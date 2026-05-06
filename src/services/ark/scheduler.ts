import { AppRegistry, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import PushNotification from 'react-native-push-notification';

/**
 * JS-side wrapper around the native ArkBackgroundScheduler module.
 *
 * Exports a flat surface (schedule / cancel) so the rest of the codebase
 * doesn't need to care which OS-level primitive is doing the work
 * (BGAppRefreshTask on iOS, WorkManager periodic on Android).
 *
 * Also owns the registration of the platform handlers — the Android
 * HeadlessJsTask receiver and the iOS event-emitter listener — both of
 * which have to be in place at JS bundle load time, BEFORE the first
 * wake fires. See registerArkBackgroundRefreshHandlers.
 */

type SchedulerNative = {
    schedule: () => Promise<void>;
    cancel: () => Promise<void>;
    markTaskCompleted: (taskId: string, success: boolean) => void;
    // Android-only — return false on iOS via the missing-method guard.
    isIgnoringBatteryOptimizations?: () => Promise<boolean>;
    openBatteryOptimizationSettings?: () => Promise<void>;
    getDeviceManufacturer?: () => Promise<string>;
};

function getNative(): SchedulerNative | null {
    return (NativeModules.ArkBackgroundScheduler as SchedulerNative | undefined) ?? null;
}

export async function scheduleArkBackgroundRefresh(): Promise<void> {
    const native = getNative();
    if (!native) {
        console.warn('[Ark scheduler] native module unavailable — schedule() is a no-op');
        return;
    }
    await native.schedule();
}

export async function cancelArkBackgroundRefresh(): Promise<void> {
    const native = getNative();
    if (!native) return;
    await native.cancel();
}

/**
 * Android-only probe: is the OS treating Cypher Box as exempt from
 * battery-optimisation throttling?
 *
 * Returns true on iOS (no equivalent constraint — iOS background tasks
 * are managed by BGTaskScheduler with budget per app, not by a per-app
 * allowlist) and on Android <23 (pre-Doze).
 *
 * On Android 6+ (Doze era) returns the actual OS allowlist state. False
 * is the bad case: AlarmManager fires can be deferred indefinitely
 * during deep Doze, especially on Samsung One UI / Xiaomi MIUI / similar
 * vendor-specific battery managers.
 */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const native = getNative();
    if (!native?.isIgnoringBatteryOptimizations) return true;
    try {
        return await native.isIgnoringBatteryOptimizations();
    } catch (err: any) {
        if (__DEV__) {
            console.log('[Ark scheduler] battery probe failed:', err?.message ?? err);
        }
        // Conservative: if we can't tell, assume worst-case (not ignoring)
        // so the onboarding nudge fires instead of being silently
        // suppressed.
        return false;
    }
}

/**
 * Android-only: open the system Settings page where the user can move
 * Cypher Box onto the battery-optimisation allowlist. Resolves once the
 * Settings activity has been launched (not when the user has finished
 * tapping through it — the result has to be re-probed via
 * `isIgnoringBatteryOptimizations` after the user returns).
 *
 * Falls back to generic Settings.ACTION_SETTINGS if the device's stock
 * battery-allowlist activity isn't recognised. Custom ROMs occasionally
 * route the action elsewhere; the fallback is so the tap doesn't
 * become a no-op.
 *
 * No-op on iOS.
 */
export async function openBatteryOptimizationSettings(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const native = getNative();
    if (!native?.openBatteryOptimizationSettings) return;
    await native.openBatteryOptimizationSettings();
}

/**
 * Android-only: returns the lower-cased device manufacturer string
 * (e.g. "samsung", "xiaomi", "huawei", "oneplus"). Used to pick
 * vendor-specific guidance copy in the battery onboarding modal —
 * Samsung's "Battery → Unrestricted" flow has different button labels
 * than Xiaomi's "Auto-start" toggle, etc.
 *
 * Returns empty string on iOS or on probe failure (caller treats empty
 * as "generic Android" guidance).
 */
export async function getDeviceManufacturer(): Promise<string> {
    if (Platform.OS !== 'android') return '';
    const native = getNative();
    if (!native?.getDeviceManufacturer) return '';
    try {
        return await native.getDeviceManufacturer();
    } catch {
        return '';
    }
}

/**
 * One-time registration of platform task handlers. Must run from
 * index.js so both Android's AppRegistry-based headless task lookup
 * and iOS's BGTask event listener are attached before the OS routes
 * its first scheduled wake into our process.
 *
 * The orchestrator is loaded lazily inside the handler (require, not
 * import-at-top) so the index.js boot path doesn't pay the cost of
 * importing the full Ark service chain on every app start. Users who
 * never enable the toggle never load the orchestrator.
 */
export function registerArkBackgroundRefreshHandlers(): void {
    // Single PushNotification.configure call for the whole app. Set up
    // here at boot so the FCM-arrival path on Android (silent push wake)
    // has a registered onNotification before any message can arrive.
    // iOS silent-push wake is intercepted in AppDelegate.mm via the
    // ArkBackgroundScheduler native handler — the JS-side onNotification
    // never sees it, so this configure is effectively Android-only for
    // routing purposes.
    //
    // requestPermissions: false — opt-in flow requests permission via
    // ensureBgNotificationPermission() when the user enables the toggle.
    PushNotification.configure({
        requestPermissions: false,
        onNotification: (notification: any) => {
            const data = (notification && (notification.data || notification.userInfo)) || {};
            if (data && data.type === 'ark.refresh.due') {
                if (Platform.OS === 'android') {
                    // FCM data-message arrival has spun up the JS bridge.
                    // Run the orchestrator inline — no WorkManager
                    // round-trip needed since we're already alive. The
                    // orchestrator records its own telemetry; nothing to
                    // signal back to native.
                    require('./backgroundRefresh')
                        .runBackgroundRefresh('push')
                        .catch((err: unknown) => {
                            console.warn('[Ark scheduler] Android push handler threw:', err);
                        });
                }
                // iOS: native AppDelegate already handled it. We won't
                // see the notification at this layer for content-available
                // pushes — included here as defensive code in case the
                // routing changes.
            }
        },
    });

    if (Platform.OS === 'android') {
        AppRegistry.registerHeadlessTask('ArkBackgroundRefresh', () => async () => {
            const { runBackgroundRefresh } = require('./backgroundRefresh');
            const result = await runBackgroundRefresh('scheduled');
            // Return value lands in the WorkManager Result via the bridge.
            // We always succeed at the worker level — refresh-round outcome
            // is recorded in our own telemetry rather than reflected as a
            // worker retry. See ArkRefreshWorker.doWork() for the rationale.
            return result.outcome;
        });
        return;
    }

    if (Platform.OS === 'ios') {
        const native = getNative();
        if (!native) return;
        const emitter = new NativeEventEmitter(NativeModules.ArkBackgroundScheduler as any);
        emitter.addListener(
            'ArkBackgroundRefreshTaskFired',
            async (payload: { taskId?: string; trigger?: 'scheduled' | 'push' }) => {
                const taskId = payload?.taskId;
                const trigger = payload?.trigger ?? 'scheduled';
                if (!taskId) return;
                try {
                    const { runBackgroundRefresh } = require('./backgroundRefresh');
                    const result = await runBackgroundRefresh(trigger);
                    // iOS uses success/failure as a signal to the OS
                    // scheduler. Treat any clean exit as success — only
                    // hard errors and missing-seed cases mark failure.
                    // Reporting failure too liberally throttles future wakes.
                    const completedCleanly =
                        result.outcome !== 'error' && result.outcome !== 'no_seed';
                    native.markTaskCompleted(taskId, completedCleanly);
                } catch (err) {
                    console.warn('[Ark scheduler] iOS task handler threw:', err);
                    native.markTaskCompleted(taskId, false);
                }
            },
        );
    }
}

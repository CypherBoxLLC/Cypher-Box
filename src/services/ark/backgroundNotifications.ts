import { Platform } from 'react-native';
import PushNotification from 'react-native-push-notification';

/**
 * Local OS-level notifications for the background-refresh feature.
 *
 * react-native-push-notification 8.1.1 is in package.json. The library's
 * one-time `configure()` call is owned by src/services/ark/scheduler.ts
 * (registered at app boot) so the onNotification handler — which routes
 * Android silent pushes into the orchestrator — stays attached. This
 * module owns the Android channel + the iOS permission prompt only.
 */
const CHANNEL_ID = 'ark-bg-refresh';
let initialized = false;

function ensureInit(): void {
    if (initialized) return;
    if (Platform.OS === 'android') {
        PushNotification.createChannel(
            {
                channelId: CHANNEL_ID,
                channelName: 'Ark capsule refresh',
                channelDescription:
                    'Alerts about Ark capsule auto-refresh outcomes (failures, expiring capsules, unusual fees).',
                importance: 4, // HIGH — covers both high- and low-priority notifications
                vibrate: true,
            },
            () => {},
        );
    }
    initialized = true;
}

/**
 * Idempotent notification permission request.
 *
 * Called from the toggle's enable path so users see the OS prompt at the
 * moment they opt into the feature, not at app boot or randomly later.
 *
 * Returns true if alerts are allowed. iOS users who decline still get the
 * feature working (the toggle flips on), but warning notifications won't
 * surface — the in-app banner is their fallback signal.
 */
export async function ensureBgNotificationPermission(): Promise<boolean> {
    ensureInit();
    const result = await PushNotification.requestPermissions(['alert', 'sound', 'badge']);
    return Boolean(result?.alert);
}

type Priority = 'low' | 'high';

function fire(
    title: string,
    message: string,
    priority: Priority,
    extras: Record<string, any> = {},
): void {
    ensureInit();
    PushNotification.localNotification({
        channelId: CHANNEL_ID,
        title,
        message,
        priority: priority === 'high' ? 'high' : 'low',
        importance: priority === 'high' ? 'high' : 'low',
        userInfo: { source: 'ark-bg-refresh', ...extras },
        // High-priority notifications make a sound and vibrate (iOS will
        // honour the device's silent switch). Low-priority is visual only
        // — appropriate for the "couldn't auto-refresh" case which is
        // informational, not urgent.
        playSound: priority === 'high',
        soundName: priority === 'high' ? 'default' : undefined,
    });
}

export function notifyConsecutiveFailures(): void {
    fire(
        'Auto-refresh trouble',
        "Couldn't auto-refresh — tap to refresh manually.",
        'low',
    );
}

export function notifyFeeGated(feeSats: number, maxSats: number): void {
    fire(
        'Refresh fee unusually high',
        `Estimated ${feeSats} sats (limit ${maxSats}). Open Cypher Box to review.`,
        'high',
        { feeSats, maxSats },
    );
}

export function notifyExpiryWarning24h(): void {
    fire(
        'Capsule expiring soon',
        'A capsule will expire within 24 hours and auto-refresh has not run. Open Cypher Box to refresh.',
        'high',
    );
}

export function notifyExpiryWarning2h(): void {
    fire(
        'Capsule expiring NOW',
        'A capsule will expire within 2 hours. Open Cypher Box immediately to refresh.',
        'high',
    );
}

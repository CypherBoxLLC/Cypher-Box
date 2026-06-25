import { Platform } from 'react-native';
import PushNotification from 'react-native-push-notification';

import useAuthStore from '@Cypher/stores/authStore';

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
                channelName: 'Bark capsule refresh',
                channelDescription:
                    'Alerts about Bark capsule auto-refresh outcomes (failures, expiring capsules, unusual fees).',
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

/**
 * Non-prompting check of the current OS notification permission state.
 *
 * Used by the Settings banner that nudges the user into Settings → Apps →
 * Cypher Box → Notifications when reminders are toggled on in-app but the
 * OS has notifications blocked. Distinct from `ensureBgNotificationPermission`
 * which surfaces the OS prompt; this one must NEVER prompt because it runs
 * on Settings mount.
 *
 * Returns true when alerts can be shown, false otherwise. Errors resolve
 * to true (don't show a misleading "blocked" banner if the bridge hiccups).
 */
export async function areBgNotificationsEnabled(): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            // `checkPermissions` exists at runtime but is missing from the
            // shipped @types for react-native-push-notification 8.1.1, so
            // cast through `any` rather than carry a project-local type
            // augmentation just for one method.
            (PushNotification as any).checkPermissions(
                (perms: { alert?: boolean }) => {
                    resolve(Boolean(perms?.alert));
                },
            );
        } catch {
            resolve(true);
        }
    });
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

/**
 * Format the subject of the title — "{N} sats" when an amount is known,
 * "your Ark vault balance" as the generic fallback. Older alarms scheduled
 * before the sats parameter existed and arkoor-receive flows that don't
 * have sats at schedule time both fall back gracefully without breaking
 * the user-facing string.
 */
function fmtSatsSubject(satsAmount: number | undefined): string {
    if (satsAmount == null || !Number.isFinite(satsAmount) || satsAmount <= 0) {
        return 'your Bark Vault balance';
    }
    return `${Math.round(satsAmount).toLocaleString()} sats`;
}

/**
 * Body line shared across the warning schedule. Two variants: an
 * informational nudge for the early warnings (4d/48h) and an urgent
 * call-to-action for the late warnings (24h/12h/6h) that surfaces the
 * upper-bound round duration so the user knows refresh isn't instant.
 */
function fmtBody(urgent: boolean, satsKnown: boolean): string {
    if (urgent) {
        return 'Tap to refresh. Refresh takes up to an hour.';
    }
    return satsKnown
        ? 'Tap to refresh, or these sats may be lost.'
        : 'Tap to refresh, or these funds may be lost.';
}

export function notifyExpiryWarning24h(satsAmount?: number): void {
    // Source override routes the tap through the same deep-link path as
    // the scheduled warnings: ArkCapsules tab + auto-refresh on arrival.
    const subject = fmtSatsSubject(satsAmount);
    fire(
        `24 hours left to refresh ${subject} ⚠️`,
        fmtBody(true, satsAmount != null && satsAmount > 0),
        'high',
        { source: 'ark-vtxo-expiry-warn24h' },
    );
}

export function notifyExpiryWarning6h(satsAmount?: number): void {
    const subject = fmtSatsSubject(satsAmount);
    fire(
        `6 hours left to refresh ${subject} 🚨`,
        fmtBody(true, satsAmount != null && satsAmount > 0),
        'high',
        { source: 'ark-vtxo-expiry-warn6h' },
    );
}

type WarnKind = 'warn96h' | 'warn48h' | 'warn24h' | 'warn12h' | 'warn6h';

/**
 * Source IDs that identify a scheduled Ark VTXO expiry warning. Both the
 * scheduler that emits them and the tap handler in `scheduler.ts` reference
 * this list, so adding a new warning is a single edit. The legacy `warn2h`
 * entry is retained so a pre-upgrade alarm that survives the migration
 * cancel still drives the same deep-link path if it ever fires.
 */
export const ARK_EXPIRY_WARNING_SOURCES = [
    'ark-vtxo-expiry-warn96h',
    'ark-vtxo-expiry-warn48h',
    'ark-vtxo-expiry-warn24h',
    'ark-vtxo-expiry-warn12h',
    'ark-vtxo-expiry-warn6h',
    'ark-vtxo-expiry-warn2h',
] as const;

export type ArkExpiryWarningSource = (typeof ARK_EXPIRY_WARNING_SOURCES)[number];

export function isArkExpiryWarningSource(s: unknown): s is ArkExpiryWarningSource {
    return typeof s === 'string'
        && (ARK_EXPIRY_WARNING_SOURCES as readonly string[]).includes(s);
}

/**
 * Pre-expiry warning schedule. Each row defines one OS-level alarm that
 * fires `offsetMs` before a VTXO's expiry timestamp. Add a row to add a
 * warning; the schedule + cancel loops adapt automatically. Order matters
 * only for readability — the loop skips entries whose target time is
 * already past.
 *
 * Five-step escalation by design: the earliest warnings (4d, 48h) read
 * informational; the middle warnings (24h, 12h) call out the deadline
 * directly; the final warning (6h) is the urgent last reminder. 1h or
 * shorter was rejected because an Ark refresh round can itself take ten
 * to thirty minutes — a late ping wouldn't leave room to act.
 *
 * Title/body are computed at schedule time from `label` + the per-VTXO
 * `satsAmount`, so users can see both the time-left and the value at
 * risk on the lock screen without opening the app. `urgent` flips the
 * body to the "Refresh takes up to an hour" wording so the late
 * warnings tell the user that tapping kicks off a round that needs
 * time to settle.
 */
const WARN_SCHEDULE: ReadonlyArray<{
    kind: WarnKind;
    source: ArkExpiryWarningSource;
    offsetMs: number;
    label: string;
    suffix: string;
    urgent: boolean;
}> = [
    {
        kind: 'warn96h',
        source: 'ark-vtxo-expiry-warn96h',
        offsetMs: 96 * 60 * 60 * 1000,
        label: '4 days',
        suffix: '',
        urgent: false,
    },
    {
        kind: 'warn48h',
        source: 'ark-vtxo-expiry-warn48h',
        offsetMs: 48 * 60 * 60 * 1000,
        label: '2 days',
        suffix: '',
        urgent: false,
    },
    {
        kind: 'warn24h',
        source: 'ark-vtxo-expiry-warn24h',
        offsetMs: 24 * 60 * 60 * 1000,
        label: '24 hours',
        suffix: ' ⚠️',
        urgent: true,
    },
    {
        kind: 'warn12h',
        source: 'ark-vtxo-expiry-warn12h',
        offsetMs: 12 * 60 * 60 * 1000,
        label: '12 hours',
        suffix: ' ⚠️',
        urgent: true,
    },
    {
        kind: 'warn6h',
        source: 'ark-vtxo-expiry-warn6h',
        offsetMs: 6 * 60 * 60 * 1000,
        label: '6 hours',
        suffix: ' 🚨',
        urgent: true,
    },
];

/**
 * Hash a VTXO id + kind to a stable 31-bit signed integer.
 *
 * react-native-push-notification 8.1.1 treats `id` as a positive int on iOS,
 * and VTXO ids are 64-char hex+colon which the library cannot handle
 * natively. The hash is FNV-1a, stable across app restarts so cancellation
 * works against the same id we scheduled with. Collision risk across a
 * 50-VTXO wallet is statistically negligible.
 *
 * Pre-scheduled OS-level alarms (UNUserNotificationCenter on iOS,
 * AlarmManager on Android) fire even if the app is killed, the device
 * sleeps for days, no background-refresh task wakes, and no silent push
 * lands — as long as the device clock is running and notifications are
 * permitted. That's the whole point: this path is the only mitigation for
 * the "user receives via Lightning while online, then goes offline
 * indefinitely" edge case. Pre-scheduled local notifications just need
 * the clock to tick.
 *
 * Schedule is idempotent on re-schedule with the same `vtxoId` — the OS
 * replaces the existing entry. The caller is responsible for canceling on
 * VTXO state change (refreshed / spent / exited) via
 * {@link cancelVtxoExpiryWarnings} so users don't get phantom alerts about
 * funds that already moved.
 */
function notificationIdFor(vtxoId: string, kind: WarnKind): string {
    let h = 2166136261;
    const tagged = `${kind}:${vtxoId}`;
    for (let i = 0; i < tagged.length; i++) {
        h ^= tagged.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return String(h & 0x7fffffff);
}

// Migration: prior to the 2h -> 6h rollout the second warning was tagged
// `warn2h`, which produces a different hash. We need to cancel those legacy
// IDs explicitly during the first sync after the upgrade so the old alarms
// don't fire phantom "expires in 2 hours" notifications. Safe to keep around
// indefinitely: a no-op once every device has migrated through one sync tick.
function legacyWarn2hNotificationId(vtxoId: string): string {
    let h = 2166136261;
    const tagged = `warn2h:${vtxoId}`;
    for (let i = 0; i < tagged.length; i++) {
        h ^= tagged.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return String(h & 0x7fffffff);
}

export function scheduleVtxoExpiryWarnings(
    vtxoId: string,
    expiryAtMs: number,
    satsAmount?: number,
): void {
    // The user-facing toggle (label: "Capsule expiry reminders") gates
    // every part of this feature: when off we skip queueing new alarms,
    // and the OFF path in setArkBackgroundRefreshEnabled also cancels
    // anything previously queued so existing notifications die within
    // seconds of the toggle flip. The field name (`arkBgRefreshEnabled`)
    // is legacy from when the toggle gated only the silent bg-refresh
    // task; renaming the persist field requires a zustand version bump
    // and is deferred. The user-facing copy never references the field
    // name, so the cosmetic drift is contained.
    if (!useAuthStore.getState().arkBgRefreshEnabled) return;

    ensureInit();
    const now = Date.now();

    // Migration: drop any pre-upgrade `warn2h` alarm for this VTXO so it
    // doesn't fire alongside the new schedule.
    try {
        PushNotification.cancelLocalNotification(legacyWarn2hNotificationId(vtxoId));
    } catch {
        // never throws meaningfully; library has been known to no-op-warn on
        // stale ids. Ignore.
    }

    const subject = fmtSatsSubject(satsAmount);
    const satsKnown = satsAmount != null && Number.isFinite(satsAmount) && satsAmount > 0;
    for (const w of WARN_SCHEDULE) {
        const at = expiryAtMs - w.offsetMs;
        if (at <= now) continue;
        PushNotification.localNotificationSchedule({
            id: notificationIdFor(vtxoId, w.kind),
            channelId: CHANNEL_ID,
            title: `${w.label} left to refresh ${subject}${w.suffix}`,
            message: fmtBody(w.urgent, satsKnown),
            date: new Date(at),
            priority: 'high',
            importance: 'high',
            playSound: true,
            soundName: 'default',
            userInfo: { source: w.source, vtxoId },
            allowWhileIdle: true,
        });
    }
}

export function cancelVtxoExpiryWarnings(vtxoId: string): void {
    try {
        for (const w of WARN_SCHEDULE) {
            PushNotification.cancelLocalNotification(notificationIdFor(vtxoId, w.kind));
        }
        // Migration: also clear the pre-upgrade 2h alarm if still queued.
        PushNotification.cancelLocalNotification(legacyWarn2hNotificationId(vtxoId));
    } catch (err) {
        // Cancellation should never throw, but the library has been
        // observed to no-throw-but-warn on stale ids. Swallow.
        console.warn('[Ark notifications] cancelVtxoExpiryWarnings:', err);
    }
}

export function notifyDustUneconomic(
    feeSats: number,
    totalSats: number,
    vtxoCount: number,
): void {
    fire(
        'Tiny capsules at risk',
        `${vtxoCount} capsule${vtxoCount === 1 ? '' : 's'} totalling ${totalSats} sats will expire — refresh fee (${feeSats} sats) exceeds their value.`,
        'low',
        { feeSats, totalSats, vtxoCount },
    );
}

export function notifyDustStranded(
    totalSats: number,
    minRequired: number,
    vtxoCount: number,
): void {
    fire(
        'Tiny capsules need topping up',
        `${vtxoCount} capsule${vtxoCount === 1 ? '' : 's'} totalling ${totalSats} sats can't auto-refresh — round minimum is ${minRequired} sats. Send funds to yourself to combine them before expiry.`,
        'high',
        { totalSats, minRequired, vtxoCount },
    );
}

/**
 * "You got paid" — fired when a new Lightning/arkoor receive lands while the
 * app is backgrounded. When foreground, the in-app Arkoor popup
 * (useArkoorReceivePrompt) already surfaces the receive, so the caller gates
 * this on AppState to avoid a double signal.
 */
export function notifyArkReceived(sats?: number): void {
    const body =
        typeof sats === 'number' && sats > 0
            ? `You received ${sats.toLocaleString()} sats in your Bark Vault.`
            : 'You received a payment in your Bark Vault.';
    fire('Payment received', body, 'high', { sats });
}

/**
 * Fired when a refresh round has been detected stuck (ongoing past the
 * expected completion window). The in-app red "tap to recover" banner only
 * helps a user who has the app open; this push reaches them when it's closed.
 * Caller dedupes per round so this can't fire on every wake.
 */
export function notifyStuckRefresh(sats?: number): void {
    const amount =
        typeof sats === 'number' && sats > 0 ? ` (${sats.toLocaleString()} sats)` : '';
    fire(
        'Refresh stuck',
        `A capsule refresh got stuck${amount}. Open Cypher Box to recover it.`,
        'high',
    );
}

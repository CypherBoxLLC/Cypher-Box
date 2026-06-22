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
    // Source override routes the tap through the same deep-link path as
    // the scheduled warnings: ArkCapsules tab + auto-refresh on arrival.
    fire(
        'Capsule expiring soon',
        'A capsule will expire within 24 hours and auto-refresh has not run. Open Cypher Box to refresh.',
        'high',
        { source: 'ark-vtxo-expiry-warn24h' },
    );
}

export function notifyExpiryWarning6h(): void {
    fire(
        'Capsule expiring NOW',
        'A capsule will expire within 6 hours. Open Cypher Box immediately to refresh.',
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
 */
const WARN_SCHEDULE: ReadonlyArray<{
    kind: WarnKind;
    source: ArkExpiryWarningSource;
    offsetMs: number;
    title: string;
    message: string;
}> = [
    {
        kind: 'warn96h',
        source: 'ark-vtxo-expiry-warn96h',
        offsetMs: 96 * 60 * 60 * 1000,
        title: 'Capsule expiring in 4 days',
        message:
            'Some of your Ark vault balance expires in about 4 days. Open Cypher Box and refresh to keep it.',
    },
    {
        kind: 'warn48h',
        source: 'ark-vtxo-expiry-warn48h',
        offsetMs: 48 * 60 * 60 * 1000,
        title: 'Capsule expiring in 2 days',
        message:
            'Some of your Ark vault balance expires in about 48 hours. Open Cypher Box and refresh to keep it.',
    },
    {
        kind: 'warn24h',
        source: 'ark-vtxo-expiry-warn24h',
        offsetMs: 24 * 60 * 60 * 1000,
        title: 'Open Cypher Box to protect your Bitcoin ⚠️',
        message:
            'Some of your Ark vault balance expires in about 24 hours! Open the app to keep it, or it may be lost.',
    },
    {
        kind: 'warn12h',
        source: 'ark-vtxo-expiry-warn12h',
        offsetMs: 12 * 60 * 60 * 1000,
        title: 'Capsule expiring in 12 hours ⚠️',
        message:
            'Your Ark vault balance expires in about 12 hours. Open Cypher Box now and refresh to keep it safe.',
    },
    {
        kind: 'warn6h',
        source: 'ark-vtxo-expiry-warn6h',
        offsetMs: 6 * 60 * 60 * 1000,
        title: 'Act now or you may lose Bitcoin 🚨',
        message:
            'Your Ark vault balance expires in about 6 hours. Open Cypher Box now to keep it safe.',
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

    for (const w of WARN_SCHEDULE) {
        const at = expiryAtMs - w.offsetMs;
        if (at <= now) continue;
        PushNotification.localNotificationSchedule({
            id: notificationIdFor(vtxoId, w.kind),
            channelId: CHANNEL_ID,
            title: w.title,
            message: w.message,
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
            ? `You received ${sats.toLocaleString()} sats in your Ark Vault.`
            : 'You received a payment in your Ark Vault.';
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

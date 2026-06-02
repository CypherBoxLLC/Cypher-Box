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

/**
 * Schedule the 24h + 2h expiry-warning notifications for a specific VTXO.
 *
 * These are queued in the OS notification scheduler (UNUserNotificationCenter
 * on iOS, AlarmManager on Android) at the moment the VTXO is observed. They
 * fire even if the app process is killed, the device sleeps for days, no
 * background-refresh task ever wakes, and no silent push lands — as long as
 * the device clock is running and notifications are permitted.
 *
 * That's the whole point: this path is the only mitigation for the
 * "user receives via Lightning while online, then goes offline indefinitely"
 * edge case. Background refresh and silent push both need the device to
 * have signal + battery + OS goodwill. Pre-scheduled local notifications
 * just need the clock to tick.
 *
 * Idempotent on re-schedule with the same `vtxoId` — the OS replaces the
 * existing entry. The caller is responsible for canceling on VTXO state
 * change (refreshed / spent / exited) via {@link cancelVtxoExpiryWarnings}
 * so users don't get phantom alerts about funds that already moved.
 *
 * vtxoId is hashed to a 31-bit signed integer because the underlying
 * library (react-native-push-notification 8.1.1) treats `id` as a
 * positive int on iOS — VTXO IDs are 64-char hex+colon which the
 * library can't handle natively. Collision risk across a 50-VTXO
 * wallet is statistically negligible; if it ever bites we'll switch
 * to a longer hash + a numeric-namespace map.
 */
function notificationIdFor(vtxoId: string, kind: 'warn24h' | 'warn2h'): string {
    // FNV-1a 32-bit hash, then mask to 31 bits and prefix-tag by kind so the
    // 24h and 2h alerts for the same VTXO get distinct IDs. Stable across
    // app restarts — same input always produces same id, so cancel works.
    let h = 2166136261;
    const tagged = `${kind}:${vtxoId}`;
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
    ensureInit();
    const now = Date.now();
    const warn24hAt = expiryAtMs - 24 * 60 * 60 * 1000;
    const warn2hAt = expiryAtMs - 2 * 60 * 60 * 1000;

    if (warn24hAt > now) {
        PushNotification.localNotificationSchedule({
            id: notificationIdFor(vtxoId, 'warn24h'),
            channelId: CHANNEL_ID,
            title: 'Capsule expiring soon',
            message:
                'A capsule will expire within 24 hours. Open Cypher Box to refresh.',
            date: new Date(warn24hAt),
            priority: 'high',
            importance: 'high',
            playSound: true,
            soundName: 'default',
            userInfo: { source: 'ark-vtxo-expiry-warn24h', vtxoId },
            allowWhileIdle: true,
        });
    }
    if (warn2hAt > now) {
        PushNotification.localNotificationSchedule({
            id: notificationIdFor(vtxoId, 'warn2h'),
            channelId: CHANNEL_ID,
            title: 'Capsule expiring NOW',
            message:
                'A capsule will expire within 2 hours. Open Cypher Box immediately to refresh.',
            date: new Date(warn2hAt),
            priority: 'high',
            importance: 'high',
            playSound: true,
            soundName: 'default',
            userInfo: { source: 'ark-vtxo-expiry-warn2h', vtxoId },
            allowWhileIdle: true,
        });
    }
}

export function cancelVtxoExpiryWarnings(vtxoId: string): void {
    try {
        PushNotification.cancelLocalNotification(notificationIdFor(vtxoId, 'warn24h'));
        PushNotification.cancelLocalNotification(notificationIdFor(vtxoId, 'warn2h'));
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

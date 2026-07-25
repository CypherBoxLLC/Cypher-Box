import { PermissionsAndroid, Platform } from 'react-native';
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
                channelName: 'Lightning capsule reminders',
                channelDescription:
                    'Reminders to refresh your lightning capsules (VTXOs) before they expire.',
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
    if (Platform.OS === 'android') {
        // Android 13+ (API 33) gates notification display behind the
        // POST_NOTIFICATIONS runtime permission. react-native-push-notification
        // 8.1.1 predates that model, so its requestPermissions() never asks
        // and every notification (including the five scheduled expiry
        // warnings) is silently dropped by the OS. Found live 2026-07-07:
        // granted=false on a stock Android 14 device that had toggled
        // reminders on. Request through RN core's PermissionsAndroid
        // instead. Below API 33 the manifest declaration alone grants it.
        if (Number(Platform.Version) >= 33) {
            const res = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
            );
            return res === PermissionsAndroid.RESULTS.GRANTED;
        }
        return true;
    }
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
        return 'Tap to refresh. Refresh takes up to 3 hours.';
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
 * Every notification source whose tap should deep-link into the Capsules
 * tab: the expiry warnings (refresh is the action), payment-received
 * (see what landed), and refresh-complete (see the fresh capsules; the
 * visit also reconciles any stale locked/pulsing UI state). The tap
 * handler in notificationHandler.ts matches against this.
 */
export function isArkCapsuleTapSource(s: unknown): boolean {
    return (
        isArkExpiryWarningSource(s) ||
        s === 'ark-received' ||
        s === 'ark-refresh-complete'
    );
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

// --- Stuck-refresh SWAP-OUT notifications -----------------------------------
//
// A separate notification category from the five refresh warnings above.
// These fire ONLY when a refresh round is wedged (stuck past 2× the round
// interval, per useArkSync) AND the Locked funds are near their pre-refresh
// expiry. At that point telling the user to "tap to refresh" is wrong (the
// refresh is what's stuck). Instead these say "move your funds out" and their
// tap deep-links to ArkStuckCapsuleScreen (cancel the wedged round + swap to
// another wallet), not the auto-refresh path.
//
// Product decision (2026-07-15): the 24h refresh warning stays as-is (a
// freshly received arkoor VTXO legitimately has a 24-48h TTL, so refresh is
// still the right first action there); only from 12h down does a stuck round
// escalate to "swap out". So the schedule is 12h / 6h / 3h. The refresh 12h/6h
// warnings are already cancelled the moment a VTXO goes Locked (it drops out
// of the spendable set the scheduler reconciles against), so there is no
// double-notification: these replace them for the stuck-and-locked window.
type StuckSwapKind = 'swap12h' | 'swap6h' | 'swap3h';

export const ARK_STUCK_SWAP_SOURCES = [
    'ark-vtxo-stuck-swap12h',
    'ark-vtxo-stuck-swap6h',
    'ark-vtxo-stuck-swap3h',
] as const;

export type ArkStuckSwapSource = (typeof ARK_STUCK_SWAP_SOURCES)[number];

export function isArkStuckSwapSource(s: unknown): s is ArkStuckSwapSource {
    return typeof s === 'string'
        && (ARK_STUCK_SWAP_SOURCES as readonly string[]).includes(s);
}

const STUCK_SWAP_SCHEDULE: ReadonlyArray<{
    kind: StuckSwapKind;
    source: ArkStuckSwapSource;
    offsetMs: number;
    label: string;
    suffix: string;
}> = [
    {
        kind: 'swap12h',
        source: 'ark-vtxo-stuck-swap12h',
        offsetMs: 12 * 60 * 60 * 1000,
        label: '12 hours',
        suffix: ' ⚠️',
    },
    {
        kind: 'swap6h',
        source: 'ark-vtxo-stuck-swap6h',
        offsetMs: 6 * 60 * 60 * 1000,
        label: '6 hours',
        suffix: ' 🚨',
    },
    {
        kind: 'swap3h',
        source: 'ark-vtxo-stuck-swap3h',
        offsetMs: 3 * 60 * 60 * 1000,
        label: '3 hours',
        suffix: ' 🚨',
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
function notificationIdFor(vtxoId: string, kind: WarnKind | StuckSwapKind): string {
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

/**
 * Schedule the 12h/6h/3h "move your funds out" alarms for a Locked VTXO whose
 * refresh round is stuck. `expiryAtMs` is the VTXO's pre-refresh expiry (the
 * deadline the stuck round failed to extend). Mirrors
 * {@link scheduleVtxoExpiryWarnings}: gated on the reminders toggle, idempotent
 * by id, skips levels already past. Cancellation on state change is the
 * caller's job via {@link cancelVtxoStuckSwapWarnings}.
 */
export function scheduleVtxoStuckSwapWarnings(
    vtxoId: string,
    expiryAtMs: number,
    satsAmount?: number,
): void {
    if (!useAuthStore.getState().arkBgRefreshEnabled) return;
    ensureInit();
    const now = Date.now();
    const subject = fmtSatsSubject(satsAmount);
    for (const w of STUCK_SWAP_SCHEDULE) {
        const at = expiryAtMs - w.offsetMs;
        if (at <= now) continue;
        PushNotification.localNotificationSchedule({
            id: notificationIdFor(vtxoId, w.kind),
            channelId: CHANNEL_ID,
            title: `Refresh stuck: move ${subject} out${w.suffix}`,
            message: `${w.label} left before expiry. Tap to move your funds to another wallet.`,
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

export function cancelVtxoStuckSwapWarnings(vtxoId: string): void {
    try {
        for (const w of STUCK_SWAP_SCHEDULE) {
            PushNotification.cancelLocalNotification(notificationIdFor(vtxoId, w.kind));
        }
    } catch (err) {
        console.warn('[Ark notifications] cancelVtxoStuckSwapWarnings:', err);
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
        'Spend your tiny capsules',
        `${vtxoCount} capsule${vtxoCount === 1 ? '' : 's'} totalling ${totalSats} sats ${vtxoCount === 1 ? 'is' : 'are'} below the ${minRequired}-sat refresh minimum, so ${vtxoCount === 1 ? "it can't" : "they can't"} auto-refresh. Spend ${vtxoCount === 1 ? 'it' : 'them'} in a payment before ${vtxoCount === 1 ? 'it expires' : 'they expire'}.`,
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
    // Dedicated source so the tap deep-links to the Capsules tab (see
    // isArkCapsuleTapSource); the default 'ark-bg-refresh' source is
    // ignored by the tap handler.
    fire('Payment received', body, 'high', { source: 'ark-received', sats });
}

/**
 * "Refresh done" — fired when a refresh round finalizes while the app is
 * backgrounded. Complements the in-app refreshing indicator: users who
 * kicked off a batch refresh (rounds can take up to an hour) and switched
 * away get a definitive completion signal instead of re-opening the app
 * to check. Foreground is deliberately not notified; the Capsules UI is
 * the signal there. Caller dedupes per movement id.
 */
export function notifyArkRefreshComplete(capsuleCount?: number): void {
    const subject =
        typeof capsuleCount === 'number' && capsuleCount > 0
            ? `${capsuleCount} capsule${capsuleCount === 1 ? '' : 's'}`
            : 'Your capsules';
    fire(
        'Refresh complete',
        `${subject} refreshed successfully. Fresh expiry is locked in.`,
        'low',
        { source: 'ark-refresh-complete', capsuleCount },
    );
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

/**
 * Fire the stuck-refresh SWAP-OUT notification immediately, with the same
 * content + source as the scheduled 12h warning so the tap deep-links to
 * ArkStuckCapsuleScreen. Used by the in-app dev test trigger to exercise the
 * notification path without waiting for a real stuck round near expiry.
 */
export function notifyStuckSwapNow(satsAmount?: number): void {
    const subject = fmtSatsSubject(satsAmount);
    fire(
        `Refresh stuck: move ${subject} out ⚠️`,
        '12 hours left before expiry. Tap to move your funds to another wallet.',
        'high',
        { source: 'ark-vtxo-stuck-swap12h' },
    );
}

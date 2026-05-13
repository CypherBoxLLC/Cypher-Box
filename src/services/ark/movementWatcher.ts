import {
    WalletNotification_Tags,
    type Movement,
    type NotificationHolderInterface,
} from '@secondts/bark-react-native';

import { runBackgroundRefresh } from './backgroundRefresh';
import { getArkWalletHandle } from './walletHandle';

/**
 * Long-lived consumer of the bark wallet's notification stream.
 *
 * Why this exists: Lightning receives land in Bark as arkoor VTXOs that
 * sit under an Ark-server-trust assumption until refreshed (see project
 * memory `project_arkoor_lightning_trust_model`). The scheduled
 * background-refresh closes that trust window on its wake cadence
 * (~hours) — fine for an idle wallet, but every minute a Lightning
 * receive sits unrefreshed is a minute the user's funds are
 * server-trusted instead of chain-enforced.
 *
 * The bark FFI exposes `wallet.notifications()` returning a pull-based
 * `NotificationHolder` that emits `MovementCreated` events the moment a
 * new VTXO materialises. We loop on `nextNotification()` and fire
 * `runBackgroundRefresh('arrival')` whenever a new VTXO lands. The
 * orchestrator's `minGapBetweenSuccessMsArrival` (60s) coalesces rapid
 * arrivals and bounds the cost of micro-payment spam.
 *
 * Lifecycle: started when a wallet handle opens, stopped when it
 * clears. Idempotent — calling start twice is a no-op. The loop tears
 * itself down cleanly when `stopArkMovementWatcher` is invoked or when
 * the underlying stream is shut by the wallet being destroyed.
 */

let active = false;
let holder: NotificationHolderInterface | null = null;
let cancelled = false;

/**
 * Debounce arrival triggers. A single LN receive in Bark fires up to three
 * movement events within ~400ms (MovementUpdated → MovementCreated →
 * MovementUpdated when the round commits). Without coalescing we'd invoke
 * `runBackgroundRefresh` three times in rapid succession, AND we'd race
 * against bark's own commit pipeline — a refresh fired ~50ms after the
 * receive round committed throws `BarkError.Internal` because the new VTXO
 * isn't yet refreshable in the wallet's state machine, even though
 * `allVtxos()` already reports it Spendable.
 *
 * The 3-second window batches receive bursts into one round and gives
 * bark's internal state ~3s to settle past the just-completed round.
 */
const ARRIVAL_DEBOUNCE_MS = 3000;
let pendingArrivalTimer: ReturnType<typeof setTimeout> | null = null;
let pendingArrivalInFlight = false;

export function startArkMovementWatcher(): void {
    console.log('[Ark watcher] startArkMovementWatcher() called, active=', active);
    if (active) return;
    const handle = getArkWalletHandle();
    if (!handle) {
        console.warn('[Ark watcher] start called with no handle — skipping');
        return;
    }
    active = true;
    cancelled = false;
    console.log('[Ark watcher] kicking runLoop');
    void runLoop(handle);
}

export function stopArkMovementWatcher(): void {
    if (!active) return;
    cancelled = true;
    // Unblock the currently pending `nextNotification()` so the loop
    // exits its await promptly. The holder is destroyed inside the loop
    // once it observes the cancellation, NOT here — destroying it from
    // outside the loop while the await is still in flight risks a
    // use-after-free on the Rust side.
    try {
        holder?.cancelNextNotificationWait();
    } catch (err) {
        console.warn('[Ark watcher] cancel wait threw:', err);
    }
}

async function runLoop(handle: ReturnType<typeof getArkWalletHandle>): Promise<void> {
    if (!handle) {
        console.warn('[Ark watcher] runLoop with no handle');
        active = false;
        return;
    }
    console.log('[Ark watcher] runLoop entering, calling handle.notifications()');
    try {
        holder = await handle.notifications();
        console.log('[Ark watcher] holder obtained, entering wait loop');
        while (!cancelled) {
            const notif = await holder.nextNotification();
            console.log('[Ark watcher] nextNotification resolved, notif=', notif ? `tag=${notif.tag}` : 'null/cancelled');
            if (cancelled) break;
            // null signals stream cancelled or wallet shut down permanently.
            if (!notif) break;
            try {
                handleNotification(notif);
            } catch (err) {
                console.warn('[Ark watcher] handler threw:', err);
            }
        }
        console.log('[Ark watcher] loop exited, cancelled=', cancelled);
    } catch (err: any) {
        console.warn('[Ark watcher] loop crashed:', err?.message ?? err);
    } finally {
        // Destroy the holder explicitly so the Rust drop runs while the
        // wallet handle is still alive. Skipping this leaves the broadcast
        // receiver pinned until GC.
        try {
            (holder as any)?.uniffiDestroy?.();
        } catch (err) {
            console.warn('[Ark watcher] holder destroy threw:', err);
        }
        holder = null;
        active = false;
    }
}

function handleNotification(notif: { tag: string; inner?: any }): void {
    // Movement lifecycle in bark fires:
    //   MovementCreated  (status=pending, outputVtxoIds=[])  ← VTXO doesn't exist yet
    //   MovementUpdated  (status=successful, outputVtxoIds=[…])  ← VTXO landed in datadir
    // Listen to both — the orchestrator's eligibility scan decides whether
    // anything is actually worth refreshing.
    if (
        notif.tag !== WalletNotification_Tags.MovementCreated &&
        notif.tag !== WalletNotification_Tags.MovementUpdated
    ) {
        return;
    }
    const movement: Movement | undefined = notif.inner?.movement;
    if (!movement) return;
    console.log(
        '[Ark watcher]', notif.tag,
        'subsystem=', movement.subsystemKind,
        'status=', movement.status,
        'outputs=', movement.outputVtxoIds?.length ?? 0,
        'effectiveSats=', movement.effectiveBalanceSats?.toString?.() ?? movement.effectiveBalanceSats,
    );
    // Gate arrival triggers to receive-subsystem movements only. Refresh
    // / send / board / exit subsystems also fire Movement events as their
    // rounds progress — including the cancellation transition when the
    // user cancels a round mid-flight. Without this filter, a user-
    // initiated cancel produced its own MovementUpdated, the watcher
    // re-fired runBackgroundRefresh('arrival'), and the freshly-unlocked
    // VTXOs got re-locked into yet another refresh round 3s later (the
    // debounce window). Observed in production logs 2026-05-13 09:13:
    // cancel succeeded at 09:13:04 → pendingRound=0; new refresh fired
    // at 09:13:07 → pendingRound=1041 again.
    if (movement.subsystemKind !== 'receive') {
        return;
    }
    scheduleDebouncedArrival();
}

function scheduleDebouncedArrival(): void {
    if (pendingArrivalInFlight) {
        // An arrival refresh is already running. Skip — the orchestrator's
        // own rate-limit handles successive triggers, and we don't want to
        // queue a follow-on while one is in flight.
        return;
    }
    if (pendingArrivalTimer !== null) {
        // A debounce is already armed. Extend it by clearing+rescheduling so
        // a burst of movement events keeps pushing the fire time out until
        // the burst settles. Capped naturally by ARRIVAL_DEBOUNCE_MS being
        // short relative to typical movement-event spacing.
        clearTimeout(pendingArrivalTimer);
    }
    pendingArrivalTimer = setTimeout(() => {
        pendingArrivalTimer = null;
        pendingArrivalInFlight = true;
        console.log('[Ark watcher] debounce fired, invoking runBackgroundRefresh(arrival)');
        runBackgroundRefresh('arrival')
            .catch((err: any) => {
                console.warn('[Ark watcher] arrival refresh threw:', err?.message ?? err);
            })
            .finally(() => {
                pendingArrivalInFlight = false;
            });
    }, ARRIVAL_DEBOUNCE_MS);
}

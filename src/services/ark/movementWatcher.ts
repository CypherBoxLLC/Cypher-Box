import { AppState } from 'react-native';
import {
    WalletNotification_Tags,
    type Movement,
    type NotificationHolderInterface,
} from '@secondts/bark-react-native';

import useAuthStore from '@Cypher/stores/authStore';
import { notifyArkReceived } from './backgroundNotifications';
import { getArkWalletHandle } from './walletHandle';

/**
 * Long-lived consumer of the bark wallet's notification stream.
 *
 * Originally fired `runBackgroundRefresh('arrival')` on every LN receive
 * to close the arkoor server-trust window within minutes. That strategy
 * was replaced by lazy refresh: the 30s sweep in useArkSync fires
 * `runBackgroundRefresh('foreground')` only when a spendable VTXO has
 * `daysLeft < URGENCY_THRESHOLD_DAYS` (2 days). Trust window grows from
 * "minutes" to "up to several days" for fresh receives, matching bark's
 * fee schedule (0-fee refresh below 2 days) and avoiding hammering the
 * ASP during flaky periods.
 *
 * The watcher is kept for diagnostic logging of MovementCreated /
 * MovementUpdated events — useful when investigating stuck rounds or
 * receive-pipeline issues. It no longer dispatches any refresh.
 *
 * Lifecycle: started when a wallet handle opens, stopped when it
 * clears. Idempotent — calling start twice is a no-op. The loop tears
 * itself down cleanly when `stopArkMovementWatcher` is invoked or when
 * the underlying stream is shut by the wallet being destroyed.
 */

let active = false;
let holder: NotificationHolderInterface | null = null;
let cancelled = false;
// Promise that resolves when the runLoop has fully torn down — used by
// `stopArkMovementWatcher` to give callers an awaitable signal that the
// holder's `uniffiDestroy()` has run and bark's SQLite file descriptors
// are actually released. Without this, callers like
// `clearArkWalletHandle` (and downstream `resetArkWalletState` →
// `deleteArkDatadir`) race the watcher's async drop and bark rejects
// the next `Wallet.open/create` with `BarkError.Database` because
// stale FDs are still pinning the old datadir.
let runLoopPromise: Promise<void> | null = null;

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
    runLoopPromise = runLoop(handle);
}

export async function stopArkMovementWatcher(): Promise<void> {
    if (!active) {
        // Cover the edge case where stop is called after a previous
        // stop's promise hasn't fully resolved yet (e.g. delete-then-
        // create happening fast). If a promise is still in flight,
        // await it so the caller gets a clean teardown signal.
        if (runLoopPromise) await runLoopPromise;
        return;
    }
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
    // Wait for the runLoop to actually finish — that's where the
    // holder's uniffiDestroy() runs in the finally block, releasing the
    // last SQLite FD bark holds for this wallet. Without awaiting, the
    // caller proceeds to wipe/recreate the datadir while bark still has
    // open file descriptors and the next Wallet.open/create errors out
    // with BarkError.Database.
    if (runLoopPromise) {
        try {
            await runLoopPromise;
        } catch (err) {
            console.warn('[Ark watcher] runLoop awaited error:', err);
        }
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
        runLoopPromise = null;
    }
}

function handleNotification(notif: { tag: string; inner?: any }): void {
    // Movement lifecycle in bark fires:
    //   MovementCreated  (status=pending, outputVtxoIds=[])  ← VTXO doesn't exist yet
    //   MovementUpdated  (status=successful, outputVtxoIds=[…])  ← VTXO landed in datadir
    // Logged for diagnostics + drives the Arkoor-receive popup. Lazy
    // refresh from useArkSync still handles its own dispatch based on
    // expiry; the popup needs movement-level latency (sub-second) because
    // it has to race auto-refresh, which fires within a few seconds of
    // the receive settling.
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

    // Push new receive VTXOs into arkArkoorPromptState so the
    // useArkoorReceivePrompt hook can surface the choice + the auto-refresh
    // gate can block them. We do this from the movement notification (not
    // from the 30s arkVtxos poll) because auto-refresh fires within a
    // couple seconds of the receive settling — a poll-driven detector
    // loses the race and the VTXO is already Locked in a refresh round
    // before the user sees the popup.
    //
    // Conditions to trigger the prompt:
    //   - tag = MovementUpdated     (Created has outputs=[]; Updated is where ids appear)
    //   - subsystemKind = receive   (subsystem strings are lowercase in this SDK)
    //   - status = successful       (means the VTXO actually exists in datadir)
    //   - outputVtxoIds non-empty   (there's a vtxo id to track)
    if (notif.tag !== WalletNotification_Tags.MovementUpdated) return;
    const subsystem = String(movement.subsystemKind ?? '').toLowerCase();
    const status = String(movement.status ?? '').toLowerCase();
    if (subsystem !== 'receive') return;
    if (status !== 'successful') return;
    const ids: string[] = movement.outputVtxoIds ?? [];
    if (!ids.length) return;

    // Extract sats from the movement so the prompt state entry carries
    // the amount directly. This decouples the popup from arkVtxos (which
    // only contains Spendable; if the SDK Locks the just-received vtxo
    // immediately into a round, the popup needs the amount from somewhere
    // else). Bark reports bigint; coerce to a plain number at the JS
    // boundary (the amounts fit comfortably in Number for any realistic
    // single-receive sat amount).
    const rawSats = movement.effectiveBalanceSats;
    const sats =
        typeof rawSats === 'bigint'
            ? Number(rawSats)
            : typeof rawSats === 'number'
            ? rawSats
            : 0;
    const store = useAuthStore.getState();
    const cur = store.arkArkoorPromptState ?? {};
    const now = Date.now();
    let mutated = false;
    const next = { ...cur };
    for (const id of ids) {
        if (next[id]) continue; // already tracked (avoid re-prompt)
        next[id] = { status: 'pending' as const, observedAt: now, sats };
        mutated = true;
        console.log(
            '[Ark watcher] queued arkoor prompt for',
            id.slice(0, 12),
            'sats=',
            sats,
        );
    }
    if (mutated) {
        store.setArkArkoorPromptState(next);
        // Money-received push. Foreground is already covered by the in-app
        // Arkoor popup (useArkoorReceivePrompt), so only buzz when
        // backgrounded to avoid a double signal. Fires once per receive
        // movement (sats = the movement amount), not once per output id.
        if (AppState.currentState !== 'active') {
            notifyArkReceived(sats);
        }
    }
}

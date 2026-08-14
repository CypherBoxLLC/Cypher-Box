import { useEffect, useState } from 'react';

import useAuthStore from '@Cypher/stores/authStore';

import { sumMidRoundVtxos } from './vtxos';

/**
 * Global "cancel-in-flight" state for the Ark capsule refresh UI.
 *
 * Why module-level instead of component-local: the V-capsules tab can
 * unmount mid-cancel (user taps the X, then navigates back to Home).
 * Local React state vanishes on unmount and the row's X button reappears
 * on remount even though the round is still locked, inviting the user
 * to spam-tap cancel and triggering 3 more bark lock-timeout retries
 * per tap. Hoisting this out keeps the "Cancelling" gate up across the
 * full lifetime of the in-flight cancel, regardless of which screen is
 * mounted.
 *
 * Why global rather than per-VTXO: `cancelArkPendingRound` has no
 * per-VTXO scope — bark RoundState carries no VTXO mapping, so the
 * cancel handler iterates every ongoing round. One flag covers it.
 *
 * Auto-clear is driven from inside this module so it works even when
 * the screen is unmounted: we subscribe to `useAuthStore` once per
 * cancel and clear when pending-round sats drop to 0 (real round
 * settlement), with a 2-minute safety timeout in case bark stalls
 * indefinitely.
 */

const CANCELLING_SAFETY_TIMEOUT_MS = 2 * 60 * 1000;

let cancelling = false;
let cancellingStart: number | null = null;
const listeners = new Set<() => void>();
let storeUnsub: (() => void) | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;

function pendingRoundSatsFromStore(): number {
    const s = useAuthStore.getState();
    // Must count delegated refreshes too. This value is the signal for "the
    // round has let go of the funds", so counting only `Locked` made it read 0
    // for the entire life of a delegated round and cleared the cancelling gate
    // immediately. See isVtxoMidRound.
    return sumMidRoundVtxos(s.arkVtxos, s.arkRefreshingVtxoIds).sats;
}

function notify(): void {
    for (const l of listeners) l();
}

function clearInternal(): void {
    cancelling = false;
    cancellingStart = null;
    if (storeUnsub) {
        storeUnsub();
        storeUnsub = null;
    }
    if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
    }
    notify();
}

function maybeClear(): void {
    if (!cancelling) return;
    if (pendingRoundSatsFromStore() === 0) {
        clearInternal();
        return;
    }
    if (cancellingStart !== null && Date.now() - cancellingStart > CANCELLING_SAFETY_TIMEOUT_MS) {
        clearInternal();
    }
}

export function getArkCancelling(): boolean {
    return cancelling;
}

export function setArkCancelling(value: boolean): void {
    if (value === cancelling) return;
    if (value) {
        cancelling = true;
        cancellingStart = Date.now();
        // Re-check on every auth-store update; the only field we care
        // about is arkVtxos, but resubscribing per-field needs the
        // subscribeWithSelector middleware which isn't wired here.
        // Recomputing pendingRoundSats on unrelated updates is cheap.
        storeUnsub = useAuthStore.subscribe(() => maybeClear());
        safetyTimer = setTimeout(() => maybeClear(), CANCELLING_SAFETY_TIMEOUT_MS + 1000);
        notify();
    } else {
        clearInternal();
    }
}

/**
 * React hook — subscribes to the global cancelling flag and re-renders
 * the caller when it flips.
 */
export function useArkCancelling(): boolean {
    const [value, setValue] = useState<boolean>(cancelling);
    useEffect(() => {
        const l = () => setValue(cancelling);
        listeners.add(l);
        // Sync in case the flag changed between initial render and
        // effect attach (e.g. screen remount mid-cancel).
        l();
        return () => {
            listeners.delete(l);
        };
    }, []);
    return value;
}

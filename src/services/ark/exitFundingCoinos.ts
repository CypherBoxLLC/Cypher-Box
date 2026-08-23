/**
 * Fund the exit-fee reserve from a CoinOS balance.
 *
 * CoinOS is first of the wallet sources because it settles without a signing
 * device and is where most spare sats sit. The send is an ordinary on-chain
 * withdrawal to the Bark wallet's own on-chain address, so it needs no ASP and
 * works during an outage, which is exactly when the reserve tends to be needed.
 *
 * Two ordering rules matter and neither is obvious:
 *
 *   1. ARM THE RESERVE FIRST. sync.ts boards confirmed on-chain funds into Ark
 *      unless `arkExitFeeReserveSats` says to hold them. During an active exit
 *      boarding is already off, but the precautionary case (topping up BEFORE
 *      starting an exit) would otherwise quietly undo itself on the next tick.
 *      Arming before sending means the sats are protected the moment they land.
 *
 *   2. CHECK FOR A DUPLICATE BEFORE SENDING. A previous attempt whose reply was
 *      lost is already on its way, and sending again pays twice. See
 *      services/coinos/withdrawGuard.
 *
 * Network calls are injected so this can be tested without standing up the API
 * layer, and so the caller keeps control of the auth-bearing fetches.
 */

import {
    findRecentMatchingWithdrawal,
    isCoinosWithdrawIndeterminate,
    type CoinosPaymentLike,
} from '../coinos/withdrawGuard';

import { planExitFunding } from './exitFundingPlan';

export type CoinosExitFundingDeps = {
    /** Bark's own on-chain address. Local BDK, no ASP. */
    getOnchainAddress: () => Promise<string>;
    /** Recent CoinOS payments, for the duplicate check. */
    getRecentPayments: () => Promise<{ payments?: CoinosPaymentLike[] } | null>;
    /** Estimated miner fee for this send, in sats. */
    estimateFeeSats: (address: string, amountSats: number) => Promise<number>;
    /** Perform the withdrawal. Should carry the idempotency key. */
    send: (address: string, amountSats: number, idempotencyKey: string) => Promise<string>;
    /** Persist the reserve so auto-board leaves the funds alone. */
    armReserve: (sats: number) => void;
    now?: () => number;
};

export type CoinosExitFundingRequest = {
    shortfallSats: number;
    availableSats: number | null;
    /** Reserve already armed, so arming never lowers an existing floor. */
    currentReserveSats?: number;
    idempotencyKey: string;
};

export type CoinosExitFundingResult =
    | { ok: true; txid: string | null; sentSats: number; feeSats: number; partial: boolean }
    | { ok: false; reason: string; duplicate?: boolean; indeterminate?: boolean };

export async function fundExitFeesFromCoinos(
    req: CoinosExitFundingRequest,
    deps: CoinosExitFundingDeps,
): Promise<CoinosExitFundingResult> {
    const now = deps.now ?? (() => Date.now());

    const address = await deps.getOnchainAddress();
    if (!address) {
        return { ok: false, reason: 'Could not get the on-chain address for the fee reserve.' };
    }

    // Fee first: the plan cannot be sized without it, because the fee comes off
    // the top of the source balance.
    let feeSats = 0;
    try {
        feeSats = Math.max(0, Math.floor((await deps.estimateFeeSats(address, req.shortfallSats)) || 0));
    } catch {
        // An unavailable estimate must not block funding. planExitFunding
        // handles fee 0 and the provider still charges what it charges.
        feeSats = 0;
    }

    const plan = planExitFunding({
        shortfallSats: req.shortfallSats,
        availableSats: req.availableSats,
        feeSats,
    });
    if (!plan.ok) return { ok: false, reason: plan.reason };

    // Duplicate check before spending anything. A failed history read does NOT
    // block: being unable to read history is not evidence of a duplicate.
    try {
        const recent = await deps.getRecentPayments();
        const dupe = findRecentMatchingWithdrawal(recent?.payments, {
            address,
            amountSats: plan.sendSats,
            now: now(),
        });
        if (dupe) {
            return {
                ok: false,
                duplicate: true,
                reason: 'A matching top-up already went out a moment ago. Check your CoinOS history rather than sending again.',
            };
        }
    } catch {
        // Continue: see above.
    }

    // Arm BEFORE sending, so the sats are protected the instant they confirm.
    // Never lower an existing floor: a bigger reserve someone already chose is
    // not ours to shrink.
    const target = Math.max(req.currentReserveSats ?? 0, (req.currentReserveSats ?? 0) + plan.sendSats);
    deps.armReserve(target);

    try {
        const raw = await deps.send(address, plan.sendSats, req.idempotencyKey);
        // CoinOS answers with a JSON body on success and a bare string on
        // refusal, the same shape the withdraw screen already contends with.
        let txid: string | null = null;
        if (typeof raw === 'string' && raw.trim().startsWith('{')) {
            try {
                txid = JSON.parse(raw)?.txid ?? null;
            } catch {
                txid = null;
            }
        } else if (typeof raw === 'string' && raw.trim()) {
            return { ok: false, reason: raw.trim() };
        }
        return { ok: true, txid, sentSats: plan.sendSats, feeSats, partial: plan.partial };
    } catch (err) {
        if (isCoinosWithdrawIndeterminate(err)) {
            // Outcome unknown. The reserve stays armed on purpose: if the send
            // did go through, the sats must not be boarded away when they land.
            return {
                ok: false,
                indeterminate: true,
                reason:
                    (err as Error)?.message ??
                    'This top-up may already have been sent. Check your CoinOS history before trying again.',
            };
        }
        return { ok: false, reason: (err as Error)?.message ?? 'The top-up could not be sent.' };
    }
}

/**
 * How much to send when funding the exit-fee reserve from another wallet.
 *
 * Separated from the screen and from the provider because the arithmetic is
 * where this goes wrong, and the failure is expensive in both directions:
 * sending too little leaves the exit stalled after the user believed they had
 * fixed it, and sending everything strips a wallet they may still need.
 *
 * The number that matters is what LANDS on-chain, not what leaves. The miner
 * fee comes out on top, so a wallet holding exactly the shortfall cannot
 * deliver the shortfall.
 */

import { MIN_USEFUL_FUNDING_SATS } from './exitFundingSources';

export type ExitFundingPlanInput = {
    /** Sats the reserve is short by. */
    shortfallSats: number;
    /** Spendable sats at the source, or null when unknown. */
    availableSats: number | null;
    /** Estimated miner fee for this send. */
    feeSats: number;
    /** Floor below which a contribution cannot pay its own way. */
    minUsefulSats?: number;
};

export type ExitFundingPlan =
    | {
          ok: true;
          /** Sats to hand the provider, i.e. what should land. */
          sendSats: number;
          /** Total leaving the source, send + fee. */
          totalCostSats: number;
          /** True when this does not close the whole shortfall. */
          partial: boolean;
      }
    | { ok: false; reason: string };

export function planExitFunding(input: ExitFundingPlanInput): ExitFundingPlan {
    const minUseful = input.minUsefulSats ?? MIN_USEFUL_FUNDING_SATS;
    const shortfall = Math.max(0, Math.floor(input.shortfallSats || 0));
    const fee = Math.max(0, Math.floor(input.feeSats || 0));

    if (shortfall <= 0) {
        return { ok: false, reason: 'The exit-fee reserve is already funded.' };
    }

    // An unreadable balance is not a zero balance. Plan for the full shortfall
    // and let the provider reject it if the funds are not there: refusing here
    // would strand a user whose balance simply failed to load.
    const available =
        typeof input.availableSats === 'number' && Number.isFinite(input.availableSats)
            ? Math.max(0, Math.floor(input.availableSats))
            : null;

    if (available == null) {
        return {
            ok: true,
            sendSats: shortfall,
            totalCostSats: shortfall + fee,
            partial: false,
        };
    }

    // The fee is charged on top, so the most that can LAND is balance - fee.
    const maxLanding = available - fee;

    if (maxLanding < minUseful) {
        return {
            ok: false,
            // Name the fee explicitly. "Insufficient balance" reads as a lie to
            // someone looking at a balance larger than the amount they typed.
            reason:
                fee > 0
                    ? `Not enough to cover the ${fee.toLocaleString()} sat network fee and a useful top-up.`
                    : 'Balance is too small to be worth sending.',
        };
    }

    if (maxLanding >= shortfall) {
        return {
            ok: true,
            sendSats: shortfall,
            totalCostSats: shortfall + fee,
            partial: false,
        };
    }

    // Partial funding is still progress: it can be the difference between an
    // exit that finishes and one that stalls. Send what fits and say so.
    return {
        ok: true,
        sendSats: maxLanding,
        totalCostSats: available,
        partial: true,
    };
}

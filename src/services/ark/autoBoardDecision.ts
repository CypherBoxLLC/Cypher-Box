/**
 * Pure helper: should the on-chain (BDK) balance be boarded into Ark, and how
 * much must stay behind.
 *
 * Deliberately free of imports beyond the sibling pure helper, so it stays
 * unit-testable without the native bark module.
 *
 * Why this exists as a decision function rather than inline in sync.ts: the
 * on-chain wallet is where unilateral-exit CPFP fees are paid from, so boarding
 * the wrong amount does not merely misplace funds, it disarms the exit. Two
 * separate defects lived in the inline version:
 *
 *   1. The hold target was the ARMED reserve only. A user who funds toward a
 *      recommendation far above what they armed (the recommendation moves with
 *      exit depth and was measured at 233,120 against an armed 3,654) would
 *      have the difference boarded straight back into Ark, undoing the top-up
 *      they had just made specifically to enable the exit.
 *   2. The unarmed path called boardAll with NO board-minimum guard, while the
 *      armed path guarded correctly. A sub-minimum on-chain balance can never
 *      board, so it retried every sync tick forever. The asymmetry was
 *      acknowledged in the old comment as "the exact old boardAll behavior".
 */
import { resolveExitReserveTarget } from './exitReserveTarget';

export type AutoBoardDecision =
    | { action: 'skip'; reason: 'exit-in-progress' | 'nothing-onchain' | 'board-in-flight' }
    | { action: 'hold'; reason: 'below-board-minimum'; surplusSats: number; holdSats: number }
    | { action: 'board-amount'; sats: number; holdSats: number }
    | { action: 'board-all'; holdSats: 0 };

export type AutoBoardInput = {
    confirmedSats: number;
    pendingBoardSats: number;
    exitInProgress: boolean;
    /** What the user armed, if anything. */
    armedReserveSats: number | null | undefined;
    /** Last computed exit-cost estimate, if one has been persisted. */
    recommendedReserveSats: number | null | undefined;
    /** Server board minimum. Below this a board can never succeed. */
    minBoardSats: number;
    /** Slack so boardAmount's own fee cannot dip the leftover below the hold. */
    boardFeeHeadroomSats: number;
};

export function decideAutoBoard(input: AutoBoardInput): AutoBoardDecision {
    // An exit in progress means every VTXO is already committed and the whole
    // on-chain balance is fee money. Board nothing, whatever the numbers say.
    if (input.exitInProgress) return { action: 'skip', reason: 'exit-in-progress' };

    const confirmed = Math.max(0, Math.floor(input.confirmedSats || 0));
    if (confirmed <= 0) return { action: 'skip', reason: 'nothing-onchain' };

    // bark has not yet observed the previous board consuming its input; firing
    // again here double-boards.
    if ((input.pendingBoardSats || 0) > 0) return { action: 'skip', reason: 'board-in-flight' };

    const holdSats = resolveExitReserveTarget({
        armedSats: input.armedReserveSats,
        recommendedSats: input.recommendedReserveSats,
    });
    const minBoard = Math.max(0, Math.floor(input.minBoardSats || 0));

    if (holdSats <= 0) {
        // Nothing to protect, so boardAll keeps its original semantics and
        // leaves no dust behind. The minimum guard is new: without it this
        // retried forever on a balance that could never board.
        if (confirmed >= minBoard) return { action: 'board-all', holdSats: 0 };
        return { action: 'hold', reason: 'below-board-minimum', surplusSats: confirmed, holdSats: 0 };
    }

    const surplusSats = confirmed - holdSats - Math.max(0, Math.floor(input.boardFeeHeadroomSats || 0));
    if (surplusSats >= minBoard) return { action: 'board-amount', sats: surplusSats, holdSats };
    return { action: 'hold', reason: 'below-board-minimum', surplusSats, holdSats };
}

/**
 * "It may already have gone through."
 *
 * Every call that hands a transaction to the ASP or to the chain shares one
 * hazard: if the connection dies mid-call, we cannot tell whether it landed.
 * Reporting that as a failure is a guess, and the copy that follows a guess is
 * usually a lie. `ArkSendReviewScreen` said, verbatim, "Your funds were not
 * moved"; the exit-fee sheet said "Your Ark funds are unchanged".
 *
 * Both can be false, and a user who is told their money is untouched while it
 * is confirming goes looking for a balance that has legitimately gone.
 *
 * WHY THIS LIVES IN ITS OWN MODULE
 *
 * The first version of this guard sat inside `executeArkSend`, which covered
 * the two call sites the bug was reported against and none of the four others:
 * `exitFunding.convertToExitFees`, `offboard.offboardArkVtxos`,
 * `exit.claimArkExitsToAddress`, and `recoverOnchainBoard`. Fixing a path
 * rather than a capability leaves the next call site to reintroduce it.
 *
 * CALL SITES. Keep this list current; an audit found the Lightning ones missing
 * from it, and the list being wrong is part of why they stayed unguarded. Six
 * sites were enumerated here, all of them arkoor, on-chain or exit paths, so
 * "the Lightning branch is not on the list" never looked like an omission.
 *
 *   exit.ts                 claimArkExitsToAddress
 *   exitFunding.ts          convertToExitFees
 *   recoverOnchainBoard.ts  recoverArkOnchainBoard
 *   offboard.ts             offboardArkVtxos
 *   send.ts                 sendArkoorPayment
 *   send.ts                 sendOnchain
 *   send.ts                 dispatchLnSend          <- added 2026-09-08
 *
 * `lightning.ts#cancelArkLightningReceive` uses `looksLikeConnectionLoss`
 * directly rather than this wrapper, because it returns a discriminated result
 * instead of throwing. Same rule, different shape.
 *
 * The test to apply when adding a call: does it hand something to the ASP or
 * the chain that could still land after the connection dies? If yes, it belongs
 * here, and it belongs on this list.
 *
 * It imports nothing from the SDK on purpose, so any module can wrap a call
 * without dragging the native binding into a unit test.
 */

import { looksLikeConnectionLoss } from './networkFault';
import loc from '../../../loc';

/**
 * Error marking an outcome as UNKNOWN rather than failed.
 *
 * Callers MUST check `isArkSendIndeterminate` before reporting an error, and
 * when it is true they MUST NOT claim the funds are safe and MUST NOT re-enable
 * their send control. Re-arming is the dangerous half: for Lightning a retry
 * mints a fresh invoice and can pay twice.
 */
export type ArkSendIndeterminateError = Error & { arkSendIndeterminate: true };

/** True when the outcome is unknown and a retry is not obviously safe. */
export function isArkSendIndeterminate(err: unknown): boolean {
    return !!err && (err as { arkSendIndeterminate?: boolean }).arkSendIndeterminate === true;
}

/** Build the flagged error with a caller-supplied, user-facing sentence. */
export function makeIndeterminate(message: string): ArkSendIndeterminateError {
    const e = new Error(message) as ArkSendIndeterminateError;
    e.arkSendIndeterminate = true;
    return e;
}

/**
 * Wrap a call that may broadcast. A REFUSAL passes through untouched, because
 * the money certainly did not move and saying so is both true and useful. Only
 * a dropped connection becomes indeterminate.
 *
 * `what` names the operation in the user's own words, so the sentence reads as
 * the thing they pressed: "withdrawal", "payment", "top-up", "release".
 */
export async function runBroadcastCall<T>(run: () => Promise<T>, what: string): Promise<T> {
    try {
        return await run();
    } catch (err) {
        if (!looksLikeConnectionLoss(err)) throw err;
        throw makeIndeterminate(
            String(loc.formatString(loc.cypherbox.services.indeterminate.connection_dropped, { what })),
        );
    }
}

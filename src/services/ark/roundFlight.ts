/**
 * Is a round participation still in flight?
 *
 * WHY THIS IS NOT JUST `r.ongoing`
 *
 * bark 0.6.1's `RoundState` had `{ id, ongoing }`, and every guard that stops a
 * second refresh from being submitted read `ongoing`. bark 0.8.0 (SDK 0.26.0)
 * added `state: RoundFlowKind` and kept `ongoing` "for compatibility", defined
 * as `state` being `Pending` or `Ongoing`.
 *
 * That definition leaves out `DelegatedPending`: a delegated refresh waiting
 * for its scheduled round. It is the state every refresh this app submits sits
 * in for up to a round interval (an hour on mainnet), and it reports
 * `ongoing: false`. Read through the old test, a delegated refresh that is
 * waiting looked like "nothing in flight", so the next sync, sweep or tap
 * would submit another one over the same capsules.
 *
 * bark 0.8.0 also stopped locking inputs at registration (they lock once a
 * round attempt starts), so the capsules stay Spendable while they wait and
 * nothing else stands in the way. Server 0.8.1 refuses a delegated submission
 * over inputs a round attempt already holds; before that point a new
 * submission silently replaces the pending one.
 *
 * In flight here means waiting for a round or playing one out:
 * DelegatedPending, Pending, Ongoing. AwaitingConfirmations is not: the round
 * finished and its inputs are already spent, exactly like `ongoing: false` on
 * bark 0.6.1. Failed and Canceled are over.
 *
 * An unrecognised state counts as NOT in flight (only `ongoing` decides). The
 * opposite default could block refreshes forever on a future SDK, and a
 * capsule that is never refreshed expires; a duplicate submission is refused
 * or replaced server-side.
 */

import { RoundFlowKind } from '@secondts/bark-react-native';

const IN_FLIGHT_FLOW_NAMES = new Set(['DelegatedPending', 'Pending', 'Ongoing']);

/**
 * Variant name of a `RoundFlowKind` value.
 *
 * `RoundFlowKind` is a numeric TypeScript enum, whose runtime object maps each
 * number back to its name. Going through the name rather than comparing
 * numbers keeps this correct if a later SDK reorders the enum. Returns null
 * when the enum is not available (a unit test's stand-in for the binding) or
 * the value is unknown.
 */
export function roundFlowName(state: unknown): string | null {
    if (typeof state === 'string') return state;
    if (typeof state !== 'number') return null;
    const names = RoundFlowKind as unknown as Record<number, string> | undefined;
    const name = names?.[state];
    return typeof name === 'string' ? name : null;
}

export function isArkRoundInFlight(round: { ongoing?: boolean; state?: unknown } | null | undefined): boolean {
    if (!round) return false;
    if (round.ongoing === true) return true;
    const name = roundFlowName(round.state);
    return name != null && IN_FLIGHT_FLOW_NAMES.has(name);
}

/**
 * Did the server refuse a round submission because a round attempt already
 * holds its inputs?
 *
 * Server 0.8.1 (MR !2706) answers `SubmitRoundParticipation` over such inputs
 * with InvalidArgument and lists them under the `in-flight-inputs` metadata
 * key, "so the client can wait for the round instead of dropping them". That
 * is a refresh already in progress, not a failed one: it must not count toward
 * the refresh-failure streak or show as a failure.
 *
 * Matched on text because the binding flattens server errors into a message;
 * if the wording never matches, behaviour is what it was before.
 */
export function isInFlightInputsRefusal(err: unknown): boolean {
    const e = err as { message?: unknown; inner?: { errorMessage?: unknown; message?: unknown } } | null;
    const text = [e?.message, e?.inner?.errorMessage, e?.inner?.message]
        .filter((s): s is string => typeof s === 'string')
        .join(' ');
    return /in[-_ ]flight[-_ ]inputs?/i.test(text);
}

/** Short label for logs: the flow state when known, else ongoing/finalising. */
export function describeArkRound(round: { id?: unknown; ongoing?: boolean; state?: unknown }): string {
    const name = roundFlowName(round.state);
    return `${String(round.id)}(${name ?? (round.ongoing ? 'ongoing' : 'finalising')})`;
}

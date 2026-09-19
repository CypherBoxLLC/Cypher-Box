/**
 * chainSwap/types: provider interface for CROSS-CHAIN swaps.
 *
 * Sibling to ./lightningSwap, deliberately separate. A Lightning swap is
 * "destination creates an invoice → source pays it", which is a synchronous
 * two-party handshake. A chain swap is nothing like that: you ask a third
 * party for a rate, it hands you a deposit address, you send funds to it,
 * and some minutes later it settles a different asset to an address you
 * gave it. Different lifecycle, different failure modes, different money.
 *
 * Forcing this into LightningSwapProvider would have meant lying about
 * both. They stay separate and share nothing but conventions.
 *
 * Adding a new venue = one file in ./providers, one register() call. The
 * UI pulls from the registry and never needs editing.
 *
 * --- Holds: reported when the venue says so, inferred when it does not ---
 * A venue that cannot process a deposit automatically may park the order
 * for human review. Some venues report that as an explicit status with a
 * reason. Many do not: the order sits in an ordinary in-flight state
 * indefinitely, and a wallet cannot tell "slow" from "stuck".
 *
 * This interface handles both. A reported hold normalises to `held` and
 * escalates at once. Where the venue says nothing, a stall is inferred from
 * time without movement. Either way `pollShift` returns an escalation
 * verdict alongside the status, so the UI is never left rendering a spinner
 * over a stuck order.
 */

/** Stable, lower-case registry key. Add new venues here. */
export type ChainSwapProviderId = 'sideshift' | 'flashnet';

/**
 * An asset on a specific chain. Both halves matter and conflating them is
 * the classic bug in this domain: "USDT" is meaningless, "USDT on Tron" is
 * an address format, a fee model and a settlement time.
 *
 * `coin` and `network` use each venue's own vocabulary, normalised to
 * lower case. Providers translate to their wire format internally, so
 * callers never build venue-specific strings.
 */
export type ChainAsset = {
    /** e.g. 'btc', 'usdt' */
    readonly coin: string;
    /** e.g. 'bitcoin', 'tron', 'liquid', 'lightning' */
    readonly network: string;
};

/** Convenience constructor so call sites read as prose. */
export const asset = (coin: string, network: string): ChainAsset => ({
    coin: coin.toLowerCase(),
    network: network.toLowerCase(),
});

/**
 * Which side of the swap the user fixed.
 *
 * `exact_in` is the default: the user says what they will send. `exact_out` is
 * the reverse, and it exists for destinations that cannot accept an open
 * amount: a Lightning invoice carries its amount, so to pay one the venue has
 * to work backwards to the deposit. There the deposit is what varies, and it
 * has to be sent exactly.
 */
export type ChainSwapAmountMode = 'exact_in' | 'exact_out';

/**
 * Indicative pair limits and rate, from an unauthenticated endpoint.
 *
 * Cheap enough to call on every keystroke, and it is what the amount
 * screen uses to validate before spending a real quote. It is NOT
 * bookable: the rate you settle at comes from `requestQuote`.
 *
 * All amounts are DECIMAL STRINGS in units of `depositAsset`, never
 * JS numbers. Decimal amounts do not survive binary floating point
 * (0.1 + 0.2 is not 0.3), and a rounded amount is a user's money. Parse at
 * the edge, with a decimal library, never with parseFloat.
 */
export type ChainSwapPair = {
    readonly depositAsset: ChainAsset;
    readonly settleAsset: ChainAsset;
    /** Minimum deposit, decimal string in deposit units. */
    readonly min: string;
    /** Maximum deposit, decimal string in deposit units. */
    readonly max: string;
    /** Indicative settle-per-deposit rate, decimal string. */
    readonly rate: string;
    /**
     * A flat charge taken from each deposit before `rate` applies, in deposit
     * units: what the route costs at the venue, plus any flat fee of ours.
     * What arrives is about (deposit - fixedCost) * rate, and `rate` already
     * has our proportional fee in it. Absent where there is no such charge.
     */
    readonly fixedCost?: string;
};

/**
 * A bookable quote. Short-lived: venues expire these within minutes, which
 * is why `expiresAt` is mandatory rather than optional. The UI must show a
 * countdown and re-quote rather than letting a user submit a dead quote.
 */
export type ChainSwapQuote = {
    readonly id: string;
    readonly depositAsset: ChainAsset;
    readonly settleAsset: ChainAsset;
    /** Exact amount the user must send, decimal string. */
    readonly depositAmount: string;
    /** Exact amount they will receive, decimal string. */
    readonly settleAmount: string;
    /** Wall-clock expiry. */
    readonly expiresAt: Date;
    /**
     * Whether `settleAmount` is committed or only expected. Absent means
     * committed, which is SideShift's behaviour.
     *
     * Some venues price the settlement at execution rather than at quote
     * time, so the user can receive less than quoted. Where that is the case
     * the UI must show the amount as approximate, and `minSettleAmount` is
     * the floor to warn against.
     */
    readonly settleAmountIsFirm?: boolean;
    /** Which side the user fixed. Absent means exact_in. */
    readonly amountMode?: ChainSwapAmountMode;
    /**
     * Ceiling on the deposit, for exact_out quotes where the venue works
     * backwards from the settle amount. Send more than this and the venue can
     * refuse or hold the deposit, so the send path must treat `depositAmount`
     * as exact rather than approximate.
     */
    readonly maxDepositAmount?: string;
    /** Floor on the settle amount, when the venue commits to one. */
    readonly minSettleAmount?: string | null;
    /**
     * Deposit instructions, when the venue binds them at quote time rather
     * than at creation. See ChainSwapProvider.quoteNeedsAddresses.
     */
    readonly depositAddress?: string | null;
    readonly depositMemo?: string;
    /**
     * All-in cost as a fraction of notional (0.0185 = 1.85%), derived by
     * comparing settleAmount against an independent spot reference.
     *
     * Deliberately nullable: if we have no trustworthy spot price we show
     * nothing rather than a fabricated percentage. Never render a headline
     * rate the venue advertised; render what this quote actually returns.
     */
    readonly allInCostFraction: number | null;
};

/**
 * Lifecycle of a submitted shift, normalised across venues.
 *
 * Venue enums differ, so each provider maps its own states onto this set
 * and the UI keeps one state machine. Each venue's mapping lives beside its
 * provider, tested against that venue's documented status table.
 */
export type ChainSwapStatus =
    /** Created; waiting for the user's deposit to arrive. */
    | 'awaiting_deposit'
    /** Deposit seen, not yet confirmed enough to act on. */
    | 'confirming'
    /** Deposit confirmed and being processed. */
    | 'processing'
    /**
     * The venue reports it cannot process the deposit automatically and has
     * parked it for human review. It can still settle or refund. Carries the
     * venue's reason in `ChainSwapOrder.issue` when one is given.
     */
    | 'held'
    /** Settlement transaction created, awaiting confirmation. */
    | 'settling'
    /** Settled to the destination. Terminal, success. */
    | 'settled'
    /**
     * A refund is queued or in progress. Not terminal: funds are on their
     * way back, or waiting on a refund address if none was supplied.
     */
    | 'refunding'
    /** Refund confirmed. Terminal, not a success, but funds are back. */
    | 'refunded'
    /** Validity window ended with no deposit. Terminal, harmless. */
    | 'expired'
    /** The venue reported an explicit failure. Terminal. */
    | 'failed';

/** Statuses from which the order can still move. */
export const IN_FLIGHT_STATUSES: readonly ChainSwapStatus[] = [
    'awaiting_deposit',
    'confirming',
    'processing',
    'held',
    'settling',
    'refunding',
];

export const isInFlight = (s: ChainSwapStatus): boolean =>
    IN_FLIGHT_STATUSES.includes(s);

export const isTerminal = (s: ChainSwapStatus): boolean => !isInFlight(s);

/**
 * Escalation verdict returned with every poll.
 *
 * `none`:      progressing normally, or terminal.
 * `slow`:      in flight longer than expected. Reassure, do not alarm.
 * `stalled`:   in flight well past any plausible settlement time with no
 *              status change. Inferred. Surface an actionable message with
 *              the venue's support channel and the order id.
 * `held`:      the venue itself reports a human-review hold. Explicit, so it
 *              escalates immediately rather than waiting on a timer.
 *
 * `stalled` and `held` both mean "stop pretending nothing is wrong", and
 * neither is a claim that funds are lost. They differ in copy: a hold is a
 * known state with a reason, a stall is an absence of progress.
 */
export type ChainSwapStall = 'none' | 'slow' | 'stalled' | 'held';

/** A submitted shift, as returned by createShift and pollShift. */
export type ChainSwapOrder = {
    readonly id: string;
    readonly status: ChainSwapStatus;
    /**
     * The venue's own status string, kept only to detect progress between
     * polls. Two venue states can normalise to the same status, for example a
     * queued refund and a refund in progress, and moving between them is real
     * progress that must reset the stall clock.
     */
    readonly venueStatus?: string;
    /**
     * Where the user must send funds. Nullable: venues can unassign a
     * deposit address after a retention period and reuse it for other
     * orders. Persist it when the order is created, and never send to an
     * address from an order that has expired.
     */
    readonly depositAddress: string | null;
    /** Memo/tag/extraId, for chains that require one. Absent for BTC and Tron. */
    readonly depositMemo?: string;
    readonly depositAsset: ChainAsset;
    readonly settleAsset: ChainAsset;
    readonly depositAmount: string;
    /** Null until the venue commits to a settle amount. */
    readonly settleAmount: string | null;
    /** Destination address we asked it to settle to. */
    readonly settleAddress: string;
    /** Where a refund goes. Always set at creation, see createShift. */
    readonly refundAddress: string | null;
    /** On-chain ids once known, for receipts and support. */
    readonly depositTxId?: string;
    readonly settleTxId?: string;
    /** Venue-supplied reason when `held` or `refunding`, if any. */
    readonly issue?: string;
    readonly createdAt: Date;
    /** Deadline for the deposit to arrive. */
    readonly expiresAt: Date;
    /**
     * When we last observed a CHANGE in status or venue status. Client-tracked,
     * not taken from the venue: venues do not reliably report an update time
     * while an order is in flight. Drives stall inference.
     */
    readonly statusChangedAt: Date;
};

/**
 * Poll result: the order plus our escalation verdict. Providers compute
 * `stall` via `evaluateStall` rather than inventing their own rule, so the
 * behaviour is uniform and testable.
 */
export type ChainSwapPollResult = {
    readonly order: ChainSwapOrder;
    readonly stall: ChainSwapStall;
};

/**
 * Stall thresholds, in milliseconds since the last status CHANGE (not since
 * creation: a slow deposit confirmation is normal and should not trip it).
 *
 * These are deliberately generous. A false "stalled" that scares a user
 * about a healthy swap is worse than a late one, because it trains people
 * to ignore the warning.
 */
export type ChainSwapStallThresholds = {
    readonly slowMs: number;
    readonly stalledMs: number;
};

export const DEFAULT_STALL_THRESHOLDS: ChainSwapStallThresholds = {
    /** 15 min without movement: mention it, calmly. */
    slowMs: 15 * 60 * 1000,
    /** 45 min without movement: surface support. */
    stalledMs: 45 * 60 * 1000,
};

/**
 * Pure escalation inference. Exported for direct unit testing because this
 * is the logic most likely to be wrong in a way nobody notices until a user
 * is angry.
 *
 * Rules, in order:
 *   - Terminal statuses never escalate. Funds have arrived or come back.
 *   - `held` escalates immediately. The venue has told us; no timer needed.
 *   - `awaiting_deposit` never escalates: the user has not paid yet, and
 *     nagging them about their own inaction is noise. Expiry handles it.
 *   - Otherwise, measure from the last observed status change.
 */
export function evaluateStall(
    status: ChainSwapStatus,
    statusChangedAt: Date,
    now: Date = new Date(),
    thresholds: ChainSwapStallThresholds = DEFAULT_STALL_THRESHOLDS,
): ChainSwapStall {
    if (isTerminal(status)) return 'none';
    if (status === 'held') return 'held';
    if (status === 'awaiting_deposit') return 'none';

    const elapsed = now.getTime() - statusChangedAt.getTime();
    if (elapsed >= thresholds.stalledMs) return 'stalled';
    if (elapsed >= thresholds.slowMs) return 'slow';
    return 'none';
}

/**
 * Per-request jurisdiction verdict, checked BEFORE showing the user a
 * quote. Venues enforce this server-side on the end user's IP, and we
 * honour their answer rather than shipping our own country list, which
 * would go stale.
 */
export type ChainSwapPermission = {
    readonly allowed: boolean;
    /** Venue-supplied reason, if any. Not always present. */
    readonly reason?: string;
};

/** Provider contract. Implementations self-register via ./registry. */
export interface ChainSwapProvider {
    readonly id: ChainSwapProviderId;
    readonly displayName: string;

    /**
     * Whether a quote must know where the funds will settle and refund.
     *
     * Some venues allocate the deposit address at quote time, which means
     * the settle and refund addresses are needed before a quote exists and
     * the quote expires whether or not the user commits. The UI therefore has
     * to collect addresses before quoting, and re-quote on expiry.
     */
    readonly quoteNeedsAddresses?: boolean;

    /**
     * Whether the venue can price backwards from the settle amount. Needed to
     * pay a Lightning invoice, which carries its own amount. Absent means no,
     * and requestQuote rejects `exact_out`.
     */
    readonly supportsExactOut?: boolean;

    /** Whether the rail is wired up at all (config present, etc). */
    isAvailable(): boolean;

    /**
     * Server-side jurisdiction pre-flight for THIS user. Call before
     * quoting. Providers must fail CLOSED: on a network error, return
     * `{ allowed: false }` rather than optimistically allowing, because the
     * downstream failure is a rejected order after the user has committed.
     */
    checkPermission(): Promise<ChainSwapPermission>;

    /**
     * Indicative limits + rate. Unauthenticated and cheap; safe to poll.
     *
     * Pass the user's amount when there is one. Fixed network costs make a
     * venue's rate depend heavily on size, so a rate quoted at the route
     * minimum is not the rate at $500 and must not be shown as though it were.
     */
    getPair(deposit: ChainAsset, settle: ChainAsset, depositAmount?: string): Promise<ChainSwapPair>;

    /**
     * Bookable quote for an exact deposit amount. Costs a venue-side,
     * rate-limited resource and expires, so only call when the user is close
     * to committing, never on every keystroke.
     */
    requestQuote(
        deposit: ChainAsset,
        settle: ChainAsset,
        depositAmount: string,
        /** Required when `quoteNeedsAddresses` is set, ignored otherwise. */
        addresses?: { settleAddress: string; refundAddress: string },
        /**
         * Which side `depositAmount` refers to. With `exact_out` it is the
         * settle amount instead, in settle units. Only for providers that
         * declare `supportsExactOut`.
         */
        mode?: ChainSwapAmountMode,
    ): Promise<ChainSwapQuote>;

    /**
     * Commit a quote and get a deposit address.
     *
     * `refundAddress` is not optional in practice even where the venue
     * marks it so: without one, an underpaid, overpaid or late deposit can
     * become unrecoverable. Always pass one, valid for the deposit asset's
     * chain.
     *
     * A timed-out call may still have created the order on the venue side.
     * Callers must not retry blindly: reconcile first, or a user can end up
     * with two open orders and one deposit.
     */
    createShift(
        quote: ChainSwapQuote,
        settleAddress: string,
        refundAddress: string,
    ): Promise<ChainSwapOrder>;

    /**
     * Poll an order. Takes the last known order rather than just its id,
     * because stall inference needs the last observed status change and the
     * venue does not reliably report one while an order is in flight. Returns
     * the refreshed order with `statusChangedAt` advanced only on real
     * progress, a change in status or venue status. Must be a pure read; the
     * UI calls it on a timer.
     */
    pollShift(previous: ChainSwapOrder): Promise<ChainSwapPollResult>;

    /**
     * Human-reachable support channel for this venue, shown when an order
     * is `stalled` or `held`. Required, not optional: an escalation with no
     * way to act on it is just a scarier spinner.
     */
    readonly supportUrl: string;
}

/* --------------------------------------------------------------------- */
/* Typed errors                                                          */
/* --------------------------------------------------------------------- */

export class ChainSwapError extends Error {
    cause?: unknown;
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'ChainSwapError';
        this.cause = cause;
    }
}

export class ProviderUnavailableError extends ChainSwapError {
    constructor(id: ChainSwapProviderId) {
        super(`Swap provider "${id}" is not available`);
        this.name = 'ProviderUnavailableError';
    }
}

/**
 * The venue refused to serve this user's jurisdiction. Distinct from a
 * generic failure because the UI copy must not suggest retrying: it will
 * fail identically every time, and the user deserves to be told why.
 */
export class JurisdictionBlockedError extends ChainSwapError {
    constructor(id: ChainSwapProviderId, reason?: string) {
        super(reason ?? `"${id}" is not available in your region`);
        this.name = 'JurisdictionBlockedError';
    }
}

function rangeMessage(min: string | undefined, max: string | undefined): string {
    if (min !== undefined && max !== undefined) return `Amount must be between ${min} and ${max}`;
    if (min !== undefined) return `Amount is below the minimum of ${min}`;
    if (max !== undefined) return `Amount is above the maximum of ${max}`;
    return 'Amount is outside the allowed range';
}

/**
 * Amount outside the pair's allowed range. Carries whichever bounds are
 * known, since a venue often reports only the one that was crossed, so the
 * UI can say "minimum is X" instead of a generic failure.
 */
export class AmountOutOfRangeError extends ChainSwapError {
    constructor(
        readonly amount: string | undefined,
        readonly min: string | undefined,
        readonly max: string | undefined,
    ) {
        super(rangeMessage(min, max));
        this.name = 'AmountOutOfRangeError';
    }
}

/** Quote died before the user committed. The UI should re-quote silently. */
export class QuoteExpiredError extends ChainSwapError {
    constructor(quoteId?: string) {
        super(quoteId ? `Quote ${quoteId} has expired` : 'Quote has expired');
        this.name = 'QuoteExpiredError';
    }
}

/**
 * The venue rejected a settle or refund address. Carries which one so the
 * UI can point at the right field. Not retryable with the same input.
 */
export class InvalidAddressError extends ChainSwapError {
    constructor(readonly field: 'settle' | 'refund', message?: string) {
        super(message ?? `Invalid ${field} address`);
        this.name = 'InvalidAddressError';
    }
}

/**
 * Temporary venue-side unavailability: a method paused, a deposit range or
 * route quote unavailable, or a rate limit. Distinct from a hard failure so
 * the UI can offer a retry instead of a dead end.
 */
export class VenueUnavailableError extends ChainSwapError {
    constructor(
        id: ChainSwapProviderId,
        readonly retryable: boolean,
        message?: string,
        cause?: unknown,
    ) {
        super(message ?? `"${id}" is temporarily unavailable`, cause);
        this.name = 'VenueUnavailableError';
    }
}

/**
 * Our own integration is misconfigured: credentials, affiliate id, or a
 * missing end-user IP header. Never shown to the user verbatim. It is not
 * their problem and the raw venue message names internals, so that message
 * travels in `cause` instead.
 */
export class VenueConfigError extends ChainSwapError {
    constructor(id: ChainSwapProviderId, cause?: unknown) {
        super(`"${id}" integration is misconfigured`, cause);
        this.name = 'VenueConfigError';
    }
}

export class QuoteFailedError extends ChainSwapError {
    constructor(id: ChainSwapProviderId, cause?: unknown) {
        super(`"${id}" failed to quote`, cause);
        this.name = 'QuoteFailedError';
    }
}

export class ShiftCreationFailedError extends ChainSwapError {
    constructor(id: ChainSwapProviderId, cause?: unknown) {
        super(`"${id}" failed to create the shift`, cause);
        this.name = 'ShiftCreationFailedError';
    }
}

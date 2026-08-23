/**
 * Duplicate protection for CoinOS on-chain withdrawals.
 *
 * THE HAZARD. `POST /bitcoin/send` crosses the network. If the connection dies
 * after CoinOS accepted the request but before the reply arrives, the client
 * cannot tell "never sent" from "sent, reply lost". The withdraw screen treated
 * every failure as the former: it showed "Failed to Send to bitcoin. Please try
 * again." and re-armed the swipe button. Following that instruction sends the
 * money a second time, irreversibly.
 *
 * WHY NOT JUST AN IDEMPOTENCY KEY. A key only works if the server honours it,
 * and we have not confirmed CoinOS does. We send one anyway (it costs nothing
 * and helps if supported), but nothing here relies on it. The protection that
 * actually works is client-side and has two halves:
 *
 *   1. Before sending, look for a withdrawal to the same address for the same
 *      amount in the recent past. If one exists, this is almost certainly a
 *      retry of a request that already went through.
 *   2. When a send fails in a network-shaped way, do NOT report failure. The
 *      outcome is unknown, and saying otherwise is what caused the double-send.
 *
 * Same reasoning as the indeterminate Lightning send in services/ark/send.ts:
 * an unknown outcome must never be presented as a safe one.
 */

/** Shape we rely on from `GET /payments`. Deliberately loose. */
export type CoinosPaymentLike = {
    amount?: number | string | null;
    created?: number | string | null;
    type?: string | null;
    hash?: string | null;
    address?: string | null;
    onchain?: { address?: string | null } | null;
};

/** How far back a matching withdrawal still counts as "probably this one". */
export const WITHDRAW_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/** Error thrown when a withdrawal's outcome is UNKNOWN rather than failed. */
export type CoinosWithdrawIndeterminateError = Error & {
    coinosWithdrawIndeterminate: true;
};

/** True when the outcome is unknown and retrying risks paying twice. */
export function isCoinosWithdrawIndeterminate(err: unknown): boolean {
    return (
        !!err &&
        (err as { coinosWithdrawIndeterminate?: boolean }).coinosWithdrawIndeterminate === true
    );
}

/**
 * Network-shaped failures leave the request's fate unknown: it may well have
 * reached CoinOS. Anything else (a validation rejection, say) is a real
 * failure, because the server answered.
 */
export function isNetworkShapedFailure(err: unknown): boolean {
    if (!err) return false;
    const text = `${(err as Error)?.name ?? ''} ${(err as Error)?.message ?? ''}`;
    return /network request failed|timeout|timed out|aborted|socket|econn|failed to fetch|network error/i.test(
        text,
    );
}

export function markWithdrawIndeterminate(message: string): CoinosWithdrawIndeterminateError {
    const e = new Error(message) as CoinosWithdrawIndeterminateError;
    e.coinosWithdrawIndeterminate = true;
    return e;
}

function addressOf(p: CoinosPaymentLike): string | null {
    const a = p?.onchain?.address ?? p?.address ?? null;
    return typeof a === 'string' && a ? a.trim().toLowerCase() : null;
}

function createdMs(p: CoinosPaymentLike): number | null {
    const c = p?.created;
    if (typeof c === 'number' && Number.isFinite(c)) {
        // CoinOS timestamps are ms; a seconds-shaped value would land in 1970.
        return c < 1e12 ? c * 1000 : c;
    }
    if (typeof c === 'string') {
        const t = Date.parse(c);
        return Number.isNaN(t) ? null : t;
    }
    return null;
}

/**
 * A recent withdrawal matching this destination and amount, or null.
 *
 * Amount is compared on magnitude: outgoing payments are negative in CoinOS's
 * history, and the caller thinks in positive sats.
 *
 * Matching needs BOTH address and amount. Address alone would flag a legitimate
 * second payment to the same destination, and amount alone would flag any
 * same-sized payment to anyone.
 */
export function findRecentMatchingWithdrawal(
    payments: readonly CoinosPaymentLike[] | null | undefined,
    criteria: { address: string; amountSats: number; now: number; withinMs?: number },
): CoinosPaymentLike | null {
    const { address, amountSats, now } = criteria;
    const withinMs = criteria.withinMs ?? WITHDRAW_DUPLICATE_WINDOW_MS;
    if (!payments?.length || !address || !Number.isFinite(amountSats)) return null;

    const wanted = address.trim().toLowerCase();
    const wantedSats = Math.abs(Math.round(amountSats));

    for (const p of payments) {
        if (addressOf(p) !== wanted) continue;

        const raw = typeof p?.amount === 'string' ? Number(p.amount) : p?.amount;
        if (!Number.isFinite(raw as number)) continue;
        if (Math.abs(Math.round(raw as number)) !== wantedSats) continue;

        // No usable timestamp: treat as a match rather than risk a double-send.
        // A false positive costs the user a confirmation tap; a false negative
        // costs them the money.
        const ts = createdMs(p);
        if (ts == null) return p;

        if (now - ts <= withinMs && now - ts >= -withinMs) return p;
    }
    return null;
}

/**
 * Classifier for the server's "vtxo ... is not spendable" family of errors.
 *
 * WHY THIS EXISTS
 *
 * bark decides spendability from its LOCAL database. `Wallet::sync` reconciles
 * this wallet's own pending operations (rounds, arkoor sends, LN, boards,
 * offboards) plus the recovery mailbox and on-chain force-exits, and never asks
 * the server whether a locally-`Spendable` VTXO is still unspent. Verified
 * against bark 0.6.1 (`bark/src/lib.rs:1751`), all ten branches.
 *
 * So whenever local state is newer-looking than reality, the wallet shows a
 * balance that does not exist and only finds out when a spend fails. Observed
 * on a tester's wallet: 99,991 sats displayed as Spendable for days after the
 * VTXO had been arkoor'd away by a second device holding the same seed. The
 * trigger is not only seed sharing; restoring a stale `.cbark` does it too.
 *
 * The server is the authority and says so plainly:
 *
 *   vtxo <id> is not spendable (state: spent)
 *
 * This module turns that string into a decision. It is pure and has no SDK
 * import so it stays unit-testable, matching the other decision helpers.
 *
 * NOTE ON `spent` VS THE REST
 *
 * Only `spent` is permanent. `unregistered` (signed chain not uploaded yet),
 * `unclaimed` (server has not released the unlock preimage) and
 * `htlc_recv_unclaimed` (preimage not revealed) are all transient and may
 * resolve on their own, so they must NOT be treated as gone. The state names
 * mirror the server's `VtxoSpendState` enum in
 * `server-rpc/protos/bark_server.proto`.
 */

/** Mirrors the server's VtxoSpendState enum, minus SPENDABLE/UNSPECIFIED. */
export type NotSpendableState =
    | 'spent'
    | 'unregistered'
    | 'unclaimed'
    | 'htlc_recv_unclaimed'
    | 'unknown';

export type NotSpendableVtxo = {
    /** `<64 hex>:<vout>`, or null when the server did not name one. */
    vtxoId: string | null;
    state: NotSpendableState;
};

/**
 * The full form names the VTXO, which is what lets the caller prune it:
 *   vtxo 9ca5...beaf4e:0 is not spendable (state: spent)
 */
const WITH_ID =
    /vtxo\s+([0-9a-fA-F]{64}:\d+)\s+is\s+not\s+spendable\s*\(\s*state:\s*([a-z_]+)\s*\)/i;

/** Fallback: some paths report the state without naming the VTXO. */
const STATE_ONLY = /not\s+spendable\s*\(\s*state:\s*([a-z_]+)\s*\)/i;

function normaliseState(raw: string): NotSpendableState {
    switch (raw.trim().toLowerCase()) {
        case 'spent': return 'spent';
        case 'unregistered': return 'unregistered';
        case 'unclaimed': return 'unclaimed';
        case 'htlc_recv_unclaimed': return 'htlc_recv_unclaimed';
        default: return 'unknown';
    }
}

/**
 * Pull the message out of a BarkError.
 *
 * BarkError variants carry the detail in `inner.errorMessage`; `message` is
 * only the variant tag, which is why every call site that reads `message`
 * alone shows the user something useless.
 */
export function barkErrorText(err: any): string {
    return String(
        err?.inner?.errorMessage ??
        err?.cause?.inner?.errorMessage ??
        err?.inner?.message ??
        err?.cause?.message ??
        err?.message ??
        err ??
        '',
    );
}

/** Returns null when this is not a not-spendable error. */
export function parseNotSpendableError(err: unknown): NotSpendableVtxo | null {
    const text = barkErrorText(err);
    if (!text) return null;

    const full = WITH_ID.exec(text);
    if (full) return { vtxoId: full[1].toLowerCase(), state: normaliseState(full[2]) };

    const bare = STATE_ONLY.exec(text);
    if (bare) return { vtxoId: null, state: normaliseState(bare[1]) };

    return null;
}

/**
 * True when the server has told us this VTXO is gone for good, so the caller
 * should stop counting it. Deliberately narrow: see the note above on why the
 * other states must not be treated as permanent.
 */
export function isPermanentlyGone(v: NotSpendableVtxo | null): boolean {
    return v?.state === 'spent';
}

/**
 * User-facing copy. Names the remedy rather than the internal state, and never
 * exposes the raw server string.
 *
 * COPY: Bam finalizes.
 */
export function notSpendableMessage(v: NotSpendableVtxo): { title: string; body: string } {
    switch (v.state) {
        case 'spent':
            return {
                title: 'Those sats are already gone',
                body: 'The Ark server reports this capsule as already spent, so the balance shown was out of date. Your wallet has been corrected. This happens when the same seed phrase is used on another device, or after restoring an old backup file.',
            };
        case 'unregistered':
            return {
                title: 'A capsule is stuck',
                body: "One of your capsules is in a state the Ark server won't spend, so payments from Bark Vault keep failing. Try sending from a different wallet for now.",
            };
        case 'unclaimed':
        case 'htlc_recv_unclaimed':
            return {
                title: 'A capsule is not ready yet',
                body: 'One of your capsules is still being finalised by the Ark server and cannot be spent yet. Wait a few minutes and try again.',
            };
        default:
            return {
                title: 'That capsule cannot be spent',
                body: 'The Ark server refused to spend one of your capsules. Try again in a few minutes, or send from a different wallet.',
            };
    }
}

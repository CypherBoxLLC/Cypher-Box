/**
 * Capsule (UTXO) selection for vault sends.
 *
 * Selecting capsules is mandatory in Cypher Box: you cannot send from a vault
 * without choosing coins first. Every entry point into ColdStorage passes both
 * the UTXO set and the selected ids, and Capsules gates each of its four send
 * paths on a non-empty selection.
 *
 * This lives in its own module rather than inline in the screen so the rule can
 * be tested directly. The screen used to hand the UNFILTERED set to
 * createTransaction, so coinselect (which sorts descending and takes the
 * largest) spent whatever coin it liked regardless of what the user ticked, and
 * the change figure on the confirm screen, derived from the selection, could be
 * wrong by orders of magnitude. That matters most when change is routed to a
 * Strike or CoinOS deposit address.
 */

/** Minimum shape this module needs. Real UTXOs carry more fields. */
export type SelectableUtxo = {
    txid: string;
    vout: number;
    value: number;
};

/** Canonical outpoint key. Both halves matter: one txid can fund several vouts. */
export function outpointKey(u: Pick<SelectableUtxo, 'txid' | 'vout'>): string {
    return `${u.txid}:${u.vout}`;
}

/**
 * The capsules the user picked, and the ONLY coins a vault send may spend.
 *
 * Order follows `utxo`, not `ids`, so the caller's coin ordering is preserved
 * for coinselect. Ids with no matching UTXO are ignored rather than throwing:
 * a stale selection (coin spent elsewhere since the picker rendered) should
 * narrow the spend, never fabricate an input.
 *
 * There is deliberately NO whole-wallet fallback. If the selection is empty
 * that is a caller bug, and quietly spending the rest of the vault is the worst
 * available response, so this returns an empty array and callers must refuse to
 * build a transaction.
 */
export function selectCapsules<T extends SelectableUtxo>(
    utxo: readonly T[] | null | undefined,
    ids: readonly string[] | null | undefined,
): T[] {
    if (!utxo || !ids || ids.length === 0) return [];
    const wanted = new Set(ids);
    return utxo.filter((u) => wanted.has(outpointKey(u)));
}

/** Total value of a selection, in sats. */
export function selectedTotalSats(utxo: readonly SelectableUtxo[]): number {
    return utxo.reduce((sum, u) => sum + u.value, 0);
}

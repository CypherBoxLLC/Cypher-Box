/**
 * The capsules a Hot or Cold Vault card shows: its largest ones, up to five. The card used to show the oldest, with
 * any unconfirmed ones ahead of them, so a vault holding one large capsule among many small ones could show only
 * small ones.
 */

/** The fields needed here. BlueWallet's UTXOs carry the sats as `value` and again as `amount`. */
export type CardCapsule = {
    txid: string;
    vout: number;
    height: number;
    value?: number;
    amount?: number;
};

/** How many capsules a vault card has room for. */
export const VAULT_CARD_CAPSULES = 5;

const sats = (capsule: CardCapsule): number => Number(capsule.amount ?? capsule.value ?? 0);
// Unconfirmed capsules have height 0 and are the newest.
const age = (capsule: CardCapsule): number => (capsule.height > 0 ? capsule.height : Number.MAX_SAFE_INTEGER);

/**
 * The largest capsules first, equal ones oldest first (unconfirmed last), as a new array. The wallet's own UTXO list
 * is not reordered: getUtxo() returns the wallet's array itself, and the card used to sort it in place.
 */
export function largestCapsules<T extends CardCapsule>(
    utxo: readonly T[] | null | undefined,
    count: number = VAULT_CARD_CAPSULES,
): T[] {
    if (!utxo) return [];
    return [...utxo]
        .sort((a, b) => sats(b) - sats(a) || age(a) - age(b) || a.txid.localeCompare(b.txid) || a.vout - b.vout)
        .slice(0, count);
}

import loc from '../../loc';

/**
 * Which vault flow a review or confirm screen is showing, from its route params.
 *
 * The screens used to decide this inline, and the order of the checks mattered:
 * Move to Cold and Move to Hot pass the other vault's address as `to`, the same
 * param a Lightning top-up uses for its CoinOS deposit address, so checking `to`
 * before `vaultSend` labelled a move as a top-up. The Home screen's scan-to-send
 * also passes the scanned address as `to` (and `autoSelected`): a send, not a
 * top-up to CoinOS.
 */
export type VaultSendKind = 'consolidate' | 'move_to_cold' | 'move_to_hot' | 'top_up' | 'send';

export function vaultSendKind(p: {
    isBatch?: boolean;
    vaultSend?: boolean;
    /** true when the capsules come from the Cold Vault */
    vaultTab?: boolean;
    to?: string | null;
    toStrike?: string | null;
    toArk?: string | null;
    /** the Home scan picked the capsules (and the address in `to`) */
    autoSelected?: boolean;
}): VaultSendKind {
    if (p.isBatch) return 'consolidate';
    if (p.vaultSend) return p.vaultTab ? 'move_to_hot' : 'move_to_cold';
    if (p.autoSelected) return 'send';
    if (p.to || p.toStrike || p.toArk) return 'top_up';
    return 'send';
}

/**
 * Whether the review offers to send the change somewhere else (Strike, CoinOS,
 * the other vault). Not for a consolidation: it is labelled from and to the
 * same vault, so its change, when the user edited it to a smaller capsule, stays
 * there too.
 */
export function offersChangeSweep(kind: VaultSendKind): boolean {
    return kind !== 'consolidate';
}

/** The review screen's title and the label over the amount (Consolidate has its own block). */
export function reviewLabels(kind: VaultSendKind): { title: string; amount: string } {
    const t = loc.cypherbox.vault.cold_storage;
    switch (kind) {
        case 'consolidate':
            return { title: t.batch_capsules, amount: t.batched_capsule_size };
        case 'move_to_hot':
            return { title: t.move_to_hot_vault, amount: t.amount_moved };
        case 'move_to_cold':
            return { title: t.move_to_cold_vault, amount: t.transfer_amount };
        case 'top_up':
            return { title: t.topup_transaction, amount: t.topup_amount };
        default:
            return { title: t.construct_transaction, amount: t.recipient_will_get };
    }
}

/**
 * The confirm screen's labels. It only signs for the Hot Vault (a Cold Vault
 * spend goes to its signing device), so a consolidation is from and to Hot Vault
 * addresses and a move goes to the Cold Vault. `toCoinos`: the destination is
 * the CoinOS deposit address, as opposed to Strike's or Bark's.
 */
export function confirmLabels(kind: VaultSendKind, o: { vaultTab?: boolean; toCoinos?: boolean } = {}) {
    const c = loc.cypherbox.payments.common;
    const ct = loc.cypherbox.payments.confirm_transaction;
    const ownVault = o.vaultTab ? c.cold_vault_address_label : c.hot_vault_address_label;
    return {
        amount:
            kind === 'consolidate' ? ct.amount_to_batch
            : kind === 'move_to_cold' || kind === 'move_to_hot' ? ct.transfer_amount
            : kind === 'top_up' ? c.top_up_amount
            : c.recipient_will_get,
        from: ownVault,
        toTitle: kind === 'top_up' && o.toCoinos ? c.to_coinos_bitcoin_address : c.to_colon,
        to:
            kind === 'consolidate' ? ownVault
            : kind === 'move_to_cold' ? c.cold_vault_address_label
            : kind === 'move_to_hot' ? c.hot_vault_address_label
            : c.bitcoin_address_label,
    };
}

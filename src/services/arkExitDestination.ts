import BIP32Factory from 'bip32';

import ecc from '../../blue_modules/noble_ecc';

const bip32 = BIP32Factory(ecc);

/**
 * LEGACY Ark exit destination slot: m/84'/0'/0'/2/0 (node 2).
 *
 * This was a Cypher-Box-internal "reserved slot" convention, but the Hot Vault
 * is a BlueWallet HDsegwitBech32 whose class only derives and scans node 0
 * (receive) and node 1 (change) (see class/wallets/abstract-hd-electrum-wallet.ts,
 * _getNodeAddressByIndex, which throws on any other node). Nothing in the app
 * ever scanned node 2, so exit funds swept there landed on the user's seed but
 * were invisible and unspendable in-app: not in the Hot Vault balance/history,
 * not owned by bark's onchain wallet, not covered by ArkOnchainRecoverSection
 * (that reads bark's onchain BOARD reserve). Recovery required importing the
 * seed into a wallet that supports the custom path.
 *
 * Exits now go to a scanned node-1 change address (deriveArkExitAddress below).
 * These constants + deriveLegacyReservedSlotAddress remain ONLY so the one-time
 * migration in useArkExitDestinationBackfill can recognise a persisted legacy
 * address and repoint it.
 */
export const ARK_EXIT_LEGACY_NODE = 2;
export const ARK_EXIT_LEGACY_INDEX = 0;

/**
 * Re-derive the legacy m/84'/0'/0'/2/0 address for a Hot Vault. Used ONLY to
 * detect a persisted legacy exit destination during migration. Returns null on
 * any failure (treated as "not a legacy address, leave it alone").
 */
export function deriveLegacyReservedSlotAddress(
    wallet: any | null | undefined,
): string | null {
    if (!wallet) return null;
    try {
        const zpub = typeof wallet.getXpub === 'function' ? wallet.getXpub() : null;
        if (!zpub || typeof zpub !== 'string') return null;
        const xpub =
            typeof wallet._zpubToXpub === 'function'
                ? wallet._zpubToXpub(zpub)
                : zpub;
        const hdNode = bip32.fromBase58(xpub);
        const slotNode = hdNode
            .derive(ARK_EXIT_LEGACY_NODE)
            .derive(ARK_EXIT_LEGACY_INDEX);
        if (typeof wallet._hdNodeToAddress !== 'function') return null;
        const address = wallet._hdNodeToAddress(slotNode);
        return typeof address === 'string' && address ? address : null;
    } catch {
        return null;
    }
}

/**
 * Derive the Ark unilateral-exit destination for a Hot Vault wallet.
 *
 * Uses a node-1 (change) address the wallet itself derives and scans, via the
 * wallet's own primitives, so exit funds land where fetchBalance /
 * fetchTransactions already look and weOwnAddress() recognises them. This
 * mirrors the recover-prefill in ArkOnchainRecoverSection (resolveHotVaultAddress).
 * A change address (rather than a public receive address) keeps auto-eject UTXOs
 * out of a receive address the user may have shared as a QR.
 *
 * Returns null on any failure (missing wallet, missing derivation primitives,
 * derivation error). Callers treat null as "leave arkExitDestinationAddress
 * unset" rather than a hard error: auto-eject simply won't fire until a
 * destination is configured (auto-derived here, or manually via Settings).
 */
export function deriveArkExitAddress(
    wallet: any | null | undefined,
): string | null {
    if (!wallet) return null;
    try {
        if (
            typeof wallet._getInternalAddressByIndex !== 'function' ||
            typeof wallet.getNextFreeChangeAddressIndex !== 'function'
        ) {
            console.warn(
                '[ArkExitDestination] wallet lacks change-address derivation primitives',
            );
            return null;
        }
        const index = wallet.getNextFreeChangeAddressIndex();
        const address = wallet._getInternalAddressByIndex(index);
        if (typeof address !== 'string' || !address) {
            console.warn(
                '[ArkExitDestination] _getInternalAddressByIndex returned non-string',
            );
            return null;
        }
        return address;
    } catch (err) {
        console.warn('[ArkExitDestination] deriveArkExitAddress failed:', err);
        return null;
    }
}

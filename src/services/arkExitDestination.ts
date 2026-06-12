import BIP32Factory from 'bip32';

import ecc from '../../blue_modules/noble_ecc';

const bip32 = BIP32Factory(ecc);

/**
 * Derivation node + index for the Ark unilateral-exit destination on a Hot
 * Vault wallet.
 *
 * BIP84 standardly uses node=0 (external/receive) and node=1 (change). We
 * reserve node=2 — and specifically slot (2,0) — as a Cypher-Box-internal
 * convention for "this address is the destination of any auto-eject /
 * unilateral exit from Ark".
 *
 * Why a reserved slot rather than the next-unused receive address:
 *   - Hot Vault transaction history can label these UTXOs distinctly
 *     ("Auto-eject from Ark") without burning a public-facing receive
 *     address that the user may have shared as a QR.
 *   - A receive address the user shared with someone won't accidentally
 *     collide with auto-eject UTXOs in the same UTXO — keeping the
 *     auto-eject behaviour from leaking metadata to that counterparty.
 *   - Stable across runs: no race with the user spending their own next
 *     receive address mid-flight, and the same address is regenerable
 *     from the seed alone if the wallet is ever rebuilt.
 *
 * Cross-wallet compatibility caveat: most other wallets (Sparrow,
 * Electrum, BlueWallet itself) only scan node=0 and node=1 by default.
 * If a user imports the same seed elsewhere, auto-eject UTXOs at (2,0)
 * won't appear in the other wallet's history without manually adding
 * the path. We document this in Settings; advanced users who care can
 * fall back to the manual "custom address" override.
 *
 * Full BIP84 mainnet path: m/84'/0'/0'/2/0.
 */
export const ARK_EXIT_NODE = 2;
export const ARK_EXIT_INDEX = 0;

/**
 * Derive the reserved-slot Ark exit address from a Hot Vault wallet.
 *
 * Uses the wallet's existing public primitives (`getXpub`, `_zpubToXpub`,
 * `_hdNodeToAddress`) so the address format follows whatever the wallet
 * itself produces — bech32 for BIP84 Hot Vaults (the default), p2sh-segwit
 * for legacy BIP49 vaults, etc. The reserved-slot convention is
 * format-independent.
 *
 * Returns null on any failure: missing wallet, missing xpub, derivation
 * error, or an address-derivation primitive the wallet doesn't expose.
 * Callers should treat null as "leave `arkExitDestinationAddress` unset"
 * rather than as a hard error — auto-eject simply won't fire until the
 * user manually configures a destination via Settings.
 *
 * Why we don't pass through `wallet._getNodeAddressByIndex`: that helper
 * caches `_node0` / `_node1` and explicitly throws on any other node —
 * extending it would be invasive and tied to AbstractHDElectrumWallet's
 * internal state. Re-deriving once from the xpub on this code path is
 * cheap and self-contained.
 */
export function deriveArkExitAddress(wallet: any | null | undefined): string | null {
    if (!wallet) return null;
    try {
        const zpub = typeof wallet.getXpub === 'function' ? wallet.getXpub() : null;
        if (!zpub || typeof zpub !== 'string') {
            console.warn('[ArkExitDestination] wallet.getXpub() returned non-string');
            return null;
        }
        const xpub =
            typeof wallet._zpubToXpub === 'function'
                ? wallet._zpubToXpub(zpub)
                : zpub;
        const hdNode = bip32.fromBase58(xpub);
        const slotNode = hdNode.derive(ARK_EXIT_NODE).derive(ARK_EXIT_INDEX);
        if (typeof wallet._hdNodeToAddress !== 'function') {
            console.warn('[ArkExitDestination] wallet has no _hdNodeToAddress');
            return null;
        }
        const address = wallet._hdNodeToAddress(slotNode);
        if (typeof address !== 'string' || !address) {
            console.warn('[ArkExitDestination] _hdNodeToAddress returned non-string');
            return null;
        }
        return address;
    } catch (err) {
        console.warn('[ArkExitDestination] deriveArkExitAddress failed:', err);
        return null;
    }
}

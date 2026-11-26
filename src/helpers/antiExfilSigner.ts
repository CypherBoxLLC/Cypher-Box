import type { BIP32Interface } from 'bip32';
import { ECPairFactory } from 'ecpair';

import ecc from '../../blue_modules/noble_ecc';
import type { SignerKeyAccess } from './antiExfilController';
import { AntiExfilMessage, decodeAntiExfilMessage, isAntiExfilContainer } from './antiExfilTransport';

/**
 * The signing phone's side of verified signing (anti-exfil), as the sign-once screen uses it: unwrapping the Cold
 * Vault's request, and handing the protocol the private keys it asks for, from the Hot Vault on this phone or from a
 * backup loaded for this signature only.
 *
 * Errors are thrown in English, like the signing helpers' (helpers/signOnce), and translated where they're shown
 * (screens/SignOnce/errorText).
 */

const ECPair = ECPairFactory(ecc);

export const ANTI_EXFIL_NEWER_VERSION =
    'This verified-signing request comes from a newer Cypher Box. Update this phone, then scan it again.';
export const ANTI_EXFIL_DAMAGED =
    'This verified-signing request is incomplete or damaged. Start the spend again on your Cold Vault and scan its code again.';
export const ANTI_EXFIL_WRONG_REPLY =
    "That isn't your Cold Vault's reply to this signing. Scan this phone's code on the Cold Vault again, then scan what it shows.";
export const ANTI_EXFIL_CANNOT_SIGN =
    "This transaction can't be signed with verification by this key. Sign it without verification: turn off Verify my signing phone on the Cold Vault.";

/**
 * What was scanned or opened to sign: a plain unsigned transaction, or the Cold Vault's verified-signing request
 * (hop 1) with the transaction inside it. The transaction comes back either way, so the same checks and review run
 * on it; `commit` says whether the signature has to go through the verified exchange.
 */
export function unwrapAntiExfilCommit(data: string): { psbt: string; commit: AntiExfilMessage | null } {
    if (!isAntiExfilContainer(data)) return { psbt: data, commit: null };
    const decoded = decodeAntiExfilMessage(data);
    if (decoded.kind === 'unsupported-version') throw new Error(ANTI_EXFIL_NEWER_VERSION);
    if (decoded.kind !== 'ok' || decoded.message.hop !== 'commit' || !decoded.message.psbt) throw new Error(ANTI_EXFIL_DAMAGED);
    return { psbt: decoded.message.psbt, commit: decoded.message };
}

// wallets write hardened steps as ' or h; bip32 only reads '
const normalizePath = (path: string) => path.replace(/h/gi, "'");

const samePubkey = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Keys from a backup (12 or 24 words, or a SeedQR) loaded for this signature. Every key is derived at the path the
 * transaction gives and must be the public key the transaction states for it, or it isn't handed out: the protocol
 * then refuses the input rather than signing with a key the Cold Vault didn't ask for.
 */
export function keyAccessFromRoot(root: BIP32Interface): SignerKeyAccess {
    return {
        fingerprint: undefined,
        derive: (path, pubkey) => {
            try {
                const node = root.derivePath(normalizePath(path));
                if (!node.privateKey || !samePubkey(Uint8Array.from(node.publicKey), pubkey)) return null;
                return Uint8Array.from(node.privateKey);
            } catch (_) {
                return null;
            }
        },
    };
}

/**
 * Keys from the Hot Vault on this phone, by (change, index) off the end of the path, the way its own cosigning
 * derives them. The same public-key check as above: a path outside this vault's account gives nothing.
 */
export function keyAccessFromWallet(wallet: { _getWIFByIndex: (internal: boolean, index: number) => string | false }): SignerKeyAccess {
    return {
        fingerprint: undefined,
        derive: (path, pubkey) => {
            try {
                const steps = normalizePath(path).split('/');
                const change = Number(steps[steps.length - 2]);
                const index = Number(steps[steps.length - 1]);
                if (!Number.isInteger(change) || (change !== 0 && change !== 1) || !Number.isInteger(index) || index < 0) return null;
                const wif = wallet._getWIFByIndex(change === 1, index);
                if (!wif) return null;
                const pair = ECPair.fromWIF(wif);
                if (!pair.privateKey || !samePubkey(Uint8Array.from(pair.publicKey), pubkey)) return null;
                return Uint8Array.from(pair.privateKey);
            } catch (_) {
                return null;
            }
        },
    };
}

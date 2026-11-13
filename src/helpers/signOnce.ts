import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import BIP32Factory, { BIP32Interface } from 'bip32';

import ecc from '../../blue_modules/noble_ecc';
import { rootFromMnemonic } from './seedFromWords';
import { auditPsbtSignatures } from '../../class/signatureAudit';

/**
 * Signing an unsigned transaction (PSBT) made by a watch-only wallet: a Cypher Box Cold Vault, Sparrow or any other
 * app. Used by the sign-once flow, where the key comes from a backup (12 or 24 words, or a SeedQR) typed or scanned
 * just for this signature and never saved, and by the Hot Vault's own "Sign a transaction".
 *
 * The transaction is checked against the backup before anything is signed: its inputs have to belong to that backup,
 * and an output the transaction claims comes back to the same wallet has to really derive from it. A watch-only
 * wallet that lies about change is the attack this catches.
 */

const bip32 = BIP32Factory(ecc);

const PSBT_HEX_MAGIC = '70736274ff';

export const SIGN_NOT_A_TRANSACTION = "This isn't an unsigned transaction (PSBT).";
export const SIGN_INVALID_BACKUP = "Those words aren't a valid recovery phrase. One may be wrong or out of order.";
export const SIGN_NO_KEY_INFO =
    "This transaction doesn't say which key signs it. Export it again from your wallet with key details (derivation paths) included.";
export const SIGN_BACKUP_MISMATCH =
    "This backup doesn't belong to the wallet that made this transaction. Check the words, and the passphrase if you use one.";
export const SIGN_VAULT_MISMATCH =
    "This transaction wasn't made for your Hot Vault. Sign it on the signing device it was made for.";
export const SIGN_ON_SIGNING_DEVICE =
    "This phone only signs for its own Hot Vault. Sign this transaction on your signing device: a hardware wallet, or an offline phone in Offline Seed-Signer mode.";
export const SIGN_FALSE_CHANGE =
    "An amount marked as coming back to your wallet goes to an address that isn't yours. Don't sign this transaction.";
export const SIGN_NOTHING_SIGNED = "Nothing in this transaction could be signed with this key.";
export const SIGN_INPUT_MISMATCH =
    "This transaction's amounts don't add up: an input's amount doesn't match the transaction it comes from. Don't sign it.";

export interface ReviewOutput {
    address: string | null;
    value: number;
    /** comes back to the signing wallet */
    change: boolean;
}

export interface TransactionReview {
    outputs: ReviewOutput[];
    /** null when an input doesn't carry its amount */
    fee: number | null;
    inputCount: number;
    /** inputs this key can sign; fewer than inputCount means another signer is needed too */
    ownInputs: number;
}

/** True when scanned or opened data looks like a PSBT (base64 or hex). Cheap check, for routing a scan. */
export function looksLikePsbt(data: string | null | undefined): boolean {
    if (typeof data !== 'string') return false;
    const trimmed = data.trim();
    return trimmed.startsWith('cHNidP') || trimmed.toLowerCase().startsWith(PSBT_HEX_MAGIC);
}

export function parseUnsignedPsbt(data: string): bitcoin.Psbt {
    const trimmed = (data ?? '').trim();
    try {
        return trimmed.toLowerCase().startsWith(PSBT_HEX_MAGIC) ? bitcoin.Psbt.fromHex(trimmed) : bitcoin.Psbt.fromBase64(trimmed);
    } catch (_) {
        throw new Error(SIGN_NOT_A_TRANSACTION);
    }
}

/**
 * The recovery phrase in a typed backup or a scanned standard SeedQR (each word as its 4-digit index in the BIP39
 * word list). Spacing and capitals don't matter. Throws SIGN_INVALID_BACKUP.
 */
export function backupToMnemonic(text: string): string {
    const wordlist = bip39.wordlists.english;
    const trimmed = (text ?? '').trim();
    let words: string[];
    if (/^\d+$/.test(trimmed) && (trimmed.length === 48 || trimmed.length === 96)) {
        words = (trimmed.match(/\d{4}/g) ?? []).map(n => wordlist[parseInt(n, 10)]);
    } else {
        // anything that isn't a letter separates words: keyboards can slip in odd spaces or punctuation
        words = trimmed.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    }
    const unknown = words.find(w => !wordlist.includes(w));
    if (unknown) throw new Error(`"${unknown}" isn't a recovery phrase word. Check its spelling.`);
    if (![12, 15, 18, 21, 24].includes(words.length)) {
        throw new Error(`That's ${words.length} words. A recovery phrase has 12 or 24.`);
    }
    const mnemonic = words.join(' ');
    if (!bip39.validateMnemonic(mnemonic, wordlist)) throw new Error(SIGN_INVALID_BACKUP);
    return mnemonic;
}

export function rootFromBackup(text: string, passphrase = ''): BIP32Interface {
    return bip32.fromSeed(bip39.mnemonicToSeedSync(backupToMnemonic(text), passphrase));
}

/** The same root, with the seed made natively when the phone can: seconds faster on a slow phone. */
export function rootFromBackupAsync(text: string, passphrase = ''): Promise<BIP32Interface> {
    return rootFromMnemonic(backupToMnemonic(text), passphrase);
}

const fingerprintHex = (root: BIP32Interface) => Buffer.from(root.fingerprint).toString('hex');

/** Master key fingerprints the transaction says its inputs are signed by. */
export function inputFingerprints(psbt: bitcoin.Psbt): string[] {
    const found = new Set<string>();
    psbt.data.inputs.forEach(input =>
        (input.bip32Derivation ?? []).forEach(d => found.add(Buffer.from(d.masterFingerprint).toString('hex'))),
    );
    return [...found];
}

/** Throws SIGN_NO_KEY_INFO, or `mismatch` (the backup message unless the caller signs with something else), unless the
 * transaction's inputs belong to this fingerprint. */
export function assertKeyMatches(psbt: bitcoin.Psbt, fingerprint: string, mismatch = SIGN_BACKUP_MISMATCH) {
    const fingerprints = inputFingerprints(psbt);
    if (!fingerprints.length) throw new Error(SIGN_NO_KEY_INFO);
    if (!fingerprints.includes(fingerprint.toLowerCase())) throw new Error(mismatch);
}

// wallets write hardened steps as ' or h; bip32 only reads '
const normalizePath = (path: string) => path.replace(/h/gi, "'");

/**
 * The master fingerprint a watch-only wallet writes when it was set up from a bare xpub and doesn't know the real one.
 * BlueWallet does, so a Cypher Box Cold Vault paired from the Hot Vault's xpub screen does too.
 */
const UNKNOWN_FINGERPRINT = '00000000';

type Derivation = { masterFingerprint: Buffer; path: string; pubkey: Buffer };

/**
 * A key the transaction is checked against: its master fingerprint (lower case), and its public key at a path, or null
 * when it can't tell. A seed answers for any path; a wallet on the phone only for its own account's addresses.
 */
export interface SigningKey {
    fingerprint: string;
    publicKeyAt: (path: string) => Buffer | null;
}

export function signingKeyFromRoot(root: BIP32Interface): SigningKey {
    return {
        fingerprint: fingerprintHex(root),
        publicKeyAt: path => {
            try {
                return Buffer.from(root.derivePath(normalizePath(path)).publicKey);
            } catch (_) {
                return null;
            }
        },
    };
}

/**
 * The same for a BlueWallet HD wallet on this phone (the Hot Vault): its fingerprint, and the public keys of its
 * account's receive and change addresses, which come from its xpub, so no private key is touched.
 */
export function signingKeyForWallet(wallet: {
    getMasterFingerprintHex: () => string;
    getDerivationPath?: () => string | undefined;
    _getNodePubkeyByIndex: (node: number, index: number) => Buffer | undefined;
}): SigningKey {
    const account = normalizePath(wallet.getDerivationPath?.() ?? "m/84'/0'/0'").replace(/\/+$/, '');
    return {
        fingerprint: String(wallet.getMasterFingerprintHex()).toLowerCase(),
        publicKeyAt: path => {
            const normalized = normalizePath(path);
            if (!normalized.startsWith(`${account}/`)) return null;
            const steps = normalized.slice(account.length + 1).split('/');
            if (steps.length !== 2 || !steps.every(s => /^\d+$/.test(s))) return null;
            const [change, index] = steps.map(Number);
            if (change !== 0 && change !== 1) return null;
            try {
                const pubkey = wallet._getNodePubkeyByIndex(change, index);
                return pubkey ? Buffer.from(pubkey) : null;
            } catch (_) {
                return null;
            }
        },
    };
}

/**
 * Whether a derivation in the transaction is this key's: it carries the key's fingerprint, or it carries 00000000 and
 * its path gives exactly the public key it states. The second is a stronger test than a 4-byte fingerprint, and it lets
 * a wallet set up from a bare xpub be signed for, as the Hot Vault's cosigning always did.
 */
export function isOwnDerivation(key: SigningKey, d: Derivation): boolean {
    const fingerprint = Buffer.from(d.masterFingerprint).toString('hex');
    if (fingerprint === key.fingerprint) return true;
    if (fingerprint !== UNKNOWN_FINGERPRINT) return false;
    const pubkey = key.publicKeyAt(d.path);
    return !!pubkey && pubkey.equals(Buffer.from(d.pubkey));
}

/** True when an input of the transaction belongs to this key. */
export function isForKey(psbt: bitcoin.Psbt, key: SigningKey): boolean {
    return psbt.data.inputs.some(input => (input.bip32Derivation ?? []).some(d => isOwnDerivation(key, d)));
}

/** Throws SIGN_NO_KEY_INFO, or `mismatch` (the backup message unless the caller signs with something else), unless an
 * input of the transaction belongs to this key. */
export function assertKeyOwns(psbt: bitcoin.Psbt, key: SigningKey, mismatch = SIGN_BACKUP_MISMATCH) {
    if (!inputFingerprints(psbt).length) throw new Error(SIGN_NO_KEY_INFO);
    if (!isForKey(psbt, key)) throw new Error(mismatch);
}

export function assertBackupMatches(psbt: bitcoin.Psbt, root: BIP32Interface) {
    assertKeyOwns(psbt, signingKeyFromRoot(root));
}

/**
 * A public key the way watch-only wallets read it with its origin: `[fingerprint/84h/0h/0h]zpub…`. BlueWallet's import,
 * and so a Cypher Box Cold Vault, takes the master fingerprint from it; given a bare xpub it writes 00000000.
 */
export function keyWithOrigin(fingerprint: string, path: string, xpub: string): string {
    const steps = normalizePath(path).replace(/^m\/?/, '').replace(/'/g, 'h');
    return `[${fingerprint.toLowerCase()}/${steps}]${xpub}`;
}

/** Highest address index counted as the paired wallet's own. Wallets look 20 past the last used address, so a real
 * wallet stays far below this; it's a backstop against a path crafted to hide coins, not a gap limit. */
const MAX_WALLET_ADDRESS_INDEX = 10000;

/** True for m/84'/0'/0'/0/i and m/84'/0'/0'/1/i (receive and change) with i below MAX_WALLET_ADDRESS_INDEX: the
 * account the signer pairs (SIGNER_KEY_PATH in signerPublicKey.ts, which imports from here). */
export function isWalletAddressPath(path: string): boolean {
    const m = /^m\/84'\/0'\/0'\/([01])\/(\d+)$/.exec(normalizePath(path).trim());
    return !!m && Number(m[2]) < MAX_WALLET_ADDRESS_INDEX;
}

const scriptsForPubkey = (pubkey: Buffer): Buffer[] => {
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey });
    return [
        p2wpkh.output as Buffer,
        bitcoin.payments.p2sh({ redeem: p2wpkh }).output as Buffer,
        bitcoin.payments.p2pkh({ pubkey }).output as Buffer,
    ];
};

/**
 * Whether an output really comes back to this key: it has to carry a derivation for this key (its fingerprint, or
 * 00000000 with a path that gives this key), that path has to give the stated public key, and the output script has to
 * pay that key. Throws SIGN_FALSE_CHANGE when the output claims this key but doesn't pay it.
 */
function isVerifiedChange(script: Buffer, derivations: Derivation[] | undefined, root: BIP32Interface): boolean {
    const key = signingKeyFromRoot(root);
    const ours = (derivations ?? []).filter(d => isOwnDerivation(key, d));
    if (!ours.length) return false;
    // Only where the paired wallet will look for it: this account's receive or change addresses, at an index a wallet
    // can reach. A path elsewhere (another account, index 500,000) still gives this key, but the watch-only wallet never
    // shows those coins, so the amount is listed as going out rather than coming back.
    if (!ours.every(d => isWalletAddressPath(d.path))) return false;
    for (const d of ours) {
        let pubkey: Buffer;
        try {
            pubkey = Buffer.from(root.derivePath(normalizePath(d.path)).publicKey);
        } catch (_) {
            throw new Error(SIGN_FALSE_CHANGE);
        }
        if (!pubkey.equals(Buffer.from(d.pubkey)) || !scriptsForPubkey(pubkey).some(s => s.equals(script))) {
            throw new Error(SIGN_FALSE_CHANGE);
        }
    }
    return true;
}

/**
 * An input's amount, as its signature commits to it. When a PSBT carries both, bitcoinjs signs a segwit input over the
 * previous transaction (nonWitnessUtxo), not witnessUtxo, so the review takes the amount from there too: a watch-only
 * wallet that put a smaller amount in witnessUtxo would otherwise show a small fee for a large one. The previous
 * transaction has to be the one the input spends, and witnessUtxo, when there, has to agree with it. Throws
 * SIGN_INPUT_MISMATCH.
 */
const inputValue = (psbt: bitcoin.Psbt, i: number): number | null => {
    const input = psbt.data.inputs[i];
    if (input.nonWitnessUtxo) {
        const spends = psbt.txInputs[i];
        let prevTx: bitcoin.Transaction;
        try {
            prevTx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
        } catch (_) {
            throw new Error(SIGN_INPUT_MISMATCH);
        }
        // both in the transaction's internal byte order
        if (!prevTx.getHash().equals(spends.hash)) throw new Error(SIGN_INPUT_MISMATCH);
        const prevOut = prevTx.outs[spends.index];
        if (!prevOut) throw new Error(SIGN_INPUT_MISMATCH);
        if (input.witnessUtxo && (input.witnessUtxo.value !== prevOut.value || !input.witnessUtxo.script.equals(prevOut.script))) {
            throw new Error(SIGN_INPUT_MISMATCH);
        }
        return prevOut.value;
    }
    if (input.witnessUtxo) return input.witnessUtxo.value;
    return null;
};

const addressOf = (script: Buffer): string | null => {
    try {
        return bitcoin.address.fromOutputScript(script);
    } catch (_) {
        return null; // OP_RETURN or a non-standard script
    }
};

function feeOf(psbt: bitcoin.Psbt): number | null {
    const values = psbt.txInputs.map((_, i) => inputValue(psbt, i));
    if (values.some(v => v === null)) return null;
    const totalIn = values.reduce((sum: number, v) => sum + (v as number), 0);
    return totalIn - psbt.txOutputs.reduce((sum, o) => sum + o.value, 0);
}

/** What the transaction does, checked against the backup's key. Throws SIGN_FALSE_CHANGE. */
export function reviewWithRoot(psbt: bitcoin.Psbt, root: BIP32Interface): TransactionReview {
    const key = signingKeyFromRoot(root);
    return {
        outputs: psbt.txOutputs.map((output, i) => ({
            address: addressOf(output.script),
            value: output.value,
            change: isVerifiedChange(output.script, psbt.data.outputs[i]?.bip32Derivation, root),
        })),
        fee: feeOf(psbt),
        inputCount: psbt.inputCount,
        ownInputs: psbt.data.inputs.filter(input => (input.bip32Derivation ?? []).some(d => isOwnDerivation(key, d))).length,
    };
}

/** The same, for a wallet already on the phone (the Hot Vault), which knows its own addresses. A fingerprint alone
 * still works, but then inputs written as 00000000 aren't counted as its own. */
export function reviewWithWallet(psbt: bitcoin.Psbt, isOwnAddress: (address: string) => boolean, key: SigningKey | string): TransactionReview {
    const signingKey: SigningKey = typeof key === 'string' ? { fingerprint: key.toLowerCase(), publicKeyAt: () => null } : key;
    return {
        outputs: psbt.txOutputs.map(output => {
            const address = addressOf(output.script);
            let change = false;
            try {
                change = !!address && isOwnAddress(address);
            } catch (_) {}
            return { address, value: output.value, change };
        }),
        fee: feeOf(psbt),
        inputCount: psbt.inputCount,
        ownInputs: psbt.data.inputs.filter(input => (input.bip32Derivation ?? []).some(d => isOwnDerivation(signingKey, d))).length,
    };
}

const signedCount = (psbt: bitcoin.Psbt) =>
    psbt.data.inputs.filter(input => (input.partialSig?.length ?? 0) > 0 || !!input.finalScriptWitness || !!input.finalScriptSig).length;

const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) => ecc.verify(msghash, pubkey, signature);

/**
 * Signs derivations written as 00000000. bitcoinjs picks a signer's derivations by fingerprint, then still checks that
 * each path gives the stated public key before it signs.
 */
const unknownFingerprintSigner = (root: BIP32Interface) => ({
    fingerprint: Buffer.from(UNKNOWN_FINGERPRINT, 'hex'),
    publicKey: Buffer.from(root.publicKey),
    derivePath: (path: string) => root.derivePath(normalizePath(path)),
    sign: (hash: Buffer) => Buffer.from(root.sign(hash)),
});

/**
 * Signs every input that belongs to this key and checks each new signature. Returns a signed copy, not finalized, so
 * the wallet that made the transaction can combine it and broadcast; its key details are left as that wallet wrote
 * them. Throws SIGN_NOTHING_SIGNED.
 */
export function signWithRoot(psbt: bitcoin.Psbt, root: BIP32Interface): { psbt: bitcoin.Psbt; signed: number } {
    const copy = bitcoin.Psbt.fromBase64(psbt.toBase64());
    const before = signedCount(copy);
    const key = signingKeyFromRoot(root);
    const fp = Buffer.from(root.fingerprint);
    const verified: number[] = [];
    copy.data.inputs.forEach((input, i) => {
        const derivations = input.bip32Derivation ?? [];
        if (derivations.some(d => Buffer.from(d.masterFingerprint).equals(fp))) {
            copy.signInputHD(i, root);
        } else {
            const unknown = derivations.filter(d => Buffer.from(d.masterFingerprint).toString('hex') === UNKNOWN_FINGERPRINT);
            // bitcoinjs signs every 00000000 derivation on the input, so each one has to be this key's
            if (!unknown.length || !unknown.every(d => isOwnDerivation(key, d))) return;
            copy.signInputHD(i, unknownFingerprintSigner(root));
        }
        if (!copy.validateSignaturesOfInput(i, validator)) throw new Error(SIGN_NOTHING_SIGNED);
        verified.push(i);
    });
    // Nonce-reuse canary on the inputs just signed, whose signatures were all verified above. Inputs this key didn't
    // sign may carry anything the PSBT's maker put there.
    auditPsbtSignatures(copy, verified);
    const signed = signedCount(copy) - before;
    if (signed <= 0) throw new Error(SIGN_NOTHING_SIGNED);
    return { psbt: copy, signed };
}

export const formatSignSats = (sats: number) => `${String(Math.round(sats)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} sats`;

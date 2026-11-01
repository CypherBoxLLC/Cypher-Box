import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import BIP32Factory, { BIP32Interface } from 'bip32';

import ecc from '../../blue_modules/noble_ecc';

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
    "This transaction wasn't made for your Hot Vault. Sign it with the backup or signing device it was made for.";
export const SIGN_FALSE_CHANGE =
    "An amount marked as coming back to your wallet goes to an address that isn't yours. Don't sign this transaction.";
export const SIGN_NOTHING_SIGNED = "Nothing in this transaction could be signed with this key.";

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

export function assertBackupMatches(psbt: bitcoin.Psbt, root: BIP32Interface) {
    assertKeyMatches(psbt, fingerprintHex(root));
}

// wallets write hardened steps as ' or h; bip32 only reads '
const normalizePath = (path: string) => path.replace(/h/gi, "'");

const scriptsForPubkey = (pubkey: Buffer): Buffer[] => {
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey });
    return [
        p2wpkh.output as Buffer,
        bitcoin.payments.p2sh({ redeem: p2wpkh }).output as Buffer,
        bitcoin.payments.p2pkh({ pubkey }).output as Buffer,
    ];
};

/**
 * Whether an output really comes back to this key: it has to carry a derivation for this key, that path has to give
 * the stated public key, and the output script has to pay that key. Throws SIGN_FALSE_CHANGE when the output claims
 * this key but doesn't pay it.
 */
function isVerifiedChange(script: Buffer, derivations: { masterFingerprint: Buffer; path: string; pubkey: Buffer }[] | undefined, root: BIP32Interface): boolean {
    const ours = (derivations ?? []).filter(d => Buffer.from(d.masterFingerprint).equals(Buffer.from(root.fingerprint)));
    if (!ours.length) return false;
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

const inputValue = (psbt: bitcoin.Psbt, i: number): number | null => {
    const input = psbt.data.inputs[i];
    if (input.witnessUtxo) return input.witnessUtxo.value;
    if (input.nonWitnessUtxo) {
        const prevOut = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo).outs[psbt.txInputs[i].index];
        return prevOut ? prevOut.value : null;
    }
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
    const fp = Buffer.from(root.fingerprint);
    return {
        outputs: psbt.txOutputs.map((output, i) => ({
            address: addressOf(output.script),
            value: output.value,
            change: isVerifiedChange(output.script, psbt.data.outputs[i]?.bip32Derivation, root),
        })),
        fee: feeOf(psbt),
        inputCount: psbt.inputCount,
        ownInputs: psbt.data.inputs.filter(input => (input.bip32Derivation ?? []).some(d => Buffer.from(d.masterFingerprint).equals(fp))).length,
    };
}

/** The same, for a wallet already on the phone (the Hot Vault), which knows its own addresses. */
export function reviewWithWallet(psbt: bitcoin.Psbt, isOwnAddress: (address: string) => boolean, fingerprint: string): TransactionReview {
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
        ownInputs: psbt.data.inputs.filter(input =>
            (input.bip32Derivation ?? []).some(d => Buffer.from(d.masterFingerprint).toString('hex') === fingerprint.toLowerCase()),
        ).length,
    };
}

const signedCount = (psbt: bitcoin.Psbt) =>
    psbt.data.inputs.filter(input => (input.partialSig?.length ?? 0) > 0 || !!input.finalScriptWitness || !!input.finalScriptSig).length;

const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) => ecc.verify(msghash, pubkey, signature);

/**
 * Signs every input that belongs to this key and checks each new signature. Returns a signed copy, not finalized, so
 * the wallet that made the transaction can combine it and broadcast. Throws SIGN_NOTHING_SIGNED.
 */
export function signWithRoot(psbt: bitcoin.Psbt, root: BIP32Interface): { psbt: bitcoin.Psbt; signed: number } {
    const copy = bitcoin.Psbt.fromBase64(psbt.toBase64());
    const before = signedCount(copy);
    const fp = Buffer.from(root.fingerprint);
    copy.data.inputs.forEach((input, i) => {
        if (!(input.bip32Derivation ?? []).some(d => Buffer.from(d.masterFingerprint).equals(fp))) return;
        copy.signInputHD(i, root);
        if (!copy.validateSignaturesOfInput(i, validator)) throw new Error(SIGN_NOTHING_SIGNED);
    });
    const signed = signedCount(copy) - before;
    if (signed <= 0) throw new Error(SIGN_NOTHING_SIGNED);
    return { psbt: copy, signed };
}

export const formatSignSats = (sats: number) => `${String(Math.round(sats)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} sats`;

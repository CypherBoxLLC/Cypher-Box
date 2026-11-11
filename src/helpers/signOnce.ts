import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import BIP32Factory, { BIP32Interface } from 'bip32';

import ecc from '../../blue_modules/noble_ecc';
import { PolicyKey, SignerWallet, isP2wshScript, policyKeyPubkey, policyWitnessScript } from './multisigPolicy';
import { rootFromMnemonic } from './seedFromWords';

/**
 * Signing an unsigned transaction (PSBT) made by a watch-only wallet: a Cypher Box Cold Vault, Sparrow or any other
 * app. Used by the sign-once flow, where the key comes from a backup (12 or 24 words, or a SeedQR) typed or scanned
 * just for this signature and never saved, and by the Hot Vault's own "Sign a transaction".
 *
 * The transaction is checked against the backup before anything is signed: its inputs have to belong to that backup,
 * and an output the transaction claims comes back to the same wallet has to really derive from it. A watch-only
 * wallet that lies about change is the attack this catches.
 *
 * A backup can also be one key of a native SegWit multisig wallet made in a coordinator (helpers/multisigPolicy). Its
 * inputs are signed only if their script is exactly a registered wallet's script at the path the transaction gives for
 * this key, and an output counts as change only if it pays that wallet's script at its path. There is no "sign anyway"
 * for a multisig the signer doesn't know, and the Hot Vault doesn't sign multisig at all.
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
export const SIGN_ON_SIGNING_DEVICE =
    "This phone only signs for its own Hot Vault. Sign this transaction on your signing device: a hardware wallet, or an offline phone in Offline Seed-Signer mode.";
export const SIGN_FALSE_CHANGE =
    "An amount marked as coming back to your wallet goes to an address that isn't yours. Don't sign this transaction.";
export const SIGN_NOTHING_SIGNED = "Nothing in this transaction could be signed with this key.";
export const SIGN_UNKNOWN_MULTISIG =
    "This transaction spends from a multisig wallet that isn't registered on this signer. Add the wallet's file under Multisig Wallets first, then sign again.";
export const SIGN_UNSUPPORTED_MULTISIG =
    "This transaction spends from a kind of multisig the signer doesn't sign. It only signs native SegWit (P2WSH) multisig wallets.";
export const SIGN_MIXED_WALLETS = "This transaction spends from more than one wallet. Sign one wallet's transactions at a time.";
export const SIGN_MULTISIG_HOT_VAULT =
    "The Hot Vault doesn't sign multisig transactions. Sign this one on an offline phone in Offline Seed-Signer mode, with your SeedQR.";
export const SIGN_INPUT_DETAILS =
    "This transaction's details about the coins it spends are missing or don't agree. Don't sign it: export it again from your wallet.";

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
    /** the registered multisig wallet the inputs spend from, when it is one */
    multisig?: { id: string; name: string; m: number; n: number };
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

const isP2shScript = (script: Buffer) => script.length === 23 && script[0] === 0xa9 && script[1] === 0x14 && script[22] === 0x87;
const isP2wpkhScript = (script: Buffer) => script.length === 22 && script[0] === 0x00 && script[1] === 0x14;

/**
 * The coin an input spends: from its witness UTXO, or from the whole previous transaction, which has to be the one the
 * input names. When both are there they have to agree: bitcoinjs signs with the previous transaction's amount, and the
 * review shows the witness UTXO's. Null when the input carries neither. Throws SIGN_INPUT_DETAILS.
 */
const prevoutOf = (psbt: bitcoin.Psbt, i: number): { script: Buffer; value: number } | null => {
    const input = psbt.data.inputs[i];
    let fromTx: { script: Buffer; value: number } | null = null;
    if (input.nonWitnessUtxo) {
        let tx: bitcoin.Transaction;
        try {
            tx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
        } catch (_) {
            throw new Error(SIGN_INPUT_DETAILS);
        }
        const spent = psbt.txInputs[i];
        const out = tx.outs[spent.index];
        if (!out || !Buffer.from(tx.getHash()).equals(Buffer.from(spent.hash))) throw new Error(SIGN_INPUT_DETAILS);
        fromTx = { script: Buffer.from(out.script), value: out.value };
    }
    if (input.witnessUtxo) {
        const fromWitness = { script: Buffer.from(input.witnessUtxo.script), value: input.witnessUtxo.value };
        if (fromTx && (fromTx.value !== fromWitness.value || !fromTx.script.equals(fromWitness.script))) {
            throw new Error(SIGN_INPUT_DETAILS);
        }
        return fromWitness;
    }
    return fromTx;
};

/**
 * True when an input spends a script rather than one key: P2WSH, or P2SH that isn't one key's nested SegWit. That is
 * multisig for this signer, whoever's input it is.
 */
const spendsScript = (psbt: bitcoin.Psbt, i: number): boolean => {
    const input = psbt.data.inputs[i];
    if (input.witnessScript) return true;
    if (input.redeemScript && !isP2wpkhScript(Buffer.from(input.redeemScript))) return true;
    let prevout: { script: Buffer } | null = null;
    try {
        prevout = prevoutOf(psbt, i);
    } catch (_) {
        return false;
    }
    return !!prevout && isP2wshScript(prevout.script);
};

/** True when the transaction spends any multisig (or other script) coin. */
export function isMultisigTransaction(psbt: bitcoin.Psbt): boolean {
    return psbt.data.inputs.some((_, i) => spendsScript(psbt, i));
}

/** The Hot Vault signs single-key coins only. Throws SIGN_MULTISIG_HOT_VAULT. */
export function assertSingleKeyOnly(psbt: bitcoin.Psbt) {
    if (isMultisigTransaction(psbt)) throw new Error(SIGN_MULTISIG_HOT_VAULT);
}

/**
 * What an input of this key spends: one key (P2WPKH, nested P2WPKH, P2PKH), or a P2WSH script whose witness script is
 * what the coin pays. Wrapped and legacy multisig aren't signed. Throws SIGN_UNSUPPORTED_MULTISIG or SIGN_INPUT_DETAILS.
 */
const scriptKind = (psbt: bitcoin.Psbt, i: number): 'single' | 'p2wsh' => {
    const input = psbt.data.inputs[i];
    const prevout = prevoutOf(psbt, i);
    if (input.redeemScript) {
        if (input.witnessScript || !isP2wpkhScript(Buffer.from(input.redeemScript))) throw new Error(SIGN_UNSUPPORTED_MULTISIG);
        return 'single';
    }
    if (input.witnessScript || (prevout && isP2wshScript(prevout.script))) {
        if (!prevout || !input.witnessScript) throw new Error(SIGN_INPUT_DETAILS);
        const paid = bitcoin.payments.p2wsh({ redeem: { output: Buffer.from(input.witnessScript) } }).output as Buffer;
        if (!paid.equals(prevout.script)) {
            // P2SH-wrapped multisig without its redeem script, or a witness script the coin doesn't pay
            throw new Error(isP2shScript(prevout.script) ? SIGN_UNSUPPORTED_MULTISIG : SIGN_INPUT_DETAILS);
        }
        return 'p2wsh';
    }
    // P2SH without the redeem script can't be signed or checked
    if (prevout && isP2shScript(prevout.script)) throw new Error(SIGN_INPUT_DETAILS);
    return 'single';
};

/** Receive or change and the index, after a wallet key's own path: `<key path>/0/12` is (0, 12). */
const branchAndIndex = (path: string, keyPath: string): { branch: number; index: number } | null => {
    const normalized = normalizePath(path);
    if (!normalized.startsWith(`${keyPath}/`)) return null;
    const steps = normalized.slice(keyPath.length + 1).split('/');
    if (steps.length !== 2 || !steps.every(s => /^\d{1,10}$/.test(s))) return null;
    const [branch, index] = steps.map(Number);
    if ((branch !== 0 && branch !== 1) || index >= 0x80000000) return null;
    return { branch, index };
};

interface WalletMatch {
    wallet: SignerWallet;
    key: PolicyKey;
    branch: number;
    index: number;
}

/**
 * The registered wallet whose script at this derivation's path is `witnessScript`: the derivation names one of its
 * keys (by fingerprint, or 00000000), its path is that key's path plus receive or change and an index, its public key
 * is that key's there, and the wallet's script there is the witness script, byte for byte.
 */
const walletForDerivation = (
    d: Derivation,
    witnessScript: Buffer,
    wallets: SignerWallet[],
    isCandidate: (key: PolicyKey) => boolean = () => true,
): WalletMatch | null => {
    const fingerprint = Buffer.from(d.masterFingerprint).toString('hex');
    for (const wallet of wallets) {
        for (const key of wallet.keys) {
            if ((fingerprint !== key.fingerprint && fingerprint !== UNKNOWN_FINGERPRINT) || !isCandidate(key)) continue;
            const at = branchAndIndex(d.path, key.path);
            if (!at) continue;
            if (!policyKeyPubkey(key, at.branch, at.index).equals(Buffer.from(d.pubkey))) continue;
            if (!policyWitnessScript(wallet, at.branch, at.index).equals(witnessScript)) continue;
            return { wallet, key, ...at };
        }
    }
    return null;
};

/**
 * Before a seed is loaded: a transaction that only spends multisig coins, none of them from a registered wallet, is
 * refused now, so nobody scans a SeedQR for something that would be refused anyway. The full check comes with the seed.
 * Throws SIGN_UNKNOWN_MULTISIG, SIGN_UNSUPPORTED_MULTISIG or SIGN_INPUT_DETAILS.
 */
export function assertMultisigRegistered(psbt: bitcoin.Psbt, wallets: SignerWallet[]) {
    if (!psbt.inputCount || !psbt.data.inputs.every((_, i) => spendsScript(psbt, i))) return;
    const known = psbt.data.inputs.some((input, i) => {
        if (scriptKind(psbt, i) !== 'p2wsh') return false;
        const witnessScript = Buffer.from(input.witnessScript as Buffer);
        return (input.bip32Derivation ?? []).some(d => walletForDerivation(d, witnessScript, wallets) !== null);
    });
    if (!known) throw new Error(SIGN_UNKNOWN_MULTISIG);
}

interface OwnSpend {
    /** inputs with a derivation of this key */
    inputs: number[];
    /** the registered wallet they spend from, and its key that is this one; null for single-key coins */
    multisig: { wallet: SignerWallet; key: PolicyKey } | null;
}

/**
 * The inputs this key signs, each checked. A P2WSH input has to be a registered wallet's script at the path the
 * transaction gives for this key, all of them from the same wallet, and the seed's key at that wallet key's path has
 * to be the wallet's key. Single-key and multisig coins aren't signed together.
 */
const ownSpend = (psbt: bitcoin.Psbt, key: SigningKey, wallets: SignerWallet[], root: BIP32Interface): OwnSpend => {
    const inputs: number[] = [];
    let single = false;
    let multisig: OwnSpend['multisig'] = null;
    psbt.data.inputs.forEach((input, i) => {
        const ours = (input.bip32Derivation ?? []).filter(d => isOwnDerivation(key, d));
        if (!ours.length) return;
        inputs.push(i);
        if (scriptKind(psbt, i) === 'single') {
            single = true;
            return;
        }
        const witnessScript = Buffer.from(input.witnessScript as Buffer);
        for (const d of ours) {
            const match = walletForDerivation(d, witnessScript, wallets, k => k.fingerprint === key.fingerprint);
            if (!match) throw new Error(SIGN_UNKNOWN_MULTISIG);
            if (multisig && multisig.wallet.id !== match.wallet.id) throw new Error(SIGN_MIXED_WALLETS);
            // the wallet's key with this fingerprint has to be this seed's key, not just share its fingerprint
            if (root.derivePath(match.key.path).neutered().toBase58() !== match.key.xpub) throw new Error(SIGN_BACKUP_MISMATCH);
            multisig = { wallet: match.wallet, key: match.key };
        }
    });
    if (single && multisig) throw new Error(SIGN_MIXED_WALLETS);
    return { inputs, multisig };
};

/**
 * Whether an output comes back to the multisig wallet: it carries this key's derivation, that path is the wallet key's
 * path plus receive or change and an index, and the output pays the wallet's script there with this key's public key in
 * it. This key's derivation on an output that pays anything else (another multisig this key is part of, say) is
 * SIGN_FALSE_CHANGE.
 */
const isVerifiedMultisigChange = (
    output: { bip32Derivation?: Derivation[]; witnessScript?: Buffer } | undefined,
    script: Buffer,
    key: SigningKey,
    spend: { wallet: SignerWallet; key: PolicyKey },
): boolean => {
    const ours = (output?.bip32Derivation ?? []).filter(d => isOwnDerivation(key, d));
    if (!ours.length) return false;
    for (const d of ours) {
        const at = branchAndIndex(d.path, spend.key.path);
        if (!at) throw new Error(SIGN_FALSE_CHANGE);
        const witnessScript = policyWitnessScript(spend.wallet, at.branch, at.index);
        const paid = bitcoin.payments.p2wsh({ redeem: { output: witnessScript } }).output as Buffer;
        if (!paid.equals(script) || !policyKeyPubkey(spend.key, at.branch, at.index).equals(Buffer.from(d.pubkey))) {
            throw new Error(SIGN_FALSE_CHANGE);
        }
        if (output?.witnessScript && !Buffer.from(output.witnessScript).equals(witnessScript)) throw new Error(SIGN_FALSE_CHANGE);
    }
    return true;
};

const addressOf = (script: Buffer): string | null => {
    try {
        return bitcoin.address.fromOutputScript(script);
    } catch (_) {
        return null; // OP_RETURN or a non-standard script
    }
};

/** Throws SIGN_INPUT_DETAILS when an input's amount can't be trusted. */
function feeOf(psbt: bitcoin.Psbt): number | null {
    const values = psbt.txInputs.map((_, i) => prevoutOf(psbt, i)?.value ?? null);
    if (values.some(v => v === null)) return null;
    const totalIn = values.reduce((sum: number, v) => sum + (v as number), 0);
    return totalIn - psbt.txOutputs.reduce((sum, o) => sum + o.value, 0);
}

/**
 * What the transaction does, checked against the backup's key and, for multisig, the registered wallets. Throws
 * SIGN_FALSE_CHANGE, SIGN_UNKNOWN_MULTISIG, SIGN_UNSUPPORTED_MULTISIG, SIGN_MIXED_WALLETS, SIGN_INPUT_DETAILS or
 * SIGN_BACKUP_MISMATCH.
 */
export function reviewWithRoot(psbt: bitcoin.Psbt, root: BIP32Interface, wallets: SignerWallet[] = []): TransactionReview {
    const key = signingKeyFromRoot(root);
    const spend = ownSpend(psbt, key, wallets, root);
    const multisig = spend.multisig;
    return {
        outputs: psbt.txOutputs.map((output, i) => ({
            address: addressOf(output.script),
            value: output.value,
            change: multisig
                ? isVerifiedMultisigChange(psbt.data.outputs[i], output.script, key, multisig)
                : isVerifiedChange(output.script, psbt.data.outputs[i]?.bip32Derivation, root),
        })),
        fee: feeOf(psbt),
        inputCount: psbt.inputCount,
        ownInputs: spend.inputs.length,
        ...(multisig
            ? { multisig: { id: multisig.wallet.id, name: multisig.wallet.name, m: multisig.wallet.m, n: multisig.wallet.keys.length } }
            : {}),
    };
}

/** The same, for a wallet already on the phone (the Hot Vault), which knows its own addresses. A fingerprint alone
 * still works, but then inputs written as 00000000 aren't counted as its own. Throws SIGN_MULTISIG_HOT_VAULT. */
export function reviewWithWallet(psbt: bitcoin.Psbt, isOwnAddress: (address: string) => boolean, key: SigningKey | string): TransactionReview {
    assertSingleKeyOnly(psbt);
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

const sigPubkeys = (input: { partialSig?: { pubkey: Buffer }[] }) => (input.partialSig ?? []).map(s => Buffer.from(s.pubkey).toString('hex'));

/**
 * Signs every input that belongs to this key, after the same checks as the review, and checks that each input got
 * signatures from this key only and that they verify. Another cosigner's signatures already on the transaction are
 * kept; an input this key has already signed is left as it is. Returns a signed copy, not finalized, so the wallet that
 * made the transaction can combine it and broadcast; its key details are left as that wallet wrote them. Throws
 * SIGN_NOTHING_SIGNED, or what the review throws.
 */
export function signWithRoot(psbt: bitcoin.Psbt, root: BIP32Interface, wallets: SignerWallet[] = []): { psbt: bitcoin.Psbt; signed: number } {
    const copy = bitcoin.Psbt.fromBase64(psbt.toBase64());
    const key = signingKeyFromRoot(root);
    // whatever the review refuses isn't signed either, change included, even if nobody looked at a review
    reviewWithRoot(copy, root, wallets);
    const spend = ownSpend(copy, key, wallets, root);
    const fp = Buffer.from(root.fingerprint);
    let signed = 0;
    for (const i of spend.inputs) {
        const input = copy.data.inputs[i];
        const derivations = input.bip32Derivation ?? [];
        const ourPubkeys = derivations.filter(d => isOwnDerivation(key, d)).map(d => Buffer.from(d.pubkey).toString('hex'));
        const before = sigPubkeys(input);
        if (ourPubkeys.every(p => before.includes(p))) continue;
        if (derivations.some(d => Buffer.from(d.masterFingerprint).equals(fp))) {
            copy.signInputHD(i, root);
        } else {
            const unknown = derivations.filter(d => Buffer.from(d.masterFingerprint).toString('hex') === UNKNOWN_FINGERPRINT);
            // bitcoinjs signs every 00000000 derivation on the input, so each one has to be this key's
            if (!unknown.length || !unknown.every(d => isOwnDerivation(key, d))) continue;
            copy.signInputHD(i, unknownFingerprintSigner(root));
        }
        const added = sigPubkeys(copy.data.inputs[i]).filter(p => !before.includes(p));
        if (!added.length || !added.every(p => ourPubkeys.includes(p))) throw new Error(SIGN_NOTHING_SIGNED);
        if (!added.every(p => copy.validateSignaturesOfInput(i, validator, Buffer.from(p, 'hex')))) throw new Error(SIGN_NOTHING_SIGNED);
        signed++;
    }
    if (signed <= 0) throw new Error(SIGN_NOTHING_SIGNED);
    return { psbt: copy, signed };
}

export const formatSignSats = (sats: number) => `${String(Math.round(sats)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} sats`;

import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import BIP32Factory, { BIP32Interface } from 'bip32';
import * as necc from '@noble/secp256k1';
import b58 from 'bs58check';
import createHash from 'create-hash';
import { createHmac } from 'crypto';

import ecc from '../../blue_modules/noble_ecc';

/**
 * Multisig wallets the Offline Seed-Signer holds one key of. The wallet itself lives in a coordinator (Nunchuk, Sparrow,
 * BlueWallet or another app): it shows the balance and makes the transactions. The signer keeps the wallet's public
 * description, registered from the file or QR the coordinator exports, so it can tell for itself that a transaction
 * spends from that wallet and that its change goes back to it. Without one it refuses multisig transactions outright.
 *
 * Only native SegWit multisig is read: P2WSH with sortedmulti, 2 to 15 keys, every key with its fingerprint and path,
 * receive addresses at /0/* and change at /1/*. Anything else (Taproot, miniscript, wrapped or legacy multisig, keys in
 * a fixed order, private keys, testnet) is refused with a reason, never read loosely. That is why this doesn't use
 * BlueWallet's MultisigHDWallet.setSecret: it accepts partial files, gives every key the last `Derivation:` line it
 * saw, and reads descriptors without checking their checksum.
 *
 * Formats: Coldcard-style text files (Nunchuk, Sparrow, BlueWallet, Keystone and Passport write these), output
 * descriptors (one with <0;1>/*, a receive and change pair, or keys without a suffix as Sparrow's Specter export
 * writes them), the same inside JSON, the descriptor string the scanner makes from a UR crypto-output, and unencrypted
 * BSMS 1.0 files (BIP-129), whose first address is checked.
 */

const bip32 = BIP32Factory(ecc);

export interface PolicyKey {
    /** master key fingerprint, 8 lowercase hex digits */
    fingerprint: string;
    /** derivation path from the master key, hardened steps written with ' (m/48'/0'/0'/2') */
    path: string;
    /** the public key at that path, as a standard xpub */
    xpub: string;
}

export interface MultisigPolicy {
    /** the same for the same wallet whatever order a file lists its keys in */
    id: string;
    name: string;
    /** signatures needed */
    m: number;
    /** in the order the file listed them */
    keys: PolicyKey[];
}

/** A wallet registered on this signer, after its SeedQR showed that one of the keys is this seed's. */
export interface SignerWallet extends MultisigPolicy {
    /** fingerprint of the key the signer's seed holds */
    ownFingerprint: string;
    /** epoch ms */
    addedAt: number;
}

export const MAX_MULTISIG_KEYS = 15;
export const DEFAULT_WALLET_NAME = 'Multisig wallet';

export const WALLET_FILE_UNREADABLE =
    "This isn't a multisig wallet file the signer can read. In your coordinator, export the wallet for a signing device: a wallet file (text), a BSMS file or its output descriptor.";
export const WALLET_FILE_SINGLE_KEY =
    "This is a single key, not a multisig wallet. Once your coordinator has made the wallet, scan the wallet file it exports for signing devices.";
export const WALLET_FILE_SEED = "That's a recovery phrase, not a wallet file. A wallet file holds only public keys.";
export const WALLET_FILE_PRIVATE =
    "This file holds a private key or a recovery phrase, so it isn't a wallet file to share. Don't use it, and keep it off any phone that goes online.";
export const WALLET_FILE_NOT_P2WSH =
    "The signer only works with native SegWit multisig wallets (P2WSH, sortedmulti). This wallet is another kind, so it can't be added.";
export const WALLET_FILE_TESTNET = 'This wallet uses testnet keys. The signer works with Bitcoin mainnet only.';
export const WALLET_FILE_BAD_CHECKSUM = "This descriptor's checksum doesn't match: it was changed or damaged on the way. Export it again.";
export const WALLET_FILE_NO_FORMAT = "This wallet file doesn't say its address type. It needs a line reading Format: P2WSH.";
export const WALLET_FILE_NO_POLICY = "This wallet file doesn't say how many signatures it needs. It needs a line such as Policy: 2 of 3.";
export const WALLET_FILE_NO_ORIGIN =
    "A key in this wallet comes without its fingerprint and derivation path. Export the wallet again with key details included.";
export const WALLET_FILE_PATHS =
    "This wallet uses an address layout the signer doesn't support. It needs receive addresses at /0/* and change at /1/*.";
export const WALLET_FILE_ENCRYPTED = 'This BSMS file is encrypted. Export it again without encryption.';
export const WALLET_FILE_BSMS_VERSION = "This BSMS file has a version the signer doesn't read. It reads BSMS 1.0.";
export const WALLET_FILE_FIRST_ADDRESS =
    "The first address in this file doesn't come from its keys. Don't use this file: export the wallet again.";
export const WALLET_FILE_DUPLICATE_KEY = 'The same key appears twice in this wallet.';
export const WALLET_FILE_NO_FINGERPRINT = 'A key in this wallet has no fingerprint (00000000). Export the wallet again with key details included.';
export const OWN_KEY_DIFFERENT =
    "This wallet lists your seed's fingerprint with a different key. Don't use this wallet file: it may have been changed.";

export const walletFileBadKey = (n: number) =>
    `Key ${n} in this wallet isn't a valid public key, or its details don't match its derivation path.`;
export const walletFileKeyCount = (m: number, n: number, count: number) =>
    `This wallet file says ${m} of ${n}, but lists ${count} key${count === 1 ? '' : 's'}.`;
export const walletFileSize = (n: number) =>
    `This wallet has ${n} key${n === 1 ? '' : 's'}. The signer works with multisig wallets of 2 to ${MAX_MULTISIG_KEYS} keys.`;
export const walletFileThreshold = (m: number, n: number) => `This wallet needs ${m} of ${n} signatures, which can't work.`;
export const walletFileSameFingerprint = (fingerprint: string) =>
    `Two keys in this wallet have the same fingerprint (${fingerprint}). Each key of a multisig should come from its own seed.`;
export const ownKeyMissing = (fingerprint: string) =>
    `This seed (fingerprint ${fingerprint}) isn't one of this wallet's keys. Check the SeedQR, and the passphrase if you use one.`;

// ---------------------------------------------------------------------------------------------------------------------
// Descriptor checksum (BIP-380)

/* eslint-disable no-bitwise */

const INPUT_CHARSET = "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0xf5dee51989, 0xa9fdca3312, 0x1bab10e32d, 0x3706b1677a, 0x644d626ffd].map(g => BigInt(g));
const LOW_35_BITS = BigInt(0x7ffffffff);
const B1 = BigInt(1);
const B5 = BigInt(5);
const B31 = BigInt(31);
const B35 = BigInt(35);

const polymod = (c: bigint, value: number): bigint => {
    const top = c >> B35;
    let next = ((c & LOW_35_BITS) << B5) ^ BigInt(value);
    GENERATOR.forEach((g, i) => {
        if ((top >> BigInt(i)) & B1) next ^= g;
    });
    return next;
};

/** The 8-character checksum of a descriptor written without one. Throws on a character descriptors can't contain. */
export function descriptorChecksum(descriptor: string): string {
    let c = B1;
    let group = 0;
    let groupCount = 0;
    for (const ch of descriptor) {
        const pos = INPUT_CHARSET.indexOf(ch);
        if (pos === -1) throw new Error(WALLET_FILE_UNREADABLE);
        c = polymod(c, pos & 31);
        group = group * 3 + (pos >> 5);
        if (++groupCount === 3) {
            c = polymod(c, group);
            group = 0;
            groupCount = 0;
        }
    }
    if (groupCount > 0) c = polymod(c, group);
    for (let i = 0; i < 8; i++) c = polymod(c, 0);
    c ^= B1;
    let out = '';
    for (let i = 0; i < 8; i++) out += CHECKSUM_CHARSET[Number((c >> (B5 * BigInt(7 - i))) & B31)];
    return out;
}
/* eslint-enable no-bitwise */

// ---------------------------------------------------------------------------------------------------------------------
// Keys

const XPUB = '0488b21e';
// SLIP-132: the same key data, labelled for native SegWit multisig
const ZPUB_MULTISIG = '02aa7ed3';
const TESTNET_PUBLIC = ['043587cf', '024289ef', '02575483', '044a5262', '045f1cf6'];
const OTHER_MAINNET_PUBLIC = ['049d7cb2', '04b24746', '0295b43f'];
const PRIVATE_VERSIONS = ['0488ade4', '02aa7a99', '049d7878', '04b2430c', '0295b005', '04358394', '02575048', '044a4e28', '045f18bc', '024285b5'];

const HARDENED = 0x80000000;

const PRIVATE_KEY_TOKEN = /(?:^|[^1-9A-HJ-NP-Za-km-z])[xyzYZtuvUV]prv[1-9A-HJ-NP-Za-km-z]{90,}/;

/** `m/48'/0'/0'/2'` from `48h/0h/0h/2h`, `/48'/0'/0'/2'` or `m/48H/...`; throws on anything else. */
const normalizePolicyPath = (steps: string): { path: string; indexes: number[] } => {
    const parts = steps.replace(/^m/, '').split('/').filter(p => p !== '');
    const indexes = parts.map(p => {
        const match = /^(\d{1,10})(['hH]?)$/.exec(p);
        if (!match) throw new Error(WALLET_FILE_UNREADABLE);
        const index = Number(match[1]);
        if (index >= HARDENED) throw new Error(WALLET_FILE_UNREADABLE);
        return match[2] ? index + HARDENED : index;
    });
    const path = ['m', ...indexes.map(i => (i >= HARDENED ? `${i - HARDENED}'` : String(i)))].join('/');
    return { path, indexes };
};

/** A key from a wallet file, checked: a mainnet public key whose depth and child number agree with its path. */
const policyKey = (fingerprint: string, steps: string, encoded: string, n: number): PolicyKey => {
    if (!/^[0-9a-fA-F]{8}$/.test(fingerprint)) throw new Error(WALLET_FILE_NO_ORIGIN);
    const fp = fingerprint.toLowerCase();
    if (fp === '00000000') throw new Error(WALLET_FILE_NO_FINGERPRINT);
    let data: Buffer;
    try {
        data = Buffer.from(b58.decode(encoded.trim()));
    } catch (_) {
        throw new Error(walletFileBadKey(n));
    }
    if (data.length !== 78) throw new Error(walletFileBadKey(n));
    // Buffer's own toString with a range: on Hermes, subarray() gives a plain Uint8Array, whose toString ignores 'hex'
    const version = data.toString('hex', 0, 4);
    if (PRIVATE_VERSIONS.includes(version)) throw new Error(WALLET_FILE_PRIVATE);
    if (TESTNET_PUBLIC.includes(version)) throw new Error(WALLET_FILE_TESTNET);
    if (OTHER_MAINNET_PUBLIC.includes(version)) throw new Error(WALLET_FILE_NOT_P2WSH);
    if (version !== XPUB && version !== ZPUB_MULTISIG) throw new Error(walletFileBadKey(n));
    const standard = b58.encode(Buffer.concat([Buffer.from(XPUB, 'hex'), Buffer.from(data.subarray(4))]));
    let node: BIP32Interface;
    try {
        node = bip32.fromBase58(standard);
    } catch (_) {
        throw new Error(walletFileBadKey(n));
    }
    let normalized: { path: string; indexes: number[] };
    try {
        normalized = normalizePolicyPath(steps);
    } catch (_) {
        throw new Error(walletFileBadKey(n));
    }
    const { path, indexes } = normalized;
    // the key has to be where the file says it was derived, as Coldcard also checks
    if (node.depth !== indexes.length) throw new Error(walletFileBadKey(n));
    if (indexes.length > 0 && node.index !== indexes[indexes.length - 1]) throw new Error(walletFileBadKey(n));
    return { fingerprint: fp, path, xpub: node.neutered().toBase58() };
};

type Suffix = 'none' | 'receive' | 'change' | 'both';

const suffixOf = (text: string): Suffix => {
    switch (text) {
        case '':
            return 'none';
        case '/0/*':
            return 'receive';
        case '/1/*':
            return 'change';
        // BIP-389 multipath, and BIP-129's shorthand for the same pair
        case '/<0;1>/*':
        case '/**':
            return 'both';
        default:
            throw new Error(WALLET_FILE_PATHS);
    }
};

const BASE58_RUN = '[1-9A-HJ-NP-Za-km-z]+';
// [fingerprint/path]key/suffix, and fingerprint/path'key/suffix, which is how the scanner writes a UR crypto-output
const KEY_WITH_ORIGIN = new RegExp(`^\\[([0-9a-fA-F]{8})((?:/\\d+['hH]?)*)\\](${BASE58_RUN})(/.*)?$`);
const KEY_WITH_BARE_ORIGIN = new RegExp(`^([0-9a-fA-F]{8})((?:/\\d+['hH]?)+)([a-zA-Z]{4}${BASE58_RUN})(/.*)?$`);
const KEY_WITHOUT_ORIGIN = new RegExp(`^[a-zA-Z]{4}${BASE58_RUN}(/.*)?$`);

const parseKeyExpression = (expression: string, n: number): { key: PolicyKey; suffix: Suffix } => {
    const match = KEY_WITH_ORIGIN.exec(expression) ?? KEY_WITH_BARE_ORIGIN.exec(expression);
    if (!match) {
        if (KEY_WITHOUT_ORIGIN.test(expression)) throw new Error(WALLET_FILE_NO_ORIGIN);
        throw new Error(walletFileBadKey(n));
    }
    const [, fingerprint, steps, encoded, suffix] = match;
    if (/\*['hH]$/.test(suffix ?? '')) throw new Error(WALLET_FILE_PATHS);
    return { key: policyKey(fingerprint, steps, encoded, n), suffix: suffixOf(suffix ?? '') };
};

// ---------------------------------------------------------------------------------------------------------------------
// Policies

const cleanName = (name: string | undefined | null): string => {
    const cleaned = String(name ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned ? cleaned.slice(0, 40) : DEFAULT_WALLET_NAME;
};

const keyExpression = (key: PolicyKey) => `[${key.fingerprint}${key.path.slice(1).replace(/'/g, 'h')}]${key.xpub}/<0;1>/*`;

/**
 * The wallet as one output descriptor with its checksum: `wsh(sortedmulti(2,[fp/48h/0h/0h/2h]xpub…/<0;1>/*,…))#…`, keys in
 * the file's order. Sparrow, Bitcoin Core 26+ and EntropyLab read it.
 */
export function policyDescriptor(policy: Pick<MultisigPolicy, 'm' | 'keys'>): string {
    const body = `wsh(sortedmulti(${policy.m},${policy.keys.map(keyExpression).join(',')}))`;
    return `${body}#${descriptorChecksum(body)}`;
}

const policyId = (m: number, keys: PolicyKey[]): string => {
    // sortedmulti doesn't depend on the order of the keys, so neither does the id
    const sorted = [...keys].sort((a, b) => (a.xpub < b.xpub ? -1 : a.xpub > b.xpub ? 1 : 0));
    return createHash('sha256').update(policyDescriptor({ m, keys: sorted })).digest('hex').slice(0, 16);
};

/** Checks the quorum and the keys, and gives the wallet its id. */
export function makePolicy(m: number, keys: PolicyKey[], name?: string | null): MultisigPolicy {
    const n = keys.length;
    if (n < 2 || n > MAX_MULTISIG_KEYS) throw new Error(walletFileSize(n));
    if (!Number.isInteger(m) || m < 1 || m > n) throw new Error(walletFileThreshold(m, n));
    const fingerprints = new Set<string>();
    const xpubs = new Set<string>();
    for (const key of keys) {
        if (xpubs.has(key.xpub)) throw new Error(WALLET_FILE_DUPLICATE_KEY);
        if (fingerprints.has(key.fingerprint)) throw new Error(walletFileSameFingerprint(key.fingerprint));
        xpubs.add(key.xpub);
        fingerprints.add(key.fingerprint);
    }
    return { id: policyId(m, keys), name: cleanName(name), m, keys: keys.map(k => ({ ...k })) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Scripts and addresses

interface Branch {
    node: BIP32Interface;
    pubkey: Buffer;
    point: InstanceType<typeof necc.Point>;
    children: Map<number, Buffer>;
}

// A key's receive and change nodes (key/0, key/1) are worked out once, with their point decoded once: every address
// starts from them, and bip32's derive decodes the parent again for every child. Children are kept too, so a second
// search through the same wallet is instant. All of it is public.
const branches = new Map<string, Branch>();
const branchOf = (xpub: string, branch: number): Branch => {
    const cacheKey = `${xpub}/${branch}`;
    let entry = branches.get(cacheKey);
    if (!entry) {
        const node = bip32.fromBase58(xpub).derive(branch);
        const pubkey = Buffer.from(node.publicKey);
        entry = { node, pubkey, point: necc.Point.fromHex(pubkey), children: new Map() };
        branches.set(cacheKey, entry);
    }
    return entry;
};

/** Drops what's kept of a key's child public keys: for a seed's own account, once a search through it is done. */
export function forgetKeyCache(xpub: string) {
    branches.delete(`${xpub}/0`);
    branches.delete(`${xpub}/1`);
}

/** Public key of one of the wallet's keys at branch/index (receive 0, change 1): BIP32's public child derivation. */
export function policyKeyPubkey(key: PolicyKey, branch: number, index: number): Buffer {
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new Error(WALLET_FILE_PATHS);
    const entry = branchOf(key.xpub, branch);
    let child = entry.children.get(index);
    if (!child) {
        const data = Buffer.alloc(37);
        entry.pubkey.copy(data, 0);
        data.writeUInt32BE(index, 33);
        const I = createHmac('sha512', Buffer.from(entry.node.chainCode)).update(data).digest();
        // a range on Buffer's own toString, not subarray(): on Hermes that gives a plain Uint8Array, which ignores 'hex'
        const tweak = BigInt(`0x${Buffer.from(I).toString('hex', 0, 32)}`);
        try {
            child = Buffer.from(entry.point.add(necc.Point.BASE.multiply(tweak)).toRawBytes(true));
        } catch (_) {
            // a tweak of 0 or past the curve order, or the point at infinity (odds about 1 in 2^127): bip32's own rule
            child = Buffer.from(entry.node.derive(index).publicKey);
        }
        entry.children.set(index, child);
    }
    return child;
}

/** The witness script at branch/index: m, every key's public key there in sorted order, n, OP_CHECKMULTISIG. */
export function policyWitnessScript(policy: Pick<MultisigPolicy, 'm' | 'keys'>, branch: number, index: number): Buffer {
    const pubkeys = policy.keys.map(k => policyKeyPubkey(k, branch, index)).sort(Buffer.compare);
    return bitcoin.payments.p2ms({ m: policy.m, pubkeys }).output as Buffer;
}

export function policyOutputScript(policy: Pick<MultisigPolicy, 'm' | 'keys'>, branch: number, index: number): Buffer {
    return bitcoin.payments.p2wsh({ redeem: { output: policyWitnessScript(policy, branch, index) } }).output as Buffer;
}

export function policyAddress(policy: Pick<MultisigPolicy, 'm' | 'keys'>, branch: number, index: number): string {
    return bitcoin.payments.p2wsh({ redeem: { output: policyWitnessScript(policy, branch, index) } }).address as string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading wallet files

interface ParsedDescriptor {
    m: number;
    keys: PolicyKey[];
    suffix: Suffix;
}

const parseDescriptor = (text: string): ParsedDescriptor => {
    const trimmed = text.trim();
    const hash = trimmed.lastIndexOf('#');
    const body = hash === -1 ? trimmed : trimmed.slice(0, hash);
    if (hash !== -1) {
        const checksum = trimmed.slice(hash + 1);
        let expected: string;
        try {
            expected = descriptorChecksum(body);
        } catch (_) {
            throw new Error(WALLET_FILE_UNREADABLE);
        }
        if (checksum !== expected) throw new Error(WALLET_FILE_BAD_CHECKSUM);
    }
    if (/^(sh\(|tr\(|rawtr\()/.test(body)) throw new Error(WALLET_FILE_NOT_P2WSH);
    if (/^(wpkh|pkh|combo|addr|raw)\(/.test(body)) throw new Error(WALLET_FILE_SINGLE_KEY);
    if (!body.startsWith('wsh(')) throw new Error(WALLET_FILE_UNREADABLE);
    const inner = /^wsh\(sortedmulti\(([^()]*)\)\)$/.exec(body);
    // wsh(multi(...)) keeps the keys in a fixed order; anything else in wsh() is miniscript
    if (!inner) throw new Error(WALLET_FILE_NOT_P2WSH);
    const parts = inner[1].split(',');
    if (!/^\d{1,2}$/.test(parts[0])) throw new Error(WALLET_FILE_UNREADABLE);
    const m = Number(parts[0]);
    const parsed = parts.slice(1).map((expression, i) => parseKeyExpression(expression, i + 1));
    if (!parsed.length) throw new Error(WALLET_FILE_UNREADABLE);
    const suffixes = new Set(parsed.map(p => p.suffix));
    if (suffixes.size !== 1) throw new Error(WALLET_FILE_PATHS);
    return { m, keys: parsed.map(p => p.key), suffix: parsed[0].suffix };
};

const sameKeys = (a: PolicyKey[], b: PolicyKey[]) =>
    a.length === b.length && a.every((k, i) => k.fingerprint === b[i].fingerprint && k.path === b[i].path && k.xpub === b[i].xpub);

/**
 * One descriptor for the whole wallet, or several for the same keys: a receive and change pair, or (as Sparrow's
 * descriptor file has) the multipath one next to the pair. They all have to describe the same wallet.
 */
const policyFromDescriptors = (descriptors: string[], name?: string | null): MultisigPolicy => {
    const parsed = descriptors.map(parseDescriptor);
    if (!parsed.length || parsed.length > 4) throw new Error(WALLET_FILE_UNREADABLE);
    const [first] = parsed;
    if (parsed.some(p => p.m !== first.m || !sameKeys(p.keys, first.keys))) throw new Error(WALLET_FILE_UNREADABLE);
    const suffixes = new Set(parsed.map(p => p.suffix));
    // keys without a suffix stand for the standard receive and change chains, and can't be mixed with ones that have one
    if (suffixes.has('none') && suffixes.size > 1) throw new Error(WALLET_FILE_PATHS);
    // a change descriptor alone doesn't describe the wallet's receive addresses
    if (suffixes.size === 1 && suffixes.has('change')) throw new Error(WALLET_FILE_PATHS);
    return makePolicy(first.m, first.keys, name);
};

const isKeyToken = (value: string) => /^[a-zA-Z]{4}[1-9A-HJ-NP-Za-km-z]{100,}$/.test(value);

/** Coldcard's multisig file, as Nunchuk, Sparrow, BlueWallet, Keystone and Passport write it. */
const policyFromTextFile = (text: string): MultisigPolicy => {
    let name: string | null = null;
    let quorum: { m: number; n: number } | null = null;
    let format: string | null = null;
    // a Derivation: line holds for the keys after it; BlueWallet's "# derivation:" comment for the next key only
    let derivation: string | null = null;
    let nextKeyPath: string | null = null;
    const keys: PolicyKey[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('#')) {
            const comment = /^#\s*derivation\s*:\s*(\S+)\s*$/i.exec(line);
            if (comment) nextKeyPath = comment[1];
            continue;
        }
        const colon = line.indexOf(':');
        if (colon === -1) {
            if (line.split(/\s+/).some(isKeyToken)) throw new Error(WALLET_FILE_UNREADABLE);
            continue;
        }
        const field = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        switch (field.toLowerCase()) {
            case 'name':
                name = value;
                break;
            case 'policy': {
                const match = /^(\d{1,2})\s*(?:of|\/)\s*(\d{1,2})$/i.exec(value);
                if (!match) throw new Error(WALLET_FILE_NO_POLICY);
                quorum = { m: Number(match[1]), n: Number(match[2]) };
                break;
            }
            case 'derivation':
                derivation = value;
                break;
            case 'format':
                format = value.toUpperCase();
                break;
            case 'seed':
                throw new Error(WALLET_FILE_PRIVATE);
            default:
                if (/^[0-9a-fA-F]{8}$/.test(field)) {
                    const path = nextKeyPath ?? derivation;
                    nextKeyPath = null;
                    if (!path) throw new Error(WALLET_FILE_NO_ORIGIN);
                    keys.push(policyKey(field, path, value, keys.length + 1));
                } else if (isKeyToken(value)) {
                    // a key line whose fingerprint isn't 8 hex digits
                    throw new Error(WALLET_FILE_NO_ORIGIN);
                }
            // other header lines (Coldcard and others add a few) don't change the wallet
        }
    }
    if (!format) throw new Error(WALLET_FILE_NO_FORMAT);
    if (format !== 'P2WSH') throw new Error(WALLET_FILE_NOT_P2WSH);
    if (!quorum) throw new Error(WALLET_FILE_NO_POLICY);
    if (keys.length !== quorum.n) throw new Error(walletFileKeyCount(quorum.m, quorum.n, keys.length));
    return makePolicy(quorum.m, keys, name);
};

/** BSMS 1.0 (BIP-129), unencrypted: version, descriptor or template, path restrictions, first address. */
const policyFromBsms = (lines: string[]): MultisigPolicy => {
    if (lines[0].trim() !== 'BSMS 1.0') throw new Error(WALLET_FILE_BSMS_VERSION);
    if (lines.length < 4) throw new Error(WALLET_FILE_UNREADABLE);
    const [, descriptor, restrictions, firstAddress] = lines.map(l => l.trim());
    const parsed = parseDescriptor(descriptor);
    const pathRule = restrictions.replace(/\s+/g, '').toLowerCase();
    if (pathRule !== '/0/*,/1/*' && pathRule !== 'nopathrestrictions') throw new Error(WALLET_FILE_PATHS);
    if (parsed.suffix === 'change') throw new Error(WALLET_FILE_PATHS);
    const policy = makePolicy(parsed.m, parsed.keys, null);
    // the record's own check: the first address has to come out of its keys
    if (policyAddress(policy, 0, 0) !== firstAddress) throw new Error(WALLET_FILE_FIRST_ADDRESS);
    return policy;
};

const singleKeyJson = (json: any) =>
    !!json &&
    typeof json === 'object' &&
    ((json.xfp && (json.p2wsh || json.p2sh || json.p2wsh_p2sh || json.xpub)) || (json.ExtPubKey && json.MasterFingerprint));

const policyFromJson = (json: any): MultisigPolicy => {
    const items = Array.isArray(json) ? json : null;
    if (items) {
        const descriptors = items.map((d: any) => d?.desc).filter((d: any) => typeof d === 'string');
        if (descriptors.length) return policyFromDescriptors(descriptors, null);
        if (items.some(singleKeyJson)) throw new Error(WALLET_FILE_SINGLE_KEY);
        throw new Error(WALLET_FILE_UNREADABLE);
    }
    if (json && typeof json === 'object') {
        if (typeof json.descriptor === 'string') return policyFromDescriptors([json.descriptor], json.label ?? json.name);
        if (Array.isArray(json.descriptors)) {
            const descriptors = json.descriptors.map((d: any) => d?.desc ?? d).filter((d: any) => typeof d === 'string');
            return policyFromDescriptors(descriptors, json.wallet_name ?? json.label ?? json.name);
        }
        if (singleKeyJson(json)) throw new Error(WALLET_FILE_SINGLE_KEY);
    }
    throw new Error(WALLET_FILE_UNREADABLE);
};

/**
 * Reads a wallet file or scanned wallet QR. Throws one of the WALLET_FILE_* messages, saying why, for anything that
 * isn't a native SegWit multisig wallet with every key's fingerprint and path.
 */
export function parseWalletFile(text: string): MultisigPolicy {
    const raw = String(text ?? '').replace(/^\ufeff/, '').trim();
    if (!raw) throw new Error(WALLET_FILE_UNREADABLE);
    if (PRIVATE_KEY_TOKEN.test(raw)) throw new Error(WALLET_FILE_PRIVATE);
    // a SeedQR (digits) or the words themselves
    if (/^\d+$/.test(raw) && (raw.length === 48 || raw.length === 96)) throw new Error(WALLET_FILE_SEED);
    if (/^[a-z]+(\s+[a-z]+){11,23}$/.test(raw) && bip39.validateMnemonic(raw.split(/\s+/).join(' '))) {
        throw new Error(WALLET_FILE_SEED);
    }
    const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
    if (/^BSMS\b/.test(lines[0])) return policyFromBsms(lines);
    if (raw.startsWith('{') || raw.startsWith('[')) {
        let json: any;
        try {
            json = JSON.parse(raw);
        } catch (_) {
            json = undefined;
        }
        if (json !== undefined) return policyFromJson(json);
        if (raw.startsWith('[') && !raw.includes('(')) throw new Error(WALLET_FILE_SINGLE_KEY);
    }
    // descriptors, one per line, maybe with comment lines around them
    const content = lines.map(l => l.trim()).filter(l => !l.startsWith('#'));
    if (content.length && content.every(l => /^[a-z]+\(/.test(l))) return policyFromDescriptors(content, null);
    if (/^\s*(policy|format|derivation)\s*:/im.test(raw) || /^[0-9a-fA-F]{8}\s*:/m.test(raw)) return policyFromTextFile(raw);
    if (/^[a-zA-Z]{4}[1-9A-HJ-NP-Za-km-z]{100,}$/.test(raw)) throw new Error(WALLET_FILE_SINGLE_KEY);
    // BIP-129's encrypted records are hex
    if (/^[0-9a-fA-F]+$/.test(raw.replace(/\s+/g, '')) && raw.length > 64) throw new Error(WALLET_FILE_ENCRYPTED);
    throw new Error(WALLET_FILE_UNREADABLE);
}

/**
 * Checks that the seed holds one of the wallet's keys: some key has the seed's fingerprint, and the seed's key at that
 * key's path is exactly that key (a fingerprint alone could be put next to someone else's key). Returns that key.
 */
export function confirmOwnKey(policy: MultisigPolicy, root: BIP32Interface): PolicyKey {
    const fingerprint = Buffer.from(root.fingerprint).toString('hex');
    const key = policy.keys.find(k => k.fingerprint === fingerprint);
    if (!key) throw new Error(ownKeyMissing(fingerprint));
    if (root.derivePath(key.path).neutered().toBase58() !== key.xpub) throw new Error(OWN_KEY_DIFFERENT);
    return key;
}

/** The start and end of an xpub, enough to tell keys apart on a screen. */
export function shortXpub(xpub: string): string {
    return xpub.length > 20 ? `${xpub.slice(0, 12)}…${xpub.slice(-8)}` : xpub;
}

// ---------------------------------------------------------------------------------------------------------------------
// Finding an address

export const ADDRESS_SEARCH_LIMIT = 1000;
export const NOT_AN_ADDRESS = "That isn't a Bitcoin address.";

/** The address in a scanned or typed text: a plain address or a bitcoin: link. Throws NOT_AN_ADDRESS. */
export function addressFromText(text: string): { address: string; script: Buffer } {
    let address = String(text ?? '').trim();
    if (/^bitcoin:/i.test(address)) address = address.slice('bitcoin:'.length).split('?')[0];
    // QR codes often carry bech32 addresses in capitals
    if (/^BC1[02-9AC-HJ-NP-Z]+$/.test(address)) address = address.toLowerCase();
    try {
        return { address, script: bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin) };
    } catch (_) {
        throw new Error(NOT_AN_ADDRESS);
    }
}

export const isP2wshScript = (script: Buffer) => script.length === 34 && script[0] === 0x00 && script[1] === 0x20;
/** native SegWit single key (bc1q…, 42 characters) */
export const isP2wpkhScript = (script: Buffer) => script.length === 22 && script[0] === 0x00 && script[1] === 0x14;

export interface AddressMatch {
    wallet: SignerWallet;
    /** 0 receive, 1 change */
    branch: 0 | 1;
    index: number;
}

/**
 * Looks for an address in the first `limit` receive and change addresses of each wallet, lowest index first, yielding
 * to the screen now and then. Null if it isn't there; addresses that aren't P2WSH return null straight away.
 */
export async function findAddress(
    script: Buffer,
    wallets: SignerWallet[],
    options: { limit?: number; onProgress?: (checked: number) => void; isCancelled?: () => boolean } = {},
): Promise<AddressMatch | null> {
    const limit = options.limit ?? ADDRESS_SEARCH_LIMIT;
    if (!isP2wshScript(script) || !wallets.length) return null;
    for (let index = 0; index < limit; index++) {
        for (const wallet of wallets) {
            for (const branch of [0, 1] as const) {
                if (policyOutputScript(wallet, branch, index).equals(script)) return { wallet, branch, index };
            }
        }
        if (index % 20 === 19) {
            options.onProgress?.(index + 1);
            await new Promise(resolve => setTimeout(resolve, 0));
            if (options.isCancelled?.()) return null;
        }
    }
    options.onProgress?.(limit);
    return null;
}

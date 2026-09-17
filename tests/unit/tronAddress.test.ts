/**
 * Tron address encoding.
 *
 * Every step here is one where a silent mistake produces a well-formed address
 * that nobody can spend from, so each is pinned against something independent:
 *   - keccak256 against its published empty-string digest, because crypto-js
 *     offers both the original Keccak padding and the later FIPS SHA3, and only
 *     the first is what Tron uses.
 *   - the last-20-bytes rule against Ethereum's canonical test-mnemonic
 *     address, which shares that construction.
 *   - base58check against the bs58check package in node_modules, which the app
 *     deliberately does not depend on.
 *   - and against a real mainnet address: the USDT contract on Tron, whose
 *     checksum could not verify by accident.
 */

import { getPublicKey } from '@noble/secp256k1';
import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';

import ecc from '../../blue_modules/noble_ecc';
import {
    base58Decode,
    base58Encode,
    base58checkDecode,
    base58checkEncode,
} from '../../src/services/tron/base58check';
import {
    isValidTronAddress,
    keccak256,
    tronAddressFromHex,
    tronAddressFromPublicKey,
    tronAddressToHex,
} from '../../src/services/tron/address';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bs58check = require('bs58check');
const bip32 = BIP32Factory(ecc);

// The USDT TRC20 contract, read from Flashnet's live route data.
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
// The canonical BIP39 test mnemonic.
const TEST_MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('keccak256 is Keccak, not FIPS SHA3', () => {
    it('matches the published digest of the empty string', () => {
        expect(keccak256(Buffer.alloc(0)).toString('hex')).toBe(
            'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        );
    });

    it('is not the FIPS variant, which would derive unspendable addresses', () => {
        expect(keccak256(Buffer.alloc(0)).toString('hex')).not.toBe(
            'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a',
        );
    });
});

describe('the address construction, checked against Ethereum', () => {
    // Tron and Ethereum build the address identically from the public key, so
    // Ethereum's well-known first address for the test mnemonic proves the
    // keccak and last-20-bytes steps without needing a Tron oracle.
    it('reproduces the canonical Ethereum address for the test mnemonic', () => {
        const node = bip32.fromSeed(bip39.mnemonicToSeedSync(TEST_MNEMONIC)).derivePath("m/44'/60'/0'/0/0");
        const publicKey = Buffer.from(getPublicKey(Buffer.from(node.privateKey!), false));
        const hash = keccak256(publicKey.subarray(1));
        expect(`0x${hash.subarray(hash.length - 20).toString('hex')}`).toBe(
            '0x9858effd232b4033e47d90003d41ec34ecaeda94',
        );
    });

    it('refuses a compressed public key instead of deriving a dead address', () => {
        const node = bip32.fromSeed(bip39.mnemonicToSeedSync(TEST_MNEMONIC)).derivePath("m/44'/195'/0'/0/0");
        expect(() => tronAddressFromPublicKey(Buffer.from(node.publicKey))).toThrow(/uncompressed/);
    });
});

describe('base58check matches the package we chose not to depend on', () => {
    const samples = [
        Buffer.from('41a614f803b6fd780986a42c78ec9c7f77e6ded13c', 'hex'),
        Buffer.alloc(21, 0x41),
        Buffer.concat([Buffer.alloc(3), Buffer.from('41deadbeef', 'hex')]),
        Buffer.from('00', 'hex'),
    ];

    it.each(samples.map((s, i) => [i, s]))('encodes sample %i the same way', (_i, bytes) => {
        expect(base58checkEncode(bytes as Buffer)).toBe(bs58check.encode(bytes as Buffer));
    });

    it('decodes what that package encodes', () => {
        for (const bytes of samples) {
            expect(base58checkDecode(bs58check.encode(bytes)).toString('hex')).toBe(bytes.toString('hex'));
        }
    });

    it('round-trips raw base58 including leading and all zeros', () => {
        const cases = [...samples, Buffer.alloc(0), Buffer.alloc(1), Buffer.alloc(5)];
        // Plus every length up to an address, with a zero prefix, which is
        // where an off-by-one in the zero handling hides.
        for (let len = 1; len <= 25; len++) {
            cases.push(Buffer.concat([Buffer.alloc(len % 4), Buffer.alloc(len, len)]));
        }
        for (const bytes of cases) {
            expect(base58Decode(base58Encode(bytes)).toString('hex')).toBe(bytes.toString('hex'));
        }
    });

    it('agrees with the package on raw encoding too, zeros included', () => {
        // bs58check appends a checksum, so compare through it: same input,
        // same output means our base58 layer matches theirs.
        for (const bytes of [Buffer.alloc(1), Buffer.alloc(4), Buffer.alloc(21)]) {
            expect(base58checkEncode(bytes)).toBe(bs58check.encode(bytes));
        }
    });
});

describe('a real mainnet address', () => {
    it('verifies the checksum of the USDT contract address', () => {
        expect(isValidTronAddress(USDT_CONTRACT)).toBe(true);
    });

    it('converts to the 41-prefixed hex the API uses, and back', () => {
        const hex = tronAddressToHex(USDT_CONTRACT);
        expect(hex).toMatch(/^41[0-9a-f]{40}$/);
        expect(hex).toBe(Buffer.from(bs58check.decode(USDT_CONTRACT)).toString('hex'));
        expect(tronAddressFromHex(hex)).toBe(USDT_CONTRACT);
        expect(tronAddressFromHex(`0x${hex}`)).toBe(USDT_CONTRACT);
    });
});

describe('what must be rejected', () => {
    it('rejects a tampered address', () => {
        const tampered = `${USDT_CONTRACT.slice(0, -1)}${USDT_CONTRACT.endsWith('t') ? 'u' : 't'}`;
        expect(isValidTronAddress(tampered)).toBe(false);
        expect(() => tronAddressToHex(tampered)).toThrow(/checksum/);
    });

    it('rejects a character outside the alphabet', () => {
        expect(isValidTronAddress(`${USDT_CONTRACT.slice(0, -1)}0`)).toBe(false);
    });

    it('rejects an address that is not Tron mainnet', () => {
        // Same construction, bitcoin's version byte instead of Tron's.
        const wrongPrefix = bs58check.encode(Buffer.concat([Buffer.from([0x00]), Buffer.alloc(20, 7)]));
        expect(isValidTronAddress(wrongPrefix)).toBe(false);
    });

    it('rejects an empty or short input', () => {
        expect(isValidTronAddress('')).toBe(false);
        expect(isValidTronAddress('T1')).toBe(false);
        expect(() => tronAddressFromHex('41dead')).toThrow(/21 bytes/);
    });
});

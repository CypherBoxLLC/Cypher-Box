/**
 * The Tron byte code, run against a Buffer that behaves like the shim.
 *
 * What this protects, and why it exists:
 *
 * React Native has no Buffer, so one is shimmed in, and this tree contains
 * three of them: buffer@6.0.3 at the top, 5.7.1 nested, and 4.9.2 under
 * react-native-randombytes. The first two override
 * `Buffer.prototype.subarray` to return a Buffer. buffer@4 does not, so it
 * inherits Uint8Array's and hands back a plain Uint8Array.
 *
 * Every one of these tests passed before the fix, because Jest runs on Node,
 * where subarray returns a real Buffer. On the phone it did not:
 *
 *   - the balance card showed "checksum(payload).equals is not a function",
 *     because Uint8Array has no .equals;
 *   - and worse, silently, `.toString('hex')` on a Uint8Array ignores the
 *     argument and returns "169,5,156,187". That is a garbage keccak digest
 *     feeding address derivation, and a garbage TRANSFER_METHOD_ID feeding
 *     every USDT transfer.
 *
 * So these run the real functions with subarray forced to the buffer@4
 * behaviour, and assert the answers are unchanged. A regression here means
 * addresses nobody can spend from.
 */

import { getPublicKey } from '@noble/secp256k1';
import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';

import ecc from '../../blue_modules/noble_ecc';

import { keccak256, tronAddressFromPublicKey, tronAddressToHex } from '../../src/services/tron/address';
import { base58checkDecode, base58checkEncode } from '../../src/services/tron/base58check';
import { bytesEqual, sliceBytes, toHex } from '../../src/services/tron/bytes';
import { TRANSFER_SELECTOR } from '../../src/services/tron/contract';

const bip32 = BIP32Factory(ecc);

const TEST_MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** Run `fn` with Buffer.prototype.subarray behaving as buffer@4.9.2's does. */
function asOldPolyfill<T>(fn: () => T): T {
    const original = Buffer.prototype.subarray;
    // eslint-disable-next-line no-extend-native
    (Buffer.prototype as any).subarray = function (start?: number, end?: number) {
        return new Uint8Array(Uint8Array.prototype.slice.call(this, start, end));
    };
    try {
        return fn();
    } finally {
        (Buffer.prototype as any).subarray = original;
    }
}

const uncompressedTestKey = (): Buffer => {
    const node = bip32.fromSeed(bip39.mnemonicToSeedSync(TEST_MNEMONIC)).derivePath("m/44'/195'/0'/0/0");
    return Buffer.from(getPublicKey(Buffer.from(node.privateKey!), false));
};

describe('the shim behaviour this guards against', () => {
    it('is real: a Uint8Array stringifies to commas, not hex', () => {
        const bytes = new Uint8Array([0xa9, 0x05, 0x9c, 0xbb]);
        expect(bytes.toString()).toBe('169,5,156,187');
        expect(toHex(bytes)).toBe('a9059cbb');
    });

    it('is what the forced subarray reproduces', () => {
        asOldPolyfill(() => {
            const sub = Buffer.from([1, 2, 3, 4, 5]).subarray(0, 4);
            expect(Buffer.isBuffer(sub)).toBe(false);
            expect((sub as any).equals).toBeUndefined();
        });
        // And is put back afterwards.
        expect(Buffer.isBuffer(Buffer.from([1, 2, 3]).subarray(0, 2))).toBe(true);
    });
});

describe('byte helpers', () => {
    it('hexes any byte array, padding each byte', () => {
        expect(toHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
        expect(toHex(new Uint8Array())).toBe('');
    });

    it('always slices to a real Buffer, whatever subarray returns', () => {
        asOldPolyfill(() => {
            const out = sliceBytes(Buffer.from([1, 2, 3, 4, 5]), 1, 3);
            expect(Buffer.isBuffer(out)).toBe(true);
            expect(out.toString('hex')).toBe('0203');
        });
    });

    it('compares bytes without Buffer.equals', () => {
        expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
        expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
        expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    });
});

describe('under the old polyfill, the answers do not change', () => {
    it('keccak256 still matches the published empty-string digest', () => {
        const expected = 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';
        expect(toHex(keccak256(Buffer.alloc(0)))).toBe(expected);
        expect(asOldPolyfill(() => toHex(keccak256(Buffer.alloc(0))))).toBe(expected);
    });

    it('derives the same Tron address', () => {
        const publicKey = uncompressedTestKey();
        const good = tronAddressFromPublicKey(publicKey);
        expect(good).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
        expect(asOldPolyfill(() => tronAddressFromPublicKey(publicKey))).toBe(good);
    });

    it('reads an address back, which is the call that threw on the phone', () => {
        const address = tronAddressFromPublicKey(uncompressedTestKey());
        const good = tronAddressToHex(address);
        expect(good).toMatch(/^41[0-9a-f]{40}$/);
        expect(asOldPolyfill(() => tronAddressToHex(address))).toBe(good);
    });

    it('still rejects a corrupted address rather than accepting it', () => {
        const address = tronAddressFromPublicKey(uncompressedTestKey());
        const broken = `${address.slice(0, -1)}${address.slice(-1) === 'a' ? 'b' : 'a'}`;
        expect(() => asOldPolyfill(() => tronAddressToHex(broken))).toThrow();
    });

    it('round-trips base58check', () => {
        const payload = Buffer.from('41' + '11'.repeat(20), 'hex');
        const text = asOldPolyfill(() => base58checkEncode(payload));
        expect(text).toBe(base58checkEncode(payload));
        expect(toHex(asOldPolyfill(() => base58checkDecode(text)))).toBe(toHex(payload));
    });

    it('builds the real USDT transfer method id, not decimal text', () => {
        // The expression TRANSFER_METHOD_ID is defined by, run both ways.
        const build = () => toHex(sliceBytes(keccak256(Buffer.from(TRANSFER_SELECTOR, 'utf8')), 0, 4));
        expect(build()).toBe('a9059cbb');
        expect(asOldPolyfill(build)).toBe('a9059cbb');
    });
});

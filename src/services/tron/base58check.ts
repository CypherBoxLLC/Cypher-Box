/**
 * Base58check, the encoding Tron addresses use.
 *
 * Written here rather than pulled in: bs58check exists in the tree only as a
 * transitive dependency, at two different versions, and reaching for an
 * undeclared package to encode addresses is how a future install quietly
 * changes what this does. The unit tests cross-check every vector against that
 * package, so this stays honest without depending on it.
 *
 * Hashes come from crypto-js, already a direct dependency.
 */

import CryptoJS from 'crypto-js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const toWordArray = (bytes: Buffer) => CryptoJS.enc.Hex.parse(bytes.toString('hex'));
type WordArray = ReturnType<typeof CryptoJS.SHA256>;
const fromWordArray = (w: WordArray) => Buffer.from(w.toString(CryptoJS.enc.Hex), 'hex');

/** Tron's checksum: the first four bytes of a double SHA256. */
function checksum(payload: Buffer): Buffer {
    const once = CryptoJS.SHA256(toWordArray(payload));
    const twice = CryptoJS.SHA256(once);
    return fromWordArray(twice).subarray(0, 4);
}

/**
 * Raw base58 encode, no checksum.
 *
 * Leading zero bytes carry no value, so they are counted and emitted as '1's
 * and excluded from the number conversion. Doing it the other way round emits
 * one '1' too many when every byte is zero, since the value 0 still has a digit.
 */
export function base58Encode(bytes: Buffer): string {
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    const prefix = ALPHABET[0].repeat(zeros);
    if (zeros === bytes.length) return prefix;

    const digits: number[] = [0];
    for (let b = zeros; b < bytes.length; b++) {
        let carry = bytes[b];
        for (let i = 0; i < digits.length; i++) {
            carry += digits[i] << 8;
            digits[i] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }
    let out = prefix;
    for (let i = digits.length - 1; i >= 0; i--) {
        out += ALPHABET[digits[i]];
    }
    return out;
}

/**
 * Raw base58 decode. Throws on a character outside the alphabet.
 *
 * Mirrors the encoder: leading '1's become zero bytes and are kept out of the
 * number conversion, so a string of only '1's decodes to only zero bytes.
 */
export function base58Decode(text: string): Buffer {
    let zeros = 0;
    while (zeros < text.length && text[zeros] === ALPHABET[0]) zeros++;
    const leading = Buffer.alloc(zeros);
    if (zeros === text.length) return leading;

    const bytes: number[] = [0];
    for (const char of text.slice(zeros)) {
        const value = ALPHABET.indexOf(char);
        if (value < 0) {
            throw new Error(`Invalid base58 character: ${char}`);
        }
        let carry = value;
        for (let i = 0; i < bytes.length; i++) {
            carry += bytes[i] * 58;
            bytes[i] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    return Buffer.concat([leading, Buffer.from(bytes.reverse())]);
}

/** Append the checksum and encode. */
export function base58checkEncode(payload: Buffer): string {
    return base58Encode(Buffer.concat([payload, checksum(payload)]));
}

/**
 * Decode and verify the checksum.
 *
 * A bad checksum throws rather than returning something usable, because the
 * only reason to decode an address here is to act on it.
 */
export function base58checkDecode(text: string): Buffer {
    const raw = base58Decode(text);
    if (raw.length < 5) {
        throw new Error('Address is too short to carry a checksum');
    }
    const payload = raw.subarray(0, raw.length - 4);
    const given = raw.subarray(raw.length - 4);
    if (!checksum(payload).equals(given)) {
        throw new Error('Address checksum does not match');
    }
    return payload;
}

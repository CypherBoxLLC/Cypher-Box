/**
 * Tron addresses: deriving one from a public key, and converting between the
 * two forms the network uses.
 *
 * A Tron address is the same construction as an Ethereum one, with a different
 * wrapper: take keccak256 of the uncompressed public key without its 0x04
 * prefix, keep the last 20 bytes, prepend 0x41, and base58check the result.
 * The 0x41 form is what the HTTP API returns and expects; the base58 form is
 * what a user sees and pastes.
 *
 * keccak256 comes from crypto-js, whose SHA3 is the original Keccak padding
 * rather than the later FIPS variant, which is exactly what Tron and Ethereum
 * use. The tests pin that with a known vector, since a silent switch to
 * FIPS SHA3 would derive addresses nobody can spend from.
 */

import CryptoJS from 'crypto-js';

import { base58checkDecode, base58checkEncode } from './base58check';

/** Tron mainnet address prefix. */
export const TRON_ADDRESS_PREFIX = 0x41;

export function keccak256(bytes: Buffer): Buffer {
    const digest = CryptoJS.SHA3(CryptoJS.enc.Hex.parse(bytes.toString('hex')), { outputLength: 256 });
    return Buffer.from(digest.toString(CryptoJS.enc.Hex), 'hex');
}

/**
 * Address bytes (0x41 followed by 20) from an uncompressed public key.
 *
 * Refuses a compressed key rather than hashing it: the result would be a
 * well-formed address that the matching private key cannot spend from.
 */
export function tronAddressBytesFromPublicKey(publicKey: Buffer): Buffer {
    if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
        throw new Error('Tron needs the uncompressed public key, 65 bytes starting with 0x04');
    }
    const hash = keccak256(publicKey.subarray(1));
    return Buffer.concat([Buffer.from([TRON_ADDRESS_PREFIX]), hash.subarray(hash.length - 20)]);
}

/** The base58 form a user sees, from an uncompressed public key. */
export function tronAddressFromPublicKey(publicKey: Buffer): string {
    return base58checkEncode(tronAddressBytesFromPublicKey(publicKey));
}

/** Base58 form to the 41-prefixed hex the HTTP API uses. */
export function tronAddressToHex(address: string): string {
    const bytes = base58checkDecode(address);
    if (bytes.length !== 21 || bytes[0] !== TRON_ADDRESS_PREFIX) {
        throw new Error('Not a Tron mainnet address');
    }
    return bytes.toString('hex');
}

/** The API's hex form back to base58. Accepts an optional 0x prefix. */
export function tronAddressFromHex(hex: string): string {
    const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
    if (!/^[0-9a-fA-F]{42}$/.test(clean)) {
        throw new Error('Tron hex address must be 21 bytes');
    }
    const bytes = Buffer.from(clean, 'hex');
    if (bytes[0] !== TRON_ADDRESS_PREFIX) {
        throw new Error('Not a Tron mainnet address');
    }
    return base58checkEncode(bytes);
}

/**
 * Whether a string is a spendable-looking Tron mainnet address.
 *
 * Checksum included, because the whole point of asking is to decide if we can
 * send to it. Returns false rather than throwing so a UI can call it on every
 * keystroke.
 */
export function isValidTronAddress(address: string): boolean {
    try {
        tronAddressToHex(address);
        return true;
    } catch {
        return false;
    }
}

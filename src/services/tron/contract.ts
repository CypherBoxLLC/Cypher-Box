/**
 * The little bit of ABI encoding a TRC20 balance and transfer need.
 *
 * Pure and offline, so the encoding is unit-tested against known vectors rather
 * than checked by watching a call fail. A wrong parameter here reads the wrong
 * balance, or worse, sends to the wrong address, so each helper refuses input
 * it does not recognise instead of padding something plausible.
 *
 * Tron's HTTP API takes the function selector as a string and the arguments as
 * a bare hex string with no selector prefix, which is why nothing here emits
 * a four-byte method id.
 */

import BigNumber from 'bignumber.js';
import { Buffer } from 'buffer';

/** `balanceOf(address)`, for a constant call. */
export const BALANCE_OF_SELECTOR = 'balanceOf(address)';

/** `transfer(address,uint256)`, for a real one. */
export const TRANSFER_SELECTOR = 'transfer(address,uint256)';

const WORD = 64;

/** Left-pad hex to one 32 byte word. */
function toWord(hex: string): string {
    const clean = hex.toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]*$/.test(clean) || clean.length > WORD) {
        throw new Error('Cannot encode value as a 32 byte word');
    }
    return clean.padStart(WORD, '0');
}

/**
 * A Tron address as an ABI address argument.
 *
 * Takes the 41-prefixed hex the API uses and drops that prefix: on chain an
 * address argument is the bare 20 bytes, and leaving the 0x41 in place shifts
 * every byte and encodes a different address entirely.
 */
export function encodeAddressParam(addressHex: string): string {
    const clean = addressHex.toLowerCase().replace(/^0x/, '');
    if (!/^41[0-9a-f]{40}$/.test(clean)) {
        throw new Error('Expected a 21 byte Tron address in hex, starting with 41');
    }
    return toWord(clean.slice(2));
}

/** A whole number of smallest units as a uint256 argument. */
export function encodeUint256Param(value: string): string {
    const n = new BigNumber(value);
    if (!n.isFinite() || n.isNegative() || !n.isInteger()) {
        throw new Error(`Cannot encode ${value} as uint256`);
    }
    return toWord(n.toString(16));
}

/** Arguments for `balanceOf`: one address. */
export function encodeBalanceOfParameter(addressHex: string): string {
    return encodeAddressParam(addressHex);
}

/** Arguments for `transfer`: recipient then amount, in smallest units. */
export function encodeTransferParameter(toAddressHex: string, amountUnits: string): string {
    return encodeAddressParam(toAddressHex) + encodeUint256Param(amountUnits);
}

/**
 * Read a uint256 result as a decimal string.
 *
 * Returns a string because a TRC20 balance does not fit a JS number, and
 * rounding a balance is how a UI ends up offering to send more than exists.
 */
export function decodeUint256(hex: string): string {
    const clean = (hex || '').toLowerCase().replace(/^0x/, '');
    if (clean.length === 0 || !/^[0-9a-f]+$/.test(clean)) {
        throw new Error('Unreadable uint256 result');
    }
    const n = new BigNumber(clean, 16);
    if (!n.isFinite()) {
        throw new Error('Unreadable uint256 result');
    }
    return n.toFixed(0);
}

/** Smallest units to a decimal string, exactly. */
export function unitsToDecimal(units: string, decimals: number): string {
    const n = new BigNumber(units);
    if (!n.isFinite()) {
        throw new Error(`Unreadable amount: ${units}`);
    }
    return n.shiftedBy(-decimals).toFixed();
}

/** Decimal string to smallest units, refusing more precision than exists. */
export function decimalToUnits(amount: string, decimals: number): string {
    const n = new BigNumber(amount);
    if (!n.isFinite() || n.isNegative()) {
        throw new Error(`Invalid amount: ${amount}`);
    }
    const raw = n.shiftedBy(decimals);
    if (!raw.isInteger()) {
        throw new Error(`Amount ${amount} is finer than ${decimals} decimals allow`);
    }
    return raw.toFixed(0);
}

/** Hex helper for callers that hold bytes. */
export const bytesToHex = (bytes: Buffer): string => bytes.toString('hex');

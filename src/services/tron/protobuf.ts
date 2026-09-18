/**
 * The few protobuf encodings a Tron transaction needs, written out by hand.
 *
 * A signature commits to the exact bytes of a transaction, so this has to
 * match java-tron byte for byte. It covers only what a TRC20 transfer uses:
 * varints and length-delimited fields, written in field order. Proto3 leaves
 * zero and empty fields out, and so does this: writing an explicit zero would
 * change the bytes, and with them the transaction id.
 *
 * Values are JS numbers, which are exact up to 2^53. Everything encoded here
 * is a millisecond timestamp, an amount of sun or a small enum, all far below
 * that, and anything that is not a safe non-negative integer is refused rather
 * than rounded.
 */

import { Buffer } from 'buffer';

const WIRE_VARINT = 0;
const WIRE_LENGTH_DELIMITED = 2;

/** Base 128, least significant group first, high bit set on all but the last byte. */
export function encodeVarint(value: number): Buffer {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Cannot encode ${value} as a varint`);
    }
    const bytes: number[] = [];
    let rest = value;
    // Division rather than shifts: JS bitwise operators truncate to 32 bits,
    // and a millisecond timestamp is already past that.
    while (rest >= 0x80) {
        bytes.push((rest % 0x80) + 0x80);
        rest = Math.floor(rest / 0x80);
    }
    bytes.push(rest);
    return Buffer.from(bytes);
}

const tag = (field: number, wireType: number): Buffer => encodeVarint(field * 8 + wireType);

/** A varint field, left out when zero as proto3 does. */
export function varintField(field: number, value: number): Buffer {
    return value === 0 ? Buffer.alloc(0) : Buffer.concat([tag(field, WIRE_VARINT), encodeVarint(value)]);
}

/** A bytes, string or embedded message field, left out when empty. */
export function bytesField(field: number, value: Buffer): Buffer {
    return value.length === 0
        ? Buffer.alloc(0)
        : Buffer.concat([tag(field, WIRE_LENGTH_DELIMITED), encodeVarint(value.length), value]);
}

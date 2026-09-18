/**
 * The protobuf pieces a Tron transaction is made of.
 *
 * What this protects: varints past 32 bits, which a millisecond timestamp
 * already is and where shift-based encoders quietly go wrong, and proto3's
 * rule that zero and empty fields are left out entirely. Either mistake
 * changes the transaction id.
 */

import { bytesField, encodeVarint, varintField } from '../../src/services/tron/protobuf';

describe('encodeVarint', () => {
    it.each([
        [0, '00'],
        [1, '01'],
        [127, '7f'],
        [128, '8001'],
        [300, 'ac02'],
        [30_000_000, '8087a70e'],
        // An expiry from a node-built transfer: 41 bits.
        [1789704474000, '909bcc958b34'],
        [Number.MAX_SAFE_INTEGER, 'ffffffffffffff0f'],
    ])('encodes %p as %s', (value, hex) => {
        expect(encodeVarint(value).toString('hex')).toBe(hex);
    });

    it('refuses what it cannot encode exactly', () => {
        for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
            expect(() => encodeVarint(value)).toThrow();
        }
    });
});

describe('varintField', () => {
    it('writes the tag then the value', () => {
        // Field 18 needs a two-byte tag, as the fee limit does.
        expect(varintField(18, 30_000_000).toString('hex')).toBe('90018087a70e');
        expect(varintField(1, 31).toString('hex')).toBe('081f');
    });

    it('leaves a zero out entirely', () => {
        expect(varintField(3, 0)).toHaveLength(0);
    });
});

describe('bytesField', () => {
    it('writes the tag, the length and the bytes', () => {
        expect(bytesField(1, Buffer.from('8175', 'hex')).toString('hex')).toBe('0a028175');
    });

    it('leaves an empty value out entirely', () => {
        expect(bytesField(2, Buffer.alloc(0))).toHaveLength(0);
    });
});

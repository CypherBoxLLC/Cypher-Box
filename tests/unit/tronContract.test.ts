/**
 * The ABI encoding for a TRC20 balance and transfer.
 *
 * Every helper here is one where a plausible-looking mistake is expensive: an
 * address argument that keeps Tron's 0x41 prefix encodes a different address,
 * and a balance read through a JS number silently loses precision on any
 * realistic USDT amount.
 */

import {
    BALANCE_OF_SELECTOR,
    TRANSFER_SELECTOR,
    decimalToUnits,
    decodeUint256,
    encodeAddressParam,
    encodeBalanceOfParameter,
    encodeTransferParameter,
    encodeUint256Param,
    unitsToDecimal,
} from '../../src/services/tron/contract';
import { tronAddressToHex } from '../../src/services/tron/address';
import { USDT_TRC20_CONTRACT } from '../../src/services/tron/constants';

const USDT_HEX = tronAddressToHex(USDT_TRC20_CONTRACT);

describe('selectors', () => {
    it('are the plain signatures Tron expects, with no method id', () => {
        expect(BALANCE_OF_SELECTOR).toBe('balanceOf(address)');
        expect(TRANSFER_SELECTOR).toBe('transfer(address,uint256)');
    });
});

describe('encodeAddressParam', () => {
    it('drops the 0x41 prefix and pads to one word', () => {
        const encoded = encodeAddressParam(USDT_HEX);
        expect(encoded).toHaveLength(64);
        expect(encoded).toBe(`${'0'.repeat(24)}${USDT_HEX.slice(2)}`);
    });

    it('accepts an 0x prefix on the 21 byte form', () => {
        expect(encodeAddressParam(`0x${USDT_HEX}`)).toBe(encodeAddressParam(USDT_HEX));
    });

    it('refuses a bare 20 byte address, which would encode the wrong value', () => {
        expect(() => encodeAddressParam(USDT_HEX.slice(2))).toThrow(/21 byte/);
    });

    it('refuses anything that is not a Tron mainnet address in hex', () => {
        expect(() => encodeAddressParam('')).toThrow();
        expect(() => encodeAddressParam(`00${USDT_HEX.slice(2)}`)).toThrow(/starting with 41/);
        expect(() => encodeAddressParam('41zz')).toThrow();
    });
});

describe('encodeUint256Param', () => {
    it('encodes whole units', () => {
        expect(encodeUint256Param('0')).toBe('0'.repeat(64));
        expect(encodeUint256Param('1000000')).toBe(`${'0'.repeat(58)}0f4240`);
    });

    it('handles amounts beyond a safe integer', () => {
        const big = '123456789012345678901234567890';
        expect(decodeUint256(encodeUint256Param(big))).toBe(big);
    });

    it('refuses a fraction or a negative', () => {
        expect(() => encodeUint256Param('1.5')).toThrow(/uint256/);
        expect(() => encodeUint256Param('-1')).toThrow(/uint256/);
        expect(() => encodeUint256Param('abc')).toThrow(/uint256/);
    });
});

describe('call arguments', () => {
    it('balanceOf takes the address alone', () => {
        expect(encodeBalanceOfParameter(USDT_HEX)).toBe(encodeAddressParam(USDT_HEX));
    });

    it('transfer takes recipient then amount, two words', () => {
        const encoded = encodeTransferParameter(USDT_HEX, '2500000');
        expect(encoded).toHaveLength(128);
        expect(encoded.slice(0, 64)).toBe(encodeAddressParam(USDT_HEX));
        expect(decodeUint256(encoded.slice(64))).toBe('2500000');
    });
});

describe('decodeUint256', () => {
    it('reads a result as an exact decimal string', () => {
        expect(decodeUint256(`${'0'.repeat(58)}0f4240`)).toBe('1000000');
        expect(decodeUint256('0x0f4240')).toBe('1000000');
        expect(decodeUint256('0'.repeat(64))).toBe('0');
    });

    it('keeps precision a JS number would lose', () => {
        const large = 'f'.repeat(32);
        expect(decodeUint256(large)).toBe(BigInt(`0x${large}`).toString());
    });

    it('refuses an unreadable result rather than returning zero', () => {
        expect(() => decodeUint256('')).toThrow(/Unreadable/);
        expect(() => decodeUint256('nothex')).toThrow(/Unreadable/);
    });
});

describe('units and decimals', () => {
    it('converts both ways exactly', () => {
        expect(unitsToDecimal('1000000', 6)).toBe('1');
        expect(unitsToDecimal('1', 6)).toBe('0.000001');
        expect(unitsToDecimal('123456789', 6)).toBe('123.456789');
        expect(decimalToUnits('123.456789', 6)).toBe('123456789');
        expect(decimalToUnits('0', 6)).toBe('0');
    });

    it('refuses precision the asset does not have', () => {
        expect(() => decimalToUnits('0.0000001', 6)).toThrow(/finer than/);
    });

    it('refuses a negative amount', () => {
        expect(() => decimalToUnits('-1', 6)).toThrow(/Invalid amount/);
    });
});

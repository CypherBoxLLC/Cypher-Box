/**
 * Deriving the user's Tron account from the wallet's existing seed.
 *
 * The properties that matter: the same phrase always gives the same address,
 * the path is the one other wallets use so a restore elsewhere finds the funds,
 * an invalid phrase is refused rather than silently producing an address, and
 * the private key does not escape.
 */

import { Buffer } from 'buffer';

import { isValidTronAddress, tronAddressToHex } from '../../src/services/tron/address';
import {
    TRON_COIN_TYPE,
    deriveTronAccount,
    tronDerivationPath,
    withTronPrivateKey,
} from '../../src/services/tron/keys';

const TEST_MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_MNEMONIC =
    'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('the derivation path', () => {
    it('is the standard Tron path, so another wallet restores the same account', () => {
        expect(TRON_COIN_TYPE).toBe(195);
        expect(tronDerivationPath()).toBe("m/44'/195'/0'/0/0");
        expect(tronDerivationPath(2, 5)).toBe("m/44'/195'/2'/0/5");
    });
});

describe('deriveTronAccount', () => {
    it('gives a valid mainnet address and records the path', () => {
        const account = deriveTronAccount(TEST_MNEMONIC);
        expect(account.address.startsWith('T')).toBe(true);
        expect(account.address).toHaveLength(34);
        expect(isValidTronAddress(account.address)).toBe(true);
        expect(tronAddressToHex(account.address)).toMatch(/^41[0-9a-f]{40}$/);
        expect(account.path).toBe("m/44'/195'/0'/0/0");
        expect(account.publicKey).toMatch(/^04[0-9a-f]{128}$/);
    });

    it('is deterministic', () => {
        expect(deriveTronAccount(TEST_MNEMONIC)).toEqual(deriveTronAccount(TEST_MNEMONIC));
    });

    it('gives different accounts for different phrases, indexes and passphrases', () => {
        const base = deriveTronAccount(TEST_MNEMONIC).address;
        expect(deriveTronAccount(OTHER_MNEMONIC).address).not.toBe(base);
        expect(deriveTronAccount(TEST_MNEMONIC, 0, 1).address).not.toBe(base);
        expect(deriveTronAccount(TEST_MNEMONIC, 1, 0).address).not.toBe(base);
        expect(deriveTronAccount(TEST_MNEMONIC, 0, 0, 'passphrase').address).not.toBe(base);
    });

    it('returns no private key, so it is safe to hold in state', () => {
        expect(Object.keys(deriveTronAccount(TEST_MNEMONIC)).sort()).toEqual(['address', 'path', 'publicKey']);
    });

    it('refuses an invalid phrase rather than deriving something', () => {
        expect(() => deriveTronAccount('not a real phrase')).toThrow(/Invalid recovery phrase/);
        expect(() => deriveTronAccount('')).toThrow(/Invalid recovery phrase/);
        // One word changed, so the checksum fails.
        expect(() =>
            deriveTronAccount(TEST_MNEMONIC.replace(/about$/, 'abandon')),
        ).toThrow(/Invalid recovery phrase/);
    });
});

describe('withTronPrivateKey', () => {
    it('hands over a usable key for the call', () => {
        const length = withTronPrivateKey(TEST_MNEMONIC, key => key.length);
        expect(length).toBe(32);
    });

    it('wipes the key afterwards, so a leaked reference is useless', () => {
        let leaked: Buffer | null = null;
        withTronPrivateKey(TEST_MNEMONIC, key => {
            leaked = key;
            expect(key.some(b => b !== 0)).toBe(true);
        });
        expect(leaked).not.toBeNull();
        expect((leaked as unknown as Buffer).every(b => b === 0)).toBe(true);
    });

    it('wipes it even when the call throws', () => {
        let leaked: Buffer | null = null;
        expect(() =>
            withTronPrivateKey(TEST_MNEMONIC, key => {
                leaked = key;
                throw new Error('boom');
            }),
        ).toThrow('boom');
        expect((leaked as unknown as Buffer).every(b => b === 0)).toBe(true);
    });
});

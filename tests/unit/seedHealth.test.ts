/**
 * A freshly minted mnemonic must be validated before use, so a broken entropy
 * source (bark Rust RNG, dice, or JS CSPRNG) can't persist a weak seed. The
 * check rejects a wrong word count, a bad checksum, and single-repeated-byte
 * entropy (what a stuck/zeroed source produces, e.g. the all-zero vector), and
 * never rejects a real mnemonic.
 */

import * as bip39 from 'bip39';
import { assertMnemonicHealthy, generateCheckedArkMnemonic, SeedUnsafeError } from '../../class/seedHealth';

// A valid 12-word mnemonic with VARIED (non-constant) entropy and a good
// checksum. (Note: the common "legal winner thank..." vector is all-0x7f
// entropy, which is correctly rejected as constant, so it can't be used here.)
const GOOD = bip39.entropyToMnemonic('000102030405060708090a0b0c0d0e0f');
// The canonical all-zero-entropy mnemonic: valid checksum, but constant entropy.
const ALL_ZERO = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('assertMnemonicHealthy', () => {
    it('accepts a real mnemonic', () => {
        expect(() => assertMnemonicHealthy(GOOD)).not.toThrow();
    });

    it('rejects all-zero (constant) entropy', () => {
        expect(() => assertMnemonicHealthy(ALL_ZERO)).toThrow(SeedUnsafeError);
        try {
            assertMnemonicHealthy(ALL_ZERO);
        } catch (e) {
            expect((e as SeedUnsafeError).reason).toBe('constant-entropy');
        }
    });

    it('rejects a bad checksum', () => {
        // valid words, last word swapped so the checksum fails
        const bad = GOOD.split(' ').slice(0, 11).concat('zoo').join(' ');
        expect(() => assertMnemonicHealthy(bad)).toThrow(SeedUnsafeError);
    });

    it('rejects a wrong word count', () => {
        expect(() => assertMnemonicHealthy('legal winner thank year wave sausage')).toThrow(SeedUnsafeError);
    });

    it('rejects empty input', () => {
        expect(() => assertMnemonicHealthy('')).toThrow(SeedUnsafeError);
    });
});

describe('generateCheckedArkMnemonic', () => {
    it('returns the mnemonic when the generator is healthy', () => {
        expect(generateCheckedArkMnemonic(() => GOOD)).toBe(GOOD);
    });

    it('throws when the generator returns a degenerate seed', () => {
        expect(() => generateCheckedArkMnemonic(() => ALL_ZERO)).toThrow(SeedUnsafeError);
    });
});

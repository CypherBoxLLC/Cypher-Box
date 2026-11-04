/**
 * The seed-signer's key for a multisig (a Nunchuk wallet, say): the m/48'/0'/0'/2' key with its origin, as a
 * coordinator scans it. Expected keys were computed with @scure/bip32 and @scure/bip39, not with the code under test,
 * from public BIP39 test mnemonics.
 */

import { MULTISIG_KEY_PATH, multisigKeyExpression } from '../../src/helpers/multisigKey';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('multisigKeyExpression', () => {
    it('is the native SegWit multisig path', () => {
        expect(MULTISIG_KEY_PATH).toBe("m/48'/0'/0'/2'");
    });

    it('gives the key with its origin, fingerprint in lowercase, as a plain xpub', () => {
        expect(multisigKeyExpression(ABANDON)).toBe(
            '[73c5da0a/48h/0h/0h/2h]xpub6DkFAXWQ2dHxq2vatrt9qyA3bXYU4ToWQwCHbf5XB2mSTexcHZCeKS1VZYcPoBd5X8yVcbXFHJR9R8UCVpt82VX1VhR28mCyxUFL4r6KFrf',
        );
        expect(multisigKeyExpression('legal winner thank year wave sausage worth useful legal winner thank yellow')).toBe(
            '[b8688df1/48h/0h/0h/2h]xpub6FQya7zGhR92kacYsNnjreouvnHJMpXYsUXnW6NJJAJRCKsa26TzDy4LdnGhEurr3d6y1J8PJ7EEMKQp74XTqYvmGJNogYXSKDszYHtF8mX',
        );
    });

    it('works for 24 words', () => {
        const zoo = `${'zoo '.repeat(23)}vote`;
        expect(multisigKeyExpression(zoo)).toBe(
            '[244c267a/48h/0h/0h/2h]xpub6Da6wLpZUC4a9vRZHGxzgMiFNp7nbhDwQ3HsdV1qATPc6yktt3o6A9U2Nh7YYZnwRG1prgFGeKPGMa8gA4XGjdWGuounnWSaNp5HcWCjrPh',
        );
    });

    it('uses the passphrase, which changes both the fingerprint and the key', () => {
        expect(multisigKeyExpression(ABANDON, 'TREZOR')).toBe(
            '[b4e3f5ed/48h/0h/0h/2h]xpub6EvUNn2FJ1EvJtzDBLGqky8EypxyrcqzPGtLvXrYGMvJXB1DsJnDkSK9hmrJJbC1hXJhQxdarj4ELYX7YY5QSwVwe3PxQrkfMuXy9nFcKrg',
        );
    });

    it('refuses words that are not a valid recovery phrase', () => {
        expect(() => multisigKeyExpression('abandon '.repeat(11) + 'abandon')).toThrow();
        expect(() => multisigKeyExpression('')).toThrow();
    });
});

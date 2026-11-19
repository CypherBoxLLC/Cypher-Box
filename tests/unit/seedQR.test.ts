/**
 * A SeedQR made from the Hot Vault's phrase has to scan back to exactly that phrase, at the grid size the paper and
 * steel templates expect. All phrases here are public BIP39 test phrases.
 */

import { mnemonicToSeedQR, seedQRGrid, seedQRMatches } from '../../src/helpers/seedQR';

const TWELVE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TWENTY_FOUR =
    'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote';

describe('mnemonicToSeedQR', () => {
    it('writes each word as its 4-digit index', () => {
        // "abandon" is word 0, "about" word 3
        expect(mnemonicToSeedQR(TWELVE)).toBe('0000'.repeat(11) + '0003');
        // "zoo" is word 2047, "vote" word 1967
        expect(mnemonicToSeedQR(TWENTY_FOUR)).toBe('2047'.repeat(23) + '1967');
    });

    it('refuses a phrase that is not valid', () => {
        expect(() => mnemonicToSeedQR('abandon about')).toThrow();
    });
});

describe('seedQRGrid', () => {
    it('is 25 squares wide for 12 words and 29 for 24', () => {
        const twelve = seedQRGrid(mnemonicToSeedQR(TWELVE));
        expect(twelve.size).toBe(25);
        expect(twelve.filled).toHaveLength(25 * 25);
        expect(seedQRGrid(mnemonicToSeedQR(TWENTY_FOUR)).size).toBe(29);
    });

    it('has the finder pattern in the top left corner', () => {
        const { size, filled } = seedQRGrid(mnemonicToSeedQR(TWELVE));
        const at = (row: number, col: number) => filled[row * size + col];
        expect([0, 1, 2, 3, 4, 5, 6].every(i => at(0, i) && at(6, i) && at(i, 0) && at(i, 6))).toBe(true);
        expect(at(1, 1)).toBe(false);
        expect(at(3, 3)).toBe(true);
    });
});

describe('seedQRMatches', () => {
    it('accepts the same phrase', () => {
        expect(seedQRMatches(mnemonicToSeedQR(TWELVE), TWELVE)).toBe(true);
    });

    it('refuses a different phrase, a broken checksum and non-SeedQR data', () => {
        expect(seedQRMatches(mnemonicToSeedQR(TWENTY_FOUR), TWELVE)).toBe(false);
        expect(seedQRMatches('0000'.repeat(12), TWELVE)).toBe(false);
        expect(seedQRMatches('bc1qxyz', TWELVE)).toBe(false);
    });
});

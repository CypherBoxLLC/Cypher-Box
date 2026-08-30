/**
 * Dice entropy must never produce a predictable seed.
 *
 * The regression this pins: the entropy screen counts BITS PUSHED, not entropy,
 * and `getEntropy(face, 6)` maps a face to the same value every time. So 64
 * taps of one button satisfied the 128-bit gate with 128 zero bits, and feeding
 * those straight to `entropyToMnemonic` produced the all-zeros BIP39 test
 * vector, which is swept within seconds of being funded.
 *
 * Tapping one face is also the fastest way to fill the counter, so it was
 * reachable by impatience alone.
 */

import crypto from 'crypto';
import { eReducer, getEntropy, convertToBuffer, mixEntropy } from '../../screen/wallets/provideEntropy';
const bip39 = require('bip39');

/**
 * Replay d6 faces (1..6) through the real reducer, using the SAME face mapping
 * the Dice component uses: (i + 1) % sides, which for a face f is f % 6. That
 * makes die 6 digit 0, matching Ian Coleman's base-6 dice convention.
 *
 * Note this moves the all-zeros case. Under the old 0-based labelling the
 * degenerate face was 1; it is now 6, which is the face that maps to digit 0.
 */
const roll = (faces: number[]) => {
    let state: any;
    for (const face of faces) {
        const e = getEntropy(face % 6, 6);
        if (e) state = eReducer(state, { type: 'push', ...e });
    }
    return state;
};

/** The OLD behaviour: user bytes straight to a mnemonic. */
const seedWithoutMix = (dice: Buffer) =>
    bip39.entropyToMnemonic(dice.slice(0, 16).toString('hex'));

/**
 * The shipped mix, imported rather than reimplemented. A local copy would keep
 * passing even if the real derivation changed underneath it, which is exactly
 * the failure this file exists to prevent.
 */
const seedWithMix = (dice: Buffer, rng: Buffer) =>
    bip39.entropyToMnemonic(mixEntropy(dice.slice(0, 16), rng).toString('hex'));

const ALL_ZEROS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('the degenerate input that reached the 128-bit gate', () => {
    const lazy = convertToBuffer(roll(Array(64).fill(6)));

    it('really did satisfy the counter with zero entropy', () => {
        expect(roll(Array(64).fill(6)).bits).toBeGreaterThanOrEqual(128);
        expect(lazy.slice(0, 16).equals(Buffer.alloc(16))).toBe(true);
    });

    it('produced the swept all-zeros mnemonic without the mix', () => {
        expect(seedWithoutMix(lazy)).toBe(ALL_ZEROS);
    });

    it('does NOT produce it with the mix', () => {
        const out = seedWithMix(lazy, crypto.randomBytes(16));
        expect(out).not.toBe(ALL_ZEROS);
        expect(bip39.validateMnemonic(out)).toBe(true);
        expect(out.split(' ')).toHaveLength(12);
    });

    it('gives a different seed every time even from identical dice', () => {
        // The whole point: worthless dice are carried by the RNG.
        const seeds = new Set(
            Array.from({ length: 25 }, () => seedWithMix(lazy, crypto.randomBytes(16))),
        );
        expect(seeds.size).toBe(25);
    });
});

describe('the mix does not weaken good dice', () => {
    const good = crypto.randomBytes(16);

    it('still yields a valid 12-word mnemonic', () => {
        const out = seedWithMix(good, crypto.randomBytes(16));
        expect(bip39.validateMnemonic(out)).toBe(true);
        expect(out.split(' ')).toHaveLength(12);
    });

    it('stays unpredictable to an attacker who controls the RNG entirely', () => {
        // The reason for rolling in the first place. With the RNG pinned to a
        // known value, distinct dice must still give distinct seeds.
        const pinned = Buffer.alloc(16, 0xff);
        const seeds = new Set(
            Array.from({ length: 25 }, () => seedWithMix(crypto.randomBytes(16), pinned)),
        );
        expect(seeds.size).toBe(25);
    });

    it('changes the seed when a single dice bit changes', () => {
        const rng = crypto.randomBytes(16);
        const flipped = Buffer.from(good);
        flipped[0] ^= 0x01;
        expect(seedWithMix(good, rng)).not.toBe(seedWithMix(flipped, rng));
    });
});

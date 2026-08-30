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
import { eReducer, getEntropy, convertToBuffer } from '../../screen/wallets/provideEntropy';
const bip39 = require('bip39');

/** Replay d6 faces (1..6) through the real reducer. */
const roll = (faces: number[]) => {
    let state: any;
    for (const face of faces) {
        const e = getEntropy(face - 1, 6);
        if (e) state = eReducer(state, { type: 'push', ...e });
    }
    return state;
};

/** The OLD behaviour: user bytes straight to a mnemonic. */
const seedWithoutMix = (dice: Buffer) =>
    bip39.entropyToMnemonic(dice.slice(0, 16).toString('hex'));

/** The behaviour now shipped in SavingVaultIntro: hash dice WITH the CSPRNG. */
const seedWithMix = (dice: Buffer, rng: Buffer) =>
    bip39.entropyToMnemonic(
        crypto.createHash('sha256').update(Buffer.concat([dice.slice(0, 16), rng])).digest()
            .slice(0, 16).toString('hex'),
    );

const ALL_ZEROS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('the degenerate input that reached the 128-bit gate', () => {
    const lazy = convertToBuffer(roll(Array(64).fill(1)));

    it('really did satisfy the counter with zero entropy', () => {
        expect(roll(Array(64).fill(1)).bits).toBeGreaterThanOrEqual(128);
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

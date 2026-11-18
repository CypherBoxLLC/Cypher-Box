import * as bitcoin from 'bitcoinjs-lib';

/**
 * A seed-signer's seed from dice rolls alone, so that anyone can check it in EntropyLab ("Base 10 [1-6] / Hashed
 * rolls", 12 words), SeedSigner or COLDCARD, which all make the same 12 words from the same rolls. Only from enough
 * rolls of a six-sided die, and only when they look like real rolls: with fewer, with a coin or a 20-sided die, or
 * with rolls that look made up, the dice screen mixes the phone's randomness in instead (screen/wallets/provideEntropy).
 */

/** Rolls of a six-sided die for a 12-word seed from the rolls alone: EntropyLab's, SeedSigner's and COLDCARD's
 * recommendation (50 x log2 6 = 129 bits). */
export const ROLLS_ONLY_MIN = 50;

/** One roll as the dice screen records it: the face that came up (1 to `sides`), and the die (2 for a coin). */
export interface DiceRoll {
    sides: number;
    face: number;
}

/** Why rolls don't make the seed alone, so the phone's randomness is mixed in. */
export type RollsOnlyRefusal = 'not-six-sided' | 'too-few' | 'missing-face' | 'uneven' | 'pattern';

// chi-square with 5 degrees of freedom at p = 0.001: one honest set of rolls in a thousand goes over it
const CHI_SQUARE_5DF_P001 = 20.515;
// a cycle this short repeating through every roll isn't a die
const MAX_PATTERN_PERIOD = 12;

/**
 * The 16 bytes of BIP39 entropy for 12 words from six-sided rolls alone: SHA-256 of the faces written as the digits
 * 1 to 6 (a six is 6), every roll included, cut to 16 bytes.
 */
export function rollsOnlyEntropy(faces: readonly number[]): Buffer {
    if (!faces.length || faces.some(f => !Number.isInteger(f) || f < 1 || f > 6)) {
        throw new Error('Dice faces have to be whole numbers from 1 to 6.');
    }
    const hash = bitcoin.crypto.sha256(Buffer.from(faces.join(''), 'utf8'));
    // toString with a range, not slice or subarray: on Hermes those give a plain Uint8Array
    return Buffer.from(hash.toString('hex', 0, 16), 'hex');
}

/**
 * Null when these rolls can make the seed alone; else why not. Besides the die and the count, it turns away rolls
 * a die doesn't produce: a face that never came up, counts far from even, a short cycle repeating, or a run that
 * mostly climbs, falls or repeats from one roll to the next. About two honest sets of rolls in a thousand are turned
 * away too; they're mixed with the phone's randomness, which is as safe, only not checkable from the rolls. Numbers
 * made up to look random can pass: the screen says plainly that only a real die is safe.
 */
export function rollsOnlyRefusal(rolls: readonly DiceRoll[], min = ROLLS_ONLY_MIN): RollsOnlyRefusal | null {
    if (rolls.some(r => r.sides !== 6)) return 'not-six-sided';
    if (rolls.length < min) return 'too-few';
    const faces = rolls.map(r => r.face);
    const counts = [1, 2, 3, 4, 5, 6].map(face => faces.filter(f => f === face).length);
    if (counts.some(c => c === 0)) return 'missing-face';
    const expected = faces.length / 6;
    const chiSquare = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    if (chiSquare > CHI_SQUARE_5DF_P001) return 'uneven';
    for (let period = 1; period <= MAX_PATTERN_PERIOD; period++) {
        if (faces.every((f, i) => i < period || f === faces[i - period])) return 'pattern';
    }
    let up = 0;
    let down = 0;
    let same = 0;
    for (let i = 1; i < faces.length; i++) {
        const step = (faces[i] - faces[i - 1] + 6) % 6;
        if (step === 1) up++;
        else if (step === 5) down++;
        else if (step === 0) same++;
    }
    const half = (faces.length - 1) / 2;
    if (up > half || down > half || same > half) return 'pattern';
    return null;
}

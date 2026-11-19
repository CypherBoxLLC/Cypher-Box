/**
 * The seed-signer's seed from dice rolls alone has to be the one EntropyLab makes from the same rolls ("Base 10 [1-6] /
 * Hashed rolls", 12 words), which is SeedSigner's and COLDCARD's method too. The vectors below come from EntropyLab's
 * own code (src/js/app.js hodlDiceEntropy, loaded the way its test/dice-hashed.test.mjs does, with its @scure/bip39),
 * not from this app. Rolls that a die doesn't produce are turned away, so the phone's randomness is mixed in instead.
 */

import crypto from 'crypto';
import * as bip39 from 'bip39';

import { ROLLS_ONLY_MIN, rollsOnlyEntropy, rollsOnlyRefusal } from '../../src/helpers/diceSeed';

const ENTROPYLAB = [
    {
        rolls: '36261515636232342244625365616314551523335564321634',
        entropy: '3026419cc629226157a6a860aba02cff',
        mnemonic: 'coral craft grunt middle mutual cost future steak gaze fringe arctic yard',
    },
    {
        rolls: '312362464616531433111525415411345133435166634316136151643446345',
        entropy: '4de88099ba75a106c3b8d852b575c66d',
        mnemonic: 'evil dune chapter insane foam lock auction brand famous produce immense swim',
    },
    {
        rolls: '54211316232122624122344362434533221155531425565231141415322341365323334425113',
        entropy: '0c35402e8d94ce2b176fd6035f20a0f1',
        mnemonic: 'around present arm brass erupt better frozen width addict weekend choice tip',
    },
];
// EntropyLab hashes this one too; a die never rolls it
const PATTERN = {
    rolls: '12345612345612345612345612345612345612345612345612',
    entropy: 'ee72ae915a4e6ea7ccbeb8e5e5eecef2',
};

const facesOf = (rolls: string) => [...rolls].map(Number);
const d6 = (rolls: string) => facesOf(rolls).map(face => ({ sides: 6, face }));

describe('a seed from dice rolls alone', () => {
    it("makes EntropyLab's 12 words from the same rolls", () => {
        for (const v of ENTROPYLAB) {
            const entropy = rollsOnlyEntropy(facesOf(v.rolls));
            expect(entropy.toString('hex')).toBe(v.entropy);
            expect(bip39.entropyToMnemonic(entropy.toString('hex'))).toBe(v.mnemonic);
            // and that's SHA-256 of the faces as text, cut to 16 bytes
            expect(entropy.toString('hex')).toBe(crypto.createHash('sha256').update(v.rolls).digest('hex').slice(0, 32));
        }
        expect(rollsOnlyEntropy(facesOf(PATTERN.rolls)).toString('hex')).toBe(PATTERN.entropy);
    });

    it('takes real-looking rolls from 50 on, as EntropyLab recommends for 12 words', () => {
        expect(ROLLS_ONLY_MIN).toBe(50);
        for (const v of ENTROPYLAB) expect(rollsOnlyRefusal(d6(v.rolls))).toBeNull();
        expect(rollsOnlyRefusal(d6(ENTROPYLAB[0].rolls.slice(0, 49)))).toBe('too-few');
    });

    it('works the same with Hermes-style buffers, whose subarray gives a plain Uint8Array', () => {
        const nodeSubarray = Buffer.prototype.subarray;
        Buffer.prototype.subarray = function hermesSubarray(this: Buffer, start?: number, end?: number) {
            const view = nodeSubarray.call(this, start, end);
            return new Uint8Array(view.buffer, view.byteOffset, view.length) as unknown as Buffer;
        };
        try {
            expect(rollsOnlyEntropy(facesOf(ENTROPYLAB[0].rolls)).toString('hex')).toBe(ENTROPYLAB[0].entropy);
        } finally {
            Buffer.prototype.subarray = nodeSubarray;
        }
    });

    it('refuses faces a six-sided die has not got', () => {
        expect(() => rollsOnlyEntropy([])).toThrow();
        expect(() => rollsOnlyEntropy([1, 2, 7])).toThrow();
        expect(() => rollsOnlyEntropy([0, 1, 2])).toThrow();
    });
});

describe('rolls a die does not produce', () => {
    const real = ENTROPYLAB[1].rolls;

    it('a coin or a 20-sided die anywhere in them', () => {
        expect(rollsOnlyRefusal([...d6(real), { sides: 20, face: 13 }])).toBe('not-six-sided');
        expect(rollsOnlyRefusal([{ sides: 2, face: 1 }, ...d6(real)])).toBe('not-six-sided');
    });

    it('a face that never came up', () => {
        expect(rollsOnlyRefusal(d6(real.replace(/6/g, '5')))).toBe('missing-face');
    });

    it('counts far from even', () => {
        // every face there, but half of them ones
        const lopsided = '1'.repeat(30) + '23456'.repeat(6);
        expect(rollsOnlyRefusal(d6(lopsided))).toBe('uneven');
    });

    it('a short cycle repeating, or runs that climb, fall or repeat', () => {
        expect(rollsOnlyRefusal(d6(PATTERN.rolls))).toBe('pattern');
        expect(rollsOnlyRefusal(d6('135246'.repeat(9)))).toBe('pattern');
        expect(rollsOnlyRefusal(d6('654321'.repeat(9)))).toBe('pattern');
        // even counts, no short cycle, but each face held for three rolls
        expect(rollsOnlyRefusal(d6('111222333444555666'.repeat(3)))).toBe('pattern');
        // climbing by one, restarting at random places: no cycle, even enough
        let climbing = '';
        let face = 3;
        for (let i = 0; i < 60; i++) {
            climbing += String(face);
            face = i % 7 === 6 ? ((face + 3) % 6) + 1 : (face % 6) + 1;
        }
        expect(rollsOnlyRefusal(d6(climbing))).toBe('pattern');
    });

    it('turns away very few honest rolls: they are mixed with the phone instead, which is as safe', () => {
        // a fixed PRNG (Park-Miller MINSTD) standing in for a fair die
        let s = 20261118;
        const rnd = () => {
            s = (s * 48271) % 2147483647;
            return s / 2147483647;
        };
        let turnedAway = 0;
        const runs = 20000;
        for (let n = 0; n < runs; n++) {
            const rolls = Array.from({ length: 50 }, () => ({ sides: 6, face: 1 + Math.floor(rnd() * 6) }));
            if (rollsOnlyRefusal(rolls)) turnedAway++;
        }
        // chi-square at p = 0.001 plus a missing face (about 0.07% at 50 rolls)
        expect(turnedAway / runs).toBeLessThan(0.005);
    });
});

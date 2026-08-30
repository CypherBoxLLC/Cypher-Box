/**
 * The dice screen must produce the same entropy as Ian Coleman's BIP39 tool.
 *
 * Verifiability is the point: a user retypes their rolls at iancoleman.io/bip39,
 * picks dice, and sees the same hex this screen shows. If these ever diverge,
 * our dice machine is unauditable, and to anyone checking it looks rigged.
 *
 * Two things have to line up.
 *
 *  1. The face to bits mapping. His table (src/js/entropy.js, "base 6 (dice)")
 *     and `getEntropy` are the same scheme, four digits at two bits and two at
 *     one, averaging (4*2 + 2*1)/6 per roll. But he calls die 6 digit 0 while
 *     upstream used the 0-based index, making our die 1 his die 6. Hence the
 *     (i + 1) % sides remap in the Dice component.
 *
 *  2. The truncation. He rounds DOWN to a multiple of 32 bits and keeps the
 *     TRAILING bits (index.js: start = bits.length - bitsToUse). We keep
 *     trailing BYTES. Those pick the same 128 bits while the total sits in
 *     [128, 135], and diverge past it: at 140 he keeps 16 bytes and we keep 17.
 *     So the reducer refuses rolls once the target is reached, which pins the
 *     total to [128, 129] and keeps both inside the agreeing window.
 */

import { eReducer, getEntropy, convertToBuffer } from '../../screen/wallets/provideEntropy';

/** Ian Coleman's "base 6 (dice)" table, verbatim. He rewrites die 6 to digit 0. */
const IC_MAP: Record<string, string> = { '0': '00', '1': '01', '2': '10', '3': '11', '4': '0', '5': '1' };
const icBits = (faces: number[]) => faces.map(f => IC_MAP[f === 6 ? '0' : String(f)]).join('');

/** His index.js: round down to a 32-bit multiple, keep the trailing bits. */
const icEntropyHex = (faces: number[]) => {
    const bits = icBits(faces);
    const use = Math.floor(bits.length / 32) * 32;
    const kept = bits.substring(bits.length - use);
    let hex = '';
    for (let i = 0; i < kept.length / 8; i++) {
        hex += parseInt(kept.substring(i * 8, i * 8 + 8), 2).toString(16).padStart(2, '0');
    }
    return hex;
};

/**
 * This screen, driven exactly as the Dice component drives it. Also reports how
 * many rolls were ACCEPTED, since the reducer refuses them once the target is
 * reached and only the accepted ones are what a user would retype elsewhere.
 */
const ourEntropy = (faces: number[], limit = 128) => {
    let st: any;
    let accepted = 0;
    for (const f of faces) {
        const before = st ? st.bits : 0;
        const e = getEntropy((f - 1 + 1) % 6, 6); // (i + 1) % sides, where i = f - 1
        if (e) st = eReducer(st, { type: 'push', ...e, limit });
        if (st.bits !== before) accepted++;
    }
    return { hex: convertToBuffer(st).toString('hex'), bits: st.bits, accepted };
};

/** Deterministic pseudo-rolls, so any failure is reproducible. */
const rolls = (n: number, seed: number) => {
    const out: number[] = [];
    let x = seed;
    for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) % 2147483648;
        out.push((x % 6) + 1);
    }
    return out;
};

describe('dice entropy matches Ian Coleman', () => {
    it('agrees on a sequence landing exactly on the target', () => {
        // Under his labelling, digits 0-3 carry two bits and digits 4-5 carry
        // one. Die 6 is digit 0, so faces 6,1,2,3 are the two-bit ones and 64
        // of them is exactly 128 bits, with nothing to truncate on either side.
        const faces = Array.from({ length: 64 }, (_, i) => [6, 1, 2, 3][i % 4]);
        const ours = ourEntropy(faces);
        expect(ours.bits).toBe(128);
        expect(ours.hex).toBe(icEntropyHex(faces));
    });

    it('agrees across many mixed sequences, with the stop doing the work', () => {
        for (let seed = 1; seed <= 50; seed++) {
            // Far more rolls than needed, so the reducer must refuse the tail.
            const faces = rolls(200, seed);
            const ours = ourEntropy(faces);
            // The last accepted roll can carry us one bit past the target and
            // never further. That is the window where his 32-bit rounding and
            // our 8-bit rounding select the same trailing 128 bits.
            expect(ours.bits).toBeGreaterThanOrEqual(128);
            expect(ours.bits).toBeLessThanOrEqual(129);
            // A user retypes the rolls that counted, and his tool must agree.
            expect(ours.hex).toBe(icEntropyHex(faces.slice(0, ours.accepted)));
        }
    });

    it('always yields exactly 16 bytes, the BIP39 128-bit input', () => {
        for (let seed = 1; seed <= 25; seed++) {
            expect(ourEntropy(rolls(200, seed)).hex).toHaveLength(32);
        }
    });

    it('ignores rolls after the target, so a bored tail cannot change the key', () => {
        const base = rolls(120, 7);
        const a = ourEntropy(base);
        const b = ourEntropy([...base, 1, 1, 1, 1, 1, 1, 1, 1]);
        expect(b.hex).toBe(a.hex);
        expect(b.bits).toBe(a.bits);
    });
});

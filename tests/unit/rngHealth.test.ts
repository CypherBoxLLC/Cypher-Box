/**
 * The device's secure-randomness source must be live before any seed or key is
 * minted. evaluateRngHealth is the pure core of that check: it catches gross
 * failure (missing native module, short/constant/stuck output) and nothing
 * subtler, so real CSPRNG output never trips it.
 */

import { evaluateRngHealth } from '../../class/rngHealth';

const nativePresent = { randomBytes: () => undefined };

describe('evaluateRngHealth', () => {
    it('fails when the native RNG module is missing', async () => {
        const r = await evaluateRngHealth(undefined, async n => Buffer.alloc(n, 1));
        expect(r).toEqual({ ok: false, reason: 'native-rng-module-missing' });
    });

    it('fails when the native module lacks randomBytes', async () => {
        const r = await evaluateRngHealth({}, async n => Buffer.alloc(n, 1));
        expect(r).toEqual({ ok: false, reason: 'native-rng-module-missing' });
    });

    it('fails on all-constant output', async () => {
        const r = await evaluateRngHealth(nativePresent, async n => Buffer.alloc(n, 0));
        expect(r.ok).toBe(false);
    });

    it('fails when two draws are identical (stuck source)', async () => {
        const fixed = Buffer.from(Array.from({ length: 32 }, (_, i) => i)); // varied, not constant
        const r = await evaluateRngHealth(nativePresent, async () => Buffer.from(fixed));
        expect(r).toEqual({ ok: false, reason: 'repeated-output' });
    });

    it('fails on a short draw', async () => {
        const r = await evaluateRngHealth(nativePresent, async () => Buffer.alloc(16, 3));
        expect(r.ok).toBe(false);
    });

    it('passes for distinct, non-constant draws', async () => {
        let i = 0;
        const r = await evaluateRngHealth(nativePresent, async n => {
            i += 1;
            const b = Buffer.alloc(n, 0);
            b[0] = i;
            b[1] = 0x7f;
            return b;
        });
        expect(r).toEqual({ ok: true });
    });
});

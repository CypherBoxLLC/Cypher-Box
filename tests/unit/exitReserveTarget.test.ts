/**
 * Which reserve figure the exit-fee gate measures against.
 *
 * The bug this pins was found on device, not in review: an armed reserve of
 * 3,654 sats against a live recommendation of 233,120 made the gate report the
 * reserve fully funded and the shortfall 0, on the same screen that displayed
 * the 233,120. The user was 227k short of the app's own estimate and was told
 * they were ready to exit.
 */
import { resolveExitReserveTarget } from '../../src/services/ark/exitReserveTarget';

describe('resolveExitReserveTarget', () => {
    it('is 0 when neither figure is known, so callers do not gate yet', () => {
        expect(resolveExitReserveTarget({ armedSats: null, recommendedSats: null })).toBe(0);
        expect(resolveExitReserveTarget({ armedSats: undefined, recommendedSats: undefined })).toBe(0);
    });

    it('uses the recommendation when nothing is armed', () => {
        expect(resolveExitReserveTarget({ armedSats: 0, recommendedSats: 233_120 })).toBe(233_120);
    });

    it('uses the armed value while the recommendation is still computing', () => {
        expect(resolveExitReserveTarget({ armedSats: 3_654, recommendedSats: null })).toBe(3_654);
    });

    it('THE BUG: a stale armed value can no longer claim the exit is funded', () => {
        // Exact figures read off the device on 2026-08-20.
        const target = resolveExitReserveTarget({ armedSats: 3_654, recommendedSats: 233_120 });
        expect(target).toBe(233_120);
        const onchain = 6_259;
        expect(Math.max(0, target - onchain)).toBe(226_861);
        // The old rule was `armed > 0 ? armed : recommended`, which gave 3_654
        // and therefore a shortfall of 0 against the same 6,259 on-chain.
        expect(target).not.toBe(3_654);
    });

    it('honours an armed value ABOVE the recommendation, since that is a deliberate buffer', () => {
        expect(resolveExitReserveTarget({ armedSats: 300_000, recommendedSats: 233_120 })).toBe(300_000);
    });

    it('never returns a negative or fractional target', () => {
        expect(resolveExitReserveTarget({ armedSats: -50, recommendedSats: -10 })).toBe(0);
        expect(resolveExitReserveTarget({ armedSats: 10.9, recommendedSats: 0 })).toBe(10);
    });

    it('is stable as the recommendation grows, which is how the wallet actually moves', () => {
        // Depth drives the reserve and rises as capsules are spent through
        // arkoor hops, so the recommendation climbs over a wallet's life.
        const armed = 3_654;
        const climbing = [3_654, 12_000, 60_000, 233_120];
        const targets = climbing.map((r) => resolveExitReserveTarget({ armedSats: armed, recommendedSats: r }));
        expect(targets).toEqual([3_654, 12_000, 60_000, 233_120]);
    });
});

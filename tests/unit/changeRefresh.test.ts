/**
 * Folding arkoor change back into a round.
 *
 * Depth is created by spending and reset by rounds, and it is exactly the number
 * of transactions a unilateral exit must broadcast and confirm. Nothing folded
 * change back before this, so a user who spent accumulated depth until the
 * expiry sweep reached the capsule in its final week.
 *
 * The numbers below are from the 2026-08-22 mainnet wallet, split by state:
 * live capsules sat at [2, 2, 3, 3, 3, 3, 15, 17], median 3.
 */

import {
    ARK_CHANGE_REFRESH_MAX_DEPTH,
    decideChangeRefresh,
    type ChangeRefreshInput,
} from '../../src/services/ark/changeRefresh';

// 28h at 10-minute blocks, matching ARK_EXIT_RUNWAY_HOURS.
const MIN_RUNWAY = 168;
const MIN_SATS = 500;

const base: ChangeRefreshInput = {
    exitDepth: 3,
    sats: 5_000,
    blocksUntilExpiry: 4032, // a fresh round output, ~28 days
    stateTag: 'Spendable',
    alreadyRefreshing: false,
    exitInProgress: false,
    minSats: MIN_SATS,
    minRunwayBlocks: MIN_RUNWAY,
};

const decide = (over: Partial<ChangeRefreshInput> = {}) =>
    decideChangeRefresh({ ...base, ...over });

describe('the depth threshold', () => {
    it('leaves a normal wallet alone: the measured resting state is 2 to 3', () => {
        for (const exitDepth of [2, 3]) {
            expect(decide({ exitDepth })).toEqual({
                refresh: false,
                reason: 'shallow-enough',
            });
        }
    });

    it('does not fire at the threshold itself, only above it', () => {
        expect(decide({ exitDepth: ARK_CHANGE_REFRESH_MAX_DEPTH }).refresh).toBe(false);
        expect(decide({ exitDepth: ARK_CHANGE_REFRESH_MAX_DEPTH + 1 }).refresh).toBe(true);
    });

    it('folds back a capsule that several sends have deepened', () => {
        expect(decide({ exitDepth: 9 })).toEqual({ refresh: true, reason: 'refresh' });
    });

    it('is high enough that one send off a fresh capsule never triggers it', () => {
        // Round output is depth 2, so its change is 3. Two more sends: 4, 5.
        for (const exitDepth of [3, 4, 5]) {
            expect(decide({ exitDepth }).refresh).toBe(false);
        }
    });
});

describe('what it refuses to do, and why', () => {
    it('never runs a round while a unilateral exit is active', () => {
        // A cooperative round would spend a coin already committed on-chain.
        expect(decide({ exitDepth: 40, exitInProgress: true })).toEqual({
            refresh: false,
            reason: 'exit-in-progress',
        });
    });

    it('leaves dust alone: one sub-floor input makes the ASP reject the whole round', () => {
        expect(decide({ exitDepth: 17, sats: 400 })).toEqual({
            refresh: false,
            reason: 'below-refresh-minimum',
        });
    });

    it('names deep dust as dust, since that is the actionable half', () => {
        // The two depth-15/17 capsules in the measured wallet were both 400 sats.
        // They got deep BECAUSE they could never be refreshed alone, so reporting
        // "too deep" would point at the wrong problem.
        expect(decide({ exitDepth: 15, sats: 400 }).reason).toBe('below-refresh-minimum');
    });

    it('will not refresh inside the exit-runway floor, where a hung round eats the exit window', () => {
        expect(decide({ exitDepth: 20, blocksUntilExpiry: MIN_RUNWAY - 1 })).toEqual({
            refresh: false,
            reason: 'too-near-expiry',
        });
    });

    it('treats an unreadable expiry as the worst case rather than skipping the check', () => {
        expect(decide({ exitDepth: 20, blocksUntilExpiry: null }).reason).toBe('unknown-expiry');
        expect(decide({ exitDepth: 20, blocksUntilExpiry: NaN }).reason).toBe('unknown-expiry');
    });

    it('does not re-target a capsule another caller already submitted', () => {
        expect(decide({ exitDepth: 20, alreadyRefreshing: true }).reason).toBe(
            'already-refreshing',
        );
    });

    it('only touches Spendable capsules', () => {
        for (const stateTag of ['Locked', 'Processing', 'Exited', 'Spent']) {
            expect(decide({ exitDepth: 20, stateTag }).reason).toBe('not-spendable');
        }
    });
});

describe('the one-week ceiling deliberately does NOT apply here', () => {
    it('refreshes a deep capsule that is nowhere near expiry', () => {
        // foregroundSweep skips anything more than a week out, because when the
        // trigger is expiry there is no reason to pay early. When the trigger is
        // depth there is: the capsule is expensive to exit for as long as it
        // stays deep.
        expect(decide({ exitDepth: 12, blocksUntilExpiry: 4032 })).toEqual({
            refresh: true,
            reason: 'refresh',
        });
    });
});

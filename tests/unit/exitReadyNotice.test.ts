/**
 * One alarm, at the height the batched claim is already waiting for.
 *
 * The exit drive is foreground-only, so finishing an exit depends on the user
 * opening the app after the right block. On 2026-08-19 a claim landed within
 * one block of ripening purely because someone happened to be awake and
 * holding the phone.
 *
 * The heights below are from the 2026-08-22 mainnet exit, 7 capsules holding
 * 4,990 sats. Leaves confirmed at 963390 (x3), 963455 (x3) and 963508, and
 * every claimableHeight is leaf-confirm plus exactly 144. A per-capsule
 * schedule would fire at 963534, 963599 and 963652; only the last of those is
 * the moment the batch actually sweeps.
 */

import {
    decideExitReadyNotice,
    blocksToFireIn,
    NOTICE_RESCHEDULE_EPSILON_MS,
} from '../../src/services/ark/exitReadyNotice';

const MINUTE = 60 * 1000;
const BLOCK_MS = 10 * MINUTE;
const T0 = 1_700_000_000_000;

/** The three distinct ripening heights of the measured run. */
const EARLY = 963534;
const MID = 963599;
const LAST = 963652;

const decide = (over: Partial<Parameters<typeof decideExitReadyNotice>[0]> = {}) =>
    decideExitReadyNotice({
        claimableCount: 0,
        awaitingHeights: [EARLY, EARLY, EARLY, MID, MID, MID, LAST],
        processingCount: 0,
        tipHeight: 963508,
        now: T0,
        armed: null,
        blockMs: BLOCK_MS,
        ...over,
    });

describe('the trigger is the batch height, not each capsule', () => {
    it('arms for the LAST ripening height across every straggler', () => {
        const d = decide();
        expect(d.action).toBe('arm');
        // Not EARLY, which is where a per-capsule schedule would have fired
        // twice for nothing while decideExitClaimBatch correctly held.
        expect(d.targetHeight).toBe(LAST);
    });

    it('ignores capsules that have already ripened', () => {
        // Three are claimable, three still awaiting. The already-claimable ones
        // cannot extend the wait, so the target is the last of the stragglers.
        const d = decide({ claimableCount: 3, awaitingHeights: [MID, MID, MID] });
        expect(d.action).toBe('arm');
        expect(d.targetHeight).toBe(MID);
    });

    it('discards junk heights rather than treating them as a target', () => {
        const d = decide({ awaitingHeights: [0, -1, Number.NaN, MID] });
        expect(d.targetHeight).toBe(MID);
    });
});

describe('the target is provisional while a leaf is still confirming', () => {
    it('flags provisional when anything is still broadcasting', () => {
        const d = decide({ awaitingHeights: [EARLY, MID], processingCount: 1 });
        expect(d.action).toBe('arm');
        expect(d.provisional).toBe(true);
    });

    it('re-arms when a late leaf pushes the batch out', () => {
        // ec46d966 confirmed last in the measured run and moved the batch from
        // 963599 to 963652. An alarm computed once would have been 53 blocks
        // early, about nine hours.
        const armed = { targetHeight: MID, fireAtMs: T0 + 91 * BLOCK_MS };
        const d = decide({ armed, awaitingHeights: [MID, LAST] });
        expect(d.action).toBe('arm');
        expect(d.reason).toBe('target-moved');
        expect(d.targetHeight).toBe(LAST);
    });

    it('arms nothing while no straggler has a height yet', () => {
        // Every capsule still Processing: there is no schedule to promise.
        const d = decide({ awaitingHeights: [], processingCount: 4 });
        expect(d.action).toBe('cancel');
        expect(d.reason).toBe('no-schedule');
        expect(d.targetHeight).toBeNull();
    });
});

describe('when there is nothing to call the user back for', () => {
    it('cancels once the exit is over', () => {
        const d = decide({ claimableCount: 0, awaitingHeights: [], processingCount: 0 });
        expect(d.action).toBe('cancel');
        expect(d.reason).toBe('no-exit');
    });

    it('cancels when the sweep fires on this very tick', () => {
        // claimable with no stragglers is exactly decideExitClaimBatch's
        // all-ready case, which claims now, with the app open by definition.
        const d = decide({ claimableCount: 3, awaitingHeights: [], processingCount: 0 });
        expect(d.action).toBe('cancel');
        expect(d.reason).toBe('claim-imminent');
    });
});

describe('the date is an estimate, and it is biased late', () => {
    it('prices the wait one standard deviation past the mean', () => {
        // Block arrival is Poisson: N blocks has a standard deviation of
        // sqrt(N) intervals. 144 out is 12 extra blocks, about two hours.
        expect(blocksToFireIn(144)).toBeCloseTo(156, 6);
        expect(blocksToFireIn(4)).toBeCloseTo(6, 6);
        expect(blocksToFireIn(0)).toBe(0);
        expect(blocksToFireIn(-5)).toBe(0);
    });

    it('never fires before the target could physically arrive', () => {
        const d = decide();
        const blocks = LAST - 963508; // 144
        expect(d.fireAtMs).not.toBeNull();
        expect((d.fireAtMs as number) - T0).toBeGreaterThan(blocks * BLOCK_MS);
    });

    it('shrinks the margin as the target approaches', () => {
        const far = decide({ tipHeight: LAST - 144 });
        const near = decide({ tipHeight: LAST - 4 });
        const farMargin = (far.fireAtMs as number) - T0 - 144 * BLOCK_MS;
        const nearMargin = (near.fireAtMs as number) - T0 - 4 * BLOCK_MS;
        expect(nearMargin).toBeLessThan(farMargin);
    });
});

describe('re-arming only when the estimate has actually moved', () => {
    it('leaves the alarm alone when blocks arrive on schedule', () => {
        // One block later and ten minutes on: the absolute date is unchanged,
        // so nothing should be re-armed.
        const first = decide({ tipHeight: 963508 });
        const later = decide({
            tipHeight: 963509,
            now: T0 + BLOCK_MS,
            armed: { targetHeight: LAST, fireAtMs: first.fireAtMs as number },
        });
        expect(later.action).toBe('keep');
        expect(later.reason).toBe('unchanged');
    });

    it('re-arms when the chain has run sustainedly fast', () => {
        const first = decide({ tipHeight: 963508 });
        // Ten blocks in the time one was budgeted for: the date moves ~90 min
        // earlier, well past the epsilon.
        const later = decide({
            tipHeight: 963518,
            now: T0 + BLOCK_MS,
            armed: { targetHeight: LAST, fireAtMs: first.fireAtMs as number },
        });
        expect(later.action).toBe('arm');
        expect(later.reason).toBe('estimate-moved');
        expect((first.fireAtMs as number) - (later.fireAtMs as number))
            .toBeGreaterThanOrEqual(NOTICE_RESCHEDULE_EPSILON_MS);
    });

    it('arms on the first evaluation of a session', () => {
        expect(decide({ armed: null }).reason).toBe('first-arm');
    });
});

describe('refusing to invent a date', () => {
    it('keeps the last good estimate when every chain source failed', () => {
        const armed = { targetHeight: LAST, fireAtMs: T0 + 144 * BLOCK_MS };
        const d = decide({ tipHeight: null, armed });
        expect(d.action).toBe('keep');
        expect(d.reason).toBe('tip-unknown');
        // Crucially not a cancel: no tip is not evidence the exit is over.
        expect(d.fireAtMs).toBe(armed.fireAtMs);
    });

    it('does not push the alarm back out once the tip has crossed', () => {
        // bark has not reported the capsules claimable yet, but the app is
        // plainly open and driving. Re-arming here would delay an alarm that
        // is due about now.
        const armed = { targetHeight: LAST, fireAtMs: T0 + 5 * MINUTE };
        const d = decide({ tipHeight: LAST + 1, armed });
        expect(d.action).toBe('keep');
        expect(d.reason).toBe('already-ripe');
    });
});

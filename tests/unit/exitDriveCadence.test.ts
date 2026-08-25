/**
 * Separating "has anything changed" from "do the work".
 *
 * The 2026-08-22 mainnet exit ran 44 hours, roughly 40 of them waiting on a
 * block height it already knew, at ~20 requests per check because the full
 * drive WAS the unit of polling. Blockstream's cap is 700 requests/hour/IP and
 * it is shared behind CGNAT.
 */

import {
    decideExitDrivePlan,
    EXIT_DRIVE_FAST_MS,
    TIP_POLL_NEAR_MS,
    TIP_POLL_MID_MS,
    TIP_POLL_FAR_MS,
    FULL_DRIVE_FLOOR_MS,
    type ExitDriveSnapshot,
} from '../../src/services/ark/exitDriveCadence';

const NOW = 1_700_000_000_000;
const TIP = 963_500;

const snap = (o: Partial<ExitDriveSnapshot> = {}): ExitDriveSnapshot => ({
    claimableCount: 0,
    awaitingHeights: [],
    processingCount: 0,
    ...o,
});

/** Default the clocks to "long ago" so a decision is never blocked by them. */
const plan = (
    last: ExitDriveSnapshot | null,
    tipHeight: number | null,
    opts: { sinceFull?: number; sinceTip?: number } = {},
) =>
    decideExitDrivePlan({
        last,
        tipHeight,
        now: NOW,
        lastFullRunAt: NOW - (opts.sinceFull ?? EXIT_DRIVE_FAST_MS),
        lastTipPollAt: NOW - (opts.sinceTip ?? TIP_POLL_FAR_MS),
    });

describe('phases that still need the full drive', () => {
    it('drives fully while anything is broadcasting', () => {
        // Each tree level must be relayed before the next can go, so this is
        // the phase that genuinely needs the app.
        const p = plan(snap({ processingCount: 1, awaitingHeights: [963_600] }), TIP);
        expect(p.action).toBe('full');
        expect(p.phase).toBe('broadcasting');
    });

    it('lets broadcasting outrank a capsule that has already ripened', () => {
        const p = plan(snap({ processingCount: 1, claimableCount: 3 }), TIP);
        expect(p.phase).toBe('broadcasting');
        expect(p.action).toBe('full');
    });

    it('drives fully when something is claimable', () => {
        expect(plan(snap({ claimableCount: 1 }), TIP).action).toBe('full');
    });

    it('drives fully with no snapshot, rather than guessing a phase', () => {
        const p = plan(null, TIP);
        expect(p.action).toBe('full');
        expect(p.reason).toBe('no-snapshot');
    });

    it('drives fully when an active exit shows no recognisable schedule', () => {
        expect(plan(snap(), TIP).reason).toBe('no-known-schedule');
    });
});

describe('the waiting phase polls the tip instead of driving', () => {
    const waiting = snap({ awaitingHeights: [963_600] });

    it('asks for a tip poll, not a full drive', () => {
        const p = plan(waiting, TIP);
        expect(p.action).toBe('tip');
        expect(p.phase).toBe('waiting');
        expect(p.blocksToNext).toBe(100);
    });

    it('paces the poll by blocks remaining, which a live tip finally allows', () => {
        expect(plan(waiting, 963_500).waitMs).toBe(TIP_POLL_FAR_MS);   // 100 blocks
        expect(plan(waiting, 963_585).waitMs).toBe(TIP_POLL_MID_MS);   // 15
        expect(plan(waiting, 963_597).waitMs).toBe(TIP_POLL_NEAR_MS);  // 3
    });

    it('paces off the SOONEST height, since that is the next thing that can change', () => {
        const many = snap({ awaitingHeights: [963_652, 963_505, 963_599] });
        expect(plan(many, TIP).blocksToNext).toBe(5);
        expect(plan(many, TIP).waitMs).toBe(TIP_POLL_NEAR_MS);
    });

    it('skips entirely between polls', () => {
        expect(plan(waiting, TIP, { sinceTip: TIP_POLL_FAR_MS - 1 }).action).toBe('skip');
        expect(plan(waiting, TIP, { sinceTip: TIP_POLL_FAR_MS }).action).toBe('tip');
    });
});

describe('what promotes a poll back to a full drive', () => {
    const waiting = snap({ awaitingHeights: [963_600] });

    it('the tip crossing the soonest ripening height', () => {
        const p = plan(waiting, 963_600);
        expect(p.action).toBe('full');
        expect(p.reason).toBe('tip-crossed');
    });

    it('a tip past the height, not merely equal to it', () => {
        expect(plan(waiting, 963_999).action).toBe('full');
    });

    it('the reorg floor, however quiet the chain has been', () => {
        // bark drops a reorged exit back to Processing on progressExits, which
        // a tip-only poll never calls. This bounds how long that goes unseen.
        const p = plan(waiting, TIP, { sinceFull: FULL_DRIVE_FLOOR_MS });
        expect(p.action).toBe('full');
        expect(p.reason).toBe('reorg-floor');
    });

    it('but not one minute before the floor', () => {
        expect(plan(waiting, TIP, { sinceFull: FULL_DRIVE_FLOOR_MS - 60_000 }).action).toBe('tip');
    });
});

describe('what it refuses to do', () => {
    const waiting = snap({ awaitingHeights: [963_600] });

    it('does not guess a cadence from a tip it does not have', () => {
        const p = plan(waiting, null);
        expect(p.reason).toBe('tip-unknown');
        expect(p.blocksToNext).toBeNull();
        // Falls back to the TIGHTEST poll rather than the loosest: an unreadable
        // tip is a reason to look again sooner, not later.
        expect(p.waitMs).toBe(TIP_POLL_NEAR_MS);
    });

    it('never starves the full drive when the tip is permanently unreadable', () => {
        // Offline for hours: the floor still forces a real drive.
        const p = plan(waiting, null, { sinceFull: FULL_DRIVE_FLOOR_MS });
        expect(p.action).toBe('full');
        expect(p.reason).toBe('reorg-floor');
    });

    it('does not fire a full drive more often than the fast cadence', () => {
        expect(plan(snap({ claimableCount: 1 }), TIP, { sinceFull: EXIT_DRIVE_FAST_MS - 1 }).action)
            .toBe('skip');
    });

    it('ignores malformed heights rather than pacing off them', () => {
        const junk = snap({ awaitingHeights: [0, -1, NaN, 963_600] });
        expect(plan(junk, TIP).blocksToNext).toBe(100);
    });
});

describe('the request budget this exists to cut', () => {
    it('spends one poll where the old design spent a full drive', () => {
        // A 24h wait is ~144 blocks. Far out the poll is 10 minutes, so the
        // waiting phase costs ~1 request per poll instead of ~20 per drive.
        const p = plan(snap({ awaitingHeights: [963_500 + 144] }), TIP);
        expect(p.action).toBe('tip');
        expect(p.waitMs).toBe(TIP_POLL_FAR_MS);
    });

    it('tightens to two minutes at the end, so the claim is not 30 minutes late', () => {
        // The shipped flat-30-minute version could not do this: with no live
        // tip, blocks-remaining was a constant and never tapered.
        const p = plan(snap({ awaitingHeights: [963_502] }), TIP);
        expect(p.waitMs).toBe(TIP_POLL_NEAR_MS);
        expect(p.blocksToNext).toBe(2);
    });
});

/**
 * Backing off the exit drive when it has nothing to do.
 *
 * The 2026-08-22 mainnet exit ran 44 hours, roughly 40 of them in AwaitingDelta
 * with nothing to broadcast, at a flat 120s cadence. Blockstream's cap is 700
 * requests/hour/IP and it is shared behind CGNAT. On 2026-08-24 it was hit and
 * the wallet would not open at all.
 *
 * The waiting interval is deliberately FLAT rather than tapering toward
 * ripening: no live chain tip is available during an exit without spending a
 * request, so a taper would compute a constant and never fire. See the module
 * docblock.
 */

import {
    decideExitDriveCadence,
    EXIT_DRIVE_FAST_MS,
    EXIT_DRIVE_WAITING_MS,
    type ExitDriveSnapshot,
} from '../../src/services/ark/exitDriveCadence';

const NOW = 1_700_000_000_000;
const snap = (o: Partial<ExitDriveSnapshot> = {}): ExitDriveSnapshot => ({
    claimableCount: 0,
    awaitingCount: 0,
    processingCount: 0,
    ...o,
});
const decide = (last: ExitDriveSnapshot | null, sinceMs: number) =>
    decideExitDriveCadence({ last, now: NOW, lastRunAt: NOW - sinceMs });

describe('phases that must stay fast', () => {
    it('keeps the fast cadence while anything is still broadcasting', () => {
        // Racing expiry, and each tree level needs the app to relay the next.
        const d = decide(snap({ processingCount: 1, awaitingCount: 3 }), 0);
        expect(d.phase).toBe('broadcasting');
        expect(d.waitMs).toBe(EXIT_DRIVE_FAST_MS);
    });

    it('fires promptly once something is claimable', () => {
        const d = decide(snap({ claimableCount: 1 }), EXIT_DRIVE_FAST_MS);
        expect(d.phase).toBe('claimable');
        expect(d.run).toBe(true);
    });

    it('holds the claimable phase to its own interval, not longer', () => {
        expect(decide(snap({ claimableCount: 1 }), EXIT_DRIVE_FAST_MS - 1).run).toBe(false);
    });

    it('broadcasting outranks claimable, since a straggler still needs relaying', () => {
        expect(decide(snap({ processingCount: 1, claimableCount: 3 }), 0).phase)
            .toBe('broadcasting');
    });
});

describe('backing off while every capsule waits out its CSV', () => {
    it('waits half an hour when every capsule is confirmed and waiting', () => {
        const d = decide(snap({ awaitingCount: 3 }), 0);
        expect(d.phase).toBe('waiting');
        expect(d.waitMs).toBe(EXIT_DRIVE_WAITING_MS);
        expect(d.run).toBe(false);
    });

    it('still runs once the backed-off interval has elapsed', () => {
        const waiting = snap({ awaitingCount: 3 });
        expect(decide(waiting, EXIT_DRIVE_WAITING_MS - 1).run).toBe(false);
        expect(decide(waiting, EXIT_DRIVE_WAITING_MS).run).toBe(true);
    });

    it('does not back off on a single waiting capsule any differently', () => {
        // Count is not a cadence input: one capsule mid-CSV is as idle as five.
        expect(decide(snap({ awaitingCount: 1 }), 0).waitMs).toBe(EXIT_DRIVE_WAITING_MS);
    });
});

describe('what it refuses to back off on', () => {
    it('runs when there is no snapshot yet, rather than guessing a phase', () => {
        const d = decide(null, 0);
        expect(d.run).toBe(true);
        expect(d.phase).toBe('unknown');
    });

    it('keeps the fast cadence when no capsule is in any known phase', () => {
        // Erring toward more requests is wrong for this issue and right for not
        // stalling an exit. A stalled exit costs the user far more than a quota.
        const d = decide(snap(), 0);
        expect(d.phase).toBe('unknown');
        expect(d.waitMs).toBe(EXIT_DRIVE_FAST_MS);
    });

    it('returns to the fast cadence as soon as a waiting capsule ripens', () => {
        // The transition that ends the backed-off phase: the drive that
        // observes a claimable capsule writes a snapshot the next one reads.
        expect(decide(snap({ awaitingCount: 3 }), 0).waitMs).toBe(EXIT_DRIVE_WAITING_MS);
        expect(decide(snap({ awaitingCount: 2, claimableCount: 1 }), 0).waitMs)
            .toBe(EXIT_DRIVE_FAST_MS);
    });
});

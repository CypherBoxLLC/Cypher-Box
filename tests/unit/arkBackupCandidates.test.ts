/**
 * Choosing between several backup files for one seed.
 *
 * Numbers below are the real ones from the 2026-09-21 incident, where one
 * wallet ran on two devices. The complete backup, with the wallet's full
 * payment history, was 476.7 KB. The one written minutes after a seed-only
 * restore, with zero movements, was 526.5 KB and newer. So the incomplete file
 * was both bigger and newer than the complete one, and any ranking that leans
 * on size or recency alone would confidently pick the wrong file.
 */

import {
    pickBestBackupCandidate,
    rankBackupCandidates,
    type BackupCandidate,
} from '../../src/services/ark/backupCandidates';

const FP = 'd8f74ce1';

function candidate(
    name: string,
    opts: { v?: number; instance?: string; at?: number } = {},
): BackupCandidate<string> {
    return {
        name,
        header: {
            v: opts.v ?? 3,
            fingerprint: FP,
            ...(opts.instance ? { instance: opts.instance } : {}),
            ...(opts.at !== undefined ? { backupCreatedAt: opts.at } : {}),
        },
        payload: name,
    };
}

describe('rankBackupCandidates', () => {
    it('returns null when there is nothing to choose from', () => {
        expect(pickBestBackupCandidate([])).toBeNull();
    });

    it('prefers a file with an identified writer over one without', () => {
        // The v2 file is NEWER, and still loses: a file from a build that
        // could not have clobbered anyone is the safer starting point.
        const withWriter = candidate('a', { instance: '1111aaaa', at: 1000 });
        const withoutWriter = candidate('b', { v: 2, at: 9999 });
        expect(pickBestBackupCandidate([withoutWriter, withWriter])?.name).toBe('a');
    });

    it('uses recency only to break ties between comparable files', () => {
        const older = candidate('older', { instance: '1111aaaa', at: 1000 });
        const newer = candidate('newer', { instance: '2222bbbb', at: 2000 });
        expect(pickBestBackupCandidate([older, newer])?.name).toBe('newer');
    });

    it('treats a missing timestamp as the oldest', () => {
        const stamped = candidate('stamped', { instance: '1111aaaa', at: 1 });
        const unstamped = candidate('unstamped', { instance: '2222bbbb' });
        expect(pickBestBackupCandidate([unstamped, stamped])?.name).toBe('stamped');
    });

    it('is stable for candidates that rank equally', () => {
        const a = candidate('a', { instance: '1111aaaa', at: 500 });
        const b = candidate('b', { instance: '2222bbbb', at: 500 });
        expect(rankBackupCandidates([a, b]).map((c) => c.name)).toEqual(['a', 'b']);
        expect(rankBackupCandidates([b, a]).map((c) => c.name)).toEqual(['b', 'a']);
    });

    it('does not read file size as completeness', () => {
        // Both are v3 with writers, so only the timestamp separates them. The
        // ranking has no access to size at all, which is the point: in the
        // incident the bigger file was the emptier one.
        const complete = candidate('complete-476kb', { instance: '1111aaaa', at: 5000 });
        const incomplete = candidate('incomplete-526kb', { instance: '2222bbbb', at: 5000 });
        const ranked = rankBackupCandidates([complete, incomplete]);
        expect(ranked).toHaveLength(2);
        expect(ranked[0].name).toBe('complete-476kb'); // stable, not size-based
    });

    it('ranks every candidate rather than dropping any', () => {
        const all = [
            candidate('v2', { v: 2, at: 3 }),
            candidate('new', { instance: '1111aaaa', at: 2 }),
            candidate('old', { instance: '2222bbbb', at: 1 }),
        ];
        expect(rankBackupCandidates(all).map((c) => c.name)).toEqual(['new', 'old', 'v2']);
    });
});

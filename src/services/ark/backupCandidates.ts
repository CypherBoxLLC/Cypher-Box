/**
 * Choosing between several backup files for one seed.
 *
 * Before backups were named per device, a seed had at most one file per
 * destination, so "find the match" and "find the best match" were the same
 * question and every lookup returned the first header whose fingerprint
 * matched. Now that each device writes its own file, one seed can legitimately
 * have several, and the first one enumerated is not necessarily the one to
 * restore from.
 *
 * What does NOT work as a completeness signal
 * -------------------------------------------
 * From the 2026-09-21 incident, where one wallet ran on two devices:
 *
 *   - The COMPLETE backup, carrying the wallet's full payment history, was
 *     476.7 KB.
 *   - The INCOMPLETE one, written minutes after a seed-only restore with zero
 *     movements, was 526.5 KB and NEWER.
 *
 * So bigger is not more complete, and newer is not more complete. Ranking on
 * either of those alone would have confidently picked the wrong file. Size is
 * not used here at all, and recency is only ever a tiebreaker.
 *
 * What this ranking is for
 * ------------------------
 * Ordering candidates sensibly, not inferring which one holds more money.
 * A file with an identified writer sorts above one without, because it is from
 * a build that cannot have clobbered anyone, and then recency breaks ties.
 *
 * The properly discriminating signal is provenance: whether the wallet instance
 * that wrote a file came from a seed-only restore. That is not recorded yet, so
 * it is not used here. It matters less than it first appears: with per-device
 * filenames a freshly restored device has not written a file of its own at the
 * moment it restores, so the only candidate it can see is another device's,
 * which is the one it should have.
 */

export type BackupCandidateHeader = {
    v: number;
    fingerprint?: string;
    instance?: string;
    backupCreatedAt?: number;
};

export type BackupCandidate<T = unknown> = {
    /** Filename or Drive entry name, for logging and for a future picker. */
    name: string;
    header: BackupCandidateHeader;
    /** Whatever the caller needs back: a blob, an id, a path. */
    payload: T;
};

/**
 * Sort candidates best-first. Stable for equal candidates, so a caller
 * enumerating in a deterministic order gets a deterministic result.
 *
 *   1. Has an identified writer (v3 `instance`) before one that does not.
 *   2. Newer `backupCreatedAt` before older. Missing counts as oldest.
 *
 * Deliberately NOT considered: file size (see the header comment) and
 * filesystem mtime, which cloud sync rewrites on download.
 */
export function rankBackupCandidates<T>(
    candidates: readonly BackupCandidate<T>[],
): BackupCandidate<T>[] {
    return [...candidates]
        .map((c, i) => ({ c, i }))
        .sort((a, b) => {
            const aWriter = a.c.header.instance ? 1 : 0;
            const bWriter = b.c.header.instance ? 1 : 0;
            if (aWriter !== bWriter) return bWriter - aWriter;

            const aAt = a.c.header.backupCreatedAt ?? 0;
            const bAt = b.c.header.backupCreatedAt ?? 0;
            if (aAt !== bAt) return bAt - aAt;

            return a.i - b.i; // stable
        })
        .map(({ c }) => c);
}

/** The one to use, or null when there are no candidates. */
export function pickBestBackupCandidate<T>(
    candidates: readonly BackupCandidate<T>[],
): BackupCandidate<T> | null {
    return rankBackupCandidates(candidates)[0] ?? null;
}

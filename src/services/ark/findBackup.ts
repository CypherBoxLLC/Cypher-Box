import { Platform } from 'react-native';

import {
    pickBestBackupCandidate,
    type BackupCandidate,
} from './backupCandidates';

import RNFS from 'react-native-fs';

import {
    getICloudBackupPath,
    peekBackupHeader,
} from './backup';
import {
    downloadArkBackupFromDrive,
    findDriveBackupByFingerprint,
    isGoogleDriveConnected,
} from './googleDrive';
import {
    findSafBackupByFingerprint,
    getSavedSafBackupFolder,
    readArkBackupFromSaf,
} from './safFolderBackup';

/**
 * Channel-by-channel scan-and-match helpers for the Ark recovery flow.
 *
 * WHY THIS EXISTS:
 * Recovery is "given a mnemonic, find the matching .cbark across every
 * destination this device knows about and decrypt it." The matching step
 * is the same shape per destination (peek header → fingerprint match →
 * fall back to legacy v1 read), but the IO primitives differ — local
 * Documents uses RNFS, Drive uses an OAuth-scoped REST list, SAF uses a
 * native bridge. Each `lookupArkBackupInX` here encapsulates the
 * destination-specific IO and returns a uniform `ChannelLookupResult`,
 * so the UI can iterate channels with `if (found) restore(); else next`.
 *
 * MATCH ORDER PER CHANNEL:
 *   1. Scan path — list every `.cbark` at the destination, peek each
 *      header, collect every blob whose `header.fingerprint` matches and
 *      return the best one (./backupCandidates ranks them). Catches files
 *      the user manually renamed (downloaded + re-uploaded from a
 *      different device, organised their Drive folder, etc.).
 *      Rename-tolerance is criterion 3 of the multi-wallet PR.
 *
 *      There is deliberately no fast path by name in front of the scan
 *      any more. One used to read `ark-backup-{fp}.cbark` first and
 *      return it. Since each device writes `ark-backup-{fp}-{instance}
 *      .cbark`, that fingerprint-only name is a file from before the
 *      upgrade that no build writes, so the fast path restored a
 *      snapshot frozen at the upgrade and the per-device files were never
 *      looked at. The scan still reads that file, as one candidate.
 *   2. Legacy path — single shared `ark-backup.cbark` (v1) or
 *      `cypher-box-ark-backup.cbark` (v0). No header fingerprint, so
 *      callers must try-decrypt with the entered seed; on success the
 *      next auto-backup tick rewrites it under the per-wallet name and
 *      the orphaned legacy file gets cleaned up by Slice 4.
 *
 * RESULT VARIANTS:
 *   - `matched`              v2 or v3 file with header.fingerprint === target.
 *                            Definitive: `restoreArkBackupBlob(blob, m)`
 *                            will succeed.
 *   - `legacy-v1-candidate`  v1/v0 file, no fingerprint header. May or
 *                            may not match the entered seed; caller
 *                            try-decrypts.
 *   - `not-found`            scan ran, nothing matched, no legacy file
 *                            present. UI surfaces "no backup matches
 *                            this seed phrase."
 *
 * NEVER THROWS for missing files / disconnected channels — those are
 * `not-found`. Throws only on hard IO errors the UI should show as
 * "couldn't reach <channel>" (Drive auth declined, SAF permission
 * revoked, etc.).
 */
export type ChannelLookupResult =
    | { kind: 'matched'; blob: string }
    | { kind: 'legacy-v1-candidate'; blob: string }
    | { kind: 'not-found' };

// ---------------------------------------------------------------------------
// Local Documents (works on both iOS and Android — on iOS this is also the
// folder Apple's iCloud Drive sync mirrors transparently)
// ---------------------------------------------------------------------------

/**
 * Scan the app's Documents directory for an Ark backup matching
 * `fingerprint`. Order: directory scan with header-match and ranking,
 * then legacy v1 fallback at the original `ark-backup.cbark` path.
 */
export async function lookupArkBackupInLocalDocuments(
    fingerprint: string,
): Promise<ChannelLookupResult> {
    // Step 0 (iOS only): check the iCloud Documents container first.
    // When iCloud Drive is on for Cypher Box, writes go directly into the
    // ubiquity container via getActiveAutoBackupPath. Recovery needs to
    // find them there before falling through to local sandbox — otherwise
    // a user who created a wallet with iCloud on and is now restoring on
    // a fresh install (where the sandbox is empty) would see "no backup
    // matches" even though their backup is sitting in iCloud Drive.
    if (Platform.OS === 'ios') {
        const iCloudResult = await scanICloudContainerForBackup(fingerprint);
        if (iCloudResult.kind !== 'not-found') return iCloudResult;
    }

    // Step 1: scan every `.cbark` in Documents, peek headers, collect ALL
    // matches and rank them. No fast path by name first: see the header
    // comment for why the fingerprint-only name must not win by default.
    //
    // This used to return the first fingerprint match it found. That was
    // correct while one seed had at most one file per destination. Now that
    // each device writes its own `ark-backup-<fp>-<instance>.cbark`, one seed
    // can legitimately have several here, and enumeration order is not a
    // preference. See ./backupCandidates for the ranking and, importantly,
    // for which signals do NOT indicate a more complete backup.
    try {
        const entries = await RNFS.readDir(RNFS.DocumentDirectoryPath);
        const candidates: BackupCandidate<string>[] = [];
        for (const e of entries) {
            if (!e.isFile() || !e.name.toLowerCase().endsWith('.cbark')) continue;
            // Skip the legacy v1 path here — handled below as a typed candidate.
            if (e.name === 'ark-backup.cbark' || e.name === 'cypher-box-ark-backup.cbark') {
                continue;
            }
            let blob: string;
            try {
                blob = await RNFS.readFile(e.path, 'utf8');
            } catch (err) {
                if (__DEV__) console.log(`[Ark/find-local] read "${e.name}" failed; skipping:`, err);
                continue;
            }
            const header = peekBackupHeader(blob);
            if (!header) {
                if (__DEV__) console.log(`[Ark/find-local] skipping malformed envelope at "${e.name}"`);
                continue;
            }
            if (header.fingerprint === fingerprint) {
                candidates.push({ name: e.name, header, payload: blob });
            }
        }
        const best = pickBestBackupCandidate(candidates);
        if (best) {
            if (__DEV__ && candidates.length > 1) {
                console.log(
                    `[Ark/find-local] ${candidates.length} backups match this seed;`,
                    'using', best.name,
                );
            }
            return { kind: 'matched', blob: best.payload };
        }
    } catch (err) {
        if (__DEV__) console.log('[Ark/find-local] readDir failed:', err);
    }

    // Step 2: legacy v1 / v0 fallback. Single file at the historical path.
    for (const legacyName of ['ark-backup.cbark', 'cypher-box-ark-backup.cbark']) {
        const legacyPath = `${RNFS.DocumentDirectoryPath}/${legacyName}`;
        try {
            if (await RNFS.exists(legacyPath)) {
                const blob = await RNFS.readFile(legacyPath, 'utf8');
                const header = peekBackupHeader(blob);
                // If a v1 / v0 file has a fingerprint header (someone running
                // multiple devices with the same seed wrote a v2 to the legacy
                // filename — unlikely but possible) and it matches, surface
                // as a definitive match rather than a try-decrypt candidate.
                if (header?.fingerprint === fingerprint) {
                    return { kind: 'matched', blob };
                }
                if (header) {
                    return { kind: 'legacy-v1-candidate', blob };
                }
            }
        } catch (err) {
            if (__DEV__) console.log(`[Ark/find-local] legacy read "${legacyName}" failed:`, err);
        }
    }

    return { kind: 'not-found' };
}

/**
 * iOS iCloud Documents container scan. Same shape as the local-sandbox
 * scan in `lookupArkBackupInLocalDocuments` — directory enumeration with
 * header match and ranking, then legacy v1 / v0 fallback — but rooted at
 * the ubiquity container instead of RNFS.DocumentDirectoryPath. Returns
 * `not-found` if iCloud Drive is not reachable for Cypher Box, so callers
 * cleanly fall through to the local sandbox scan.
 */
async function scanICloudContainerForBackup(
    fingerprint: string,
): Promise<ChannelLookupResult> {
    // Derive the iCloud Documents container directory by stripping the
    // filename from the legacy-name iCloud path. If that probe returns
    // null, iCloud Drive isn't reachable — bail out cleanly.
    let containerDir: string | null = null;
    try {
        const sampleICloudPath = await getICloudBackupPath();
        if (sampleICloudPath) {
            const lastSlash = sampleICloudPath.lastIndexOf('/');
            if (lastSlash > 0) containerDir = sampleICloudPath.substring(0, lastSlash);
        }
    } catch (err) {
        if (__DEV__) console.log('[Ark/find-icloud] container path resolve failed:', err);
    }
    if (!containerDir) return { kind: 'not-found' };

    // Scan path: every `.cbark` in the iCloud container, peek headers,
    // match by fingerprint. Catches files the user might have renamed
    // or copied in from another device via iCloud Drive.
    try {
        const entries = await RNFS.readDir(containerDir);
        const candidates: BackupCandidate<string>[] = [];
        for (const e of entries) {
            if (!e.isFile() || !e.name.toLowerCase().endsWith('.cbark')) continue;
            if (e.name === 'ark-backup.cbark' || e.name === 'cypher-box-ark-backup.cbark') {
                continue;
            }
            let blob: string;
            try {
                blob = await RNFS.readFile(e.path, 'utf8');
            } catch (err) {
                if (__DEV__) console.log(`[Ark/find-icloud] read "${e.name}" failed; skipping:`, err);
                continue;
            }
            const header = peekBackupHeader(blob);
            if (!header) continue;
            if (header.fingerprint === fingerprint) {
                candidates.push({ name: e.name, header, payload: blob });
            }
        }
        // The iCloud container is where two iPhones on one Apple ID actually
        // meet, so this is the scan most likely to see more than one file for
        // a seed once per-device names are in the wild.
        const best = pickBestBackupCandidate(candidates);
        if (best) {
            if (__DEV__ && candidates.length > 1) {
                console.log(
                    `[Ark/find-icloud] ${candidates.length} backups match this seed;`,
                    'using', best.name,
                );
            }
            return { kind: 'matched', blob: best.payload };
        }
    } catch (err) {
        if (__DEV__) console.log('[Ark/find-icloud] readDir failed:', err);
    }

    // Legacy v1 / v0 fallback inside the iCloud container.
    for (const legacyName of ['ark-backup.cbark', 'cypher-box-ark-backup.cbark']) {
        const legacyPath = `${containerDir}/${legacyName}`;
        try {
            if (await RNFS.exists(legacyPath)) {
                const blob = await RNFS.readFile(legacyPath, 'utf8');
                const header = peekBackupHeader(blob);
                if (header?.fingerprint === fingerprint) {
                    return { kind: 'matched', blob };
                }
                if (header) {
                    return { kind: 'legacy-v1-candidate', blob };
                }
            }
        } catch (err) {
            if (__DEV__) console.log(`[Ark/find-icloud] legacy read "${legacyName}" failed:`, err);
        }
    }

    return { kind: 'not-found' };
}

// ---------------------------------------------------------------------------
// Google Drive (Android only)
// ---------------------------------------------------------------------------

/**
 * Scan the user's Drive appDataFolder for an Ark backup matching
 * `fingerprint`. Skips silently on iOS or when Drive isn't connected
 * (caller treats as "no Drive candidate"). Throws on auth / network /
 * quota failures so the UI can show actionable copy.
 */
export async function lookupArkBackupOnDrive(
    fingerprint: string,
): Promise<ChannelLookupResult> {
    if (Platform.OS !== 'android') return { kind: 'not-found' };
    let connected = false;
    try {
        connected = await isGoogleDriveConnected();
    } catch {
        // Sign-in lib hiccup → treat as not connected so the UI can prompt
        // a re-connect rather than throwing here.
    }
    if (!connected) return { kind: 'not-found' };

    // Step 1: scan path — list all .cbark in appDataFolder, header match,
    // ranked. A list failure (auth, network, quota) throws so the UI can
    // render the "Drive failed" path with classification.
    const matched = await findDriveBackupByFingerprint(fingerprint);
    if (matched) {
        return { kind: 'matched', blob: matched };
    }

    // Step 2: legacy v1 / v0 fallback.
    const legacy = await downloadArkBackupFromDrive();
    if (legacy) {
        const header = peekBackupHeader(legacy);
        if (header?.fingerprint === fingerprint) {
            return { kind: 'matched', blob: legacy };
        }
        if (header) {
            return { kind: 'legacy-v1-candidate', blob: legacy };
        }
    }

    return { kind: 'not-found' };
}

// ---------------------------------------------------------------------------
// SAF (user-chosen Android folder)
// ---------------------------------------------------------------------------

/**
 * Scan the user's chosen SAF folder for an Ark backup matching
 * `fingerprint`. Skips silently on iOS or when no folder URI is saved.
 * Native bridge errors propagate so the UI can render permission /
 * unreachable copy.
 */
export async function lookupArkBackupInSafFolder(
    fingerprint: string,
): Promise<ChannelLookupResult> {
    if (Platform.OS !== 'android') return { kind: 'not-found' };
    const saved = await getSavedSafBackupFolder();
    if (!saved) return { kind: 'not-found' };

    // Step 1: scan all .cbark in folder, header match, ranked.
    try {
        const matched = await findSafBackupByFingerprint(fingerprint);
        if (matched) {
            return { kind: 'matched', blob: matched };
        }
    } catch (err) {
        if (__DEV__) console.log('[Ark/find-saf] scan failed:', err);
    }

    // Step 2: legacy v1 fallback.
    try {
        const legacy = await readArkBackupFromSaf();
        if (legacy) {
            const header = peekBackupHeader(legacy);
            if (header?.fingerprint === fingerprint) {
                return { kind: 'matched', blob: legacy };
            }
            if (header) {
                return { kind: 'legacy-v1-candidate', blob: legacy };
            }
        }
    } catch (err) {
        if (__DEV__) console.log('[Ark/find-saf] legacy read failed:', err);
    }

    return { kind: 'not-found' };
}

/**
 * Match an arbitrary blob (e.g. one the user picked via DocumentPicker)
 * against the entered seed's fingerprint. Returns the same shape as the
 * channel lookup helpers so the UI can render the picked file with the
 * same logic.
 */
export function classifyPickedBackupBlob(
    blob: string,
    fingerprint: string,
): ChannelLookupResult {
    const header = peekBackupHeader(blob);
    if (!header) return { kind: 'not-found' };
    if (header.fingerprint === fingerprint) {
        return { kind: 'matched', blob };
    }
    if (!header.fingerprint) {
        // v1 / v0 file — no fingerprint to compare; let the caller
        // try-decrypt with the entered seed.
        return { kind: 'legacy-v1-candidate', blob };
    }
    // v2 file but the fingerprint disagrees — definitively a different
    // wallet's backup. Surfaced as not-found so the UI shows the
    // "no backup matches this seed phrase" branch rather than
    // try-decrypt-and-fail.
    return { kind: 'not-found' };
}

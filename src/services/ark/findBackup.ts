import { Platform } from 'react-native';

import RNFS from 'react-native-fs';

import { getICloudDocumentsDir, peekBackupHeader } from './backup';
import {
    downloadArkBackupFromDrive,
    downloadDriveBackupByFingerprint,
    findDriveBackupByFingerprint,
    isGoogleDriveConnected,
} from './googleDrive';
import {
    findSafBackupByFingerprint,
    getSavedSafBackupFolder,
    readArkBackupFromSaf,
    readSafBackupByFingerprint,
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
 *   1. Fast path — read the file at the per-wallet name (`ark-backup-
 *      {fp}.cbark`). The owner of this seed wrote that exact filename;
 *      if it's there and the header matches, we're done in one IO call.
 *   2. Scan path — list every `.cbark` at the destination, peek each
 *      header, return the blob whose `header.fingerprint` matches.
 *      Catches files the user manually renamed (downloaded + re-uploaded
 *      from a different device, organised their Drive folder, etc.).
 *      Rename-tolerance is criterion 3 of the multi-wallet PR.
 *   3. Legacy path — single shared `ark-backup.cbark` (v1) or
 *      `cypher-box-ark-backup.cbark` (v0). No header fingerprint, so
 *      callers must try-decrypt with the entered seed; on success the
 *      next auto-backup tick rewrites it under the per-wallet name and
 *      the orphaned legacy file gets cleaned up by Slice 4.
 *
 * RESULT VARIANTS:
 *   - `matched`              v2 file with header.fingerprint === target.
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
// Local + iCloud Documents
//
// On Android: just the app's local Documents directory. The off-device
// rail is Drive (handled separately by `lookupArkBackupOnDrive`).
//
// On iOS: BOTH the app's local Documents AND the iCloud Drive ubiquity
// container's Documents subdir, when iCloud is provisioned for Cypher
// Box. The iCloud scan is essential for cross-device recovery — a
// fresh install on a new iPhone signed into the same Apple ID won't
// have any local files yet, but iCloud will have synced the backups
// down from the previous device. Without scanning iCloud here, those
// users hit "no backup matches this seed phrase" despite having the
// file visible in Files → iCloud Drive → Cypher Box.
// ---------------------------------------------------------------------------

const LEGACY_FILENAMES = ['ark-backup.cbark', 'cypher-box-ark-backup.cbark'];

/**
 * iOS placeholder filenames: when a file is in iCloud but not yet
 * downloaded to this device, `NSFileManager` surfaces it as
 * `.{name}.icloud` — a dot-prefixed stub with `.icloud` extension. We
 * skip those during the scan because RNFS.readFile against a
 * placeholder either blocks for an unpredictable time or fails outright
 * depending on network state.
 *
 * Cross-device recovery on a fresh-install device with placeholder
 * files is therefore best-effort in this slice: the user can open Files
 * → iCloud Drive → Cypher Box and tap each `.cbark` to force download,
 * then re-run recovery. A future native hook around
 * `startDownloadingUbiquitousItemAtURL:` could trigger the pull from
 * here and re-scan after a short wait.
 */
function isICloudPlaceholder(name: string): boolean {
    return name.startsWith('.') && name.toLowerCase().endsWith('.icloud');
}

/**
 * Scan the device's Documents directories for an Ark backup matching
 * `fingerprint`. On iOS this covers both the app-local Documents path
 * and the iCloud Drive ubiquity container; on Android, just the local
 * Documents path.
 *
 * Order per directory:
 *   1. Fast path — read the file at the per-wallet name
 *      (`ark-backup-{fp}.cbark`). Owner of this seed wrote that exact
 *      filename; one IO call if present.
 *   2. Scan path — list every `.cbark`, peek headers, return on
 *      fingerprint match. Catches renamed files.
 *   3. Legacy path — single shared `ark-backup.cbark` (v1) /
 *      `cypher-box-ark-backup.cbark` (v0). Returns as
 *      `legacy-v1-candidate` for the caller to try-decrypt.
 *
 * Each step runs against every directory in turn before falling
 * through to the next step — fast path beats scan path even when the
 * fast path is in iCloud and the scan path would hit local Documents.
 */
export async function lookupArkBackupInLocalDocuments(
    fingerprint: string,
): Promise<ChannelLookupResult> {
    // Build the directory list. iCloud is appended on iOS only when
    // the bridge resolves it — null means iCloud is off / unprovisioned
    // and we silently scan local-only.
    const dirs: string[] = [RNFS.DocumentDirectoryPath];
    if (Platform.OS === 'ios') {
        const iCloudDocs = await getICloudDocumentsDir();
        if (iCloudDocs) dirs.push(iCloudDocs);
    }

    // Step 1: fast path — exact per-wallet filename in each directory.
    const perWalletFilename = `ark-backup-${fingerprint}.cbark`;
    for (const dir of dirs) {
        const perWalletPath = `${dir}/${perWalletFilename}`;
        try {
            if (await RNFS.exists(perWalletPath)) {
                const blob = await RNFS.readFile(perWalletPath, 'utf8');
                const header = peekBackupHeader(blob);
                if (header?.fingerprint === fingerprint) {
                    return { kind: 'matched', blob };
                }
                // File present but header doesn't match — fall through to scan.
            }
        } catch (err) {
            if (__DEV__) console.log(`[Ark/find-local] fast-path read "${dir}" failed:`, err);
        }
    }

    // Step 2: scan every `.cbark` in each directory, peek headers.
    for (const dir of dirs) {
        try {
            const entries = await RNFS.readDir(dir);
            for (const e of entries) {
                if (!e.isFile()) continue;
                if (isICloudPlaceholder(e.name)) continue;
                if (!e.name.toLowerCase().endsWith('.cbark')) continue;
                // Skip legacy paths here — handled below as typed candidates.
                if (LEGACY_FILENAMES.includes(e.name)) continue;
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
                    return { kind: 'matched', blob };
                }
            }
        } catch (err) {
            if (__DEV__) console.log(`[Ark/find-local] readDir "${dir}" failed:`, err);
        }
    }

    // Step 3: legacy v1 / v0 fallback. Single file at the historical
    // name in each directory. We prefer the FIRST match found (local
    // before iCloud) because callers try-decrypt either way; if local
    // is stale-but-correct, the caller succeeds and the next
    // auto-backup tick rewrites it under the per-wallet name.
    for (const dir of dirs) {
        for (const legacyName of LEGACY_FILENAMES) {
            const legacyPath = `${dir}/${legacyName}`;
            try {
                if (await RNFS.exists(legacyPath)) {
                    const blob = await RNFS.readFile(legacyPath, 'utf8');
                    const header = peekBackupHeader(blob);
                    // A v1 / v0 file with a fingerprint header (someone running
                    // multiple devices with the same seed wrote a v2 under the
                    // legacy filename — unlikely but possible) gets surfaced as
                    // a definitive match rather than a try-decrypt candidate.
                    if (header?.fingerprint === fingerprint) {
                        return { kind: 'matched', blob };
                    }
                    if (header) {
                        return { kind: 'legacy-v1-candidate', blob };
                    }
                }
            } catch (err) {
                if (__DEV__) console.log(`[Ark/find-local] legacy read "${legacyPath}" failed:`, err);
            }
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

    // Step 1: fast path — exact per-wallet filename.
    try {
        const blob = await downloadDriveBackupByFingerprint(fingerprint);
        if (blob) {
            const header = peekBackupHeader(blob);
            if (header?.fingerprint === fingerprint) {
                return { kind: 'matched', blob };
            }
        }
    } catch (err) {
        // Drive download error: don't swallow — propagate so UI can render
        // the "Drive failed" path with classification.
        throw err;
    }

    // Step 2: scan path — list all .cbark in appDataFolder + header match.
    const matched = await findDriveBackupByFingerprint(fingerprint);
    if (matched) {
        return { kind: 'matched', blob: matched };
    }

    // Step 3: legacy v1 / v0 fallback.
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

    // Step 1: fast path — exact per-wallet filename.
    try {
        const blob = await readSafBackupByFingerprint(fingerprint);
        if (blob) {
            const header = peekBackupHeader(blob);
            if (header?.fingerprint === fingerprint) {
                return { kind: 'matched', blob };
            }
        }
    } catch (err) {
        if (__DEV__) console.log('[Ark/find-saf] fast-path read failed:', err);
        // Fall through — scan path may still succeed.
    }

    // Step 2: scan all .cbark in folder + header match.
    try {
        const matched = await findSafBackupByFingerprint(fingerprint);
        if (matched) {
            return { kind: 'matched', blob: matched };
        }
    } catch (err) {
        if (__DEV__) console.log('[Ark/find-saf] scan failed:', err);
    }

    // Step 3: legacy v1 fallback.
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

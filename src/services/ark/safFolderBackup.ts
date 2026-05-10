import { NativeModules, Platform } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import DocumentPicker from 'react-native-document-picker';

import { peekBackupHeader } from './backup';

/**
 * User-chosen folder backup channel — Storage Access Framework (SAF)
 * on Android, no-op on iOS.
 *
 * Why this exists: of the three Android backup destinations Cypher Box
 * writes to —
 *
 *   1. Documents/ark-backup.cbark (this file: AUTO_BACKUP_PATH in backup.ts)
 *   2. Drive appDataFolder via OAuth (googleDrive.ts)
 *   3. user-chosen SAF folder (this file)
 *
 * — only #3 survives `pm uninstall`. (1) lives in the app sandbox
 * (`/data/data/io.cypherbox.btc/files`); (2) requires a working Google
 * sign-in plus a registered SHA-1 in Cloud Console (the precise
 * misconfiguration that lost 5000 sats on 2026-05-05). The SAF folder
 * is a content:// tree URI rooted at a path the user picked from the
 * system Files chooser — typically Internal Storage/Documents/Backups
 * or similar — and the file lands there with no special permissions
 * and no background dependencies.
 *
 * iOS doesn't need this: Documents is already user-visible (Files →
 * On My iPhone → Cypher Box) and iCloud Drive sync handles off-device
 * replication transparently.
 *
 * RUNTIME LIFECYCLE:
 *
 *   First run (per device install):
 *     UI calls `pickSafBackupFolder()` → opens system folder picker →
 *     user picks a folder → we call ArkSafBackup.takePersistablePermission
 *     so the URI survives reboot → we persist the URI to AsyncStorage
 *     under SAF_URI_KEY.
 *
 *   Each sync tick (or wallet-create verified write):
 *     getSavedSafBackupFolder() → if non-null, writeArkBackupToSaf(blob)
 *     → native module overwrites ark-backup.cbark inside the chosen
 *     folder. Read-back-and-decrypt verification happens at create-time
 *     only (not on every tick — same policy as Drive).
 *
 *   URI revocation:
 *     User can revoke via Settings → Apps → Cypher Box → permissions,
 *     or implicitly by moving / deleting / unmounting the chosen folder.
 *     `probeSafBackupFolder()` distinguishes the cases so the UI can
 *     prompt re-pick rather than show a generic failure.
 *
 * TRADEOFFS:
 *   - The URI is a content:// reference, not a filesystem path — we
 *     never see the absolute path, just a token the SAF provider can
 *     resolve. Caller-friendly when the user moves the folder via the
 *     Files app (the URI tracks the move) but breaks when the folder
 *     is deleted.
 *   - One folder per device install. Multiple users on the same device
 *     would each have their own AsyncStorage so this is fine.
 *   - First write may be slow (~50–200ms native round-trip) but
 *     subsequent writes reuse the resolved DocumentFile and stay under
 *     50ms on the A14.
 */

/** AsyncStorage key for the persisted SAF tree URI. */
const SAF_URI_KEY = '@CypherBoxArkSafBackup/treeUri';

/** Result of the URI health-check probe. */
export type SafFolderStatus =
    | 'not-configured' // user hasn't picked a folder yet (or was cleared)
    | 'ok'             // URI granted + folder reachable + writable
    | 'missing-permission' // URI no longer in granted set (revoked)
    | 'unreachable';   // grant intact but folder gone (deleted, SD removed)

/**
 * Discriminated outcome of a single SAF write attempt — mirrors the
 * `VerifiedBackupDriveOutcome` from backup.ts so the UI can render the
 * three channels' results side by side with the same shape.
 */
export type SafBackupOutcome =
    | { kind: 'skipped-platform' }
    | { kind: 'skipped-not-configured' }
    | { kind: 'written-and-verified'; uri: string }
    | { kind: 'write-failed'; classification: SafErrorClass; error: string }
    | { kind: 'verify-failed'; uri: string; error: string };

/** Native error codes from ArkSafBackupModule.java mapped to UI-actionable classes. */
export type SafErrorClass =
    | 'permission-revoked' // URI was granted but is no longer
    | 'folder-unreachable' // folder deleted, SD card removed, etc.
    | 'create-failed'      // tree exists but file create blocked
    | 'open-failed'        // can't open output stream
    | 'write-failed'       // generic write IO failure
    | 'native-not-loaded'  // dev builds where module isn't registered
    | 'unknown';

interface ArkSafBackupNative {
    takePersistablePermission(treeUri: string): Promise<void>;
    releasePersistablePermission(treeUri: string): Promise<void>;
    probePermission(treeUri: string): Promise<'ok' | 'missing-permission' | 'unreachable'>;
    /** @deprecated legacy single-wallet path; new code uses `writeBackupNamed`. */
    writeBackup(treeUri: string, content: string): Promise<string>;
    /** @deprecated legacy single-wallet path; new code uses `readBackupNamed`. */
    readBackup(treeUri: string): Promise<string | null>;
    /** Multi-wallet write: caller supplies the per-wallet filename. */
    writeBackupNamed(treeUri: string, filename: string, content: string): Promise<string>;
    /** Multi-wallet read: caller supplies the per-wallet filename. */
    readBackupNamed(treeUri: string, filename: string): Promise<string | null>;
    /** Enumerate every `.cbark` filename in the chosen tree (flat names). */
    listBackups(treeUri: string): Promise<string[]>;
    /** Wallet-scoped delete by exact filename. Idempotent (no-op when file is absent). */
    deleteBackupNamed(treeUri: string, filename: string): Promise<void>;
}

/**
 * Lazy native-module accessor. Returns null on iOS or if the module
 * didn't register (which happens in dev builds before a clean rebuild
 * after adding the package). Callers must handle null and either skip
 * silently (auto-backup tick) or surface as `native-not-loaded`
 * (verified path).
 */
function loadNative(): ArkSafBackupNative | null {
    if (Platform.OS !== 'android') return null;
    const mod = (NativeModules as any).ArkSafBackup;
    if (!mod || typeof mod.takePersistablePermission !== 'function') {
        if (__DEV__) {
            console.log(
                '[Ark/SAF] Native module ArkSafBackup not registered — rebuild + reinstall the APK after adding the package.',
            );
        }
        return null;
    }
    return mod as ArkSafBackupNative;
}

/**
 * Map a thrown native error code (rejection reason from the bridge)
 * into a discrete class the UI can act on. Native side throws with
 * `code`, JS gets it via `.code` on the rejected error.
 */
function classifySafError(err: unknown): SafErrorClass {
    const code = String((err as any)?.code ?? '');
    switch (code) {
        case 'E_PERMISSION_REVOKED':
            return 'permission-revoked';
        case 'E_FOLDER_UNREACHABLE':
            return 'folder-unreachable';
        case 'E_CREATE_FAILED':
            return 'create-failed';
        case 'E_OPEN_FAILED':
            return 'open-failed';
        case 'E_WRITE_FAILED':
            return 'write-failed';
        default:
            return 'unknown';
    }
}

/**
 * Actionable user-facing copy keyed by error class. Phrasing assumes
 * the user is at the create / first-backup screen and has both a
 * re-pick-folder button and the existing manual share fallback nearby.
 */
export function messageForSafError(cls: SafErrorClass): string {
    switch (cls) {
        case 'permission-revoked':
            return "Cypher Box no longer has permission to write to your chosen backup folder. Tap 'Pick folder' to re-grant access.";
        case 'folder-unreachable':
            return "The backup folder is no longer reachable (it may have been deleted, moved, or the storage was removed). Tap 'Pick folder' to choose a new one.";
        case 'create-failed':
            return "Couldn't create the backup file in the chosen folder. The folder may be read-only — pick a different one.";
        case 'open-failed':
        case 'write-failed':
            return "Couldn't write the backup to the chosen folder. The storage may be full or read-only — pick a different folder.";
        case 'native-not-loaded':
            return 'Local-folder backup is not available on this build.';
        case 'unknown':
        default:
            return "Couldn't save the backup to the chosen folder. Try picking a different folder, or use the share-sheet save below.";
    }
}

/**
 * Open the system folder picker. On user-confirm, take a persistable
 * grant on the returned URI and persist it to AsyncStorage.
 *
 * Returns the URI string on success, null on cancel. Throws only on
 * unexpected programmer errors (the take-persistable step shouldn't
 * fail for a fresh picker grant — if it does we want to know).
 */
export async function pickSafBackupFolder(): Promise<string | null> {
    if (Platform.OS !== 'android') return null;
    const native = loadNative();
    if (!native) {
        const err = new Error('Native SAF backup module not loaded');
        (err as any).code = 'NATIVE_NOT_LOADED';
        throw err;
    }

    // pickDirectory returns null on user-cancel (the v9 API behaviour;
    // earlier versions threw). We treat null as "don't change anything".
    const picked = await DocumentPicker.pickDirectory();
    if (!picked || !picked.uri) return null;

    await native.takePersistablePermission(picked.uri);
    await AsyncStorage.setItem(SAF_URI_KEY, picked.uri);
    return picked.uri;
}

/**
 * Read the saved SAF tree URI, or null if no folder is configured.
 */
export async function getSavedSafBackupFolder(): Promise<string | null> {
    if (Platform.OS !== 'android') return null;
    try {
        return await AsyncStorage.getItem(SAF_URI_KEY);
    } catch {
        return null;
    }
}

/**
 * Forget the saved folder + release the persistable URI grant.
 * Best-effort: any sub-failure resolves silently because the user has
 * already decided to disconnect.
 */
export async function clearSavedSafBackupFolder(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const native = loadNative();
    let saved: string | null = null;
    try {
        saved = await AsyncStorage.getItem(SAF_URI_KEY);
    } catch {
        // continue to release attempt
    }
    if (saved && native) {
        try {
            await native.releasePersistablePermission(saved);
        } catch {
            // best-effort
        }
    }
    try {
        await AsyncStorage.removeItem(SAF_URI_KEY);
    } catch {
        // best-effort
    }
}

/**
 * Probe the configured folder's health without performing a write.
 * Used by the create flow before re-arming the folder + by the
 * UI to decide whether to show "Pick folder" or "Folder configured".
 *
 * Resolves to `'not-configured'` if no URI is saved.
 */
export async function probeSafBackupFolder(): Promise<SafFolderStatus> {
    if (Platform.OS !== 'android') return 'not-configured';
    const saved = await getSavedSafBackupFolder();
    if (!saved) return 'not-configured';
    const native = loadNative();
    if (!native) return 'not-configured';
    try {
        return await native.probePermission(saved);
    } catch {
        return 'unreachable';
    }
}

/**
 * Per-wallet filename inside the SAF folder. Mirrors `getAutoBackupPath`
 * in backup.ts: per-wallet writes go to `ark-backup-{fp}.cbark`, and the
 * legacy single-file fallback (`null` fingerprint) targets the v1
 * filename. Two wallets sharing the same SAF folder write to distinct
 * files — neither overwrites the other.
 */
export function getSafBackupFilename(fingerprint: string | null): string {
    return fingerprint ? `ark-backup-${fingerprint}.cbark` : 'ark-backup.cbark';
}

/**
 * Write `blob` (the encrypted .cbark envelope as JSON text) into the
 * configured SAF folder under the per-wallet filename
 * `ark-backup-{fingerprint}.cbark`. Multiple wallets coexist because
 * each writes a distinct filename.
 *
 * Throws on failure with a `code` matching native error codes — caller
 * uses `classifySafError` + `messageForSafError` to render UI copy.
 *
 * Returns the file URI on success.
 */
export async function writeArkBackupToSaf(blob: string, fingerprint: string): Promise<string> {
    if (Platform.OS !== 'android') {
        throw Object.assign(new Error('SAF backup only on Android'), { code: 'NATIVE_NOT_LOADED' });
    }
    const native = loadNative();
    if (!native) {
        throw Object.assign(new Error('SAF native module not loaded'), { code: 'NATIVE_NOT_LOADED' });
    }
    const saved = await getSavedSafBackupFolder();
    if (!saved) {
        throw Object.assign(new Error('No SAF folder configured'), { code: 'NOT_CONFIGURED' });
    }
    const filename = getSafBackupFilename(fingerprint);
    return native.writeBackupNamed(saved, filename, blob);
}

/**
 * Read the per-wallet `.cbark` file from the SAF folder by exact
 * filename (`ark-backup-{fingerprint}.cbark`). Resolves to null if the
 * folder isn't configured or no file with that name exists.
 *
 * Used by the verify-roundtrip step in `writeAndVerifyArkBackup` —
 * after a write of fingerprint X, we know the file's name is exactly
 * `ark-backup-X.cbark`, so the fast path-by-name read is correct here.
 *
 * Recovery flow uses `findSafBackupByFingerprint` instead — it scans
 * the folder so a file the user manually renamed is still found by
 * its header.
 */
export async function readSafBackupByFingerprint(fingerprint: string): Promise<string | null> {
    if (Platform.OS !== 'android') return null;
    const native = loadNative();
    if (!native) return null;
    const saved = await getSavedSafBackupFolder();
    if (!saved) return null;
    const filename = getSafBackupFilename(fingerprint);
    return native.readBackupNamed(saved, filename);
}

/**
 * Legacy back-compat read: fetches the v1 `ark-backup.cbark` from the
 * configured SAF folder, regardless of fingerprint. Used by the
 * recovery flow's v1-fallback path — when the fingerprint scan misses
 * but a single legacy file exists, the caller try-decrypts it with the
 * entered seed and (on success) rewrites it as v2.
 *
 * Kept under the original `readArkBackupFromSaf` name for back-compat
 * with consumers (RecoverArkScreen) that haven't been migrated to the
 * fingerprint-keyed flow yet — they're rewired in Slice 3.
 *
 * @deprecated Use `findSafBackupByFingerprint` for fingerprint-keyed
 *   recovery, or `readSafBackupByFingerprint` for fast-path reads when
 *   the caller already knows the file's exact per-wallet name.
 */
export async function readArkBackupFromSaf(): Promise<string | null> {
    if (Platform.OS !== 'android') return null;
    const native = loadNative();
    if (!native) return null;
    const saved = await getSavedSafBackupFolder();
    if (!saved) return null;
    return native.readBackupNamed(saved, 'ark-backup.cbark');
}

/**
 * List every `.cbark` filename in the user-chosen SAF folder. Returns
 * an empty array when no folder is configured (rather than throwing) so
 * the recovery scan can treat it as "no candidates from this channel"
 * uniformly with the other destinations.
 */
export async function listSafBackupFilenames(): Promise<string[]> {
    if (Platform.OS !== 'android') return [];
    const native = loadNative();
    if (!native) return [];
    const saved = await getSavedSafBackupFolder();
    if (!saved) return [];
    try {
        return await native.listBackups(saved);
    } catch (err) {
        if (__DEV__) console.log('[Ark/SAF] listBackups failed:', err);
        return [];
    }
}

/**
 * Delete the per-wallet `.cbark` file (`ark-backup-{fingerprint}.cbark`)
 * from the configured SAF folder. Wallet-scoped: only this wallet's
 * file is removed; other wallets' files in the same folder survive.
 * Idempotent (no-op if no folder is configured or the file doesn't
 * exist). Best-effort errors logged in __DEV__ but don't propagate —
 * the caller (`resetArkWalletState` cleanup or auto-migration) treats
 * SAF cleanup as opportunistic.
 */
export async function deleteSafBackupByFingerprint(fingerprint: string): Promise<void> {
    if (Platform.OS !== 'android') return;
    const native = loadNative();
    if (!native) return;
    const saved = await getSavedSafBackupFolder();
    if (!saved) return;
    const filename = getSafBackupFilename(fingerprint);
    try {
        await native.deleteBackupNamed(saved, filename);
    } catch (err) {
        if (__DEV__) console.log(`[Ark/SAF] deleteBackupNamed("${filename}") failed:`, err);
    }
}

/**
 * Delete the legacy single-wallet `ark-backup.cbark` (or v0
 * `cypher-box-ark-backup.cbark`) file from the SAF folder. Used by the
 * auto-migration cleanup once the active wallet's seed has decrypted
 * the legacy file and confirmed it's this wallet's snapshot — at that
 * point it's redundant with the per-wallet file we just wrote.
 *
 * Best-effort: errors logged but not thrown.
 */
export async function deleteLegacySafBackup(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const native = loadNative();
    if (!native) return;
    const saved = await getSavedSafBackupFolder();
    if (!saved) return;
    for (const legacyName of ['ark-backup.cbark', 'cypher-box-ark-backup.cbark']) {
        try {
            await native.deleteBackupNamed(saved, legacyName);
        } catch (err) {
            if (__DEV__) console.log(`[Ark/SAF] legacy delete "${legacyName}" failed:`, err);
        }
    }
}

/**
 * Recovery scan: enumerate every `.cbark` in the SAF folder, peek each
 * one's unencrypted header, return the blob whose header.fingerprint
 * matches `fingerprint`. Reads regardless of filename — a user who
 * manually renamed their file (e.g. `my-funky-name.cbark`) still
 * recovers because the fingerprint sits inside the file, not in the
 * name.
 *
 * Skips files with malformed JSON / unsupported version with a warn,
 * keeps scanning — a single corrupt file in the folder must not abort
 * the whole recovery flow.
 *
 * Returns null when no file matches (caller surfaces the
 * "no backup matches this seed phrase" UX).
 */
export async function findSafBackupByFingerprint(fingerprint: string): Promise<string | null> {
    if (Platform.OS !== 'android') return null;
    const native = loadNative();
    if (!native) return null;
    const saved = await getSavedSafBackupFolder();
    if (!saved) return null;

    let names: string[];
    try {
        names = await native.listBackups(saved);
    } catch (err) {
        if (__DEV__) console.log('[Ark/SAF] listBackups failed:', err);
        return null;
    }

    for (const name of names) {
        let blob: string | null;
        try {
            blob = await native.readBackupNamed(saved, name);
        } catch (err) {
            if (__DEV__) console.log(`[Ark/SAF] readBackupNamed("${name}") failed:`, err);
            continue;
        }
        if (!blob) continue;
        const header = peekBackupHeader(blob);
        if (!header) {
            if (__DEV__) console.log(`[Ark/SAF] skipping malformed envelope at "${name}"`);
            continue;
        }
        if (header.fingerprint && header.fingerprint === fingerprint) {
            return blob;
        }
    }
    return null;
}

/**
 * Write + read-back-and-return: caller-side helper that produces a
 * `SafBackupOutcome` for the verified-create path so backup.ts doesn't
 * have to handle classification inline. Catches every native-rejection
 * shape and translates to the structured outcome.
 *
 * Caller is responsible for the decrypt/sanity-check step on the
 * returned blob — that needs the mnemonic which lives one level up.
 */
export async function writeAndReadbackSafBackup(blob: string, fingerprint: string): Promise<{
    written: { ok: true; uri: string } | { ok: false; classification: SafErrorClass; error: string };
    readback: string | null;
}> {
    let writtenUri: string;
    try {
        writtenUri = await writeArkBackupToSaf(blob, fingerprint);
    } catch (err: any) {
        return {
            written: {
                ok: false,
                classification: classifySafError(err),
                error: err?.message ?? String(err),
            },
            readback: null,
        };
    }

    let readback: string | null = null;
    try {
        // Fast path: read by exact per-wallet name we just wrote. The
        // recovery flow uses `findSafBackupByFingerprint` (scan + header
        // match) instead — but here we already know the filename, so
        // the scan would just be wasted work.
        readback = await readSafBackupByFingerprint(fingerprint);
    } catch {
        // Read-back failure handled by the caller (it'll see readback=null
        // alongside written.ok=true and classify as verify-failed).
    }

    return {
        written: { ok: true, uri: writtenUri },
        readback,
    };
}

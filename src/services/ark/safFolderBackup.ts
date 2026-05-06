import { NativeModules, Platform } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import DocumentPicker from 'react-native-document-picker';

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
    writeBackup(treeUri: string, content: string): Promise<string>;
    readBackup(treeUri: string): Promise<string | null>;
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
 * Write `blob` (the encrypted .cbark envelope as JSON text) into the
 * configured SAF folder, overwriting the existing ark-backup.cbark.
 *
 * Throws on failure with a `code` matching native error codes — caller
 * uses `classifySafError`+ `messageForSafError` to render UI copy.
 *
 * Returns the file URI on success.
 */
export async function writeArkBackupToSaf(blob: string): Promise<string> {
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
    return native.writeBackup(saved, blob);
}

/**
 * Read back the most recent ark-backup.cbark from the configured SAF
 * folder. Resolves to null when no folder is configured or no backup
 * file exists yet.
 *
 * Used by the verify-roundtrip step in `writeAndVerifyArkBackup` to
 * confirm that a write we just did is decryptable by the same seed.
 */
export async function readArkBackupFromSaf(): Promise<string | null> {
    if (Platform.OS !== 'android') return null;
    const native = loadNative();
    if (!native) return null;
    const saved = await getSavedSafBackupFolder();
    if (!saved) return null;
    return native.readBackup(saved);
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
export async function writeAndReadbackSafBackup(blob: string): Promise<{
    written: { ok: true; uri: string } | { ok: false; classification: SafErrorClass; error: string };
    readback: string | null;
}> {
    let writtenUri: string;
    try {
        writtenUri = await writeArkBackupToSaf(blob);
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
        readback = await readArkBackupFromSaf();
    } catch {
        // Read-back failure handled by the caller (it'll see readback=null
        // alongside written.ok=true and classify as verify-failed).
    }

    return {
        written: { ok: true, uri: writtenUri },
        readback,
    };
}

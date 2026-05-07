import { NativeModules, Platform } from 'react-native';

import RNFS from 'react-native-fs';
import Aes from 'react-native-aes-crypto';

import { ARK_DATADIR, ensureArkDatadir } from './datadir';
import {
    classifyDriveError,
    downloadArkBackupFromDrive,
    isGoogleDriveConnected,
    uploadArkBackupToDrive,
} from './googleDrive';
import type { DriveErrorClass } from './googleDrive';
import {
    getSavedSafBackupFolder,
    writeAndReadbackSafBackup,
    writeArkBackupToSaf,
} from './safFolderBackup';
import type { SafBackupOutcome } from './safFolderBackup';
import { clearArkWalletHandle, openArkWallet } from './walletHandle';

/**
 * Ark datadir backup / restore — Phase 2A: manual encrypted file export.
 *
 * WHY THIS EXISTS:
 * Bark stores wallet state — VTXO commitments, presigned forfeit txs, round
 * data, exit txs, the on-chain BDK SQLite — in a local datadir. The seed
 * alone CANNOT reconstruct this state. Without a datadir backup, "type your
 * seed and recover" produces an empty wallet (we tested this; the ASP does
 * not expose a `list_vtxos_by_pubkey` endpoint and `Wallet.create` with
 * `forceRescan=true` only rescans the on-chain BDK side, not Ark VTXOs).
 *
 * This module is the only path to non-destructive recovery. Without it,
 * every reset / fresh install / lost-phone scenario loses 100% of Ark funds.
 *
 * FILE FORMAT (.cbark, opaque to users):
 *   1. Read every regular file under the datadir into memory
 *   2. Build manifest: `{ version, createdAt, files: [{ path, b64 }, …] }`
 *   3. Encrypt manifest with AES-256-CBC using a seed-derived key
 *   4. Write the OpenSSL-compatible CryptoJS ciphertext as the file body
 *
 * KEY DERIVATION:
 * 32-byte AES key from the BIP39 mnemonic via PBKDF2-SHA256:
 *   - 100,000 iterations
 *   - app-fixed salt: 'cypher-box-ark-datadir-v1'
 * The seed is already 128–256 bits of entropy, so the iteration count is
 * defensive padding rather than a real password-strengthening need.
 *
 * The salt is namespaced so a future v2 format with different parameters
 * doesn't collide with v1 ciphertexts in the wild.
 *
 * SCOPE LIMITATIONS:
 *   - Manual export/import only. No automatic iCloud sync (Phase 2B).
 *   - No incremental / differential backups; each export is a full snapshot.
 *   - No SQLite checkpoint before reading. We rely on uniffiDestroy() being
 *     called via clearArkWalletHandle() before exporting (which runs the
 *     Rust drop impl and flushes WAL → main DB cleanly). If the wallet is
 *     held open during export, the resulting backup may include a half-
 *     written WAL that doesn't replay on restore. Caller MUST close first.
 *
 * NOT IN SCOPE FOR THIS MODULE:
 *   - Sharing the file (handled at the UI layer with react-native-share).
 *   - Picking the file on import (handled at the UI layer with
 *     react-native-document-picker).
 *   - Calling clearArkWalletHandle() / setArkWallet() — service-level
 *     functions, surfaced to UI as exportArkBackup / importArkBackup.
 */

const FORMAT_VERSION = 1;
const PBKDF2_SALT = 'cypher-box-ark-datadir-v1';
const PBKDF2_ITERATIONS = 100_000;
const AES_KEY_BITS = 256; // AES-256-CBC
const AES_IV_BYTES = 16;  // AES block size

/**
 * Stable path for the local-Documents auto-backup file.
 *
 * - DocumentDirectoryPath (not CachesDirectory) so the file survives across
 *   app restarts. iOS/Android won't auto-purge Documents when storage is low.
 * - Fixed filename (no timestamp suffix) — always the single most-recent
 *   auto-backup. The manual export (writeArkBackupToTempFile) writes to
 *   CachesDirectory with a timestamp if the user wants multiple snapshots.
 * - On iOS this is the FALLBACK path — used when iCloud Drive is unavailable
 *   for Cypher Box. The primary iOS path is the iCloud Documents container
 *   (see `getActiveAutoBackupPath`), which surfaces in the Files app under
 *   iCloud Drive → Cypher Box and survives uninstall via Apple's iCloud sync.
 * - On Android this remains the primary path; the SAF folder mirror handles
 *   the survives-uninstall property there.
 */
export const AUTO_BACKUP_PATH = `${RNFS.DocumentDirectoryPath}/ark-backup.cbark`;

/**
 * Native bridge for the iCloud Drive container. Defined in
 * ios/BlueWallet/CypherCloudStorage.{h,m}. Methods:
 *   - getICloudDocumentsPath(): absolute path to the container's Documents
 *     subdirectory, or null when iCloud is unavailable
 *   - isICloudAvailable(): cheaper probe that only resolves to whether
 *     URLForUbiquityContainerIdentifier returns non-nil right now
 *
 * On Android (and on iOS dev builds without the bridge linked) the lookup
 * resolves to undefined and the helpers below treat that as "no iCloud".
 */
const CypherCloudStorage: {
    getICloudDocumentsPath?: () => Promise<string | null>;
    isICloudAvailable?: () => Promise<boolean>;
} | undefined = NativeModules.CypherCloudStorage;

/**
 * iOS-only: resolve the per-app iCloud Drive `Documents` directory and
 * return the full path to the auto-backup file inside it. Returns null
 * on Android, on iOS without the bridge linked, when the user has
 * iCloud Drive off for Cypher Box, or when the OS hasn't provisioned
 * the container yet (transient — typically resolves on a subsequent
 * call within a few seconds of an entitlement update).
 */
export async function getICloudBackupPath(): Promise<string | null> {
    if (Platform.OS !== 'ios') return null;
    try {
        const docsPath = await CypherCloudStorage?.getICloudDocumentsPath?.();
        if (!docsPath) return null;
        return `${docsPath}/ark-backup.cbark`;
    } catch (err: any) {
        // mkdir-failed inside the bridge surfaces here. Log + treat as
        // unavailable; we'd rather fall back to the local Documents path
        // than throw and break the auto-tick.
        if (__DEV__) console.log('[Ark backup] iCloud probe failed:', err?.message ?? err);
        return null;
    }
}

/**
 * Probe-only variant — does not create directories. Used by the
 * Settings → Ark Backup dismiss flow to verify the user's "iCloud Drive
 * is on" claim before flipping the persistent reminder flag off, so the
 * dismiss path is self-validating instead of trust-only.
 */
export async function isICloudBackupAvailable(): Promise<boolean> {
    if (Platform.OS !== 'ios') return false;
    try {
        return (await CypherCloudStorage?.isICloudAvailable?.()) ?? false;
    } catch {
        return false;
    }
}

/**
 * Resolve the active auto-backup write path.
 *
 * - Android: always the local Documents file.
 * - iOS with iCloud Drive enabled for Cypher Box: the iCloud Documents
 *   container path. The OS auto-syncs that file to the user's iCloud
 *   Drive across all their Apple devices and survives uninstall.
 * - iOS without iCloud Drive: falls back to local Documents — the file
 *   doesn't survive uninstall in that case, which is why the create-flow
 *   gate also requires the user to manually share+confirm a snapshot
 *   somewhere they trust until they verify iCloud is on.
 *
 * One-time migration: if the iCloud path is reachable but the file isn't
 * in iCloud yet AND the local file exists, copy local → iCloud so an
 * existing user picks up auto-sync without having to re-create their
 * wallet. We DON'T delete the local copy — leaves a fallback for users
 * who later disable iCloud Drive. Subsequent writes go to iCloud only,
 * so the local copy ages out as stale, but stale-fallback beats no-fallback.
 */
async function getActiveAutoBackupPath(): Promise<string> {
    if (Platform.OS !== 'ios') return AUTO_BACKUP_PATH;
    const iCloudPath = await getICloudBackupPath();
    if (!iCloudPath) return AUTO_BACKUP_PATH;
    try {
        const iCloudExists = await RNFS.exists(iCloudPath);
        if (!iCloudExists) {
            const localExists = await RNFS.exists(AUTO_BACKUP_PATH);
            if (localExists) {
                await RNFS.copyFile(AUTO_BACKUP_PATH, iCloudPath);
                if (__DEV__) console.log('[Ark backup] migrated local → iCloud Drive');
            }
        }
    } catch (err: any) {
        if (__DEV__) {
            console.log('[Ark backup] iCloud migration check failed (non-fatal):', err?.message ?? err);
        }
    }
    return iCloudPath;
}

/**
 * Read-side helper for the recovery flow. Returns whichever auto-backup
 * file currently exists, preferring iCloud (latest) over local (potentially
 * stale post-migration). Returns null if neither exists.
 *
 * Differs from `getActiveAutoBackupPath` in not running migration / mkdir —
 * recovery is a read-only intent and shouldn't write anything until the
 * user has confirmed the seed.
 */
export async function findAutoBackupForRecovery(): Promise<string | null> {
    if (Platform.OS === 'ios') {
        const iCloudPath = await getICloudBackupPath();
        if (iCloudPath && (await RNFS.exists(iCloudPath))) return iCloudPath;
    }
    if (await RNFS.exists(AUTO_BACKUP_PATH)) return AUTO_BACKUP_PATH;
    return null;
}

/**
 * Legacy auto-backup path from earlier dev builds. Kept as a constant so the
 * boot-time migration in `migrateLegacyBackupFile()` can rename it to the
 * new `AUTO_BACKUP_PATH` if it exists. Once all known devices have migrated
 * (and backups since rotated past the original), this can be removed.
 */
export const LEGACY_AUTO_BACKUP_PATH = `${RNFS.DocumentDirectoryPath}/cypher-box-ark-backup.cbark`;

/**
 * One-shot migration: rename the legacy `cypher-box-ark-backup.cbark` to
 * `ark-backup.cbark` if the legacy file exists and the new one doesn't yet.
 * Idempotent and crash-safe — second/subsequent calls are no-ops.
 *
 * Call once at app boot, before the auto-backup loop has had a chance to
 * write a fresh file at the new path. After this lands, an existing user
 * sees the same single rolling file with the new name; no orphaned legacy
 * file dangling in their Files app.
 */
export async function migrateLegacyBackupFile(): Promise<void> {
    try {
        const legacyExists = await RNFS.exists(LEGACY_AUTO_BACKUP_PATH);
        if (!legacyExists) return;
        const newExists = await RNFS.exists(AUTO_BACKUP_PATH);
        if (newExists) {
            // New path already populated by a fresh sync; legacy is stale.
            await RNFS.unlink(LEGACY_AUTO_BACKUP_PATH);
            return;
        }
        await RNFS.moveFile(LEGACY_AUTO_BACKUP_PATH, AUTO_BACKUP_PATH);
    } catch (err: any) {
        // Best-effort: a missing or unreadable legacy file shouldn't block boot.
        // The next auto-backup tick will write a fresh `ark-backup.cbark` anyway.
        console.warn('[Ark backup] legacy filename migration failed:', err?.message ?? err);
    }
}

// ---------------------------------------------------------------------------
// In-memory AES key cache
// ---------------------------------------------------------------------------
// PBKDF2-SHA256 with 100k iterations takes ~200-400ms on a mid-range phone.
// That's fine for the one-off manual export but is way too slow if we re-derive
// on every 30s auto-backup tick. We cache the result keyed by the mnemonic
// string — since a user has exactly one Ark wallet open at a time, the cache
// holds at most one entry. The key material is already in memory everywhere the
// mnemonic is (walletHandle.cachedMnemonic, Keychain reads, etc.), so caching
// here doesn't meaningfully widen the in-memory attack surface.
//
// The cache is intentionally NOT cleared when clearArkWalletHandle() is called
// (the manual backup flow briefly closes the handle for WAL flush, then re-opens
// — clearing the key between those two steps would force a redundant 400ms
// derive on re-open). Caller code that fully disconnects a wallet (reset.ts,
// clearArkAuth) should call clearArkKeyCache() explicitly to scrub the key.
let _keyCache: { mnemonic: string; keyHex: string } | null = null;

async function getCachedAesKey(mnemonic: string): Promise<string> {
    if (_keyCache?.mnemonic === mnemonic) return _keyCache.keyHex;
    const keyHex = await deriveAesKey(mnemonic);
    _keyCache = { mnemonic, keyHex };
    return keyHex;
}

/**
 * Scrub the in-memory AES key. Call after a full wallet disconnect / reset
 * so the key for the previous wallet doesn't linger in memory.
 */
export function clearArkKeyCache(): void {
    _keyCache = null;
}

interface BackupFileEntry {
    /** Path relative to the datadir root, with `/` separators. */
    path: string;
    /** Base64 of the file's raw bytes. */
    b64: string;
}

interface BackupManifest {
    version: number;
    /** Unix ms when export ran — for diagnostics, not for recovery logic. */
    createdAt: number;
    files: BackupFileEntry[];
}

/**
 * Recursively enumerate every regular file under `dir`, returning paths
 * relative to `dir` with forward-slash separators.
 *
 * Why we don't use `RNFS.readDir` recursively in one shot: that API only
 * lists the immediate children. We descend manually so the caller doesn't
 * have to. Symlinks are not followed (Bark doesn't create any, so this is
 * theoretical; if it ever changes we'd want to revisit to avoid cycles).
 */
async function listFilesRelative(dir: string, prefix = ''): Promise<string[]> {
    const entries = await RNFS.readDir(dir);
    const out: string[] = [];
    for (const e of entries) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isFile()) {
            out.push(rel);
        } else if (e.isDirectory()) {
            const inner = await listFilesRelative(e.path, rel);
            out.push(...inner);
        }
    }
    return out;
}

async function deriveAesKey(mnemonic: string): Promise<string> {
    // react-native-aes-crypto pbkdf2 length is in BITS; returns hex.
    // Functionally equivalent to the previous CryptoJS.PBKDF2 call —
    // PBKDF2-SHA256 with the same password/salt/iter produces byte-identical
    // output, so existing CryptoJS-encrypted .cbark files still decrypt.
    return Aes.pbkdf2(mnemonic, PBKDF2_SALT, PBKDF2_ITERATIONS, AES_KEY_BITS, 'sha256');
}

/**
 * Internal: pack the current datadir into an encrypted envelope.
 *
 * Single source of truth for the datadir → ciphertext path. Both the
 * manual export (`buildArkBackupBlob`) and the auto-backup tick
 * (`writeArkAutoBackup`) call through here so they're guaranteed
 * byte-identical in produced output and failure modes.
 *
 * Returns the JSON envelope as a UTF-8 string and the createdAt
 * stamp embedded inside it (callers that want to log a manifest
 * timestamp can read it out without re-parsing).
 *
 * Throws if the datadir is empty.
 */
async function _packDatadirIntoBlob(
    mnemonic: string,
): Promise<{ blob: string; createdAt: number; fileCount: number }> {
    const datadir = await ensureArkDatadir();

    const relPaths = await listFilesRelative(datadir);
    if (relPaths.length === 0) {
        throw new Error('Ark datadir is empty — nothing to back up');
    }

    const files: BackupFileEntry[] = [];
    for (const rel of relPaths) {
        const full = `${datadir}/${rel}`;
        // RNFS reads as base64 directly when format='base64' — avoids the
        // round-trip through utf-8 strings that would corrupt SQLite blobs.
        const b64 = await RNFS.readFile(full, 'base64');
        files.push({ path: rel, b64 });
    }

    const createdAt = Date.now();
    const manifest: BackupManifest = { version: FORMAT_VERSION, createdAt, files };
    const plaintext = JSON.stringify(manifest);

    // Cached key — PBKDF2 only runs once per wallet session.
    const keyHex = await getCachedAesKey(mnemonic);
    const ivHex = await Aes.randomKey(AES_IV_BYTES);
    // Aes.encrypt runs on the native thread (off the JS main thread), so
    // the AES pass doesn't freeze the UI on slow Android phones.
    const ctBase64 = await Aes.encrypt(plaintext, keyHex, ivHex, 'aes-256-cbc');

    const envelope = {
        v: FORMAT_VERSION,
        kdf: { algo: 'pbkdf2-sha256', salt: PBKDF2_SALT, iter: PBKDF2_ITERATIONS },
        iv: ivHex,
        ct: ctBase64,
    };
    return { blob: JSON.stringify(envelope), createdAt, fileCount: files.length };
}

/**
 * Pack the current Ark datadir into an encrypted backup string.
 *
 * Returns the JSON envelope as a UTF-8 string ready to write to a file.
 *
 * MUST be called after `clearArkWalletHandle()` so SQLite has been closed
 * cleanly. The function does NOT call clearArkWalletHandle itself — that
 * decision belongs to the caller, who may want to keep the wallet open
 * (e.g. opportunistic backup that doesn't disrupt the user's session).
 *
 * Throws if the datadir is empty (no wallet to back up) or any file read
 * fails. Both indicate caller-side bugs, not user errors.
 */
export async function buildArkBackupBlob(mnemonic: string): Promise<string> {
    const { blob } = await _packDatadirIntoBlob(mnemonic);
    return blob;
}

/**
 * Decrypt a backup blob produced by `buildArkBackupBlob`.
 *
 * Throws on:
 *   - malformed envelope JSON
 *   - unsupported format version
 *   - decryption failure (wrong seed, or corrupted file)
 *
 * Returns the parsed manifest; caller is responsible for validating that
 * `manifest.files` looks plausible before writing them to disk.
 */
async function decryptBackupBlob(blob: string, mnemonic: string): Promise<BackupManifest> {
    let envelope: any;
    try {
        envelope = JSON.parse(blob);
    } catch (err) {
        throw new Error('Backup file is not valid JSON — wrong file?');
    }
    if (typeof envelope !== 'object' || envelope === null) {
        throw new Error('Backup file is malformed');
    }
    if (envelope.v !== FORMAT_VERSION) {
        throw new Error(
            `Unsupported backup version ${envelope.v}; this build understands v${FORMAT_VERSION}`,
        );
    }
    if (typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') {
        throw new Error('Backup envelope missing iv/ct');
    }

    // Using deriveAesKey directly (not the cache) so a restore-from-file
    // flow can verify a seed against a specific backup without polluting the
    // cache for an in-flight wallet session.
    const keyHex = await deriveAesKey(mnemonic);

    let plaintext: string;
    try {
        plaintext = await Aes.decrypt(envelope.ct, keyHex, envelope.iv, 'aes-256-cbc');
    } catch (err) {
        throw new Error('Decryption failed — seed may not match this backup');
    }

    if (!plaintext) {
        // Aes.decrypt typically throws on key/padding mismatch, but defend
        // against an empty-output edge case the same way the prior code did.
        throw new Error('Decryption produced empty output — seed does not match this backup');
    }

    let manifest: BackupManifest;
    try {
        manifest = JSON.parse(plaintext) as BackupManifest;
    } catch (err) {
        throw new Error('Decrypted manifest is not valid JSON — backup may be corrupted');
    }

    if (!manifest || !Array.isArray(manifest.files)) {
        throw new Error('Decrypted manifest is missing the files array');
    }

    return manifest;
}

/**
 * Restore a backup blob into a fresh datadir and open the wallet.
 *
 * Steps, in order:
 *   1. Decrypt + validate the blob with the user-supplied mnemonic
 *   2. Tear down any live wallet handle (uniffiDestroy → SQLite close)
 *   3. Wipe whatever's currently in the datadir (we're replacing it whole)
 *   4. Recreate the datadir directory shell
 *   5. Write each manifest file at its relative path, mkdir-ing parents
 *   6. `Wallet.open(mnemonic, config, datadir)` — succeeds because the
 *      datadir we just wrote matches the seed
 *
 * Caller is responsible for:
 *   - Persisting the seed to Keychain (we do not — that's UI-policy)
 *   - Flipping zustand auth flags (setArkAuth, setArkWallet, …)
 *   - Navigation
 *
 * Throws if any step fails. On partial-write failure (mid step 5) the
 * datadir is left in an inconsistent state; the next `Wallet.open` will
 * fail and the user will need to retry restore. We deliberately do NOT
 * write to a temp dir and rename — RNFS rename across the same volume
 * is fine but the failure modes get murkier. Linear write + retry is
 * easier to reason about for this rare path.
 */
export async function restoreArkBackupBlob(
    blob: string,
    mnemonic: string,
): Promise<void> {
    const manifest = await decryptBackupBlob(blob, mnemonic);

    // Defense-in-depth: refuse paths that escape the datadir. RNFS would
    // happily write to `../../private/var/…` if a malicious backup told it to.
    for (const f of manifest.files) {
        if (typeof f.path !== 'string' || typeof f.b64 !== 'string') {
            throw new Error('Manifest entry has wrong shape');
        }
        if (f.path.includes('..') || f.path.startsWith('/')) {
            throw new Error(`Manifest contains unsafe path: ${f.path}`);
        }
    }

    // Step 2: close the wallet so SQLite handles release file descriptors.
    // Without this the subsequent unlink races with live writers and the
    // restore fails with BarkError.Database (we hit this exact mode during
    // the seed-only recovery testing — see walletHandle.clearArkWalletHandle).
    clearArkWalletHandle();

    // Step 3+4: nuke and recreate datadir. Don't use deleteArkDatadir() since
    // it flips the `ensured` latch in datadir.ts and we want to resume using
    // the same path; a follow-up ensureArkDatadir handles re-creation.
    if (await RNFS.exists(ARK_DATADIR)) {
        await RNFS.unlink(ARK_DATADIR);
    }
    const datadir = await ensureArkDatadir();

    // Step 5: write files. mkdirp parents per entry — manifest doesn't
    // explicitly list directories.
    for (const f of manifest.files) {
        const full = `${datadir}/${f.path}`;
        const lastSlash = full.lastIndexOf('/');
        if (lastSlash > 0) {
            const parent = full.slice(0, lastSlash);
            if (!(await RNFS.exists(parent))) {
                await RNFS.mkdir(parent, {
                    NSURLIsExcludedFromBackupKey: true,
                    NSFileProtectionKey:
                        'NSFileProtectionCompleteUntilFirstUserAuthentication',
                });
            }
        }
        await RNFS.writeFile(full, f.b64, 'base64');
    }

    // Step 6: open the wallet — should succeed now that datadir + seed agree.
    await openArkWallet(mnemonic);
}

/**
 * Silent auto-backup — write an encrypted snapshot to the stable
 * AUTO_BACKUP_PATH in Documents WITHOUT closing the wallet handle.
 *
 * WHY NO WALLET CLOSE:
 * The manual export (writeArkBackupToTempFile) closes the wallet so SQLite
 * checkpoints its WAL before we read the files — that guarantees a clean
 * main DB file with no half-flushed WAL pages. For an opportunistic
 * background backup we skip the close for two reasons:
 *
 *   1. Closing and re-opening the wallet handle on every 30s sync tick is
 *      disruptive. The re-open can take 500ms–2s (Bark boot + ASP TOFU
 *      handshake), during which any concurrent operation fails.
 *   2. SQLite WAL mode is designed for readers. When the database has
 *      unflushed WAL pages, readers still get a consistent snapshot by
 *      virtually applying the WAL on top of the main DB. Since we capture
 *      BOTH the main DB file AND the WAL file in the manifest, the restored
 *      datadir is consistent — SQLite will automatically replay the WAL on
 *      the first `Wallet.open` after a restore.
 *
 * The only remaining risk is a write transaction in progress at the exact
 * millisecond we read the DB file, producing a partially written WAL entry.
 * On mobile, Bark only holds SQLite open between `sync()` calls (discrete
 * operations), so this race is astronomically unlikely. If it ever happens,
 * the worst outcome is a one-tick-stale backup rather than an unrestorable
 * one — the previous auto-backup still exists on disk as the overwritten
 * previous write.
 *
 * FIXED FILENAME:
 * Overwrites the previous auto-backup unconditionally. This keeps exactly
 * one copy on disk — the most recent state. Unlike the timestamped manual
 * export, there is no accumulation; Documents storage stays bounded.
 *
 * Returns { path, sizeBytes, createdAt } on success.
 * Throws if the datadir is empty — caller should swallow and log.
 */
export async function writeArkAutoBackup(
    mnemonic: string,
): Promise<{ path: string; sizeBytes: number; createdAt: number }> {
    const { blob, createdAt } = await _packDatadirIntoBlob(mnemonic);

    const path = await getActiveAutoBackupPath();
    await RNFS.writeFile(path, blob, 'utf8');

    // Android-only off-device sibling upload. iOS gets free off-device
    // backup via Apple's transparent iCloud Drive sync of Documents
    // (when the user has it enabled for Cypher Box). Android has no
    // equivalent — the local file stays on this device unless we push
    // it to Drive ourselves.
    //
    // INTENTIONALLY SILENT-FAILS HERE: this function is called every
    // sync tick from useArkSync. A Drive outage mid-session must not
    // throw, or the local backup path breaks too. The wallet-CREATE
    // flow uses `writeAndVerifyArkBackup` instead, which surfaces Drive
    // failures explicitly so funds never enter a wallet without a
    // verified off-device copy (loss-event 2026-05-05).
    try {
        if (await isGoogleDriveConnected()) {
            await uploadArkBackupToDrive(blob);
            if (__DEV__) console.log('[Ark auto-backup] Drive upload OK');
        }
    } catch (err: any) {
        if (__DEV__) {
            console.log('[Ark auto-backup] Drive upload failed (non-fatal):', err?.message ?? err);
        }
    }

    // Android SAF folder mirror — same silent-fail policy as Drive. The
    // user-chosen folder (if configured) gets the same blob written
    // every sync tick so a wallet recovered from this folder after an
    // uninstall picks up the latest VTXOs, not whatever state was
    // captured at first-create. If the URI was revoked or the folder
    // is gone, log only — the verified-create path surfaces the same
    // failures with structured errors and re-pick UI; the auto-tick
    // mustn't throw.
    try {
        const saved = await getSavedSafBackupFolder();
        if (saved) {
            await writeArkBackupToSaf(blob);
            if (__DEV__) console.log('[Ark auto-backup] SAF folder write OK');
        }
    } catch (err: any) {
        if (__DEV__) {
            console.log('[Ark auto-backup] SAF folder write failed (non-fatal):', err?.message ?? err);
        }
    }

    return { path, sizeBytes: blob.length, createdAt };
}

/**
 * Drive-status branch of a verified backup attempt. Discriminated union so
 * the UI can render distinct copy / next-actions per outcome rather than a
 * single "backup failed" toast that hides the actionable difference between
 * a build-config bug (`auth-not-configured`) and a transient hiccup.
 */
export type VerifiedBackupDriveOutcome =
    | { kind: 'skipped-platform' }
    | { kind: 'skipped-not-connected' }
    | { kind: 'uploaded-and-verified'; fileId: string }
    | { kind: 'upload-failed'; classification: DriveErrorClass; error: string }
    | { kind: 'verify-failed'; fileId: string; error: string };

/**
 * Structured outcome of a wallet-create backup attempt. Each step reports
 * its own ok/failure independently so the create flow can:
 *   - Hard-fail on Drive failure (the loss-event scenario)
 *   - Distinguish a Drive outage from a build-misconfig from a network blip
 *   - Hand a useful error string back to the user, not a stack trace
 *   - Distinguish "user hasn't picked a SAF folder yet" from "folder is
 *     unreachable" from "folder permission revoked"
 */
export type VerifiedBackupResult = {
    blob: string;
    sizeBytes: number;
    createdAt: number;
    local: { ok: true; path: string } | { ok: false; error: string };
    drive: VerifiedBackupDriveOutcome;
    saf: SafBackupOutcome;
};

/**
 * Strict, structured-result counterpart to `writeArkAutoBackup` — used by
 * the wallet-create flow where every backup destination's success/failure
 * must be visible to the UI.
 *
 * Pipeline:
 *   1. Pack datadir into encrypted envelope (same blob as auto-backup —
 *      one byte stream goes both to local disk and Drive)
 *   2. Write to AUTO_BACKUP_PATH; capture failure into result.local
 *   3. If Android + Drive connected: upload, then read back, decrypt,
 *      sanity-check manifest non-empty. Capture failure into result.drive.
 *      Read-back-decrypt is the integrity check — Drive returning 200
 *      doesn't guarantee the bytes persisted correctly.
 *
 * NEVER throws on Drive sub-failures (those go into the structured
 * result). Throws ONLY on programmer errors (datadir empty, unhandled
 * exception in the pack step) — caller can let those propagate.
 *
 * Why a separate function rather than a flag on `writeArkAutoBackup`:
 * the call sites have opposite policies. Auto-backup ticks must swallow
 * Drive errors so the local-file write keeps working; create-flow must
 * surface them so the user can't proceed without a verified backup.
 * Keeping them as distinct functions makes the policy difference
 * impossible to confuse at the call site.
 */
export async function writeAndVerifyArkBackup(
    mnemonic: string,
): Promise<VerifiedBackupResult> {
    const { blob, createdAt } = await _packDatadirIntoBlob(mnemonic);
    const sizeBytes = blob.length;

    // Local write — try first because it's the only path we can rely on
    // when the device is offline. On iOS the active path resolves to the
    // iCloud Drive container's Documents subdir when iCloud is enabled
    // for Cypher Box (gives us off-device sync via Apple), falling back
    // to local Documents otherwise. Either way the write is the same shape.
    let local: VerifiedBackupResult['local'];
    let activePath: string;
    try {
        activePath = await getActiveAutoBackupPath();
        await RNFS.writeFile(activePath, blob, 'utf8');
        local = { ok: true, path: activePath };
    } catch (err: any) {
        local = { ok: false, error: err?.message ?? String(err) };
    }

    // Drive — Android-only. iOS short-circuits with `skipped-platform`;
    // Android short-circuits with `skipped-not-connected` when the user
    // hasn't gone through the OAuth flow yet (callers should treat both
    // skip variants as "no Drive backup, ask for manual confirmation").
    if (Platform.OS !== 'android') {
        return {
            blob,
            sizeBytes,
            createdAt,
            local,
            drive: { kind: 'skipped-platform' },
            saf: { kind: 'skipped-platform' },
        };
    }

    let connected = false;
    try {
        connected = await isGoogleDriveConnected();
    } catch {
        // Probe failure → treat as not connected (rather than failing the
        // whole verify path on a sign-in lib hiccup).
    }
    // SAF folder mirror (Android only). We compute the SAF outcome here
    // independently of Drive — they're sibling channels, neither one
    // depends on the other. Both run; both surface their own outcome.
    const saf = await runSafVerify(blob, mnemonic);

    if (!connected) {
        return {
            blob,
            sizeBytes,
            createdAt,
            local,
            drive: { kind: 'skipped-not-connected' },
            saf,
        };
    }

    let fileId: string;
    try {
        fileId = await uploadArkBackupToDrive(blob);
    } catch (err: any) {
        return {
            blob,
            sizeBytes,
            createdAt,
            local,
            drive: {
                kind: 'upload-failed',
                classification: classifyDriveError(err),
                error: err?.message ?? String(err),
            },
            saf,
        };
    }

    // Read-back integrity check. Trusting Drive's 200 isn't enough — a
    // mid-flight network truncation, a Drive-side scrubber rewriting the
    // blob, or (worst case) the wrong account ending up with the file
    // would all pass the upload step. Decrypting with the same mnemonic
    // we just used to encrypt is the cheapest end-to-end witness that
    // the round-trip works.
    try {
        const remote = await downloadArkBackupFromDrive();
        if (!remote) {
            return {
                blob,
                sizeBytes,
                createdAt,
                local,
                drive: {
                    kind: 'verify-failed',
                    fileId,
                    error: 'Drive returned no file when reading back the upload',
                },
                saf,
            };
        }
        const manifest = await decryptBackupBlob(remote, mnemonic);
        if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
            return {
                blob,
                sizeBytes,
                createdAt,
                local,
                drive: {
                    kind: 'verify-failed',
                    fileId,
                    error: 'Decrypted manifest had no files',
                },
                saf,
            };
        }
    } catch (err: any) {
        return {
            blob,
            sizeBytes,
            createdAt,
            local,
            drive: {
                kind: 'verify-failed',
                fileId,
                error: err?.message ?? String(err),
            },
            saf,
        };
    }

    return {
        blob,
        sizeBytes,
        createdAt,
        local,
        drive: { kind: 'uploaded-and-verified', fileId },
        saf,
    };
}

/**
 * Run the SAF folder write-and-verify in the same shape as the Drive
 * step: write blob to user-chosen folder, read back, decrypt with the
 * same mnemonic, sanity-check manifest non-empty. Returns a
 * `SafBackupOutcome` for the structured result.
 *
 * Skipped variants ('skipped-platform' on iOS, 'skipped-not-configured'
 * when no folder URI is saved) resolve fast without touching native.
 *
 * Never throws — all error paths translate into discriminated outcomes.
 */
async function runSafVerify(blob: string, mnemonic: string): Promise<SafBackupOutcome> {
    if (Platform.OS !== 'android') return { kind: 'skipped-platform' };

    const saved = await getSavedSafBackupFolder();
    if (!saved) return { kind: 'skipped-not-configured' };

    const result = await writeAndReadbackSafBackup(blob);
    if (!result.written.ok) {
        return {
            kind: 'write-failed',
            classification: result.written.classification,
            error: result.written.error,
        };
    }

    if (!result.readback) {
        return {
            kind: 'verify-failed',
            uri: result.written.uri,
            error: 'Read-back returned no file from the SAF folder.',
        };
    }

    try {
        const manifest = await decryptBackupBlob(result.readback, mnemonic);
        if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
            return {
                kind: 'verify-failed',
                uri: result.written.uri,
                error: 'Decrypted manifest had no files.',
            };
        }
    } catch (err: any) {
        return {
            kind: 'verify-failed',
            uri: result.written.uri,
            error: err?.message ?? String(err),
        };
    }

    return { kind: 'written-and-verified', uri: result.written.uri };
}

/**
 * Convenience: run buildArkBackupBlob and write the result to a temp file
 * the UI can hand to react-native-share.
 *
 * Returns the absolute path of the temp file.
 *
 * Filename includes a UTC timestamp so multiple backups in the same session
 * don't collide (and so the user's iCloud Drive won't silently overwrite
 * yesterday's backup). Extension `.cbark` is intentionally ours-only — it
 * tells iOS / Android share targets this is an opaque blob, not a generic
 * `.json` file someone might try to open as text.
 */
export async function writeArkBackupToTempFile(
    mnemonic: string,
): Promise<{ path: string; sizeBytes: number; createdAt: number }> {
    const blob = await buildArkBackupBlob(mnemonic);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${RNFS.CachesDirectoryPath}/ark-backup-${stamp}.cbark`;
    await RNFS.writeFile(path, blob, 'utf8');
    return { path, sizeBytes: blob.length, createdAt: Date.now() };
}

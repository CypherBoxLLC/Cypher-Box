import { Platform } from 'react-native';

import RNFS from 'react-native-fs';
import Aes from 'react-native-aes-crypto';

import { deriveBackupFingerprint, normalizeMnemonic } from './backupFingerprint';
import { ARK_DATADIR, ensureArkDatadir } from './datadir';
import {
    classifyDriveError,
    deleteDriveBackupByFingerprint,
    deleteLegacyDriveBackup,
    downloadArkBackupFromDrive,
    downloadDriveBackupByFingerprint,
    isGoogleDriveConnected,
    uploadArkBackupToDrive,
} from './googleDrive';
import type { DriveErrorClass } from './googleDrive';
import {
    deleteLegacySafBackup,
    deleteSafBackupByFingerprint,
    getSavedSafBackupFolder,
    readArkBackupFromSaf,
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

/**
 * Envelope format version.
 *
 *   v1: { v:1, kdf, iv, ct }                               — legacy, single-wallet era
 *   v2: { v:2, fingerprint, kdf, iv, ct }                  — multi-wallet, lookup-keyed
 *
 * Writers always emit v2. Readers accept v1 OR v2 — v1 files in the wild
 * (devices that backed up before this change) must keep decrypting
 * indefinitely; we don't get to migrate them eagerly because the user has to
 * type their seed first to do the rewrite. See `decryptBackupBlob` for the
 * version-permissive read path.
 */
const FORMAT_VERSION_LEGACY = 1;
const FORMAT_VERSION = 2;
const PBKDF2_SALT = 'cypher-box-ark-datadir-v1';
const PBKDF2_ITERATIONS = 100_000;
const AES_KEY_BITS = 256; // AES-256-CBC
const AES_IV_BYTES = 16;  // AES block size

const AUTO_BACKUP_FILENAME_LEGACY_V0 = 'cypher-box-ark-backup.cbark';
const AUTO_BACKUP_FILENAME_LEGACY_V1 = 'ark-backup.cbark';

/**
 * Per-wallet auto-backup filename, keyed by BIP32 master fingerprint.
 *
 *   `null` — legacy single-wallet path (`ark-backup.cbark`). Used only by the
 *            legacy-migration scan and by callers that haven't been wired up
 *            for the per-wallet model yet (Settings status panel, etc — those
 *            move to enumeration in a follow-up slice).
 *   `<fp>` — `ark-backup-<fp>.cbark`, one file per wallet seed.
 *
 * Multiple Ark wallets on the same device write to distinct filenames at
 * every destination (Documents, Drive's appDataFolder, the SAF folder),
 * so creating wallet B no longer overwrites wallet A's backup.
 */
export function getAutoBackupPath(fingerprint: string | null): string {
    const filename = fingerprint
        ? `ark-backup-${fingerprint}.cbark`
        : AUTO_BACKUP_FILENAME_LEGACY_V1;
    return `${RNFS.DocumentDirectoryPath}/${filename}`;
}

/**
 * Legacy single-wallet path. Kept exported so consumers that haven't been
 * migrated to per-wallet enumeration yet still resolve the same constant
 * symbol they did before; new writes go to the per-wallet path via
 * `getAutoBackupPath(fp)`.
 *
 * @deprecated Use `getAutoBackupPath(fingerprint)` for writes and the
 *   destination-enumeration helpers (forthcoming) for reads.
 */
export const AUTO_BACKUP_PATH = getAutoBackupPath(null);

/**
 * Legacy v0-era auto-backup path from earlier dev builds. Kept as a constant
 * so the boot-time migration in `migrateLegacyBackupFile()` can rename it to
 * the v1 path if it exists. Once all known devices have migrated past v0
 * (and backups since rotated past the original), this can be removed.
 */
export const LEGACY_AUTO_BACKUP_PATH = `${RNFS.DocumentDirectoryPath}/${AUTO_BACKUP_FILENAME_LEGACY_V0}`;

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
// In-memory AES key + fingerprint cache
// ---------------------------------------------------------------------------
// PBKDF2-SHA256 with 100k iterations takes ~200-400ms on a mid-range phone.
// PBKDF2-SHA512 inside `bip39.mnemonicToSeed` (used by deriveBackupFingerprint)
// adds another ~hundred ms. That's fine for the one-off manual export but is
// way too slow if we re-derive on every 30s auto-backup tick. We cache both
// keyed by the *normalized* mnemonic string — a user has exactly one Ark
// wallet open at a time, so the cache holds at most one entry. The key
// material is already in memory everywhere the mnemonic is
// (walletHandle.cachedMnemonic, Keychain reads, etc.), so caching here doesn't
// meaningfully widen the in-memory attack surface.
//
// The cache is intentionally NOT cleared when clearArkWalletHandle() is called
// (the manual backup flow briefly closes the handle for WAL flush, then re-opens
// — clearing the key between those two steps would force a redundant 400ms
// derive on re-open). Caller code that fully disconnects a wallet (reset.ts,
// clearArkAuth) should call clearArkKeyCache() explicitly to scrub the key.
let _keyCache: { mnemonic: string; keyHex: string; fingerprint: string } | null = null;

async function getCachedKeyAndFingerprint(
    mnemonic: string,
): Promise<{ keyHex: string; fingerprint: string }> {
    const normalized = normalizeMnemonic(mnemonic);
    if (_keyCache?.mnemonic === normalized) {
        return { keyHex: _keyCache.keyHex, fingerprint: _keyCache.fingerprint };
    }
    // Derive in parallel — independent CPU-bound work, both are slow.
    const [keyHex, fingerprint] = await Promise.all([
        deriveAesKey(normalized),
        deriveBackupFingerprint(normalized),
    ]);
    _keyCache = { mnemonic: normalized, keyHex, fingerprint };
    return { keyHex, fingerprint };
}

async function getCachedAesKey(mnemonic: string): Promise<string> {
    const { keyHex } = await getCachedKeyAndFingerprint(mnemonic);
    return keyHex;
}

/**
 * Cached fingerprint lookup. Resolves the BIP32 master fingerprint for a
 * mnemonic without re-running PBKDF2 if it's already in the per-mnemonic
 * cache. Hot-path callers (auto-backup tick, verified-backup pipeline)
 * should prefer this over the bare `deriveBackupFingerprint` import.
 */
export async function getActiveBackupFingerprint(mnemonic: string): Promise<string> {
    const { fingerprint } = await getCachedKeyAndFingerprint(mnemonic);
    return fingerprint;
}

/**
 * Synchronous read of the cached fingerprint, or null if the cache is
 * cold. Used by display surfaces (Settings status panel) that want to
 * resolve the active wallet's per-wallet filename WITHOUT triggering a
 * biometric prompt to read the mnemonic.
 *
 * Cache warm conditions: any of `writeArkAutoBackup`,
 * `writeAndVerifyArkBackup`, `getActiveBackupFingerprint`, or
 * `_packDatadirIntoBlob` have run since the last `clearArkKeyCache`.
 * In practice the cache is warm within ~30s of a wallet being open
 * (first auto-backup tick from useArkSync). Cold = "wallet just opened
 * at boot, sync tick hasn't fired yet" — Settings should fall back to
 * a "no backup yet" display in that brief window.
 */
export function getCachedArkBackupFingerprint(): string | null {
    return _keyCache?.fingerprint ?? null;
}

/**
 * Scrub the in-memory AES key + cached fingerprint. Call after a full
 * wallet disconnect / reset so the key for the previous wallet doesn't
 * linger in memory.
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
): Promise<{ blob: string; createdAt: number; fileCount: number; fingerprint: string }> {
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

    // Cached key + fingerprint — PBKDF2 (both SHA-256 for AES key and
    // SHA-512 inside bip39.mnemonicToSeed for the fingerprint) only runs
    // once per wallet session.
    const { keyHex, fingerprint } = await getCachedKeyAndFingerprint(mnemonic);
    const ivHex = await Aes.randomKey(AES_IV_BYTES);
    // Aes.encrypt runs on the native thread (off the JS main thread), so
    // the AES pass doesn't freeze the UI on slow Android phones.
    const ctBase64 = await Aes.encrypt(plaintext, keyHex, ivHex, 'aes-256-cbc');

    const envelope = {
        v: FORMAT_VERSION,
        // Lookup hint, not security: the cryptographic seed↔file binding is
        // the encryption key. The fingerprint lets the recovery flow find
        // *which* file matches an entered seed before attempting decrypt
        // (so the user gets "no backup matches this seed" rather than
        // "decryption failed" when they have multiple wallets and pick
        // the wrong seed).
        fingerprint,
        kdf: { algo: 'pbkdf2-sha256', salt: PBKDF2_SALT, iter: PBKDF2_ITERATIONS },
        iv: ivHex,
        ct: ctBase64,
    };
    return { blob: JSON.stringify(envelope), createdAt, fileCount: files.length, fingerprint };
}

/**
 * Delete the local Documents per-wallet backup file
 * (`ark-backup-{fingerprint}.cbark`). Wallet-scoped: only this
 * wallet's file is removed; other wallets' per-wallet files in
 * Documents survive. Idempotent — no error when the file's already
 * gone. Best-effort: errors logged in __DEV__ but not thrown so the
 * caller's reset / migration path keeps moving.
 */
export async function deleteLocalArkBackup(fingerprint: string): Promise<void> {
    const path = getAutoBackupPath(fingerprint);
    try {
        if (await RNFS.exists(path)) {
            await RNFS.unlink(path);
        }
    } catch (err: any) {
        if (__DEV__) {
            console.log('[Ark backup] deleteLocalArkBackup failed:', err?.message ?? err);
        }
    }
}

/**
 * Delete the legacy v1 / v0 auto-backup files from local Documents.
 * Used by the auto-migration cleanup once the active wallet's seed has
 * confirmed the legacy file is this wallet's snapshot. Best-effort.
 */
async function deleteLegacyLocalArkBackup(): Promise<void> {
    for (const path of [AUTO_BACKUP_PATH, LEGACY_AUTO_BACKUP_PATH]) {
        try {
            if (await RNFS.exists(path)) {
                await RNFS.unlink(path);
            }
        } catch (err: any) {
            if (__DEV__) {
                console.log(`[Ark backup] legacy unlink "${path}" failed:`, err?.message ?? err);
            }
        }
    }
}

/**
 * Wallet-scoped backup deletion across every destination this device
 * writes to: local Documents, Drive's appDataFolder (Android), and the
 * user-chosen SAF folder (Android). Each step is independent and
 * best-effort — a Drive outage doesn't prevent the local file from
 * being deleted, and vice versa.
 *
 * Other wallets' per-wallet files at the same destinations are NOT
 * touched. The caller passes the fingerprint of THIS wallet only.
 *
 * Used by `resetArkWalletState({ deleteBackupFilesForFingerprint })` —
 * but the Settings UI today doesn't yet expose a "delete vault AND
 * its backup files" option, so the only call site is forward-looking.
 * The backup-file preservation is the safe default; this helper is
 * available for explicit opt-in.
 */
export async function deleteArkBackupForWallet(fingerprint: string): Promise<void> {
    // Run all three independently. Sequential so errors in one don't
    // mask errors in another in the dev logs; the per-channel helpers
    // already swallow failures.
    await deleteLocalArkBackup(fingerprint);
    await deleteDriveBackupByFingerprint(fingerprint);
    await deleteSafBackupByFingerprint(fingerprint);
}

/**
 * Auto-migration sweep: at every destination, check whether a legacy
 * `ark-backup.cbark` (v1) or `cypher-box-ark-backup.cbark` (v0) is
 * actually THIS wallet's snapshot, and if so, delete it.
 *
 * Match policy (criterion 4 — "no lost data"):
 *   1. If the legacy file's header has a fingerprint and it MATCHES
 *      the active wallet's → delete (this is our file at the old name).
 *   2. If the legacy file has no fingerprint header (v1 / v0 era) →
 *      try-decrypt with the active mnemonic. On success → delete (this
 *      is our file). On failure → leave it (foreign wallet's file —
 *      preserved so its owning seed can recover it later).
 *   3. If the legacy file has a DIFFERENT fingerprint → leave it.
 *      Some other wallet wrote a v2 to the legacy filename (unlikely
 *      but possible on a multi-device setup); not ours to clean up.
 *
 * Idempotent: once cleanup has run, subsequent calls find nothing to
 * delete and resolve fast. Best-effort — errors logged but never
 * thrown, so the auto-backup tick that calls us never breaks.
 *
 * Runs after a successful per-wallet write so we know there's a
 * current v2 snapshot in place before we delete the legacy file
 * (no transient state where neither file exists).
 */
async function migrateLegacyBackupsForActiveWallet(mnemonic: string): Promise<void> {
    const fingerprint = await getActiveBackupFingerprint(mnemonic);

    // --- Local Documents -----------------------------------------------
    for (const legacyPath of [AUTO_BACKUP_PATH, LEGACY_AUTO_BACKUP_PATH]) {
        try {
            if (!(await RNFS.exists(legacyPath))) continue;
            const legacyBlob = await RNFS.readFile(legacyPath, 'utf8');
            const header = peekBackupHeader(legacyBlob);
            if (header?.fingerprint && header.fingerprint !== fingerprint) {
                continue; // foreign wallet's file — leave it
            }
            if (!header?.fingerprint) {
                // v0 / v1 file, no fingerprint — try-decrypt to verify ownership.
                try {
                    await decryptBackupBlob(legacyBlob, mnemonic);
                } catch {
                    continue; // not ours
                }
            }
            await RNFS.unlink(legacyPath);
            if (__DEV__) console.log(`[Ark migrate] removed legacy local file ${legacyPath}`);
        } catch (err: any) {
            if (__DEV__) console.log(`[Ark migrate] local "${legacyPath}" check failed:`, err?.message ?? err);
        }
    }

    // --- Drive (Android) -----------------------------------------------
    if (Platform.OS === 'android') {
        try {
            const legacyDrive = await downloadArkBackupFromDrive();
            if (legacyDrive) {
                const header = peekBackupHeader(legacyDrive);
                let isOurs = false;
                if (header?.fingerprint && header.fingerprint === fingerprint) {
                    isOurs = true;
                } else if (!header?.fingerprint) {
                    try {
                        await decryptBackupBlob(legacyDrive, mnemonic);
                        isOurs = true;
                    } catch {
                        // not ours
                    }
                }
                if (isOurs) {
                    await deleteLegacyDriveBackup();
                    if (__DEV__) console.log('[Ark migrate] removed legacy Drive file');
                }
            }
        } catch (err: any) {
            if (__DEV__) console.log('[Ark migrate] Drive check failed:', err?.message ?? err);
        }
    }

    // --- SAF (Android) -------------------------------------------------
    if (Platform.OS === 'android') {
        try {
            const legacySaf = await readArkBackupFromSaf();
            if (legacySaf) {
                const header = peekBackupHeader(legacySaf);
                let isOurs = false;
                if (header?.fingerprint && header.fingerprint === fingerprint) {
                    isOurs = true;
                } else if (!header?.fingerprint) {
                    try {
                        await decryptBackupBlob(legacySaf, mnemonic);
                        isOurs = true;
                    } catch {
                        // not ours
                    }
                }
                if (isOurs) {
                    await deleteLegacySafBackup();
                    if (__DEV__) console.log('[Ark migrate] removed legacy SAF file');
                }
            }
        } catch (err: any) {
            if (__DEV__) console.log('[Ark migrate] SAF check failed:', err?.message ?? err);
        }
    }
}

/**
 * Read ONLY the unencrypted envelope of a backup blob. Used by the recovery
 * flow's destination scan to identify which file matches an entered seed
 * without paying the AES decrypt cost on each candidate.
 *
 * Returns `null` for malformed JSON, missing/wrong-shape envelope, or an
 * unsupported version. Callers treat null as "skip this candidate, log a
 * warning, keep scanning" — a single corrupt file in a Drive folder must
 * not abort the whole recovery flow.
 *
 * v1 envelopes have no `fingerprint` field; the helper still returns
 * `{ v: 1 }` so the caller can decide whether to attempt a try-decrypt
 * fallback (the only way to identify a v1 file's owning seed).
 */
export function peekBackupHeader(
    blob: string,
): { v: number; fingerprint?: string } | null {
    let envelope: any;
    try {
        envelope = JSON.parse(blob);
    } catch {
        return null;
    }
    if (typeof envelope !== 'object' || envelope === null) return null;
    if (typeof envelope.v !== 'number') return null;
    if (envelope.v !== FORMAT_VERSION_LEGACY && envelope.v !== FORMAT_VERSION) return null;
    const out: { v: number; fingerprint?: string } = { v: envelope.v };
    if (typeof envelope.fingerprint === 'string') {
        out.fingerprint = envelope.fingerprint;
    }
    return out;
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
    // Accept v1 (legacy single-wallet, no fingerprint header) and v2
    // (multi-wallet, fingerprint-keyed). v1 files in the wild stay readable
    // for back-compat; we never write v1 from this code path again.
    if (envelope.v !== FORMAT_VERSION && envelope.v !== FORMAT_VERSION_LEGACY) {
        throw new Error(
            `Unsupported backup version ${envelope.v}; this build understands v${FORMAT_VERSION_LEGACY}–v${FORMAT_VERSION}`,
        );
    }
    if (typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') {
        throw new Error('Backup envelope missing iv/ct');
    }

    // Using deriveAesKey directly (not the cache) so a restore-from-file
    // flow can verify a seed against a specific backup without polluting the
    // cache for an in-flight wallet session. Normalize the mnemonic so a
    // user-typed input with weird casing/whitespace produces the same key
    // as the canonical form that wrote the file.
    const keyHex = await deriveAesKey(normalizeMnemonic(mnemonic));

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
    const { blob, createdAt, fingerprint } = await _packDatadirIntoBlob(mnemonic);

    // Per-wallet path. Multiple wallets on the same device write to distinct
    // filenames (`ark-backup-{fp}.cbark`), so creating a second wallet no
    // longer overwrites the first wallet's local backup.
    const localPath = getAutoBackupPath(fingerprint);
    await RNFS.writeFile(localPath, blob, 'utf8');

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
            await uploadArkBackupToDrive(blob, fingerprint);
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
            await writeArkBackupToSaf(blob, fingerprint);
            if (__DEV__) console.log('[Ark auto-backup] SAF folder write OK');
        }
    } catch (err: any) {
        if (__DEV__) {
            console.log('[Ark auto-backup] SAF folder write failed (non-fatal):', err?.message ?? err);
        }
    }

    // Auto-migration cleanup. AFTER the per-wallet writes succeed, sweep
    // each destination for legacy `ark-backup.cbark` (v1) /
    // `cypher-box-ark-backup.cbark` (v0) files and delete them IF they
    // belong to this wallet (header fingerprint matches, or v1 file
    // decrypts with the active mnemonic). Foreign-wallet legacy files
    // stay untouched — they may be the only existing copy of another
    // wallet's snapshot, and deleting them would be the same silent-loss
    // bug the multi-wallet feature is fixing.
    //
    // Runs every tick because it's idempotent and cheap once the legacy
    // files are gone (existence checks short-circuit fast). Best-effort
    // — errors swallowed inside the helper so the auto-backup tick
    // never breaks on a stale legacy file.
    try {
        await migrateLegacyBackupsForActiveWallet(mnemonic);
    } catch (err: any) {
        if (__DEV__) {
            console.log('[Ark auto-backup] legacy migration failed (non-fatal):', err?.message ?? err);
        }
    }

    return { path: localPath, sizeBytes: blob.length, createdAt };
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
    const { blob, createdAt, fingerprint } = await _packDatadirIntoBlob(mnemonic);
    const sizeBytes = blob.length;

    // Local write — try first because it's the only path we can rely on
    // when the device is offline. iOS users with iCloud Drive on for the
    // app get free off-device sync from this same write. Per-wallet path
    // so a second wallet's verified-create doesn't clobber the first
    // wallet's local backup.
    const localPath = getAutoBackupPath(fingerprint);
    let local: VerifiedBackupResult['local'];
    try {
        await RNFS.writeFile(localPath, blob, 'utf8');
        local = { ok: true, path: localPath };
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
    const saf = await runSafVerify(blob, mnemonic, fingerprint);

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
        fileId = await uploadArkBackupToDrive(blob, fingerprint);
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
    // the round-trip works. Fast-path read by the per-wallet name we
    // just uploaded — avoids a full appDataFolder enumeration on the
    // verified-create hot path.
    try {
        const remote = await downloadDriveBackupByFingerprint(fingerprint);
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
async function runSafVerify(
    blob: string,
    mnemonic: string,
    fingerprint: string,
): Promise<SafBackupOutcome> {
    if (Platform.OS !== 'android') return { kind: 'skipped-platform' };

    const saved = await getSavedSafBackupFolder();
    if (!saved) return { kind: 'skipped-not-configured' };

    const result = await writeAndReadbackSafBackup(blob, fingerprint);
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

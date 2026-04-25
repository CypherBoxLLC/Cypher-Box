import RNFS from 'react-native-fs';
import CryptoJS from 'crypto-js';

import { ARK_DATADIR, ensureArkDatadir } from './datadir';
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
const PBKDF2_KEYSIZE_WORDS = 8; // 8 * 32-bit = 256-bit AES key

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

function deriveAesKey(mnemonic: string): CryptoJS.lib.WordArray {
    return CryptoJS.PBKDF2(mnemonic, CryptoJS.enc.Utf8.parse(PBKDF2_SALT), {
        keySize: PBKDF2_KEYSIZE_WORDS,
        iterations: PBKDF2_ITERATIONS,
        hasher: CryptoJS.algo.SHA256,
    });
}

/**
 * Pack the current Ark datadir into an encrypted backup string.
 *
 * Returns the OpenSSL-format ciphertext (CryptoJS default) as a UTF-8
 * string ready to write to a file.
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

    const manifest: BackupManifest = {
        version: FORMAT_VERSION,
        createdAt: Date.now(),
        files,
    };

    const plaintext = JSON.stringify(manifest);
    const key = deriveAesKey(mnemonic);
    // CryptoJS.AES.encrypt with a WordArray key uses raw 256-bit AES-CBC
    // with random IV; the resulting CipherParams.toString() gives the
    // OpenSSL-format string ("U2FsdGVkX1…") that decrypt() can round-trip.
    const ciphertext = CryptoJS.AES.encrypt(plaintext, key, {
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
        // Provide an explicit IV so we don't fall through to an empty/zero IV.
        iv: CryptoJS.lib.WordArray.random(16),
    });

    // Wrap in our envelope so future format versions can be detected without
    // attempting decryption. The body field is the raw cipher payload + IV;
    // we serialize it as a base64 of {iv, ct} pair.
    const envelope = {
        v: FORMAT_VERSION,
        // PBKDF2 params surfaced so a future format change is recognisable.
        kdf: { algo: 'pbkdf2-sha256', salt: PBKDF2_SALT, iter: PBKDF2_ITERATIONS },
        iv: ciphertext.iv?.toString(CryptoJS.enc.Hex) ?? '',
        ct: ciphertext.ciphertext?.toString(CryptoJS.enc.Base64) ?? '',
    };
    return JSON.stringify(envelope);
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
function decryptBackupBlob(blob: string, mnemonic: string): BackupManifest {
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

    const key = deriveAesKey(mnemonic);
    const iv = CryptoJS.enc.Hex.parse(envelope.iv);
    const ct = CryptoJS.enc.Base64.parse(envelope.ct);
    const params = CryptoJS.lib.CipherParams.create({ ciphertext: ct });

    let plaintext: string;
    try {
        const decrypted = CryptoJS.AES.decrypt(params, key, {
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7,
            iv,
        });
        plaintext = decrypted.toString(CryptoJS.enc.Utf8);
    } catch (err) {
        throw new Error('Decryption failed — seed may not match this backup');
    }

    if (!plaintext) {
        // CryptoJS returns empty string on padding/key mismatch rather than
        // throwing — guard the most common "wrong seed" failure mode.
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
    const manifest = decryptBackupBlob(blob, mnemonic);

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
    const path = `${RNFS.CachesDirectoryPath}/cypher-box-ark-backup-${stamp}.cbark`;
    await RNFS.writeFile(path, blob, 'utf8');
    return { path, sizeBytes: blob.length, createdAt: Date.now() };
}

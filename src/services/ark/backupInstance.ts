/**
 * Per-device identity for Ark backup files, and the one place that knows how
 * a backup file is named.
 *
 * Why this exists
 * ---------------
 * Backup filenames used to be keyed on the seed's master fingerprint alone:
 * `ark-backup-<fp>.cbark`. That solved the problem it was built for, which was
 * two DIFFERENT wallets on one device overwriting each other. It cannot
 * distinguish ONE wallet running on TWO devices, because both devices derive
 * the same fingerprint from the same seed.
 *
 * The result was that every device holding a wallet wrote the same filename to
 * the same shared storage (an iCloud account, a Google account, a synced SAF
 * folder) on every sync tick, so whichever device synced last replaced the
 * others' file. A device carrying less state than the one it replaced,
 * typically a fresh restore, took the file's contents down to its own.
 *
 * The fix is to put the WRITER in the name as well as the seed, so a device can
 * only ever replace its own file:
 *
 *     ark-backup-<fingerprint>-<instance>.cbark
 *
 * `<instance>` is 8 random hex characters, generated once per app install and
 * persisted. It is not derived from the seed, the device id, or anything else
 * that two installs could agree on by accident. A reinstall produces a new
 * instance, which writes a new file rather than taking over the old one; that
 * is the conservative direction, and recovery lists both.
 *
 * Nothing here is secret. The instance id identifies a writer, not a user, and
 * it is already visible in the filename, so it is also carried in the
 * envelope's plaintext header where a reader can use it without decrypting.
 */

import Aes from 'react-native-aes-crypto';

import { getItem, setItem } from '@Cypher/stores/storageService';

/** Storage key for this install's backup instance id. */
const INSTANCE_ID_KEY = 'ark-backup-instance-id';

/** Length of the instance id in hex characters. */
const INSTANCE_ID_HEX_CHARS = 8;

/**
 * Filenames from before per-wallet naming. Never written. Still read, and
 * from this build never deleted either: a fingerprint match proves which
 * SEED a file belongs to, never which DEVICE wrote it, so deleting one on
 * the strength of a fingerprint is the same class of mistake as overwriting
 * it was.
 */
export const LEGACY_BACKUP_FILENAME_V0 = 'cypher-box-ark-backup.cbark';
export const LEGACY_BACKUP_FILENAME_V1 = 'ark-backup.cbark';

/**
 * Module-scope cache. `loadArkBackupInstanceId` is called on every sync tick
 * from three or four write paths, and MMKV reads go through an async bridge,
 * so the id is resolved once per process.
 */
let cachedInstanceId: string | null = null;
/** In-flight load, so concurrent callers cannot each mint a different id. */
let inFlightLoad: Promise<string> | null = null;

/**
 * This install's backup instance id, creating and persisting one on first use.
 *
 * Returns a stable value for the life of the install. Never throws: if storage
 * is unreadable we fall back to a process-lifetime id rather than failing the
 * backup, because a backup written under an ephemeral name is still infinitely
 * better than no backup, and it still cannot clobber another device's file.
 */
export async function loadArkBackupInstanceId(): Promise<string> {
    if (cachedInstanceId) return cachedInstanceId;
    if (inFlightLoad) return inFlightLoad;

    inFlightLoad = (async () => {
        try {
            const stored = await getItem(INSTANCE_ID_KEY);
            if (typeof stored === 'string' && isValidInstanceId(stored)) {
                cachedInstanceId = stored;
                return stored;
            }
        } catch {
            // Fall through and mint one. A storage read failure must not stop a
            // backup from being written.
        }

        const minted = await mintInstanceId();
        try {
            await setItem(INSTANCE_ID_KEY, minted);
        } catch {
            // Not persisted, so the next launch mints a different id and writes
            // a second file. Wasteful, never destructive.
        }
        cachedInstanceId = minted;
        return minted;
    })();

    try {
        return await inFlightLoad;
    } finally {
        inFlightLoad = null;
    }
}

/**
 * The cached id without touching storage, or null before the first load.
 *
 * For call sites that cannot await, such as a synchronous path builder kept
 * for back-compat. Treat null as "this device has no instance yet" and fall
 * back to the fingerprint-only name.
 */
export function getArkBackupInstanceIdCached(): string | null {
    return cachedInstanceId;
}

/** Test seam. Not called by app code. */
export function __resetArkBackupInstanceIdCacheForTests(): void {
    cachedInstanceId = null;
    inFlightLoad = null;
}

async function mintInstanceId(): Promise<string> {
    try {
        // Same entropy source the envelope's AES IV uses. Returns hex.
        const hex = await Aes.randomKey(INSTANCE_ID_HEX_CHARS / 2);
        const cleaned = String(hex).toLowerCase().replace(/[^0-9a-f]/g, '');
        if (cleaned.length >= INSTANCE_ID_HEX_CHARS) {
            return cleaned.slice(0, INSTANCE_ID_HEX_CHARS);
        }
    } catch {
        // Native crypto unavailable. Fall through.
    }
    // Fallback only. Collision resistance here is weaker than the native
    // source, but the consequence of a collision is two devices sharing a
    // filename, which is the pre-fix behaviour rather than something worse.
    let out = '';
    while (out.length < INSTANCE_ID_HEX_CHARS) {
        out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
}

export function isValidInstanceId(value: string): boolean {
    return new RegExp(`^[0-9a-f]{${INSTANCE_ID_HEX_CHARS}}$`).test(value);
}

/**
 * The single source of truth for a backup filename, used by every
 * destination: local Documents, the iCloud container, the Drive app folder,
 * and the SAF folder. All four must agree or recovery cannot find what a
 * write produced.
 *
 *   fingerprint + instance → `ark-backup-<fp>-<instance>.cbark`  (current)
 *   fingerprint only       → `ark-backup-<fp>.cbark`             (v2, read-only)
 *   neither                → `ark-backup.cbark`                  (v1, read-only)
 */
export function buildArkBackupFilename(
    fingerprint: string | null,
    instance?: string | null,
): string {
    if (!fingerprint) return LEGACY_BACKUP_FILENAME_V1;
    if (!instance) return `ark-backup-${fingerprint}.cbark`;
    return `ark-backup-${fingerprint}-${instance}.cbark`;
}

export type ParsedBackupFilename = {
    fingerprint: string;
    /** null for a v2 fingerprint-only file, which has no identified writer. */
    instance: string | null;
};

/**
 * Read a filename back into its parts, for enumeration and for deciding
 * whether this device is allowed to replace a file.
 *
 * Returns null for the legacy single-wallet names and for anything that is not
 * one of ours, so a caller can treat "null" as "not a file I may touch".
 */
export function parseArkBackupFilename(
    name: string,
): ParsedBackupFilename | null {
    const m = /^ark-backup-([0-9a-fA-F]{8})(?:-([0-9a-f]{8}))?\.cbark$/.exec(name);
    if (!m) return null;
    return { fingerprint: m[1], instance: m[2] ?? null };
}

/**
 * Whether this device wrote the file, and may therefore replace or delete it.
 *
 * The rule that replaces "belongs to this wallet". A fingerprint match means
 * the file holds the same seed's wallet, which is exactly the condition under
 * which the old code felt entitled to overwrite another phone's backup.
 */
export function isOwnBackupFilename(name: string, instance: string | null): boolean {
    if (!instance) return false;
    const parsed = parseArkBackupFilename(name);
    return parsed?.instance === instance;
}

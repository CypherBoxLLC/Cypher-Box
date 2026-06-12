import { Platform } from 'react-native';

import { peekBackupHeader } from './backup';

/**
 * Google Drive integration for the Android off-device .cbark backup path.
 *
 * Why this exists: on iOS we get free off-device sync by writing to the
 * app's Documents folder (Apple's iCloud Drive sync, when the user enables
 * it for Cypher Box, mirrors Documents transparently — Apple sees only
 * encrypted ciphertext). Android has no equivalent transparent path —
 * app-private storage isn't surfaced to Google Drive, and Android's
 * `Auto Backup` is invisible / capped at 25 MB / not user-manageable.
 *
 * So on Android we drive Google Drive directly via the REST API, scoped
 * to the `appDataFolder`. That folder is:
 *   - Hidden from the user's main Drive UI (no clutter)
 *   - Not visible to other apps (each app has its own appDataFolder)
 *   - Standard Drive storage, counts against the user's quota
 *   - Survives device loss / reinstall, since it lives on Google's side
 *
 * The blob we upload is the same encrypted .cbark we already write to
 * local storage — `writeArkAutoBackup` produces the ciphertext and we
 * forward it here. We don't see plaintext. Google sees ciphertext only.
 *
 * AUTH — uses `@react-native-google-signin/google-signin`. The lib
 * handles the OAuth 2.0 dance + token refresh; we lazy-require it so
 * iOS bundles aren't impacted if the lib is somehow not installed yet
 * (the package.json bump is a separate step from `yarn install`).
 *
 * SETUP REQUIREMENTS (Google Cloud Console, one-time):
 *   1. Create project at https://console.cloud.google.com
 *   2. Enable "Google Drive API" in APIs & Services → Library
 *   3. Create OAuth 2.0 Client ID:
 *        - Application type: Android
 *        - Package name: io.cypherbox.btc (match android/app/build.gradle)
 *        - SHA-1 fingerprint from the debug + release keystore
 *          (`./gradlew signingReport` from android/)
 *   4. Download `google-services.json`, drop into android/app/
 *   5. Configure scopes on consent screen: `drive.appdata`
 *
 * SCOPE — we ONLY request `drive.appdata`, not `drive.file` or full
 * `drive`. That means we can read/write files in the appDataFolder we
 * own; we cannot see the user's other Drive content. Minimal-permission
 * principle for a wallet — Google's verification team also looks
 * favourably on apps that stay scoped this way.
 */

/**
 * Legacy v1 Drive filename — single shared `ark-backup.cbark`. Used by
 * the lookup-side helpers so a user who connected Drive on a pre-v2
 * build can still recover via the new flow (we read it as a v1 envelope
 * and rewrite as v2 on next sync once the active seed decrypts it).
 *
 * Multi-wallet builds NEVER write this filename. New writes always go
 * to `getDriveBackupName(fingerprint)`.
 */
const LEGACY_V1_DRIVE_FILE_NAME = 'ark-backup.cbark';

/**
 * Legacy v0 Drive filename from very early dev builds. Same role as
 * `LEGACY_V1_DRIVE_FILE_NAME` — included in the back-compat lookup
 * path so an upgrade-in-place from a pre-v0 install still finds the
 * file. Never written.
 */
const LEGACY_V0_DRIVE_FILE_NAME = 'cypher-box-ark-backup.cbark';

/**
 * Per-wallet Drive filename, keyed by BIP32 master fingerprint. Two
 * Ark wallets sharing the same Google account each upload to a distinct
 * appDataFolder entry, so neither wallet's backup overwrites the other's.
 *
 * Mirrors the local-Documents `getAutoBackupPath` and the SAF
 * `getSafBackupFilename` so all three destinations agree on the
 * naming convention. A `null` fingerprint resolves to the legacy v1
 * filename — used only by the back-compat lookup path that finds
 * pre-multi-wallet backups still living under the old shared name.
 */
function getDriveBackupName(fingerprint: string | null): string {
    return fingerprint ? `ark-backup-${fingerprint}.cbark` : LEGACY_V1_DRIVE_FILE_NAME;
}

/** OAuth scopes — minimal: app-scoped Drive folder only. */
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.appdata'];

/**
 * Discrete classes of Drive failure that the wallet-create UI can react to
 * with actionable copy. The fallback `unknown` covers anything the
 * classifier doesn't recognise — UI should still show the backup as failed
 * and offer the manual-share fallback.
 *
 * Why classify at all: the loss-event on 2026-05-05 traced to a bare
 * `developer_error` that propagated as a generic toast, leading the user to
 * think Drive was just being flaky. The actual condition (SHA-1 not
 * registered with this Cloud project) is permanent for that build and
 * needs different copy than "retry later." Same applies to other failure
 * modes — the user can act on a token-expired prompt but not on a quota
 * error, etc.
 */
export type DriveErrorClass =
    | 'auth-not-configured'
    | 'auth-cancelled'
    | 'auth-token-missing'
    | 'network'
    | 'quota'
    | 'server'
    | 'unknown';

/**
 * Map an arbitrary thrown value from a Drive helper into one of the
 * discrete error classes. Inspects:
 *   - `.code` (set by @react-native-google-signin for sign-in errors)
 *   - `.message` substring matches for the bare strings we throw
 *     (e.g. `Drive upload failed: 503 …`)
 *   - HTTP status digits parsed out of those messages
 *
 * Conservative: anything that doesn't match a known shape returns
 * `'unknown'` so the UI defaults to the safe "save manually" copy.
 */
export function classifyDriveError(err: unknown): DriveErrorClass {
    const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
    const code = String((err as any)?.code ?? '');

    if (code === 'DEVELOPER_ERROR' || msg.includes('developer_error') || msg.includes('developer error')) {
        return 'auth-not-configured';
    }
    if (code === 'SIGN_IN_CANCELLED' || msg.includes('sign_in_cancelled') || msg.includes('cancelled') || msg.includes('canceled')) {
        return 'auth-cancelled';
    }
    if (
        msg.includes('access token not available') ||
        msg.includes('re-connect google drive') ||
        msg.includes('sign_in_required') ||
        msg.includes('googlesignin module not loaded')
    ) {
        return 'auth-token-missing';
    }
    if (msg.includes('network request failed') || msg.includes('failed to fetch') || msg.includes('typeerror: network')) {
        return 'network';
    }
    const httpMatch = msg.match(/(?:upload|list|download) failed:\s*(\d{3})/);
    if (httpMatch) {
        const status = parseInt(httpMatch[1], 10);
        if (status === 401 || status === 403 || status === 429) return 'quota';
        if (status >= 500 && status < 600) return 'server';
    }
    return 'unknown';
}

/**
 * Actionable user-facing copy for each Drive error class. Phrasing assumes
 * the user is at the wallet-create / first-backup screen and has both a
 * retry button and a manual-share fallback available, so each message
 * points at the right next step.
 */
export function messageForDriveError(cls: DriveErrorClass): string {
    switch (cls) {
        case 'auth-not-configured':
            return "Google Drive isn't authorized for this build (the app's signing certificate isn't registered with Google). Save the backup file manually below, then continue.";
        case 'auth-cancelled':
            return 'Google Drive sign-in was cancelled. Tap Connect again to retry, or save the backup file manually.';
        case 'auth-token-missing':
            return 'Google Drive session expired. Tap Connect again to sign in.';
        case 'network':
            return "Couldn't reach Google Drive. Check your internet connection and retry, or save the backup file manually.";
        case 'quota':
            return 'Google Drive rejected the upload (quota or permission). Save the backup file manually instead.';
        case 'server':
            return 'Google Drive is having issues right now. Retry in a moment, or save the backup file manually.';
        case 'unknown':
        default:
            return 'Google Drive backup failed. Save the backup file manually below.';
    }
}

/**
 * Lazy-load the GoogleSignin module. Returns null on iOS (we never
 * use it there) or if the dep isn't installed. Callers must handle
 * null and skip silently — no Drive backup is the documented
 * fallback behavior on Android too.
 */
function loadGoogleSignin(): any | null {
    if (Platform.OS !== 'android') return null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('@react-native-google-signin/google-signin');
        return mod?.GoogleSignin ?? mod?.default?.GoogleSignin ?? null;
    } catch (err) {
        if (__DEV__) {
            console.log(
                '[Ark/Drive] @react-native-google-signin/google-signin not installed — skipping Drive backup. Run `yarn install` after package.json updates.',
            );
        }
        return null;
    }
}

/**
 * One-time-per-process configuration. Must be called before any sign-in
 * attempt. Idempotent — re-calling with the same args is a no-op.
 *
 * `webClientId` is the OAuth 2.0 client ID of TYPE WEB created in the
 * same Google Cloud Console project as the Android client. Required by
 * GoogleSignin to mint ID tokens (used internally for offline access).
 * Don't confuse with the Android client ID — that one's only registered
 * in google-services.json and isn't passed to JS.
 *
 * Pull these out of your env / config — never hard-code OAuth client
 * IDs in source if the repo is public.
 */
export function configureGoogleDrive(opts: {
    webClientId: string;
}): void {
    const GoogleSignin = loadGoogleSignin();
    if (!GoogleSignin) return;
    GoogleSignin.configure({
        webClientId: opts.webClientId,
        scopes: DRIVE_SCOPES,
        offlineAccess: true,
    });
}

/**
 * Returns true if the user is currently signed into Google in-app AND
 * Drive scopes are granted. Doesn't trigger a sign-in prompt — purely
 * a state probe. Used by the UI to decide whether to render "Connect
 * Google Drive" or "Disconnect Google Drive".
 *
 * v13 API note: `isSignedIn()` was removed in @react-native-google-signin
 * v13. Use `hasPreviousSignIn()` (sync) or `getCurrentUser() !== null` —
 * both are gated only on local credential cache, no network.
 */
export async function isGoogleDriveConnected(): Promise<boolean> {
    const GoogleSignin = loadGoogleSignin();
    if (!GoogleSignin) return false;
    try {
        // v13: hasPreviousSignIn is synchronous boolean
        if (typeof GoogleSignin.hasPreviousSignIn === 'function') {
            return !!GoogleSignin.hasPreviousSignIn();
        }
        // v13 fallback: getCurrentUser returns User | null
        if (typeof GoogleSignin.getCurrentUser === 'function') {
            return GoogleSignin.getCurrentUser() !== null;
        }
        // Legacy v8/v10 API
        if (typeof GoogleSignin.isSignedIn === 'function') {
            return !!(await GoogleSignin.isSignedIn());
        }
        return false;
    } catch (err) {
        if (__DEV__) console.log('[Ark/Drive] sign-in probe failed:', err);
        return false;
    }
}

/**
 * Trigger the Google Sign-In flow. Resolves true on success, false on
 * user-cancelled. THROWS on real failures (Play Services missing,
 * config error, network) so the caller can surface a real error
 * message — silent-fail makes "Connect" look broken when it's actually
 * a fixable env issue.
 *
 * v13 API note: `signIn()` returns `{type: 'success' | 'cancelled', data}`
 * instead of throwing on user cancellation. We translate the discriminated
 * union into the boolean the UI expects.
 */
export async function connectGoogleDrive(): Promise<boolean> {
    const GoogleSignin = loadGoogleSignin();
    if (!GoogleSignin) {
        throw new Error('Google Sign-In native module not available on this build');
    }
    await GoogleSignin.hasPlayServices?.({ showPlayServicesUpdateDialog: true });
    const result = await GoogleSignin.signIn();
    // v13: discriminated union response. v8/v10: direct user object.
    if (result && typeof result === 'object' && 'type' in result) {
        return result.type === 'success';
    }
    return !!result;
}

/**
 * Revoke + sign out. Removes our access token from the user's Google
 * account too — they'd have to re-grant scopes on next connect, which
 * matches the user's mental model of "I disconnected, the app no longer
 * has Drive access".
 */
export async function disconnectGoogleDrive(): Promise<void> {
    const GoogleSignin = loadGoogleSignin();
    if (!GoogleSignin) return;
    try {
        await GoogleSignin.revokeAccess?.();
    } catch {
        // revokeAccess can throw "user not signed in" — silent.
    }
    try {
        await GoogleSignin.signOut?.();
    } catch {
        /* same */
    }
}

/**
 * Fetch a fresh access token. Lib handles refresh against the stored
 * refresh token internally — caller just gets a usable Bearer token
 * back. Throws if the user isn't signed in or refresh fails (e.g.
 * revoked from Google's side).
 */
async function getAccessToken(): Promise<string> {
    const GoogleSignin = loadGoogleSignin();
    if (!GoogleSignin) throw new Error('GoogleSignin module not loaded');
    const tokens = await GoogleSignin.getTokens();
    if (!tokens?.accessToken) {
        throw new Error('Drive access token not available — re-connect Google Drive');
    }
    return tokens.accessToken as string;
}

/** Internal: file metadata shape returned by `drive.files.list`. */
type DriveFileMeta = { id: string; name: string; modifiedTime?: string; size?: string };

/**
 * Look up the Drive ID of an existing entry by exact name. Used by the
 * upload path to decide between PATCH (entry exists for this fingerprint
 * already; update-in-place) vs POST (no entry; create new).
 *
 * Returns null if no entry with that exact name exists in appDataFolder.
 * Looking up by exact name (rather than fingerprint scan) keeps the
 * upload hot path one Drive list call regardless of how many other
 * wallets' backups share the folder.
 */
async function findDriveBackupIdByName(name: string): Promise<string | null> {
    const meta = await findDriveBackupMetaByName(name);
    return meta?.id ?? null;
}

/** Internal: list metadata for one specific filename in appDataFolder. */
async function findDriveBackupMetaByName(name: string): Promise<DriveFileMeta | null> {
    const token = await getAccessToken();
    const query = `name='${name}'`;
    const url =
        'https://www.googleapis.com/drive/v3/files' +
        `?spaces=appDataFolder` +
        `&fields=files(id,name,modifiedTime,size)` +
        `&q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Drive list failed: ${resp.status} ${body}`);
    }
    const json = await resp.json();
    const files = (json?.files as DriveFileMeta[]) ?? [];
    return files[0] ?? null;
}

/**
 * Internal: list metadata for every `.cbark` file in appDataFolder.
 *
 * Drive's `q=` mini-language doesn't support glob or starts-with on
 * `name`, so we list everything in the spaces=appDataFolder scope (the
 * scope is per-app already, so it only contains Cypher Box's own
 * uploads — nothing else of the user's Drive shows up here) and filter
 * client-side by the `.cbark` extension. The legacy v0 / v1 names get
 * matched the same way.
 *
 * Cypher Box's appDataFolder typically contains 1–3 entries (one per
 * wallet currently or recently active on this device + maybe a
 * leftover legacy file mid-migration), so the listing fits comfortably
 * in a single page even on the conservative `pageSize=100` default.
 */
async function listAllDriveBackups(): Promise<DriveFileMeta[]> {
    const token = await getAccessToken();
    const url =
        'https://www.googleapis.com/drive/v3/files' +
        `?spaces=appDataFolder` +
        `&fields=files(id,name,modifiedTime,size)` +
        `&pageSize=100`;
    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Drive list failed: ${resp.status} ${body}`);
    }
    const json = await resp.json();
    const files = (json?.files as DriveFileMeta[]) ?? [];
    return files.filter(f => typeof f.name === 'string' && f.name.toLowerCase().endsWith('.cbark'));
}

/**
 * Internal: download one file's content by Drive ID. Throws on
 * non-2xx; callers handle by skipping the candidate and continuing
 * the scan.
 */
async function downloadDriveFileById(id: string): Promise<string> {
    const token = await getAccessToken();
    const url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Drive download failed: ${resp.status} ${body}`);
    }
    return resp.text();
}

/**
 * Public: fetch Drive backup status for the Settings panel of the
 * active wallet — last-modified timestamp + size of the backup matching
 * the active wallet's fingerprint, or `null` if no backup exists for
 * this wallet yet.
 *
 * Caller passes the active wallet's fingerprint so the status reflects
 * THIS wallet's backup, not some other wallet's that happens to share
 * the same Google account. Pre-Slice-3 callers (Settings.tsx) still
 * use the back-compat lookup that targets the legacy filename — wired
 * to the new fingerprint-aware version when Settings migrates.
 *
 * @param fingerprint - active wallet fingerprint, or null to look up
 *   the legacy single-file entry (back-compat).
 */
export async function getDriveBackupInfo(
    fingerprint: string | null = null,
): Promise<{ modifiedAt: number; sizeBytes: number } | null> {
    const meta = await findDriveBackupMetaByName(getDriveBackupName(fingerprint));
    if (!meta) return null;
    const modifiedAt = meta.modifiedTime ? Date.parse(meta.modifiedTime) : NaN;
    const sizeBytes = meta.size ? Number(meta.size) : NaN;
    return {
        modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : 0,
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
    };
}

/**
 * Upload (or update) the encrypted backup blob into the appDataFolder
 * under the per-wallet name `ark-backup-{fingerprint}.cbark`. PATCH
 * the existing entry of the SAME name if present, POST a new one
 * otherwise — never touches a different wallet's entry.
 *
 * Multi-wallet correctness: two wallets sharing the same Drive account
 * each upload to a distinct filename. Wallet B's upload looks up
 * `ark-backup-{fpB}.cbark`, doesn't find Wallet A's
 * `ark-backup-{fpA}.cbark` (different name), creates fresh. Wallet A's
 * blob is untouched.
 *
 * Uses Drive's multipart/related upload so metadata + content go in one
 * request — simpler than the resumable protocol for a small (< 1 MB)
 * blob and works fine over typical mobile connections.
 *
 * Returns the Drive file ID on success. Throws on auth / network /
 * quota failures; caller swallows during the auto-backup tick and
 * surfaces during verified-create.
 */
export async function uploadArkBackupToDrive(
    blob: string,
    fingerprint: string,
): Promise<string> {
    const token = await getAccessToken();
    const filename = getDriveBackupName(fingerprint);
    // Look up by exact per-wallet name so wallet B's upload never PATCHes
    // wallet A's existing entry. The check is lookup-by-exact-name only —
    // legacy `ark-backup.cbark` files belonging to other wallets stay
    // untouched until their owning seed migrates them.
    const existingId = await findDriveBackupIdByName(filename);

    // Drive multipart upload boundary. The body is:
    //   --boundary
    //   Content-Type: application/json
    //
    //   <metadata JSON>
    //   --boundary
    //   Content-Type: application/octet-stream
    //
    //   <file bytes>
    //   --boundary--
    const boundary = `cypherbox-${Date.now()}`;
    const metadata: Record<string, any> = existingId
        ? {
              // Patch / update: name + parents are immutable on PATCH,
              // so we send only modifiedTime hint.
              modifiedTime: new Date().toISOString(),
          }
        : {
              name: filename,
              parents: ['appDataFolder'],
          };

    const body =
        `--${boundary}\r\n` +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        `\r\n--${boundary}\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n' +
        blob +
        `\r\n--${boundary}--`;

    const url = existingId
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

    const resp = await fetch(url, {
        method: existingId ? 'PATCH' : 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Drive upload failed: ${resp.status} ${text}`);
    }
    const json = await resp.json();
    return json?.id as string;
}

/**
 * Fast-path read by exact per-wallet name. Used by the verify-after-
 * upload step in `writeAndVerifyArkBackup` — we just uploaded as
 * `ark-backup-{fingerprint}.cbark`, so reading back by that exact
 * name avoids a full appDataFolder scan.
 *
 * Returns null when no entry exists for this fingerprint.
 */
export async function downloadDriveBackupByFingerprint(
    fingerprint: string,
): Promise<string | null> {
    const id = await findDriveBackupIdByName(getDriveBackupName(fingerprint));
    if (!id) return null;
    return downloadDriveFileById(id);
}

/**
 * Recovery scan: enumerate every `.cbark` file in the user's Drive
 * appDataFolder, peek each one's unencrypted header, return the blob
 * whose header.fingerprint matches `fingerprint`.
 *
 * Header-match (not filename-match) so a user who manually renamed
 * their backup file (downloaded it, re-uploaded under a different
 * name, etc.) still recovers — the fingerprint sits inside the file,
 * not in the name.
 *
 * Skips files with malformed JSON or unsupported version with a warn,
 * keeps scanning — a single corrupt file in the folder must not abort
 * the whole recovery flow.
 *
 * Returns null when no file matches (caller surfaces the
 * "no backup matches this seed phrase" UX).
 */
export async function findDriveBackupByFingerprint(
    fingerprint: string,
): Promise<string | null> {
    let files: DriveFileMeta[];
    try {
        files = await listAllDriveBackups();
    } catch (err) {
        if (__DEV__) console.log('[Ark/Drive] listAllDriveBackups failed:', err);
        throw err;
    }

    for (const f of files) {
        let blob: string;
        try {
            blob = await downloadDriveFileById(f.id);
        } catch (err) {
            if (__DEV__) console.log(`[Ark/Drive] download "${f.name}" failed; skipping:`, err);
            continue;
        }
        const header = peekBackupHeader(blob);
        if (!header) {
            if (__DEV__) console.log(`[Ark/Drive] skipping malformed envelope at "${f.name}"`);
            continue;
        }
        if (header.fingerprint && header.fingerprint === fingerprint) {
            return blob;
        }
    }
    return null;
}

/**
 * Internal: delete a Drive file by ID. Best-effort — Drive returns 404
 * if the file's already gone, which we swallow because the caller's
 * goal ("make sure this is gone") is already satisfied.
 */
async function deleteDriveFileById(id: string): Promise<void> {
    const token = await getAccessToken();
    const url = `https://www.googleapis.com/drive/v3/files/${id}`;
    const resp = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 404) return; // already gone
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Drive delete failed: ${resp.status} ${body}`);
    }
}

/**
 * Delete the per-wallet entry (`ark-backup-{fingerprint}.cbark`) from
 * the Drive appDataFolder. Wallet-scoped: only this wallet's entry is
 * removed; other wallets' entries survive. Idempotent — resolves
 * cleanly when no entry exists for this fingerprint.
 *
 * iOS callers: short-circuits with no-op (Drive is Android-only).
 */
export async function deleteDriveBackupByFingerprint(fingerprint: string): Promise<void> {
    if (Platform.OS !== 'android') return;
    let connected = false;
    try {
        connected = await isGoogleDriveConnected();
    } catch {
        // Sign-in lib hiccup — nothing to delete if we can't reach Drive.
    }
    if (!connected) return;
    const id = await findDriveBackupIdByName(getDriveBackupName(fingerprint));
    if (!id) return;
    await deleteDriveFileById(id);
}

/**
 * Delete the legacy single-wallet entries (`ark-backup.cbark` and
 * `cypher-box-ark-backup.cbark`) from the appDataFolder. Used by the
 * auto-migration cleanup once the active wallet's seed has confirmed
 * the legacy file is this wallet's snapshot.
 *
 * Best-effort: errors logged but not thrown — the auto-migration
 * mustn't break the auto-backup tick.
 */
export async function deleteLegacyDriveBackup(): Promise<void> {
    if (Platform.OS !== 'android') return;
    let connected = false;
    try {
        connected = await isGoogleDriveConnected();
    } catch {
        return;
    }
    if (!connected) return;
    for (const legacyName of [LEGACY_V1_DRIVE_FILE_NAME, LEGACY_V0_DRIVE_FILE_NAME]) {
        try {
            const id = await findDriveBackupIdByName(legacyName);
            if (!id) continue;
            await deleteDriveFileById(id);
        } catch (err) {
            if (__DEV__) console.log(`[Ark/Drive] legacy delete "${legacyName}" failed:`, err);
        }
    }
}

/**
 * Legacy back-compat fetch — returns the v1 `ark-backup.cbark` (or
 * v0 `cypher-box-ark-backup.cbark`) entry's content if either exists.
 * Used by the recovery flow's v1-fallback path: when the fingerprint
 * scan misses but a single legacy file exists, the caller try-decrypts
 * with the entered seed and (on success) rewrites it as v2 under the
 * matching per-wallet filename.
 *
 * Returns null when no legacy file exists.
 *
 * Kept under the original `downloadArkBackupFromDrive` name for back-
 * compat with consumers (RecoverArkScreen) that haven't migrated to
 * the fingerprint-keyed flow yet — rewired in Slice 3.
 *
 * @deprecated Use `findDriveBackupByFingerprint` for fingerprint-keyed
 *   recovery, or `downloadDriveBackupByFingerprint` for fast-path
 *   reads.
 */
export async function downloadArkBackupFromDrive(): Promise<string | null> {
    // Try the v1 legacy filename first (more common), v0 second.
    const idV1 = await findDriveBackupIdByName(LEGACY_V1_DRIVE_FILE_NAME);
    if (idV1) return downloadDriveFileById(idV1);
    const idV0 = await findDriveBackupIdByName(LEGACY_V0_DRIVE_FILE_NAME);
    if (idV0) return downloadDriveFileById(idV0);
    return null;
}

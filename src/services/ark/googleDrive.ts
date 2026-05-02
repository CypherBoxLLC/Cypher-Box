import { Platform } from 'react-native';

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

/** Filename used inside the appDataFolder. Stable so we overwrite the
 * single rolling backup rather than littering Drive with N versions
 * (Drive does keep its own version history under the hood for paid
 * tiers, but we don't depend on that). */
const DRIVE_FILE_NAME = 'ark-backup.cbark';
/**
 * Legacy Drive filename from earlier dev builds. Used by the lookup helper
 * (in `findDriveFileId`) so a user who took an OAuth-connected backup before
 * the rename still has their backup discoverable. The next upload writes
 * the new name; we never write the legacy name again.
 */
const LEGACY_DRIVE_FILE_NAME = 'cypher-box-ark-backup.cbark';

/** OAuth scopes — minimal: app-scoped Drive folder only. */
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.appdata'];

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
 */
export async function isGoogleDriveConnected(): Promise<boolean> {
    const GoogleSignin = loadGoogleSignin();
    if (!GoogleSignin) return false;
    try {
        const isSignedIn = await GoogleSignin.isSignedIn?.();
        return !!isSignedIn;
    } catch (err) {
        if (__DEV__) console.log('[Ark/Drive] isSignedIn probe failed:', err);
        return false;
    }
}

/**
 * Trigger the Google Sign-In flow. Resolves true on success, false on
 * user-dismissed / failed. Failure cases are non-fatal at the wallet
 * level — Drive is an optional rail; the local encrypted backup still
 * runs regardless.
 */
export async function connectGoogleDrive(): Promise<boolean> {
    const GoogleSignin = loadGoogleSignin();
    if (!GoogleSignin) return false;
    try {
        await GoogleSignin.hasPlayServices?.();
        await GoogleSignin.signIn();
        return true;
    } catch (err: any) {
        if (__DEV__) {
            console.log('[Ark/Drive] sign-in failed:', err?.code ?? err?.message ?? err);
        }
        return false;
    }
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

/**
 * Look up the existing backup file's Drive ID inside `appDataFolder`,
 * if any. Returns null when no prior upload has happened. Used to
 * decide between PATCH (update existing) vs POST (create new) on
 * subsequent uploads — Drive doesn't have a "createOrUpdate" verb;
 * we have to do the lookup ourselves.
 */
async function findExistingBackupId(): Promise<string | null> {
    const token = await getAccessToken();
    // Match either the new or legacy filename so a user who uploaded a
    // backup before the rename still has it discoverable. The next upload
    // will write the new name; old `cypher-box-ark-backup.cbark` entries
    // get overwritten by a PATCH on the same Drive ID.
    const query = `name='${DRIVE_FILE_NAME}' or name='${LEGACY_DRIVE_FILE_NAME}'`;
    const url =
        'https://www.googleapis.com/drive/v3/files' +
        `?spaces=appDataFolder` +
        `&fields=files(id,name,modifiedTime)` +
        `&q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Drive list failed: ${resp.status} ${body}`);
    }
    const json = await resp.json();
    const files = (json?.files as Array<{ id: string; name: string; modifiedTime?: string }>) ?? [];
    if (files.length === 0) return null;
    // Prefer the new-name entry if both exist; otherwise return the one we got.
    const newName = files.find(f => f.name === DRIVE_FILE_NAME);
    return (newName ?? files[0]).id;
}

/**
 * Upload (or update) the encrypted backup blob into the appDataFolder.
 * Uses Drive's multipart/related upload so metadata + content go in one
 * request — simpler than the resumable protocol for a small (< 1 MB)
 * blob and works fine over typical mobile connections.
 *
 * Returns the Drive file ID on success. Throws on auth / network /
 * quota failures; caller should swallow and surface a non-blocking
 * toast — the local backup is still good.
 */
export async function uploadArkBackupToDrive(blob: string): Promise<string> {
    const token = await getAccessToken();
    const existingId = await findExistingBackupId();

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
              name: DRIVE_FILE_NAME,
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
 * Pull the most recent backup blob down from Drive's appDataFolder.
 * Returns null if no backup exists for this Google account / app combo
 * (e.g. fresh install on a new device that hasn't backed up yet, or
 * the user signed in with the wrong account).
 *
 * Caller treats this as the bytes equivalent of `RNFS.readFile(
 * AUTO_BACKUP_PATH)` — pass straight to `restoreArkBackupBlob`.
 */
export async function downloadArkBackupFromDrive(): Promise<string | null> {
    const token = await getAccessToken();
    const id = await findExistingBackupId();
    if (!id) return null;

    const url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Drive download failed: ${resp.status} ${body}`);
    }
    return resp.text();
}

package io.cypherbox.btc;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.UriPermission;
import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.documentfile.provider.DocumentFile;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Native bridge for the user-chosen Storage Access Framework (SAF) folder
 * Ark backup channel.
 *
 * Why this exists: Android's `Documents/ark-backup.cbark` (the existing
 * always-on local backup) lives inside the app's private storage and is
 * wiped on uninstall. Google Drive (the existing off-device channel) is
 * great when present but depends on Play Services + a registered Google
 * account + working OAuth client config (the 2026-05-05 loss-event was a
 * silent OAuth misconfig). A user-picked SAF folder is the only Android
 * channel that:
 *   - lives outside the app sandbox, so it survives uninstall
 *   - is visible to the user in the Files app, so they can verify it
 *     and copy it off the device manually if they want
 *   - doesn't require a Google account or a network round-trip
 *   - doesn't need the WRITE_EXTERNAL_STORAGE permission (which was
 *     removed on Android 11+ for non-system apps anyway)
 *
 * Java side keeps the surface small — JS owns the folder URI, this module
 * just executes the per-call SAF primitives:
 *
 *   takePersistablePermission(uri) — survive reboot
 *   releasePersistablePermission(uri) — disconnect
 *   probePermission(uri) → "ok" | "missing-permission" | "unreachable"
 *   writeBackup(uri, content) — overwrite ark-backup.cbark inside `uri`
 *   readBackup(uri) → content | null
 *
 * The orchestration (do we have a URI saved? auto-write on each sync
 * tick? gate the create flow on a verified write?) lives in JS in
 * src/services/ark/safFolderBackup.ts and src/services/ark/backup.ts.
 *
 * Failure modes worth knowing:
 *   - URI permission can be revoked by the user in
 *     Settings → Apps → Cypher Box → permissions, or implicitly when
 *     the user moves/deletes the chosen folder via the Files app.
 *     SecurityException on read/write surfaces as `E_PERMISSION_REVOKED`
 *     so the JS layer can prompt re-pick.
 *   - DocumentFile.fromTreeUri returns null if the underlying provider
 *     no longer recognises the URI (e.g. SD card removed). We translate
 *     to `E_FOLDER_UNREACHABLE`.
 *
 * Shape note: methods deliberately don't take/return RN ReadableMap so
 * the JS ↔ native cost is just the primitive String fields. The backup
 * blob is JSON text (base64 inside the envelope), so passing it as a
 * String round-trips cleanly without binary corruption.
 */
public class ArkSafBackupModule extends ReactContextBaseJavaModule {

    private static final String NAME = "ArkSafBackup";

    /**
     * Legacy single-wallet filename. Pre–multi-wallet builds wrote one
     * shared file at this name across every wallet on the device — the
     * source of the silent-overwrite data-loss bug fixed in v2 of the
     * envelope format. Multi-wallet builds use `writeBackupNamed` /
     * `readBackupNamed` / `listBackups` with per-wallet filenames keyed
     * by BIP32 master fingerprint (`ark-backup-{fp}.cbark`); this
     * constant only services back-compat for callers still on the old
     * `writeBackup` / `readBackup` entry points and for the legacy-file
     * scan that the recovery flow performs to migrate v1 files.
     */
    private static final String BACKUP_FILE_NAME = "ark-backup.cbark";

    /**
     * File extension shared by every Ark backup file (v0 / v1 / v2). The
     * `listBackups` enumeration filters on this so a user-chosen folder
     * containing other documents (the user picked Internal/Documents
     * because that's their general-purpose dump) doesn't surface
     * unrelated files to the JS-side recovery scan.
     */
    private static final String BACKUP_FILE_EXTENSION = ".cbark";

    /**
     * MIME type registered with SAF when creating the file. octet-stream
     * marks the file as opaque so file managers don't try to render it
     * as text/json (the envelope is JSON but the inner ct field is
     * base64 ciphertext — opening as text leaks nothing useful but
     * looks scary). The .cbark extension stays our own, signalling this
     * is a Cypher Box artefact.
     */
    private static final String BACKUP_MIME = "application/octet-stream";

    /**
     * Persistable permission flags. We always grant both read and write
     * so the verify-roundtrip in writeAndVerifyArkBackup can read what
     * it just wrote without a separate grant call.
     */
    private static final int PERSIST_FLAGS =
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    public ArkSafBackupModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    /**
     * Promote a one-shot SAF tree URI grant (the kind that comes back
     * from ACTION_OPEN_DOCUMENT_TREE / DocumentPicker.pickDirectory) into
     * a persistable grant that survives process death and device reboot.
     *
     * The system caps total persistable grants per app at 128 (Android
     * default); we only ever hold one at a time and release it on
     * disconnect, so we don't worry about exhaustion.
     */
    @ReactMethod
    public void takePersistablePermission(String treeUriString, Promise promise) {
        try {
            Uri treeUri = Uri.parse(treeUriString);
            getReactApplicationContext()
                    .getContentResolver()
                    .takePersistableUriPermission(treeUri, PERSIST_FLAGS);
            promise.resolve(null);
        } catch (SecurityException e) {
            // Caller passed a URI that wasn't actually granted in the
            // current intent — typically means JS forgot to use the
            // exact URI the picker returned, or the picker fell back
            // to a non-persistable result.
            promise.reject("E_PERSIST_DENIED", "URI is not eligible for persistable permission", e);
        } catch (Exception e) {
            promise.reject("E_PERSIST_FAILED", e.getMessage(), e);
        }
    }

    /**
     * Drop the persistable grant. Idempotent — if the grant was already
     * released or the URI is invalid, we resolve silently rather than
     * surfacing an error. Caller has already decided to forget the
     * folder; failing on the cleanup step would just cause a wedged
     * "disconnect" UI.
     */
    @ReactMethod
    public void releasePersistablePermission(String treeUriString, Promise promise) {
        try {
            Uri treeUri = Uri.parse(treeUriString);
            getReactApplicationContext()
                    .getContentResolver()
                    .releasePersistableUriPermission(treeUri, PERSIST_FLAGS);
        } catch (Exception ignored) {
            // best-effort
        }
        promise.resolve(null);
    }

    /**
     * Probe the persisted URI without performing a write. Used at boot
     * (and before each verified-write attempt) to surface re-pick UI
     * before the user expects a successful backup. Returns:
     *   "ok"                 — URI granted, folder reachable + writable
     *   "missing-permission" — URI no longer in the persistable grant
     *                          set (user revoked, or app data was
     *                          partially cleared)
     *   "unreachable"        — grant intact but provider can't resolve
     *                          (folder deleted, SD card removed, etc.)
     */
    @ReactMethod
    public void probePermission(String treeUriString, Promise promise) {
        try {
            Context ctx = getReactApplicationContext();
            Uri treeUri = Uri.parse(treeUriString);

            boolean stillGranted = false;
            List<UriPermission> grants = ctx.getContentResolver().getPersistedUriPermissions();
            for (UriPermission grant : grants) {
                if (grant.getUri().equals(treeUri) && grant.isWritePermission()) {
                    stillGranted = true;
                    break;
                }
            }
            if (!stillGranted) {
                promise.resolve("missing-permission");
                return;
            }

            DocumentFile tree = DocumentFile.fromTreeUri(ctx, treeUri);
            if (tree == null || !tree.canWrite()) {
                promise.resolve("unreachable");
                return;
            }

            promise.resolve("ok");
        } catch (Exception e) {
            // Conservative: any unexpected failure means we shouldn't
            // claim the folder is fine. JS will treat as unreachable.
            promise.resolve("unreachable");
        }
    }

    /**
     * Write `content` (the encrypted .cbark envelope as a UTF-8 JSON
     * string) into `treeUri/ark-backup.cbark`. Creates the file if it
     * doesn't exist; overwrites with mode "wt" (truncate-then-write) if
     * it does.
     *
     * Why "wt": the envelope is variable-length JSON. Without truncate,
     * a smaller new ciphertext leaves the tail of the previous one in
     * the file, producing a malformed JSON envelope on next read. Some
     * SAF providers default to append; "wt" is the explicit
     * truncate-then-write mode.
     *
     * Returns the URI of the written file (a content:// document URI,
     * different from the tree URI we wrote into). JS doesn't currently
     * use this beyond logging, but having it makes the read-back step
     * trivial (read by file URI rather than re-resolving by name).
     */
    @ReactMethod
    public void writeBackup(String treeUriString, String content, Promise promise) {
        try {
            Context ctx = getReactApplicationContext();
            Uri treeUri = Uri.parse(treeUriString);

            DocumentFile tree = DocumentFile.fromTreeUri(ctx, treeUri);
            if (tree == null || !tree.canWrite()) {
                promise.reject(
                        "E_FOLDER_UNREACHABLE",
                        "Backup folder is no longer reachable. Pick the folder again.");
                return;
            }

            DocumentFile target = tree.findFile(BACKUP_FILE_NAME);
            if (target == null || !target.exists()) {
                target = tree.createFile(BACKUP_MIME, BACKUP_FILE_NAME);
                if (target == null) {
                    promise.reject(
                            "E_CREATE_FAILED",
                            "Couldn't create ark-backup.cbark in the chosen folder.");
                    return;
                }
            }

            ContentResolver cr = ctx.getContentResolver();
            // "wt" = write + truncate. Required so a shorter new payload
            // doesn't leave stale tail bytes from the previous payload.
            try (OutputStream out = cr.openOutputStream(target.getUri(), "wt")) {
                if (out == null) {
                    promise.reject("E_OPEN_FAILED", "Couldn't open backup file for writing.");
                    return;
                }
                out.write(content.getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
            promise.resolve(target.getUri().toString());
        } catch (SecurityException e) {
            promise.reject(
                    "E_PERMISSION_REVOKED",
                    "Permission to the backup folder was revoked. Pick the folder again.",
                    e);
        } catch (Exception e) {
            promise.reject("E_WRITE_FAILED", e.getMessage(), e);
        }
    }

    /**
     * Read the most recent backup blob from the user-chosen folder, or
     * resolve to null if no backup file exists in there yet (caller
     * treats null as "no backup" rather than an error).
     */
    @ReactMethod
    public void readBackup(String treeUriString, Promise promise) {
        try {
            Context ctx = getReactApplicationContext();
            Uri treeUri = Uri.parse(treeUriString);

            DocumentFile tree = DocumentFile.fromTreeUri(ctx, treeUri);
            if (tree == null) {
                promise.reject(
                        "E_FOLDER_UNREACHABLE",
                        "Backup folder is no longer reachable. Pick the folder again.");
                return;
            }

            DocumentFile target = tree.findFile(BACKUP_FILE_NAME);
            if (target == null || !target.exists()) {
                promise.resolve(null);
                return;
            }

            ContentResolver cr = ctx.getContentResolver();
            try (InputStream in = cr.openInputStream(target.getUri())) {
                if (in == null) {
                    promise.reject("E_OPEN_FAILED", "Couldn't open backup file for reading.");
                    return;
                }
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] tmp = new byte[8192];
                int n;
                while ((n = in.read(tmp)) > 0) {
                    buf.write(tmp, 0, n);
                }
                promise.resolve(buf.toString(StandardCharsets.UTF_8.name()));
            }
        } catch (SecurityException e) {
            promise.reject(
                    "E_PERMISSION_REVOKED",
                    "Permission to the backup folder was revoked. Pick the folder again.",
                    e);
        } catch (Exception e) {
            promise.reject("E_READ_FAILED", e.getMessage(), e);
        }
    }

    /**
     * Multi-wallet write: same semantics as `writeBackup` but the JS
     * caller supplies the filename. JS uses `ark-backup-{fp}.cbark`
     * (one file per wallet seed) so two wallets sharing the same SAF
     * folder coexist without overwriting each other.
     *
     * Filename validation: a malicious / buggy JS caller could in
     * principle pass `../something` and the SAF provider would happily
     * write outside the chosen tree. Reject any filename containing
     * path separators or `..` defensively. Real callers always pass
     * a flat `ark-backup-<8 hex>.cbark` produced by `getAutoBackupPath`.
     */
    @ReactMethod
    public void writeBackupNamed(String treeUriString, String filename, String content, Promise promise) {
        if (!isSafeFlatFilename(filename)) {
            promise.reject("E_INVALID_FILENAME", "Filename must be a flat file with no path separators.");
            return;
        }
        try {
            Context ctx = getReactApplicationContext();
            Uri treeUri = Uri.parse(treeUriString);

            DocumentFile tree = DocumentFile.fromTreeUri(ctx, treeUri);
            if (tree == null || !tree.canWrite()) {
                promise.reject(
                        "E_FOLDER_UNREACHABLE",
                        "Backup folder is no longer reachable. Pick the folder again.");
                return;
            }

            DocumentFile target = tree.findFile(filename);
            if (target == null || !target.exists()) {
                target = tree.createFile(BACKUP_MIME, filename);
                if (target == null) {
                    promise.reject(
                            "E_CREATE_FAILED",
                            "Couldn't create " + filename + " in the chosen folder.");
                    return;
                }
            }

            ContentResolver cr = ctx.getContentResolver();
            try (OutputStream out = cr.openOutputStream(target.getUri(), "wt")) {
                if (out == null) {
                    promise.reject("E_OPEN_FAILED", "Couldn't open backup file for writing.");
                    return;
                }
                out.write(content.getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
            promise.resolve(target.getUri().toString());
        } catch (SecurityException e) {
            promise.reject(
                    "E_PERMISSION_REVOKED",
                    "Permission to the backup folder was revoked. Pick the folder again.",
                    e);
        } catch (Exception e) {
            promise.reject("E_WRITE_FAILED", e.getMessage(), e);
        }
    }

    /**
     * Multi-wallet read: same semantics as `readBackup` but the JS
     * caller supplies the filename. Resolves to null when the file
     * doesn't exist (caller treats as "no backup with that name in this
     * folder"). Filename safety enforced as in `writeBackupNamed`.
     */
    @ReactMethod
    public void readBackupNamed(String treeUriString, String filename, Promise promise) {
        if (!isSafeFlatFilename(filename)) {
            promise.reject("E_INVALID_FILENAME", "Filename must be a flat file with no path separators.");
            return;
        }
        try {
            Context ctx = getReactApplicationContext();
            Uri treeUri = Uri.parse(treeUriString);

            DocumentFile tree = DocumentFile.fromTreeUri(ctx, treeUri);
            if (tree == null) {
                promise.reject(
                        "E_FOLDER_UNREACHABLE",
                        "Backup folder is no longer reachable. Pick the folder again.");
                return;
            }

            DocumentFile target = tree.findFile(filename);
            if (target == null || !target.exists()) {
                promise.resolve(null);
                return;
            }

            ContentResolver cr = ctx.getContentResolver();
            try (InputStream in = cr.openInputStream(target.getUri())) {
                if (in == null) {
                    promise.reject("E_OPEN_FAILED", "Couldn't open backup file for reading.");
                    return;
                }
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] tmp = new byte[8192];
                int n;
                while ((n = in.read(tmp)) > 0) {
                    buf.write(tmp, 0, n);
                }
                promise.resolve(buf.toString(StandardCharsets.UTF_8.name()));
            }
        } catch (SecurityException e) {
            promise.reject(
                    "E_PERMISSION_REVOKED",
                    "Permission to the backup folder was revoked. Pick the folder again.",
                    e);
        } catch (Exception e) {
            promise.reject("E_READ_FAILED", e.getMessage(), e);
        }
    }

    /**
     * Enumerate every `.cbark` file in the user-chosen folder. The
     * recovery flow uses this to scan-and-header-match: list filenames →
     * read each one's unencrypted envelope header → match by BIP32
     * fingerprint → decrypt the matching file with the entered seed.
     *
     * Only filenames are returned (not URIs); callers re-resolve via
     * `readBackupNamed` for any file they want to open. Keeping the JS
     * surface as flat-string lists rather than URI-laden objects avoids
     * coupling JS to provider-internal URI shapes that vary by Android
     * version.
     *
     * `.cbark`-only filter: protects against a user who picked a
     * general-purpose folder (e.g. Internal Storage/Documents) — we
     * don't surface every PDF / .txt / random content as a candidate.
     */
    @ReactMethod
    public void listBackups(String treeUriString, Promise promise) {
        try {
            Context ctx = getReactApplicationContext();
            Uri treeUri = Uri.parse(treeUriString);

            DocumentFile tree = DocumentFile.fromTreeUri(ctx, treeUri);
            if (tree == null) {
                promise.reject(
                        "E_FOLDER_UNREACHABLE",
                        "Backup folder is no longer reachable. Pick the folder again.");
                return;
            }

            WritableArray names = Arguments.createArray();
            DocumentFile[] children = tree.listFiles();
            if (children != null) {
                for (DocumentFile child : children) {
                    if (child == null || !child.isFile()) continue;
                    String name = child.getName();
                    if (name == null) continue;
                    if (name.toLowerCase().endsWith(BACKUP_FILE_EXTENSION)) {
                        names.pushString(name);
                    }
                }
            }
            promise.resolve(names);
        } catch (SecurityException e) {
            promise.reject(
                    "E_PERMISSION_REVOKED",
                    "Permission to the backup folder was revoked. Pick the folder again.",
                    e);
        } catch (Exception e) {
            promise.reject("E_LIST_FAILED", e.getMessage(), e);
        }
    }

    /**
     * Delete a single per-wallet backup file from the chosen folder.
     * Wallet-delete-scoped: only the named file is removed; every other
     * `.cbark` in the folder (other wallets' backups, the user's own
     * unrelated files) survives. Idempotent — resolves null when the
     * file doesn't exist (caller treats as "already cleaned up").
     *
     * Filename safety enforced as in `writeBackupNamed` / `readBackupNamed`.
     */
    @ReactMethod
    public void deleteBackupNamed(String treeUriString, String filename, Promise promise) {
        if (!isSafeFlatFilename(filename)) {
            promise.reject("E_INVALID_FILENAME", "Filename must be a flat file with no path separators.");
            return;
        }
        try {
            Context ctx = getReactApplicationContext();
            Uri treeUri = Uri.parse(treeUriString);

            DocumentFile tree = DocumentFile.fromTreeUri(ctx, treeUri);
            if (tree == null) {
                promise.reject(
                        "E_FOLDER_UNREACHABLE",
                        "Backup folder is no longer reachable. Pick the folder again.");
                return;
            }

            DocumentFile target = tree.findFile(filename);
            if (target == null || !target.exists()) {
                // Idempotent: nothing to delete. Caller's reconciliation is
                // simpler if "already gone" is success rather than error.
                promise.resolve(null);
                return;
            }

            boolean ok = target.delete();
            if (!ok) {
                promise.reject(
                        "E_DELETE_FAILED",
                        "Couldn't delete " + filename + " in the chosen folder.");
                return;
            }
            promise.resolve(null);
        } catch (SecurityException e) {
            promise.reject(
                    "E_PERMISSION_REVOKED",
                    "Permission to the backup folder was revoked. Pick the folder again.",
                    e);
        } catch (Exception e) {
            promise.reject("E_DELETE_FAILED", e.getMessage(), e);
        }
    }

    /**
     * Defensive: a flat filename has no path separators, no `..`, and is
     * non-empty. Anything else gets rejected at the bridge so a buggy or
     * malicious JS caller can't escape the chosen tree. Real callers
     * pass `ark-backup-<8 hex>.cbark` produced by `getAutoBackupPath`,
     * which is always flat by construction.
     */
    private static boolean isSafeFlatFilename(String name) {
        if (name == null) return false;
        if (name.isEmpty()) return false;
        if (name.indexOf('/') >= 0) return false;
        if (name.indexOf('\\') >= 0) return false;
        if (name.equals(".") || name.equals("..")) return false;
        if (name.contains("..")) return false;
        return true;
    }
}

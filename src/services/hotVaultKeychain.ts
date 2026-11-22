import { Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { randomBytes } from '../../class/rng';

/**
 * Hot Vault seed phrase — iPhone Keychain / Android Keystore storage.
 *
 * Mirrors the Ark Keychain convention (`src/services/ark`) but keyed PER
 * wallet so the app can hold multiple hot vaults without service collision.
 * iOS generic-password Keychain items are uniquely identified by service +
 * account; `getGenericPassword({ service })` returns a single record, so if
 * two wallets shared one service string the second save would shadow the
 * first. Each backup therefore gets its own service suffix.
 *
 * That suffix is a random handle, NOT the walletID. `getAllGenericPasswordServices()`
 * lists service names with no biometric, and the Keychain outlives app delete /
 * reinstall, so a walletID in the service name is a walletID a forensic read can
 * recover without unlocking. A passphrase (hidden) vault's walletID is derived
 * WITH the passphrase, so a walletID that matches no vault in the app would betray
 * that a hidden or deleted vault exists. The walletID lives only inside the
 * biometry-gated seed payload (the account field); the ungated meta carries none.
 * Legacy backups written by older builds use the walletID as the suffix and stay
 * fully readable (their handle just equals the walletID).
 *
 * Two entries per backup:
 *
 *   1. hot-vault-seed-phrase:<ref>           — the mnemonic itself
 *        account:  walletID (only readable behind the gate)
 *        password: BIP39 mnemonic, space-separated
 *        access:   BIOMETRY_ANY_OR_DEVICE_PASSCODE + WHEN_PASSCODE_SET_THIS_DEVICE_ONLY
 *        → FaceID/passcode required on READ; silent on WRITE.
 *
 *   2. hot-vault-meta:<ref>                   — the sidecar
 *        account:  ref (never the walletID)
 *        password: JSON { version, createdAt, label? }
 *        access:   WHEN_PASSCODE_SET_THIS_DEVICE_ONLY, NO accessControl
 *        → READ is free (no biometric); listing can enrich picker rows
 *          without unlocking every backup. Non-sensitive data only.
 *
 * Why two entries instead of packing metadata into the mnemonic blob:
 * reading the mnemonic requires biometric. If metadata rode along with
 * it, we'd need to unlock EVERY backup just to render the picker —
 * triggering N FaceID prompts before the user even chooses one.
 * Separate unprotected meta items let us show human-readable rows
 * ("Backed up Apr 21, 2026") while the seed stays behind the gate.
 *
 * Access control on the seed:
 *   accessControl: BIOMETRY_ANY_OR_DEVICE_PASSCODE
 *     → FaceID / TouchID or device passcode required on READ.
 *     → SAVE is silent (no biometric prompt at write time).
 *   accessible: WHEN_PASSCODE_SET_THIS_DEVICE_ONLY
 *     → Device-bound, never synced to iCloud.
 *     → Survives app reinstall on iOS (Keychain is OS-level).
 *     → Cleared if the user removes their device passcode.
 *
 * This is NOT the primary seed store — BlueWallet's encrypted on-disk wallet
 * list still owns that. Keychain here is an OS-level convenience/recovery
 * channel: a user who wipes app data but keeps the iOS install can recover
 * via biometric unlock instead of having to type 12 words.
 */
const KEYCHAIN_SERVICE_PREFIX = 'hot-vault-seed-phrase';
const KEYCHAIN_META_PREFIX = 'hot-vault-meta';

/**
 * `STORAGE_TYPE.RSA` is the user-authentication-bound Android Keystore cipher
 * (KeystoreRSAECB). On Android, react-native-keychain chooses the cipher at
 * write time: with no strong (Class 3) biometric enrolled it silently falls
 * back from this RSA cipher to KeystoreAESCBC, which is NOT bound to any
 * fingerprint, and the write still resolves successfully. We read the constant
 * defensively so a missing runtime export can never collapse into
 * `undefined !== undefined` and let the gate check below pass by accident.
 * This mirrors src/services/ark/seedKeychain.ts.
 */
const RSA_STORAGE: string =
    (Keychain as unknown as { STORAGE_TYPE?: { RSA?: string } }).STORAGE_TYPE?.RSA ??
    'KeystoreRSAECB';

// `ref` is a backup's service suffix: a random handle for a new backup, or the
// walletID for a legacy one. Reads work the same either way.
const serviceFor = (ref: string): string =>
    `${KEYCHAIN_SERVICE_PREFIX}:${ref}`;

const metaServiceFor = (ref: string): string =>
    `${KEYCHAIN_META_PREFIX}:${ref}`;

/**
 * A random, non-identifying handle for a new backup's two entries. 16 bytes of
 * CSPRNG output as hex (32 chars) so it can never collide with a walletID (a
 * 64-hex getID) — the Recover screen tells legacy from new by that length.
 */
async function newBackupRef(): Promise<string> {
    return (await randomBytes(16)).toString('hex');
}

/**
 * Metadata payload shape — stored as JSON in the unprotected sidecar entry.
 *
 * `version` is a forward-compat guard: if we ever change the shape (add a
 * balance-hint field, encode differently) old entries can be detected and
 * handled without a crash. Bump on breaking changes; readers must tolerate
 * unknown fields.
 *
 * `createdAt` is epoch ms. Picker rows format it to a short local date.
 *
 * `label` is a user-chosen nickname — reserved for a later iteration. Nullable
 * so v1 writers can skip it entirely.
 */
export interface HotVaultMeta {
    version: 1;
    createdAt: number;
    label?: string | null;
    // DELIBERATELY NO `hasPassphrase`.
    //
    // It used to live here so keychain recovery could prompt for the passphrase
    // after the biometric read, on the reasoning that it "reveals only that
    // protection exists, never the protection itself". That reveal is the
    // problem. A BIP39 passphrase is a deniability tool: its value is that
    // nobody can tell the hidden wallet exists, so a flag saying one does
    // defeats the feature for anyone holding the unlocked phone.
    //
    // Stale `hasPassphrase` values in sidecars written by older builds are
    // ignored on read (see readHotVaultMeta) rather than migrated, since
    // rewriting them would need the seed and a biometric prompt.
}

export type HotVaultKeychainSaveResult =
    | { ok: true }
    | { ok: false; kind: 'no-biometric-gate'; storage: string }
    | { ok: false; kind: 'error'; error: Error };

/**
 * Persist a hot-vault mnemonic into the OS keychain.
 *
 * Silent on success. On iOS, `setGenericPassword` with
 * `BIOMETRY_ANY_OR_DEVICE_PASSCODE` does NOT prompt biometric at write time —
 * the prompt fires on the later READ. This lets us save during wallet
 * creation without interrupting the "write down your seed" UX.
 *
 * Android downgrade guard (mirrors saveArkSeedToKeychain in
 * src/services/ark/seedKeychain.ts): `BIOMETRY_ANY_OR_DEVICE_PASSCODE` is a
 * REQUEST, not a guarantee. react-native-keychain picks the cipher at write
 * time, and with no strong biometric enrolled it silently falls back from the
 * user-auth-bound RSA cipher to KeystoreAESCBC (NOT auth-bound) and still
 * resolves. Treating that resolved promise as success stored a mnemonic that
 * anyone holding the unlocked phone could read with no prompt, while the UI
 * recorded it as protected. So on Android we inspect the returned storage and,
 * on a downgrade, delete the entry we just wrote and report `no-biometric-gate`
 * rather than leave an un-gated seed the user never agreed to. Callers must
 * surface that case instead of flipping the "backed up" flag.
 */
// `ref` is the service suffix to write under. It defaults to the walletID
// (legacy layout), and `backupHotVaultSeedWithMeta` passes a random handle for a
// new backup. The walletID always rides in the account field, which is only
// readable behind the gate, so it never reaches the ungated service list.
export async function backupHotVaultSeed(
    walletID: string,
    mnemonic: string,
    ref: string = walletID,
): Promise<HotVaultKeychainSaveResult> {
    if (!walletID) {
        return { ok: false, kind: 'error', error: new Error('Missing walletID') };
    }
    const trimmed = (mnemonic || '').trim();
    if (!trimmed) {
        return { ok: false, kind: 'error', error: new Error('Missing mnemonic') };
    }

    let written: false | { storage?: string };
    try {
        written = (await Keychain.setGenericPassword(walletID, trimmed, {
            service: serviceFor(ref),
            accessControl:
                Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
            accessible:
                Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
        })) as false | { storage?: string };
    } catch (err) {
        return { ok: false, kind: 'error', error: err as Error };
    }

    if (!written) {
        return {
            ok: false,
            kind: 'error',
            error: new Error('keychain write returned false'),
        };
    }

    // Android only. On iOS the Keychain enforces the access control itself and
    // reports storage 'keychain', so there is no silent downgrade to detect.
    if (Platform.OS === 'android') {
        const storage = written.storage ?? 'unknown';
        if (storage !== RSA_STORAGE) {
            console.warn(
                '[HotVault] biometric gate NOT applied (storage=', storage,
                '). Removing the un-gated entry rather than storing an unprotected seed.',
            );
            try {
                await Keychain.resetGenericPassword({ service: serviceFor(ref) });
            } catch (resetErr) {
                // Best effort. Reported either way, so the caller never claims
                // the seed is protected when it is not.
                console.warn('[HotVault] failed to remove un-gated entry:', resetErr);
            }
            return { ok: false, kind: 'no-biometric-gate', storage };
        }
    }

    return { ok: true };
}

/**
 * Write the unprotected metadata sidecar for a backup.
 *
 * Intentionally omits `accessControl` → no biometric gate on read. Keep this
 * strictly non-sensitive (no balance, no xpub, no address fingerprint that
 * could be correlated with on-chain activity by someone with device access).
 * Violate that and this becomes a privacy hole.
 *
 * Callers should write meta alongside every seed save (creation, manual
 * Settings backup, recovery re-save) so enumeration always has a companion
 * row. Orphan seed entries (no meta) are treated as legacy — the Recover
 * screen synthesizes a stub with `createdAt: 0` so they still render.
 */
export async function backupHotVaultMeta(
    ref: string,
    meta: Omit<HotVaultMeta, 'version'>,
): Promise<HotVaultKeychainSaveResult> {
    if (!ref) {
        return { ok: false, kind: 'error', error: new Error('Missing ref') };
    }
    try {
        const payload: HotVaultMeta = {
            version: 1,
            createdAt: meta.createdAt,
            label: meta.label ?? null,
            // No passphrase flag is written. See HotVaultMeta.
        };
        // Account is the ref, never the walletID: this entry is ungated, so a
        // walletID here would be readable without the gate, the leak we removed.
        await Keychain.setGenericPassword(
            ref,
            JSON.stringify(payload),
            {
                service: metaServiceFor(ref),
                accessible:
                    Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
            },
        );
        return { ok: true };
    } catch (err) {
        return { ok: false, kind: 'error', error: err as Error };
    }
}

/**
 * Convenience wrapper: write seed + meta atomically from the caller's POV.
 *
 * Not a real transaction — Keychain has no multi-item atomicity — but we do
 * the seed write first so that if meta fails, the recoverable secret is
 * already on disk. A bare seed with no meta is fine (Recover synthesizes a
 * stub); a lingering meta with no seed would be confusing but we'll never
 * hit that state from this function (meta is written second).
 *
 * `createdAt` defaults to `Date.now()` — callers only need to pass a custom
 * value when rehydrating from a known timestamp (e.g. import flow).
 */
export type HotVaultSeedWithMetaResult =
    | { ok: true; ref: string }
    | { ok: false; kind: 'no-biometric-gate'; storage: string }
    | { ok: false; kind: 'error'; error: Error };

export async function backupHotVaultSeedWithMeta(
    walletID: string,
    mnemonic: string,
    meta?: Partial<Omit<HotVaultMeta, 'version'>>,
): Promise<HotVaultSeedWithMetaResult> {
    // One random handle for both entries, so the seed and its sidecar pair up on
    // read without the walletID appearing in either service name.
    const ref = await newBackupRef();
    const seedResult = await backupHotVaultSeed(walletID, mnemonic, ref);
    if (!seedResult.ok) return seedResult;
    const metaResult = await backupHotVaultMeta(ref, {
        createdAt: meta?.createdAt ?? Date.now(),
        label: meta?.label ?? null,
    });
    // Deliberately don't bubble up meta failures — the seed is saved, and a
    // missing meta row just falls back to a walletID-only picker row. That's
    // strictly better than pretending the whole save failed.
    if (!metaResult.ok) {
        // Meta is a non-seed write with no accessControl, so it never reports
        // 'no-biometric-gate'; narrow defensively anyway so this compiles
        // against the shared result type.
        const detail =
            metaResult.kind === 'error' ? metaResult.error : metaResult.storage;
        console.warn('[HotVault] Meta save failed, seed saved OK:', detail);
    }
    return { ok: true, ref };
}

export type HotVaultKeychainReadResult =
    | { ok: true; mnemonic: string; walletID: string }
    | { ok: false; reason: 'not-found' | 'read-failed'; error?: Error };

/**
 * Retrieve a hot-vault mnemonic from Keychain.
 *
 * **Triggers biometric / passcode prompt** — call only in response to an
 * explicit user action (e.g. "Recover from Keychain"). Do not call on boot
 * or during background sync, or the user will see unexplained FaceID
 * prompts.
 *
 * `not-found` is distinguished from `read-failed` so the UI can tell "never
 * backed up" apart from "backup exists but we couldn't read it (biometric
 * declined / Keychain error)".
 */
export async function getHotVaultSeedFromKeychain(
    ref: string,
): Promise<HotVaultKeychainReadResult> {
    if (!ref) {
        return {
            ok: false,
            reason: 'read-failed',
            error: new Error('Missing ref'),
        };
    }
    try {
        const creds = await Keychain.getGenericPassword({
            service: serviceFor(ref),
        });
        if (!creds || !creds.password) {
            return { ok: false, reason: 'not-found' };
        }
        // The walletID is the gated account. A legacy entry stored it there too,
        // so this is uniform; `ref` is only a fallback for a malformed record.
        return { ok: true, mnemonic: creds.password, walletID: creds.username || ref };
    } catch (err) {
        return { ok: false, reason: 'read-failed', error: err as Error };
    }
}

/**
 * Read the (unprotected) metadata sidecar for a given wallet.
 *
 * Does NOT trigger biometric — meta items are stored without accessControl.
 * Returns null when the entry is missing or malformed; callers should treat
 * null as "legacy backup" and fall back to walletID-only rendering rather
 * than surfacing an error.
 *
 * Malformed JSON is logged-and-nulled rather than thrown because a single
 * corrupt meta shouldn't break the entire Recover screen.
 */
export async function getHotVaultMeta(
    ref: string,
): Promise<HotVaultMeta | null> {
    if (!ref) return null;
    try {
        const creds = await Keychain.getGenericPassword({
            service: metaServiceFor(ref),
        });
        if (!creds || !creds.password) return null;
        const parsed = JSON.parse(creds.password);
        if (
            typeof parsed !== 'object' ||
            parsed === null ||
            typeof parsed.createdAt !== 'number'
        ) {
            console.warn('[HotVault] Meta shape invalid for', ref);
            return null;
        }
        return {
            version: 1,
            createdAt: parsed.createdAt,
            label: typeof parsed.label === 'string' ? parsed.label : null,
            // A legacy `parsed.hasPassphrase` is deliberately DROPPED rather
            // than surfaced. Recovery is passphrase-agnostic now, so nothing
            // may branch on it: acting on the flag is what told anyone holding
            // the phone that a hidden wallet existed. See HotVaultMeta.
        };
    } catch (err) {
        console.warn('[HotVault] Meta read failed for', ref, err);
        return null;
    }
}

/**
 * Enumerate all hot-vault Keychain backups on this device.
 *
 * Returns an array of backup handles (the service suffix): a random handle for a
 * new backup, the walletID for a legacy one. The walletID of a new backup is NOT
 * here by design — it only lives behind the gate. Safe to call at any time:
 * `getAllGenericPasswordServices` only lists service strings — it does NOT read
 * passwords, so no biometric prompt fires.
 *
 * Filters strictly on the seed-phrase prefix so that meta entries (same-app,
 * different prefix) aren't double-counted. The meta list is derived lazily
 * by `listHotVaultKeychainBackupsWithMeta`.
 *
 * This is the fresh-install recovery entry point: on a new install the
 * zustand store is empty, but iOS Keychain persists across reinstalls, so
 * enumeration is how we surface "you have X backed-up hot vault(s) on this
 * device — recover?" without requiring the user to remember a walletID.
 *
 * Ordering is implementation-defined; caller should not rely on it.
 */
export async function listHotVaultKeychainBackups(): Promise<string[]> {
    try {
        const services = await Keychain.getAllGenericPasswordServices();
        const prefix = `${KEYCHAIN_SERVICE_PREFIX}:`;
        return services
            .filter(s => s.startsWith(prefix))
            .map(s => s.slice(prefix.length));
    } catch (err) {
        console.warn('[HotVault] Keychain enumeration failed:', err);
        return [];
    }
}

export interface HotVaultBackupSummary {
    // The backup handle (service suffix): random for a new backup, the walletID
    // for a legacy one. The real walletID of a new backup is known only after the
    // gated seed read; recovery carries it out of getHotVaultSeedFromKeychain.
    ref: string;
    meta: HotVaultMeta | null;
}

/**
 * Enumerate backups AND fetch each meta sidecar.
 *
 * Concurrent meta reads via Promise.all — meta reads are free (no biometric),
 * so we don't bother serializing or bailing on first error. `meta: null`
 * means "legacy backup with no sidecar" — UI renders these as a fallback
 * row with just the walletID, sorted to the bottom.
 *
 * Returns results sorted newest-first by `createdAt`. Legacy entries
 * (`meta === null`) sink to the bottom with an implicit `createdAt` of 0.
 * This is the primary data source for the Recover screen's picker.
 */
export async function listHotVaultKeychainBackupsWithMeta(): Promise<HotVaultBackupSummary[]> {
    const refs = await listHotVaultKeychainBackups();
    const summaries = await Promise.all(
        refs.map(async ref => ({
            ref,
            meta: await getHotVaultMeta(ref),
        })),
    );
    return summaries.sort((a, b) => {
        const at = a.meta?.createdAt ?? 0;
        const bt = b.meta?.createdAt ?? 0;
        return bt - at;
    });
}

/**
 * Remove a hot-vault mnemonic from Keychain.
 *
 * Idempotent: resetting a non-existent entry is not an error. Returns
 * `true` on success (including no-op), `false` if the Keychain call itself
 * threw — in which case the caller should warn but not treat as fatal,
 * since a best-effort delete is usually what we want on wallet removal.
 *
 * Does NOT remove the meta sidecar — use `resetHotVaultBackupFully` for
 * that. Kept granular so callers who only want to nuke the secret (e.g. a
 * hypothetical "lock seed" feature) can do so without losing the timestamp.
 */
export async function resetHotVaultKeychainBackup(
    ref: string,
): Promise<boolean> {
    if (!ref) return false;
    try {
        await Keychain.resetGenericPassword({ service: serviceFor(ref) });
        return true;
    } catch (err) {
        console.warn('[HotVault] Keychain reset failed:', err);
        return false;
    }
}

/**
 * Remove the metadata sidecar for a given wallet. Idempotent.
 *
 * Usually called together with `resetHotVaultKeychainBackup` via
 * `resetHotVaultBackupFully`. Exposed standalone for defensive cleanup
 * paths (e.g. enumeration found a meta entry with no matching seed).
 */
export async function resetHotVaultMeta(ref: string): Promise<boolean> {
    if (!ref) return false;
    try {
        await Keychain.resetGenericPassword({
            service: metaServiceFor(ref),
        });
        return true;
    } catch (err) {
        console.warn('[HotVault] Meta reset failed:', err);
        return false;
    }
}

/**
 * Android: removes Hot Vault seed copies that open without the fingerprint, and returns their wallet IDs.
 *
 * Before backupHotVaultSeed checked the cipher (0.1.12 and earlier), a phone without a strong biometric stored the
 * copy with KeystoreAESCBC, which the app reads back with no prompt, so anyone holding the unlocked phone could bring
 * the seed back, even after the vault was deleted in the app. Those copies still showed as saved. The cipher is read
 * from the entry's record without opening it (hasInternetCredentials reads the same record a generic password writes,
 * keyed by the service), so this never prompts. A copy whose cipher can't be read is left alone. iOS has nothing to
 * do: its Keychain items carry their access control.
 */
export async function dropUnprotectedHotVaultBackups(walletIDsInApp: readonly string[]): Promise<string[]> {
    if (Platform.OS !== 'android') return [];
    // Only for vaults still in the app, whose seed is in the wallet list as well. A copy whose vault was deleted (delete
    // keeps it on purpose, and Recover offers it back) can be the only copy of that seed left on the phone: it stays.
    const inApp = new Set(walletIDsInApp);
    const dropped: string[] = [];
    for (const walletID of await listHotVaultKeychainBackups()) {
        if (!inApp.has(walletID)) continue;
        let storage: string | null = null;
        try {
            const found = await Keychain.hasInternetCredentials(serviceFor(walletID));
            storage = found && typeof found === 'object' && typeof (found as { storage?: unknown }).storage === 'string'
                ? (found as { storage: string }).storage
                : null;
        } catch {
            storage = null;
        }
        if (storage === null || storage === RSA_STORAGE) continue;
        console.warn('[HotVault] removing a Keychain copy not bound to a fingerprint (storage=', storage, ')');
        // the seed entry going is what counts (its saved flag must clear then), even if the sidecar can't be removed
        if (await resetHotVaultKeychainBackup(walletID)) {
            await resetHotVaultMeta(walletID);
            dropped.push(walletID);
        }
    }
    return dropped;
}

/**
 * Remove BOTH the mnemonic and its meta sidecar for a wallet.
 *
 * This is the "delete this backup" user action. Returns `true` only if both
 * deletes reported success — callers that want best-effort semantics can
 * ignore the return value. A partial failure (seed gone, meta stays or
 * vice-versa) is non-fatal: the Recover screen's listing is tolerant of
 * either half being missing.
 */
export async function resetHotVaultBackupFully(
    ref: string,
): Promise<boolean> {
    const seedOk = await resetHotVaultKeychainBackup(ref);
    const metaOk = await resetHotVaultMeta(ref);
    return seedOk && metaOk;
}

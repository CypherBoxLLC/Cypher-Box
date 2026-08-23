import * as Keychain from 'react-native-keychain';

/**
 * Hot Vault seed phrase — iPhone Keychain / Android Keystore storage.
 *
 * Mirrors the Ark Keychain convention (`src/services/ark`) but keyed PER
 * wallet so the app can hold multiple hot vaults without service collision.
 * iOS generic-password Keychain items are uniquely identified by service +
 * account; `getGenericPassword({ service })` returns a single record, so if
 * two wallets shared one service string the second save would shadow the
 * first. Namespacing the service with the walletID sidesteps that entirely.
 *
 * Two entries per wallet:
 *
 *   1. hot-vault-seed-phrase:<walletID>      — the mnemonic itself
 *        account:  walletID
 *        password: BIP39 mnemonic, space-separated
 *        access:   BIOMETRY_ANY_OR_DEVICE_PASSCODE + WHEN_PASSCODE_SET_THIS_DEVICE_ONLY
 *        → FaceID/passcode required on READ; silent on WRITE.
 *
 *   2. hot-vault-meta:<walletID>             — the sidecar
 *        account:  walletID
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

const serviceFor = (walletID: string): string =>
    `${KEYCHAIN_SERVICE_PREFIX}:${walletID}`;

const metaServiceFor = (walletID: string): string =>
    `${KEYCHAIN_META_PREFIX}:${walletID}`;

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
    | { ok: false; error: Error };

/**
 * Persist a hot-vault mnemonic into the OS keychain.
 *
 * Silent on success. On iOS, `setGenericPassword` with
 * `BIOMETRY_ANY_OR_DEVICE_PASSCODE` does NOT prompt biometric at write time —
 * the prompt fires on the later READ. This lets us save during wallet
 * creation without interrupting the "write down your seed" UX.
 */
export async function backupHotVaultSeed(
    walletID: string,
    mnemonic: string,
): Promise<HotVaultKeychainSaveResult> {
    if (!walletID) {
        return { ok: false, error: new Error('Missing walletID') };
    }
    const trimmed = (mnemonic || '').trim();
    if (!trimmed) {
        return { ok: false, error: new Error('Missing mnemonic') };
    }
    try {
        await Keychain.setGenericPassword(walletID, trimmed, {
            service: serviceFor(walletID),
            accessControl:
                Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
            accessible:
                Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
        });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err as Error };
    }
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
    walletID: string,
    meta: Omit<HotVaultMeta, 'version'>,
): Promise<HotVaultKeychainSaveResult> {
    if (!walletID) {
        return { ok: false, error: new Error('Missing walletID') };
    }
    try {
        const payload: HotVaultMeta = {
            version: 1,
            createdAt: meta.createdAt,
            label: meta.label ?? null,
            // No passphrase flag is written. See HotVaultMeta.
        };
        await Keychain.setGenericPassword(
            walletID,
            JSON.stringify(payload),
            {
                service: metaServiceFor(walletID),
                accessible:
                    Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
            },
        );
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err as Error };
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
export async function backupHotVaultSeedWithMeta(
    walletID: string,
    mnemonic: string,
    meta?: Partial<Omit<HotVaultMeta, 'version'>>,
): Promise<HotVaultKeychainSaveResult> {
    const seedResult = await backupHotVaultSeed(walletID, mnemonic);
    if (!seedResult.ok) return seedResult;
    const metaResult = await backupHotVaultMeta(walletID, {
        createdAt: meta?.createdAt ?? Date.now(),
        label: meta?.label ?? null,
    });
    // Deliberately don't bubble up meta failures — the seed is saved, and a
    // missing meta row just falls back to a walletID-only picker row. That's
    // strictly better than pretending the whole save failed.
    if (!metaResult.ok) {
        console.warn(
            '[HotVault] Meta save failed, seed saved OK:',
            metaResult.error,
        );
    }
    return { ok: true };
}

export type HotVaultKeychainReadResult =
    | { ok: true; mnemonic: string }
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
    walletID: string,
): Promise<HotVaultKeychainReadResult> {
    if (!walletID) {
        return {
            ok: false,
            reason: 'read-failed',
            error: new Error('Missing walletID'),
        };
    }
    try {
        const creds = await Keychain.getGenericPassword({
            service: serviceFor(walletID),
        });
        if (!creds || !creds.password) {
            return { ok: false, reason: 'not-found' };
        }
        return { ok: true, mnemonic: creds.password };
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
    walletID: string,
): Promise<HotVaultMeta | null> {
    if (!walletID) return null;
    try {
        const creds = await Keychain.getGenericPassword({
            service: metaServiceFor(walletID),
        });
        if (!creds || !creds.password) return null;
        const parsed = JSON.parse(creds.password);
        if (
            typeof parsed !== 'object' ||
            parsed === null ||
            typeof parsed.createdAt !== 'number'
        ) {
            console.warn('[HotVault] Meta shape invalid for', walletID);
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
        console.warn('[HotVault] Meta read failed for', walletID, err);
        return null;
    }
}

/**
 * Enumerate all hot-vault Keychain backups on this device.
 *
 * Returns an array of walletIDs (with the service prefix stripped). Safe to
 * call at any time: `getAllGenericPasswordServices` only lists service
 * strings — it does NOT read passwords, so no biometric prompt fires.
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
    walletID: string;
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
    const walletIDs = await listHotVaultKeychainBackups();
    const summaries = await Promise.all(
        walletIDs.map(async walletID => ({
            walletID,
            meta: await getHotVaultMeta(walletID),
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
    walletID: string,
): Promise<boolean> {
    if (!walletID) return false;
    try {
        await Keychain.resetGenericPassword({ service: serviceFor(walletID) });
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
export async function resetHotVaultMeta(walletID: string): Promise<boolean> {
    if (!walletID) return false;
    try {
        await Keychain.resetGenericPassword({
            service: metaServiceFor(walletID),
        });
        return true;
    } catch (err) {
        console.warn('[HotVault] Meta reset failed:', err);
        return false;
    }
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
    walletID: string,
): Promise<boolean> {
    const seedOk = await resetHotVaultKeychainBackup(walletID);
    const metaOk = await resetHotVaultMeta(walletID);
    return seedOk && metaOk;
}

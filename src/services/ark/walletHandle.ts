import RNFS from 'react-native-fs';
import * as Keychain from 'react-native-keychain';

import {
    OnchainWallet,
    OnchainWalletInterface,
    Wallet,
    WalletInterface,
    uniffiInitAsync,
} from '@secondts/bark-react-native';

import { createArkConfig } from './config';
import { ensureArkDatadir } from './datadir';

const KEYCHAIN_SERVICE = 'ark-seed-phrase';

let handle: WalletInterface | null = null;
let onchainHandle: OnchainWalletInterface | null = null;
let uniffiReady: Promise<void> | null = null;

// In-memory mnemonic cache. Populated whenever the wallet is opened/created
// so other modules (e.g. the auto-backup routine) can read the seed without
// hitting Keychain — which on some iOS configurations triggers a biometric
// prompt. Only ever holds one value (there is exactly one Ark wallet per
// session). Cleared when the handle is torn down so a dangling mnemonic
// string can't outlive its wallet.
let cachedMnemonic: string | null = null;

// Last on-chain (BDK) balance observed by syncArkWallet, in sats. fetchArkBalance
// reads THIS instead of making its own onchain.balance() call: that call races
// with syncArkWallet's concurrent sync/board operations on the same UniFFI
// handle and intermittently returns 0 (or throws), which hid the boarding
// bucket from the UI. syncArkWallet's read is taken right after onchain.sync()
// and is reliable, so we cache it as the single source of truth.
let lastOnchainConfirmedSats = 0;
let lastOnchainPendingSats = 0;

export function setLastOnchainBalanceSats(confirmedSats: number, pendingSats: number): void {
    lastOnchainConfirmedSats = confirmedSats;
    lastOnchainPendingSats = pendingSats;
}

export function getLastOnchainBalanceSats(): { confirmedSats: number; pendingSats: number } {
    return { confirmedSats: lastOnchainConfirmedSats, pendingSats: lastOnchainPendingSats };
}

// Lazy-require avoids the import cycle with `./movementWatcher`, which itself
// imports `getArkWalletHandle` from this file (and transitively
// `runBackgroundRefresh` whose dependency tree also walks back through here).
// Static ES imports across that cycle work in Hermes but become brittle as
// the orchestrator graph grows; established codebase pattern is to use
// `require()` at the call site for these intra-package back-references.
function startWatcher(): void {
    console.log('[Ark] startWatcher() invoked from walletHandle');
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('./movementWatcher');
        if (typeof mod?.startArkMovementWatcher !== 'function') {
            console.warn('[Ark] movement watcher module loaded but startArkMovementWatcher is', typeof mod?.startArkMovementWatcher);
            return;
        }
        mod.startArkMovementWatcher();
    } catch (err) {
        console.warn('[Ark] movement watcher start failed:', err);
    }
}

async function stopWatcher(): Promise<void> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        await require('./movementWatcher').stopArkMovementWatcher();
    } catch (err) {
        console.warn('[Ark] movement watcher stop failed:', err);
    }
}

/**
 * Return the mnemonic that was used to open the current Ark wallet handle.
 * Returns null if no wallet is open (handle was cleared or never created).
 *
 * Primary consumer: the auto-backup routine in useArkSync, which needs the
 * seed for PBKDF2 key derivation but cannot prompt biometric on a background
 * tick. The auto-backup reads this cached value instead of hitting Keychain.
 */
export function getCachedArkMnemonic(): string | null {
    return cachedMnemonic;
}

function ensureUniffi(): Promise<void> {
    if (!uniffiReady) uniffiReady = uniffiInitAsync();
    return uniffiReady;
}

export function getArkWalletHandle(): WalletInterface | null {
    return handle;
}

/**
 * Idempotent wallet initializer.
 *
 * Tries `Wallet.open(mnemonic)` first. If the datadir is empty (fresh install)
 * or open throws for any other reason, falls back to `Wallet.create`. This
 * makes the "Create Ark Wallet" CTA safe to tap twice in a session without
 * needing the user to nuke the datadir — common during dev, and matches the
 * natural expectation that "create" means "get me a working wallet handle".
 *
 * If the mnemonic doesn't match the existing datadir's wallet, open will
 * throw AND create will throw (datadir occupied). That propagates as the
 * raw BarkError — callers should surface it as "wallet mismatch, clear data".
 *
 * `forceRescan` controls Bark's 4th `Wallet.create` argument:
 *   - `false` (default) → fresh wallet, no ASP query for existing VTXOs.
 *     Right for first-time creates from a brand-new seed: nothing to scan
 *     for, and skipping it shaves the boot time.
 *   - `true` → ask the ASP to enumerate VTXOs owned by this seed's pubkey
 *     and populate the empty datadir with them. This is THE difference
 *     between "type your seed and see your funds" (hot-vault-style) and
 *     "type your seed and get an empty wallet". Recovery callers MUST
 *     pass `true`.
 *
 * Note: rescan only recovers VTXOs the ASP still tracks for this pubkey.
 * VTXOs that were Locked mid-round when the datadir was nuked may not be
 * reconstructible without ASP-side support — that's a Bark protocol
 * limitation, not a client choice we can override.
 */
export async function createArkWallet(
    mnemonic: string,
    forceRescan: boolean = false,
): Promise<WalletInterface> {
    await ensureUniffi();
    const datadir = await ensureArkDatadir();
    const config = createArkConfig();

    try {
        handle = await Wallet.open(mnemonic, config, datadir);
        cachedMnemonic = mnemonic;
        if (__DEV__) console.log('[Ark] Opened existing wallet from datadir');
        startWatcher();
        await tryEagerSpawnOnchainHandle('createArkWallet open');
        return handle;
    } catch (openErr) {
        if (__DEV__) {
            console.log('[Ark] Wallet.open failed, falling back to create (forceRescan=' + forceRescan + '):', openErr);
        }
        // Bark schema-init bug: `Wallet.open` against a fresh datadir
        // creates an empty `bark.sqlite` as a side-effect of just
        // opening the path, then errors with `no such table:
        // bark_properties` because the migration hasn't run. That
        // 0-byte file then blocks the `Wallet.create` fallback (bark
        // sees an existing file and tries to migrate instead of create
        // fresh). A zero-byte file can't contain real wallet state, so
        // nuke it before retrying create. See the gitlab draft for the
        // upstream report.
        try {
            const sqlitePath = `${datadir}/bark.sqlite`;
            const stat = await RNFS.stat(sqlitePath).catch(() => null);
            if (stat && Number((stat as any).size) === 0) {
                await RNFS.unlink(sqlitePath);
                if (__DEV__) console.log('[Ark] cleared 0-byte bark.sqlite trap before create fallback');
            }
        } catch (cleanupErr) {
            console.warn('[Ark] 0-byte sqlite cleanup failed:', cleanupErr);
        }
    }

    handle = await Wallet.create(mnemonic, config, datadir, forceRescan);
    cachedMnemonic = mnemonic;
    if (__DEV__) console.log('[Ark] Created new wallet in datadir (forceRescan=' + forceRescan + ')');
    startWatcher();
    await tryEagerSpawnOnchainHandle('createArkWallet create');
    return handle;
}

export async function openArkWallet(mnemonic: string): Promise<WalletInterface> {
    await ensureUniffi();
    const datadir = await ensureArkDatadir();
    const config = createArkConfig();
    handle = await Wallet.open(mnemonic, config, datadir);
    cachedMnemonic = mnemonic;
    startWatcher();
    await tryEagerSpawnOnchainHandle('openArkWallet');
    return handle;
}

/**
 * Hydrate the wallet handle from a seed obtained outside any foreground
 * UI flow — e.g. a background-refresh wake on a force-quit app where the
 * JS module was just freshly imported and `cachedMnemonic` is null.
 *
 * No-op if a handle is already open. Otherwise delegates to
 * `createArkWallet(mnemonic, false)` which is open-or-create + populates
 * the in-memory mnemonic cache, so subsequent reads of
 * `getCachedArkMnemonic()` work normally for the rest of this process.
 *
 * Pulled out as a separate symbol so the import surface for background
 * callers is narrow and easy to audit.
 */
export async function hydrateArkWalletFromBackgroundSeed(
    mnemonic: string,
): Promise<WalletInterface> {
    if (handle) {
        // Handle survived from a previous foreground session but the onchain
        // handle may not have been spawned yet. Make sure it is, so the
        // next syncArkWallet tick covers the boarding-deposit path. We
        // already have a fresh mnemonic from the caller — bias the cache
        // to it just in case the previous cache was cleared.
        if (!cachedMnemonic) cachedMnemonic = mnemonic;
        await tryEagerSpawnOnchainHandle('hydrateArkWalletFromBackgroundSeed reuse');
        return handle;
    }
    return createArkWallet(mnemonic, false);
}

/**
 * Synchronously shut down the live Rust handles before nulling our JS refs.
 *
 * Why this matters: setting `handle = null` only drops the JS reference. The
 * Rust object — and crucially, the SQLite file descriptors it owns — survive
 * until Hermes garbage-collects, which is asynchronous and unpredictable.
 *
 * For most call sites (e.g. logout) GC eventually catches up and nobody
 * notices. But the recovery path immediately calls `RNFS.unlink(datadir)`
 * followed by `Wallet.create(datadir)` — and SQLite/sled (Bark's underlying
 * stores) get very upset when a fresh DB is opened on a path whose previous
 * inode is still held open by a live process. Manifests as `BarkError.Database`
 * on the create call.
 *
 * `uniffiDestroy()` is the UniFFI escape hatch that calls
 * `ubrn_uniffi_bark_ffi_fn_free_wallet` and runs the Rust drop impl — which
 * closes SQLite cleanly. We swallow exceptions because the worst case (handle
 * was already destroyed / pointer was bad) is exactly the state we're trying
 * to reach.
 */
export async function clearArkWalletHandle(): Promise<void> {
    // Stop the notification watcher BEFORE destroying the handle so its
    // pending `nextNotification()` await unblocks via the holder cancel
    // and the holder's own uniffiDestroy runs while the wallet is still
    // alive. Tearing the wallet down first would leave the holder dangling
    // on a freed Rust pointer.
    //
    // AWAITING is essential: bark's SQLite file descriptors stay pinned
    // until the holder is destroyed inside the watcher's runLoop finally
    // block. If we proceed sync, callers race the watcher's drop and the
    // next Wallet.open/create on the recreated datadir throws
    // BarkError.Database. Confirmed empirically 2026-05-13 (delete vault
    // → immediate create → Database fault on both open and create).
    await stopWatcher();
    if (onchainHandle && typeof (onchainHandle as any).uniffiDestroy === 'function') {
        try {
            (onchainHandle as any).uniffiDestroy();
        } catch (err) {
            if (__DEV__) console.log('[Ark] onchain uniffiDestroy threw:', err);
        }
    }
    if (handle && typeof (handle as any).uniffiDestroy === 'function') {
        try {
            (handle as any).uniffiDestroy();
        } catch (err) {
            if (__DEV__) console.log('[Ark] wallet uniffiDestroy threw:', err);
        }
    }
    handle = null;
    onchainHandle = null;
    cachedMnemonic = null;
    lastOnchainConfirmedSats = 0;
    lastOnchainPendingSats = 0;
}

export function getArkOnchainHandle(): OnchainWalletInterface | null {
    return onchainHandle;
}

/**
 * Lazily spawn the BDK-backed on-chain wallet that sits alongside the Ark
 * wallet (shared seed + datadir). Used for boarding funds into Ark and for
 * the "receive on-chain" address in the Ark receive flow.
 *
 * Mnemonic source preference:
 *   1. The in-process `cachedMnemonic` populated by `createArkWallet` /
 *      `openArkWallet` / `hydrateArkWalletFromBackgroundSeed`. This is the
 *      common path: anything happening *during* an open session reuses the
 *      same seed, no Keychain hit, no biometric prompt, works in background.
 *   2. Keychain fallback for the rare case where this is the very first call
 *      after a hot reload or some other restart where the wallet handle was
 *      restored but the JS-side cache was lost.
 *
 * Cached for the lifetime of the process — flushed by `clearArkWalletHandle`.
 *
 * Throws if the Ark wallet handle isn't open yet (we gate UI access through
 * `isArkAuth`, which already implies a successful open/create).
 */
export async function ensureArkOnchainHandle(): Promise<OnchainWalletInterface> {
    if (onchainHandle) return onchainHandle;
    if (!handle) throw new Error('Ark wallet not initialized');

    let mnemonic = cachedMnemonic;
    if (!mnemonic) {
        const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
        if (!creds || !creds.password) {
            throw new Error('Ark seed not in Keychain — cannot spawn onchain wallet');
        }
        mnemonic = creds.password;
    }

    await ensureUniffi();
    const datadir = await ensureArkDatadir();
    const config = createArkConfig();

    onchainHandle = await OnchainWallet.default_(mnemonic, config, datadir);
    if (__DEV__) console.log('[Ark] Spawned onchain wallet');
    return onchainHandle;
}

/**
 * Best-effort proactive spawn of the on-chain handle right after the Ark
 * wallet handle is opened. Swallows errors — failure here just means the
 * lazy path in `ensureArkOnchainHandle` (or the first call to
 * `getArkOnchainAddress`) will spawn it later.
 *
 * Why eagerly: `syncArkWallet` calls `onchain.sync()` to detect deposits
 * at boarding addresses. If the onchain handle isn't already present, the
 * sync routine skips that step — meaning a board sitting unboarded on
 * chain stays invisible until the user manually opens the receive screen.
 * Eager spawn closes that gap for the cold-start case.
 */
async function tryEagerSpawnOnchainHandle(context: string): Promise<void> {
    try {
        await ensureArkOnchainHandle();
    } catch (err) {
        if (__DEV__) console.log('[Ark] eager onchain spawn skipped (' + context + '):', err);
    }
}

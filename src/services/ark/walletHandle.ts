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
    return handle;
}

export async function openArkWallet(mnemonic: string): Promise<WalletInterface> {
    await ensureUniffi();
    const datadir = await ensureArkDatadir();
    const config = createArkConfig();
    handle = await Wallet.open(mnemonic, config, datadir);
    cachedMnemonic = mnemonic;
    startWatcher();
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
    if (handle) return handle;
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
}

export function getArkOnchainHandle(): OnchainWalletInterface | null {
    return onchainHandle;
}

/**
 * Lazily spawn the BDK-backed on-chain wallet that sits alongside the Ark
 * wallet (shared seed + datadir). Used for boarding funds into Ark and for
 * the "receive on-chain" address in the Ark receive flow.
 *
 * Reads the mnemonic from Keychain on first call (may trigger biometric).
 * Cached for the lifetime of the process — flushed by `clearArkWalletHandle`.
 *
 * Throws if the Ark wallet handle isn't open yet (we gate UI access through
 * `isArkAuth`, which already implies a successful open/create).
 */
export async function ensureArkOnchainHandle(): Promise<OnchainWalletInterface> {
    if (onchainHandle) return onchainHandle;
    if (!handle) throw new Error('Ark wallet not initialized');

    const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (!creds || !creds.password) {
        throw new Error('Ark seed not in Keychain — cannot spawn onchain wallet');
    }

    await ensureUniffi();
    const datadir = await ensureArkDatadir();
    const config = createArkConfig();

    onchainHandle = await OnchainWallet.default_(creds.password, config, datadir);
    if (__DEV__) console.log('[Ark] Spawned onchain wallet');
    return onchainHandle;
}

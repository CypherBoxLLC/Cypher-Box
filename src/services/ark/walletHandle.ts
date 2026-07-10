import RNFS from 'react-native-fs';
import * as Keychain from 'react-native-keychain';

import {
    OnchainWallet,
    OnchainWalletInterface,
    Wallet,
    WalletInterface,
    WalletOpenArgs,
    uniffiInitAsync,
} from '@secondts/bark-react-native';

import { ARK_NETWORK, createArkConfig, ESPLORA_URL, ESPLORA_URLS } from './config';
import { deleteArkDatadir, ensureArkDatadir } from './datadir';

const KEYCHAIN_SERVICE = 'ark-seed-phrase';

let handle: WalletInterface | null = null;
let onchainHandle: OnchainWalletInterface | null = null;
let uniffiReady: Promise<void> | null = null;

// The esplora endpoint the main wallet successfully opened against this
// session. The boot retry loop (restore.ts) rotates providers on bot-block,
// so this is NOT necessarily the default — and the on-chain (BDK) handle
// must use the SAME one, or it gets pinned to a provider that's currently
// blocking us and every board-detection sync fails with BarkError.Network
// while the main wallet is perfectly healthy on the other provider.
// (Observed live 2026-07-07: wallet opened via mempool.space after
// blockstream blocked it, but the onchain handle still hit blockstream.)
let sessionEsploraUrl: string = ESPLORA_URL;

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

/**
 * Cache the mnemonic for a self-heal re-open WITHOUT a Keychain read.
 *
 * The Ark seed Keychain entry is stored with BIOMETRY_ANY_OR_DEVICE_PASSCODE,
 * so every Keychain read prompts FaceID/passcode. `restoreArkWalletFromDisk`
 * reads it once at boot; we cache it here immediately so that if the open
 * fails, the sync-loop self-heal (`reopenArkWalletFromCache`) can retry the
 * open reusing this value with no repeat biometric prompt. Deliberately
 * cached even when the subsequent open fails and the handle stays null —
 * `clearArkWalletHandle` flushes it on teardown, and every consumer of
 * `getCachedArkMnemonic` already gates on an open handle first.
 */
export function cacheArkMnemonicForReopen(mnemonic: string): void {
    cachedMnemonic = mnemonic;
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

    // bark 0.11.3 consolidated open-or-create into a single `Wallet.open` with
    // `createIfNotExists`, so the old open-then-catch-then-`Wallet.create`
    // fallback (and the 0-byte `bark.sqlite` trap that sat between them)
    // collapse to one call. If the 0-byte-sqlite schema-init bug still occurs
    // with the consolidated open, re-add a guarded cleanup here — verify during
    // device testing.
    //
    // ⚠ UNRESOLVED — blocks recovery-from-seed. bark 0.11.3 removed the
    // `forceRescan` argument the old `Wallet.create` took and exposes no rescan
    // entry point in its type surface. Our recover flow relies on it to
    // reconstruct VTXOs from the ASP for a restored seed. Until Second.tech
    // confirms the 0.11.3 rescan path, fail LOUD rather than silently open
    // without a rescan (which would hide funds).
    if (forceRescan) {
        throw new Error(
            'Ark rescan (forceRescan) is not yet wired for bark 0.11.3 — the SDK ' +
            'removed the rescan argument. Recovery-from-seed is blocked pending ' +
            'the Second.tech rescan API. Do not ship this path.',
        );
    }

    try {
        handle = await Wallet.open(
            ARK_NETWORK,
            mnemonic,
            config,
            WalletOpenArgs.create({ datadir, createIfNotExists: true }),
        );
    } catch (err) {
        // Guarded cleanup for the poisoned-datadir trap (the cleanup the
        // pre-0.11.3 open-catch-create fallback used to provide). A create
        // that dies mid-flight (esplora unreachable, app killed) leaves a
        // partial datadir bound to a mnemonic that no longer exists; every
        // later create then fails on the mismatch and the user is stuck.
        //
        // Wipe-and-retry ONLY when both hold:
        //   1. The failure is NOT network-shaped. Esplora/ASP outages throw
        //      here too and the datadir is not the problem; wiping on those
        //      would nuke state for nothing.
        //   2. NO ark seed exists in the Keychain. bark cannot open a datadir
        //      without its mnemonic, and the device's only copy lives at
        //      KEYCHAIN_SERVICE; no seed = nothing can ever open this datadir
        //      = failed-create residue. If a seed IS present the datadir may
        //      be a live funded wallet, so never touch it.
        //      getAllGenericPasswordServices is metadata-only (no FaceID);
        //      if the query itself fails, fail SAFE and assume a seed exists.
        const detail = `${(err as { tag?: string })?.tag ?? ''} ${(err as Error)?.message ?? String(err)}`;
        const networkShaped =
            /ServerConnection|Connection|connect|timeout|timed out|network|bad response from server/i.test(detail);
        if (networkShaped) throw err;

        const services = await Keychain.getAllGenericPasswordServices().catch(() => null);
        const seedMayExist = services === null || services.includes(KEYCHAIN_SERVICE);
        if (seedMayExist) {
            console.warn('[Ark] Wallet.create failed with a keychain seed present; NOT wiping datadir:', detail);
            throw err;
        }

        console.warn('[Ark] Wallet.create failed on an orphaned datadir (no keychain seed); wiping residue and retrying once:', detail);
        await clearArkWalletHandle();
        await deleteArkDatadir();
        const freshDatadir = await ensureArkDatadir();
        handle = await Wallet.open(
            ARK_NETWORK,
            mnemonic,
            config,
            WalletOpenArgs.create({ datadir: freshDatadir, createIfNotExists: true }),
        );
        console.log('[Ark] Wallet.create retry after residue wipe succeeded');
    }
    cachedMnemonic = mnemonic;
    if (__DEV__) console.log('[Ark] Opened-or-created wallet in datadir');
    startWatcher();
    await tryEagerSpawnOnchainHandle('createArkWallet open');
    return handle;
}

export async function openArkWallet(
    mnemonic: string,
    opts?: { esploraUrl?: string },
): Promise<WalletInterface> {
    await ensureUniffi();
    const datadir = await ensureArkDatadir();
    // Optional esplora override: the boot retry loop rotates providers
    // when the primary serves a bot-block page instead of chain data
    // (see restore.ts). The chosen endpoint sticks for this session's
    // syncs — that's fine, both providers serve the same chain.
    const chosenEsplora = opts?.esploraUrl || ESPLORA_URL;
    const config = createArkConfig({ esploraAddress: chosenEsplora });
    // Open-only (createIfNotExists: false) — this path must not fabricate a
    // wallet if the datadir is empty; that's createArkWallet's job. bark 0.11.3
    // Wallet.open signature: (network, mnemonic, config, WalletOpenArgs).
    //
    // runDaemon: false (2026-07-09, device-verified). With the daemon on
    // (0.11.3 default), a failing dependency inside Wallet.open blocks with NO
    // timeout (observed 8.75min on a TCP-dead esplora; minutes on a held
    // datadir lock) and the handle stays null behind an opaque hang. With the
    // daemon off, the same failures THROW fast with a readable error, which
    // the boot retry loop (restore.ts) can classify and rotate on. The daemon
    // is redundant here anyway: the app drives its own sync (useArkSync +
    // explicit handle.sync()), and the movement-notification stream was
    // confirmed on device to keep firing without it (1266 notifications over
    // a full send/receive QA session).
    handle = await Wallet.open(
        ARK_NETWORK,
        mnemonic,
        config,
        WalletOpenArgs.create({ datadir, createIfNotExists: false, runDaemon: false }),
    );
    // Pin the on-chain (BDK) handle to the SAME provider that just worked, so
    // board detection doesn't fail against a provider that's blocking us.
    sessionEsploraUrl = chosenEsplora;
    cachedMnemonic = mnemonic;
    startWatcher();
    await tryEagerSpawnOnchainHandle('openArkWallet');
    return handle;
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
 * Drop the on-chain handle and rotate to the next esplora provider, so the
 * next `ensureArkOnchainHandle` re-spawns against a different endpoint.
 * Called by the sync loop when the on-chain sync fails with a network error
 * (the pinned provider started bot-blocking mid-session). No-op if there's
 * only one provider configured. Destroys the old handle to release its
 * SQLite FDs before nulling the ref.
 */
export function rotateArkOnchainEsplora(): void {
    // The onchain sync failed on the current provider. We used to cycle to the
    // NEXT provider in ESPLORA_URLS — but the only fallback is blockstream,
    // which chronically bot-blocks bark's client and (with no SDK-side esplora
    // timeout) hangs the onchain sync ~90s. Observed 2026-07-09: that hang
    // froze the JS thread and starved a stuck fee estimate. So reset to the
    // reliable primary (mempool) instead of rotating onto the bad endpoint. If
    // we're already on the primary, a transient failure just retries it next
    // tick rather than pinning us to a dead provider.
    if (sessionEsploraUrl === ESPLORA_URL) return; // already on primary
    if (onchainHandle && typeof (onchainHandle as any).uniffiDestroy === 'function') {
        try {
            (onchainHandle as any).uniffiDestroy();
        } catch (err) {
            if (__DEV__) console.log('[Ark] onchain rotate destroy threw:', err);
        }
    }
    onchainHandle = null;
    sessionEsploraUrl = ESPLORA_URL;
    if (__DEV__) console.log('[Ark] onchain esplora reset to primary ->', ESPLORA_URL);
}

/**
 * Lazily spawn the BDK-backed on-chain wallet that sits alongside the Ark
 * wallet (shared seed + datadir). Used for boarding funds into Ark and for
 * the "receive on-chain" address in the Ark receive flow.
 *
 * Mnemonic source preference:
 *   1. The in-process `cachedMnemonic` populated by `createArkWallet` /
 *      `openArkWallet`. This is the
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

    // Spawn against the session esplora first (the provider that opened the
    // main wallet), then any others in the rotation. A provider that's
    // bot-blocking us surfaces at spawn or first sync as a network error;
    // trying the alternate keeps board detection alive instead of pinning
    // to a dead endpoint for the whole session.
    const ordered = [sessionEsploraUrl, ...ESPLORA_URLS.filter((u) => u !== sessionEsploraUrl)];
    let lastErr: unknown;
    for (const esploraUrl of ordered) {
        try {
            const config = createArkConfig({ esploraAddress: esploraUrl });
            // bark 0.11.3 OnchainWallet.default_ signature adds a leading network arg.
            onchainHandle = await OnchainWallet.default_(ARK_NETWORK, mnemonic, config, datadir);
            if (__DEV__) console.log('[Ark] Spawned onchain wallet via', esploraUrl);
            return onchainHandle;
        } catch (err) {
            lastErr = err;
            if (__DEV__) console.log('[Ark] onchain spawn failed via', esploraUrl, '-', (err as any)?.message ?? err);
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Failed to spawn onchain wallet');
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

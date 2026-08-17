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
import { ensureBackgroundArkSeed } from './backgroundKeychain';

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
// imports `getArkWalletHandle` from this file. Static ES imports across that
// cycle work in Hermes but become brittle as the module graph grows;
// established codebase pattern is to use `require()` at the call site for
// these intra-package back-references.
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

    // bark consolidated open-or-create into a single `Wallet.open` with
    // `createIfNotExists`; this is the create-open path.
    //
    // Recovery-from-seed (bark 0.15.0): the recovery mailbox scan runs
    // automatically on the open that CREATES the wallet locally, reconstructing
    // the VTXOs the ASP still tracks for this seed. `WalletOpenArgs.skipRecovery`
    // opts out of that scan. We map our `forceRescan` flag straight onto it:
    //   - forceRescan = true  (recover-from-seed) -> skipRecovery = false (scan)
    //   - forceRescan = false (brand-new seed)    -> skipRecovery = true  (skip;
    //     a freshly generated seed has nothing on the mailbox to recover).
    // After a recovery open we read `handle.recoveryReport()` for observability.
    //
    // ⚠ Phase 2 / Second.tech: confirm that an undefined/empty recoveryReport
    // means "nothing to recover" and NOT "scan failed" — bark logs a failed scan
    // and lets open succeed anyway, so the two are fund-safety-distinct (an
    // empty report on a funded seed would silently hide funds). This unblocks the
    // recovery-from-seed path that 0.11.3 could not wire (SDK had no rescan API).
    const skipRecovery = !forceRescan;

    // runDaemon: false on the create/recover path too (matches openArkWallet).
    // The 0.11.3 SDK daemon defaults ON and runs its own maintenance-refresh
    // below JS, which bypasses the "Use immediately" deferral and locks vtxos
    // the user chose to keep spendable. Keep JS the sole refresh driver.
    // Esplora rotation on create (mirrors the restore.ts open loop and
    // ensureArkOnchainHandle below). A public esplora that bot-blocks bark's
    // client, blockstream serves a ~338-byte Cloudflare page in place of chain
    // data, surfacing as "bad response from server (not a blockhash)", would
    // otherwise kill wallet creation outright, since the single-endpoint create
    // had no fallback, unlike recovery which already rotates. attempt 0 is the
    // same primary the old single-endpoint create used, so the happy path is
    // unchanged; only a network-shaped failure rotates to the next provider.
    for (let attempt = 0; attempt < ESPLORA_URLS.length; attempt++) {
        const config = createArkConfig({ esploraAddress: ESPLORA_URLS[attempt] });
        try {
            // bark 0.15.0: create the onchain (BDK) wallet on this same esplora
            // and pin it at open (methods no longer take it per-call). A network
            // failure here is caught below and rotates esplora just like an open
            // failure would.
            const onchain = await OnchainWallet.default_(ARK_NETWORK, mnemonic, config, datadir);
            onchainHandle = onchain;
            handle = await Wallet.open(
                ARK_NETWORK,
                mnemonic,
                config,
                WalletOpenArgs.create({ datadir, createIfNotExists: true, runDaemon: false, onchain, skipRecovery }),
            );
            break;
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
            if (networkShaped) {
                // The datadir is not the problem, so rotate to the next esplora
                // and retry. Throw only after every provider has been tried.
                if (attempt < ESPLORA_URLS.length - 1) {
                    if (__DEV__) console.warn(`[Ark] create via ${ESPLORA_URLS[attempt]} failed (network-shaped: ${detail.trim()}); rotating esplora`);
                    continue;
                }
                throw err;
            }

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
            const onchain = await OnchainWallet.default_(ARK_NETWORK, mnemonic, config, freshDatadir);
            onchainHandle = onchain;
            handle = await Wallet.open(
                ARK_NETWORK,
                mnemonic,
                config,
                WalletOpenArgs.create({ datadir: freshDatadir, createIfNotExists: true, runDaemon: false, onchain, skipRecovery }),
            );
            console.log('[Ark] Wallet.create retry after residue wipe succeeded');
            break;
        }
    }
    if (!handle) {
        // The loop either sets handle + breaks or throws; a null here would be
        // an unexpected fall-through. Throw rather than hand back a null handle
        // (also narrows the type for the return + recoveryReport read below).
        throw new Error('Ark wallet create/open produced no handle');
    }
    cachedMnemonic = mnemonic;
    if (__DEV__) console.log('[Ark] Opened-or-created wallet in datadir');
    // bark 0.15.0: on a recovery open, surface the recovery-scan outcome. An
    // undefined report means the scan was skipped OR failed (see the fund-safety
    // note above); a present report buckets every VTXO the scan looked at.
    if (forceRescan && handle) {
        try {
            const report = handle.recoveryReport();
            console.log(
                '[Ark recover] recoveryReport:',
                report ? JSON.stringify(report) : 'none (skipped or scan failed)',
            );
        } catch (repErr) {
            console.warn('[Ark recover] recoveryReport() threw:', repErr);
        }
    }
    startWatcher();
    // Onchain wallet was created + pinned at open above (bark 0.15.0), so no
    // separate post-open spawn is needed.
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
    // bark 0.15.0: create the onchain (BDK) wallet on the SAME provider and pin
    // it at open (methods no longer take it per-call). A network failure here
    // propagates to the boot retry loop (restore.ts), which rotates esplora just
    // as it does for a Wallet.open failure. Opening an EXISTING wallet
    // (createIfNotExists:false) does not run the recovery scan.
    const onchain = await OnchainWallet.default_(ARK_NETWORK, mnemonic, config, datadir);
    onchainHandle = onchain;
    handle = await Wallet.open(
        ARK_NETWORK,
        mnemonic,
        config,
        WalletOpenArgs.create({ datadir, createIfNotExists: false, runDaemon: false, onchain }),
    );
    // Pin the on-chain (BDK) handle to the SAME provider that just worked, so
    // board detection doesn't fail against a provider that's blocking us.
    sessionEsploraUrl = chosenEsplora;
    cachedMnemonic = mnemonic;
    startWatcher();
    // Background-refresh backstop: while the toggle is on (default), keep a
    // background-readable copy of the seed so a background wake can open the
    // wallet without a biometric prompt. Fire-and-forget; retried on next open.
    void ensureBackgroundArkSeed(mnemonic);
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
    // Advance to the NEXT provider in ESPLORA_URLS, wrapping at the end.
    //
    // This used to "reset to the reliable primary" instead of rotating, written
    // when the primary was mempool and blockstream was the endpoint worth
    // avoiding. The 2026-07-09 flip made blockstream the primary and turned
    // that logic inside out: `sessionEsploraUrl === ESPLORA_URL` is true for a
    // handle already pinned to blockstream, so the early return fired and the
    // on-chain wallet could never rotate off a provider that was bot-blocking
    // it. It retried the dead endpoint every tick forever.
    //
    // The visible damage was on the exit path: `onchain.sync()` kept throwing,
    // `setLastOnchainBalanceSats` was never reached, the exit-fee wallet read 0
    // sats, and Emergency Exit sat gated behind "Fund exit fees first" while the
    // funds were on-chain the whole time. Observed on device 2026-08-16.
    //
    // The wallet-open loop in restore.ts already rotates this way and recovers
    // from the same bot-block, so this brings the on-chain handle in line with it.
    if (ESPLORA_URLS.length < 2) return;
    const current = ESPLORA_URLS.indexOf(sessionEsploraUrl);
    // Unknown current provider (-1) lands on index 0, i.e. the primary.
    const next = ESPLORA_URLS[(current + 1) % ESPLORA_URLS.length];
    if (next === sessionEsploraUrl) return;
    if (onchainHandle && typeof (onchainHandle as any).uniffiDestroy === 'function') {
        try {
            (onchainHandle as any).uniffiDestroy();
        } catch (err) {
            if (__DEV__) console.log('[Ark] onchain rotate destroy threw:', err);
        }
    }
    onchainHandle = null;
    sessionEsploraUrl = next;
    if (__DEV__) console.log('[Ark] onchain esplora rotated ->', next);
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

// bark 0.15.0: the onchain (BDK) wallet is now created and pinned at
// Wallet.open (WalletOpenArgs.onchain) in openArkWallet/createArkWallet, so the
// former `tryEagerSpawnOnchainHandle` post-open backstop is obsolete and was
// removed. `ensureArkOnchainHandle` below remains as the lazy fallback for
// direct on-chain ops (sync/balance) when the cached handle was lost (e.g. hot
// reload) — but note a fallback-spawned handle is NOT pinned to an already-open
// Wallet, so Wallet methods (board/exit) need the handle from open. See the
// migration doc: this is a Phase-2/device-QA item.

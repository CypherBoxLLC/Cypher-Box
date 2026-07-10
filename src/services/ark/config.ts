import { Config, Network } from '@secondts/bark-react-native';

/**
 * Master kill-switch for the Ark feature.
 *
 * Was `__DEV__` (on only in Metro/debug builds). Flipped to `true`
 * unconditionally per Bam: Ark is non-custodial and not subject to any
 * geo-restriction (Second.tech / the ASP doesn't block EU), and the
 * production plan is "Strike + Ark, no Coinos" — so Ark needs to be
 * visible in archive/TestFlight builds for ongoing testing and for
 * eventual production rollout.
 *
 * Note: the original comment flagged that seed-alone recovery cannot
 * restore Ark balance per Bark's docs (encrypted backup/restore is the
 * Phase 2 work). That's still a real footgun for end users — make sure
 * the in-app UX surfaces the "back up your seed AND your VTXO state"
 * warning before going live to non-tester users.
 */
export const FEATURE_ARK_ENABLED = true;

/**
 * Bitcoin standard dust limit (~330 sats at 3 sat/vB). Bark inherits
 * this as the per-VTXO floor: capsules at or below this size are
 * essentially unrecoverable on-chain (the unilateral exit tx would
 * cost more in fees than the VTXO is worth) and the ASP rejects them
 * as round outputs. Used to flag dust capsules in the UI and to
 * pre-block sends that would create sub-dust change.
 *
 * Bark doesn't expose its server-side params via the SDK, so this is
 * a hardcoded constant rather than something we can query at runtime.
 * If Second.tech ever changes their dust policy, update here.
 */
export const ARK_VTXO_DUST_SATS = 330;

/**
 * Empirical minimum size for a VTXO to participate in a refresh round.
 * The ASP rejects refresh requests below this with `BarkError.Internal`
 * (no structured error code) — likely because the round's per-input
 * overhead would exceed the value being refreshed, making the round
 * uneconomic. The threshold lives somewhere on the server and isn't
 * advertised, so this is observed-behavior, not spec.
 *
 * Used as a pre-flight gate on manual + background refreshes so the
 * user gets an actionable message ("combine into a larger capsule
 * first") instead of an opaque round failure.
 */
export const ARK_REFRESH_MIN_SATS = 500;

/**
 * Empirical default TTL for an Arkoor VTXO produced by a Lightning receive.
 *
 * Arkoor VTXOs are out-of-round outputs (typically materialised when the
 * ASP claims a Lightning HTLC into the wallet without batching through a
 * round). The SDK reports `expiryHeight === 0` for them — bark intentionally
 * doesn't surface the ASP-side TTL because it can vary per server. In our
 * mainnet testing against `ark.second.tech` the observed TTL is consistently
 * ~3 days.
 *
 * We use this constant in two places, both UI-only / advisory:
 *   1. The "new Arkoor received" prompt (useArkoorReceivePrompt) — to tell
 *      the user how long they have to refresh.
 *   2. Scheduling 24h + 2h OS-level expiry-warning notifications for
 *      arkoor VTXOs (useArkSync skips them today because expiryHeight=0).
 *
 * If Second.tech ever exposes the real TTL via the SDK (e.g. on
 * `wallet.arkInfo()` or per-VTXO), switch to that and drop the constant.
 */
export const ARK_ARKOOR_ASSUMED_DAYS = 3;

export const ARK_NETWORK: Network = Network.Bitcoin;

export const ARK_SERVER_URL = 'https://ark.second.tech';

// Esplora endpoint used by bark's BDK onchain wallet for chain scans + by
// `Wallet.open` for the initial blockhash query.
//
// History: previously `https://blockstream.info/api`. Blockstream began
// aggressively rate-limiting unauthenticated IPs in 2025 (700 req/hour, 500k
// req/month per IP per their notice) and during heavy dev sessions a single
// machine can blow through the hourly quota in minutes — boot, sync, board,
// recovery, every one hits esplora. The visible failure mode was a misleading
// "Backup file is corrupt: BarkError.ServerConnection" toast on the recovery
// screen (the .cbark was fine; `Wallet.open` was hitting 429 from esplora and
// the catch upstream collapsed every wallet-open failure into one error
// string). See .claude/OPEN_BUGS.md for the full diagnosis trail.
//
// 2026-06-03: switched BACK to blockstream. mempool.space started timing out
// on the exact endpoints `Wallet.open` needs (`/blocks/tip/height`,
// `/block-height/0`) — the open's blockhash query hung (no throw, so no
// `Wallet.create` fallback), and the Ark wallet handle never became ready
// ("[ArkSync] skipped — wallet handle not ready yet" forever). blockstream was
// healthy (~0.5s) on the same endpoints at the time.
//
// 2026-07-07: switched to MEMPOOL primary, blockstream fallback. Across a full
// day of on-device QA blockstream's Cloudflare bot-blocked the client on iOS
// boot, Android boot, the LN-receive claim path, AND the chain-tip fetch
// (serving a 337/338-byte block page in place of chain data), while
// mempool.space served every request cleanly. The provider ROTATION added the
// same day (restore.ts open loop, ensureArkOnchainHandle, chainTip) means this
// is just an ordering preference now, not a hard dependency — if mempool has a
// bad day, every path falls back to blockstream. The durable fix remains a
// dedicated / authenticated esplora endpoint. Flip this pair back if
// mempool's open-endpoint hang (see 2026-06-03) recurs.
//
// 2026-07-09: FLIPPED BACK to blockstream primary — mempool's open-endpoint
// hang recurred on device. On-device probe: mempool.space TCP-connect times out
// (os error 60) so `Wallet.open` attempt 1 ate the full ~8.75min OS timeout on
// every boot before rotating; blockstream served bark's Rust client in 534ms
// (open succeeded on attempt 2 repeatedly). Blockstream 429s the JS `fetch`
// path (chain-tip / fee), but bark's own client is NOT throttled, so the wallet
// open + sync path is healthy on blockstream. mempool stays as fallback for
// when it recovers.
export const ESPLORA_URL = 'https://blockstream.info/api';

/**
 * Esplora rotation order for the wallet-open retry loop (restore.ts), the
 * on-chain handle spawn (ensureArkOnchainHandle), and the JS chain-tip fetch
 * (chainTip.ts). Both public esploras intermittently refuse bark's mobile
 * client — blockstream's Cloudflare serves a bot-block page instead of chain
 * data (the recurring 2026-07-07 failure), and mempool.space has hung outright
 * before (2026-06-03 note above). Rotating across attempts means one provider's
 * throttle no longer bricks startup. Primary is now blockstream (mempool went
 * TCP-unreachable on device 2026-07-09); the fallback covers blockstream
 * throttling for when the pair flaps back.
 *
 * Deliberately no per-attempt watchdog for the mempool hang mode: a hung
 * `Wallet.open` cannot be cancelled, and racing a second open against it
 * targets the same datadir (BarkError.Database or worse). A hang behaves
 * exactly as it did before this list existed.
 */
export const ESPLORA_URLS = [ESPLORA_URL, 'https://mempool.space/api'];

export function createArkConfig(overrides?: Partial<Parameters<typeof Config.create>[0]>) {
    return Config.create({
        serverAddress: ARK_SERVER_URL,
        // serverAccessToken was the beta-only gate at ark.second.tech (removed
        // server-side per Second.tech, 2026-06-12). Field is optional in the
        // SDK; omitting it lets the ASP authenticate the wallet by mnemonic-
        // derived identity alone, same as any other bark client.
        esploraAddress: ESPLORA_URL,
        bitcoindAddress: undefined,
        bitcoindCookiefile: undefined,
        bitcoindUser: undefined,
        bitcoindPass: undefined,
        // bark 0.11.3: `network` moved out of Config into the Wallet.open /
        // OnchainWallet.default_ signatures (passed as ARK_NETWORK there).
        vtxoRefreshExpiryThreshold: undefined,
        vtxoExitMargin: undefined,
        htlcRecvClaimDelta: undefined,
        fallbackFeeRate: undefined,
        roundTxRequiredConfirmations: undefined,
        // bark 0.2.x merged the two daemon sync intervals into one and added
        // a few optional knobs. All optional; left at server defaults.
        daemonSyncIntervalSecs: undefined,
        offboardRequiredConfirmations: undefined,
        daemonManualSync: undefined,
        lightningReceiveClaimRetries: undefined,
        ...overrides,
    });
}

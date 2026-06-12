import { Config, Network } from '@secondts/bark-react-native';
import { BARK_ACCESS_TOKEN } from './secrets';

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
// healthy (~0.5s) on the same endpoints at the time. Both public esploras
// throttle under load and trade places; the durable fix is a dedicated /
// authenticated esplora endpoint.
export const ESPLORA_URL = 'https://blockstream.info/api';

export function createArkConfig(overrides?: Partial<Parameters<typeof Config.create>[0]>) {
    return Config.create({
        serverAddress: ARK_SERVER_URL,
        serverAccessToken: BARK_ACCESS_TOKEN,
        esploraAddress: ESPLORA_URL,
        bitcoindAddress: undefined,
        bitcoindCookiefile: undefined,
        bitcoindUser: undefined,
        bitcoindPass: undefined,
        network: ARK_NETWORK,
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

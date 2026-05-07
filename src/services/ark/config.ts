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

export const ARK_NETWORK: Network = Network.Bitcoin;

export const ARK_SERVER_URL = 'https://ark.second.tech';

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
        daemonFastSyncIntervalSecs: undefined,
        daemonSlowSyncIntervalSecs: undefined,
        ...overrides,
    });
}

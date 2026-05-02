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

import { Config, Network } from '@secondts/bark-react-native';
import { BARK_ACCESS_TOKEN } from './secrets';

/**
 * Master kill-switch for the Ark feature.
 *
 * `__DEV__` = on in Metro/debug builds, off in release/TestFlight/App Store.
 * Flip to `true` unconditionally once Phase 2 (encrypted backup/restore) is
 * green — seed alone cannot recover balance per Bark docs, so a production
 * rollout without backup is a footgun.
 */
export const FEATURE_ARK_ENABLED = __DEV__;

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

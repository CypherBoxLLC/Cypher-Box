export {
    FEATURE_ARK_ENABLED,
    ARK_NETWORK,
    ARK_SERVER_URL,
    ESPLORA_URL,
    createArkConfig,
} from './config';

export { ARK_DATADIR, ensureArkDatadir, deleteArkDatadir } from './datadir';

export { resetArkWalletState } from './reset';

export { recoverArkWalletFromKeychain } from './recover';
export type { ArkRecoveryResult } from './recover';

export { restoreArkWalletFromDisk, hasArkDatadir } from './restore';
export type { ArkRestoreResult } from './restore';

export { createArkLightningInvoice, getArkAddress, getArkOnchainAddress } from './receive';

export {
    getArkWalletHandle,
    createArkWallet,
    openArkWallet,
    clearArkWalletHandle,
    getArkOnchainHandle,
    ensureArkOnchainHandle,
} from './walletHandle';

export { fetchArkBalance } from './balance';
export type { ArkBalanceSummary } from './balance';

export { fetchArkVtxos } from './vtxos';
export type { ArkVtxoView, ArkVtxoList } from './vtxos';

export { tryClaimArkLightningReceives } from './lightning';
export type { ArkLightningReceiveView } from './lightning';

export { fetchArkHistory } from './history';
export type {
    ArkMovementView,
    ArkMovementKind,
    ArkMovementStatus,
} from './history';

export { fetchChainTipHeight, blocksToDays, AVG_BLOCK_MINUTES } from './chainTip';

export { syncArkWallet } from './sync';

export {
    buildArkBackupBlob,
    restoreArkBackupBlob,
    writeArkBackupToTempFile,
} from './backup';

export {
    estimateArkRefreshFee,
    refreshArkVtxos,
    refreshArkVtxosAndSync,
} from './refresh';
export type { ArkRefreshFeeView, ArkRefreshResult } from './refresh';

export {
    classifyArkDestination,
    estimateArkSendFee,
    executeArkSend,
    labelForDestinationKind,
} from './send';
export type {
    ArkDestination,
    ArkDestinationKind,
    ArkSendFeeView,
    ArkSendResult,
} from './send';

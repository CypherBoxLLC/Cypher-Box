export {
    FEATURE_ARK_ENABLED,
    ARK_NETWORK,
    ARK_SERVER_URL,
    ESPLORA_URL,
    createArkConfig,
} from './config';

export { ARK_DATADIR, ensureArkDatadir, deleteArkDatadir } from './datadir';

export { resetArkWalletState } from './reset';

export { recoverArkWalletFromKeychain, readArkSeedPhrase } from './recover';
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
    getCachedArkMnemonic,
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
    AUTO_BACKUP_PATH,
    LEGACY_AUTO_BACKUP_PATH,
    buildArkBackupBlob,
    migrateLegacyBackupFile,
    restoreArkBackupBlob,
    writeArkAutoBackup,
    writeAndVerifyArkBackup,
    writeArkBackupToTempFile,
    clearArkKeyCache,
} from './backup';
export type { VerifiedBackupResult, VerifiedBackupDriveOutcome } from './backup';

export {
    configureGoogleDrive,
    isGoogleDriveConnected,
    connectGoogleDrive,
    disconnectGoogleDrive,
    uploadArkBackupToDrive,
    downloadArkBackupFromDrive,
    getDriveBackupInfo,
    classifyDriveError,
    messageForDriveError,
} from './googleDrive';
export type { DriveErrorClass } from './googleDrive';

export {
    cancelArkPendingRound,
    estimateArkRefreshFee,
    fetchArkPendingRoundStates,
    fetchArkRoundIntervalSecs,
    progressArkPendingRounds,
    refreshArkVtxos,
    refreshArkVtxosAndSync,
} from './refresh';

export {
    claimArkExitsToAddress,
    fetchArkExitVtxos,
    fetchClaimableExitVtxos,
    fetchHasPendingExits,
    fetchPendingExitsTotalSats,
    progressArkExits,
    startArkEmergencyExit,
    syncArkExits,
} from './exit';
export type { ArkRefreshFeeView, ArkRefreshResult } from './refresh';

export {
    runBackgroundRefresh,
    setArkBackgroundRefreshEnabled,
    BG_REFRESH_TUNABLES,
} from './backgroundRefresh';
export type { ArkBgRefreshResult } from './backgroundRefresh';

export {
    readTelemetry as readArkBgRefreshTelemetry,
    clearTelemetry as clearArkBgRefreshTelemetry,
} from './backgroundTelemetry';
export type {
    ArkBgRefreshTrigger,
    ArkBgRefreshOutcome,
    ArkBgRefreshTelemetryEntry,
} from './backgroundTelemetry';

export {
    hasBackgroundArkSeed,
} from './backgroundKeychain';

export {
    ensureBgNotificationPermission,
} from './backgroundNotifications';

export {
    registerArkBackgroundRefreshHandlers,
    scheduleArkBackgroundRefresh,
    cancelArkBackgroundRefresh,
} from './scheduler';

export { hydrateArkWalletFromBackgroundSeed } from './walletHandle';

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

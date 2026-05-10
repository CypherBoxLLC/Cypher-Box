export {
    FEATURE_ARK_ENABLED,
    ARK_NETWORK,
    ARK_SERVER_URL,
    ARK_VTXO_DUST_SATS,
    ARK_REFRESH_MIN_SATS,
    ESPLORA_URL,
    createArkConfig,
} from './config';

export { ARK_DATADIR, ensureArkDatadir, deleteArkDatadir } from './datadir';

export { resetArkWalletState } from './reset';

export {
    checkArkSeedKeychainConflict,
    readArkSeedPhrase,
    recoverArkWalletFromKeychain,
} from './recover';
export type { ArkRecoveryResult, ArkSeedKeychainConflict } from './recover';

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

export { fetchArkBalance, applyExpiredVtxoFilter } from './balance';
export type { ArkBalanceSummary } from './balance';

export { fetchArkVtxos } from './vtxos';
export type { ArkVtxoView, ArkVtxoList } from './vtxos';

export { tryClaimArkLightningReceives, fetchArkPendingLightningReceives } from './lightning';
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
    deleteArkBackupForWallet,
    deleteLocalArkBackup,
    findAutoBackupForRecovery,
    getActiveBackupFingerprint,
    getAutoBackupPath,
    getCachedArkBackupFingerprint,
    getICloudBackupPath,
    isICloudBackupAvailable,
    migrateLegacyBackupFile,
    peekBackupHeader,
    restoreArkBackupBlob,
    writeArkAutoBackup,
    writeAndVerifyArkBackup,
    writeArkBackupToTempFile,
    clearArkKeyCache,
} from './backup';
export { deriveBackupFingerprint, normalizeMnemonic } from './backupFingerprint';
export type { VerifiedBackupResult, VerifiedBackupDriveOutcome } from './backup';

export {
    configureGoogleDrive,
    isGoogleDriveConnected,
    connectGoogleDrive,
    disconnectGoogleDrive,
    uploadArkBackupToDrive,
    downloadArkBackupFromDrive,
    downloadDriveBackupByFingerprint,
    findDriveBackupByFingerprint,
    deleteDriveBackupByFingerprint,
    deleteLegacyDriveBackup,
    getDriveBackupInfo,
    classifyDriveError,
    messageForDriveError,
} from './googleDrive';
export type { DriveErrorClass } from './googleDrive';

export {
    pickSafBackupFolder,
    getSavedSafBackupFolder,
    clearSavedSafBackupFolder,
    probeSafBackupFolder,
    writeArkBackupToSaf,
    readArkBackupFromSaf,
    readSafBackupByFingerprint,
    findSafBackupByFingerprint,
    listSafBackupFilenames,
    deleteSafBackupByFingerprint,
    deleteLegacySafBackup,
    messageForSafError,
} from './safFolderBackup';
export type { SafBackupOutcome, SafErrorClass, SafFolderStatus } from './safFolderBackup';

export {
    classifyPickedBackupBlob,
    lookupArkBackupInLocalDocuments,
    lookupArkBackupInSafFolder,
    lookupArkBackupOnDrive,
} from './findBackup';
export type { ChannelLookupResult } from './findBackup';

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
    isIgnoringBatteryOptimizations,
    openBatteryOptimizationSettings,
    getDeviceManufacturer,
} from './scheduler';

export { vendorGuidance } from './batteryGuidance';
export type { VendorGuidance } from './batteryGuidance';

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

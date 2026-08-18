export {
    FEATURE_ARK_ENABLED,
    ARK_NETWORK,
    ARK_SERVER_URL,
    ARK_VTXO_DUST_SATS,
    ARK_REFRESH_MIN_SATS,
    ARK_ARKOOR_ASSUMED_DAYS,
    ARK_EXIT_RUNWAY_HOURS,
    ARK_SWEEP_MAX_RUNWAY_HOURS,
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

export { restoreArkWalletFromDisk, reopenArkWalletFromCache, ensureArkWalletHandleReady, hasArkDatadir } from './restore';
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

export { estimateArkOnchainRecover, recoverArkOnchainBoard } from './recoverOnchainBoard';
export type { ArkOnchainRecoverEstimate, ArkOnchainRecoverResult } from './recoverOnchainBoard';

export { fetchArkVtxos } from './vtxos';
export type { ArkVtxoView, ArkVtxoList } from './vtxos';

export { tryClaimArkLightningReceives, fetchArkPendingLightningReceives, driveArkPendingLightningSends } from './lightning';
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
    getLastLocalBackupNote,
    getICloudBackupPath,
    getICloudBackupPathForFingerprint,
    isICloudBackupAvailable,
    migrateLegacyBackupFile,
    peekBackupHeader,
    ArkRestoreApplyError,
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
    ArkRefreshInFlightError,
    cancelArkPendingRound,
    estimateArkRefreshFee,
    fetchArkPendingRoundStates,
    fetchArkRoundIntervalSecs,
    fetchArkMinBoardSats,
    maintenanceArkDelegated,
    progressArkPendingRounds,
    refreshArkVtxos,
    refreshArkVtxosAndSync,
    refreshArkVtxosDelegated,
    refreshArkVtxosDelegatedAndSync,
} from './refresh';

export {
    getArkCancelling,
    setArkCancelling,
    useArkCancelling,
} from './cancellingState';

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
export { estimateArkOffboardFee, offboardArkVtxos } from './offboard';
export type { ArkOffboardFeeView } from './offboard';
export {
    computeExitFeeReserveSats,
    convertToExitFees,
    estimateExitFeeConvert,
    fetchFastFeeRateSatPerVb,
    probeAspReachable,
} from './exitFunding';
export type { ExitFeeReserve, ExitFeeConvertEstimate } from './exitFunding';
export type { ArkRefreshFeeView, ArkRefreshResult, ArkDelegatedRefreshResult } from './refresh';

export { setArkBackgroundRefreshEnabled } from './backgroundRefresh';

export { maybeSweepDueArkVtxos } from './foregroundSweep';

export { barkStateTag, isActiveExit } from './barkState';

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
    ensureBgNotificationPermission,
    areBgNotificationsEnabled,
    scheduleVtxoExpiryWarnings,
    cancelVtxoExpiryWarnings,
    scheduleVtxoStuckSwapWarnings,
    cancelVtxoStuckSwapWarnings,
} from './backgroundNotifications';

export { registerArkNotificationTapHandler } from './notificationHandler';

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

export {
    MIN_USEFUL_FUNDING_SATS,
    buildExitFundingSources,
    hasUsableExitFundingSource,
} from './exitFundingSources';
export type {
    ExitFundingSource,
    ExitFundingSourceId,
    ExitFundingSourceState,
} from './exitFundingSources';

export { planExitFunding } from './exitFundingPlan';
export type { ExitFundingPlan, ExitFundingPlanInput } from './exitFundingPlan';
export { fundExitFeesFromCoinos } from './exitFundingCoinos';
export type {
    CoinosExitFundingDeps,
    CoinosExitFundingRequest,
    CoinosExitFundingResult,
} from './exitFundingCoinos';

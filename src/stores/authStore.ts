import { create, GetState, SetState } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "./index";
import type { ArkBalanceSummary, ArkLightningReceiveView, ArkVtxoView } from "@Cypher/services/ark";

export type AuthStateType = {
    user: null | any;
    token: string | null;
    withdrawThreshold: any | null;
    isAuth: boolean | undefined;
    walletID: string | undefined;
    reserveAmount: number;
    coldStorageWalletID: string | undefined;
    vaultTab: boolean;
    // userCreds removed — credentials now stored in secure keychain
    setVaultTab: (state: boolean) => void;
    setReserveAmount: (state: number) => void;
    setAuth: (state: boolean | undefined) => void;
    setWalletID: (state: string | undefined) => void;
    setColdStorageWalletID: (state: string | undefined) => void;
    setToken: (token: string) => void;
    setUser: (state: any) => void;
    setWithdrawThreshold: (state: any) => void;
    clearAuth: () => void;
    clearStrikeAuth: () => void;

    //strike
    strikeMe: any | null;
    walletTab: boolean;
    isStrikeAuth: boolean;
    strikeUser: any | null;
    strikeCurrency: string; // User's Strike account currency (USD, EUR, GBP, AUD, etc.)
    allBTCWallets: string[];
    strikeToken: string | null;
    reserveStrikeAmount: number;
    withdrawStrikeThreshold: any | null;
    matchedRateStrike: number;
    setMatchedRateStrike: (state: number) => void;
    setStrikeMe: (state: any) => void;
    setStrikeUser: (state: any) => void;
    setStrikeCurrency: (state: string) => void;
    setAllBTCWallets: (state: string[]) => void;
    setWalletTab: (state: boolean) => void;
    setStrikeToken: (token: string) => void;
    setReserveStrikeAmount: (state: number) => void;
    setWithdrawStrikeThreshold: (state: any) => void;
    setStrikeAuth: (state: boolean | undefined) => void;

    // first-time tracking
    FirstTimeLightning: boolean;
    FirstTimeCoinOS: boolean;
    FirstTimeArk: boolean;
    hasSeenCustodialWarning: boolean;
    setFirstTimeLightning: (state: boolean) => void;
    setFirstTimeCoinOS: (state: boolean) => void;
    setFirstTimeArk: (state: boolean) => void;
    setHasSeenCustodialWarning: (state: boolean) => void;

    // Hot Vault Keychain backup tracking.
    // Record<walletID, true> — only set after a successful Keychain save.
    // Persisted via zustand `persist` so we can render the "✓ Backed up" state
    // without hitting Keychain (and triggering biometric) on every mount.
    // NOTE: the zustand flag is a UI hint, not ground truth. Ground truth is
    // the Keychain entry itself — which we only read on explicit recovery.
    hotVaultKeychainBackups: Record<string, boolean>;
    setHotVaultKeychainBackup: (walletID: string, backedUp: boolean) => void;

    // Ark (experimental — Second.tech)
    // Non-custodial; no token/credential. We persist a lightweight descriptor:
    //   arkWallet: { id, createdAt, useHotVaultSeed }  — actual secret lives in native/Keychain
    //   arkBalance, thresholds, thresholds behave like Strike/CoinOS for UX parity
    isArkAuth: boolean;
    arkWallet: any | null;
    arkBalance: number;
    // Full Balance breakdown from Bark SDK, in plain number sats (bigints
    // stripped at the service boundary). Null until first successful fetch.
    arkBalanceDetail: ArkBalanceSummary | null;
    // Live VTXO list from wallet.allVtxos(), projected to a plain-number
    // view. Spendable-only subset drives the capsule UI.
    arkVtxos: ArkVtxoView[];
    /**
     * Pending Lightning receives from `wallet.pendingLightningReceives()`.
     *
     * Why this is separate from arkVtxos: between the moment a counterparty
     * pays a Lightning invoice and the moment the resulting VTXO materialises
     * in `allVtxos()` there's a multi-minute gap (the claim has to ride the
     * next Ark round). During that gap the SDK reports the movement as
     * "successful" in history but the spendable balance stays at 0 — users
     * see the receive confirmed yet no capsule and no balance change. This
     * list is the bridge: anything in here with `hasHtlcVtxos === true`
     * is money that has arrived but hasn't yet condensed into a VTXO. The UI
     * renders these as ghost capsules ("Claiming via round…") so the user
     * has a visual signal that something is in flight.
     */
    arkPendingLnReceives: ArkLightningReceiveView[];
    // Current chain tip height (from esplora). Needed to convert VTXO
    // expiryHeight → blocks-until-expiry for the depletion ring.
    arkChainTipHeight: number | null;
    // Timestamp (ms) of the last successful balance+vtxo sync. Used to
    // decide whether to block the UI on a fresh fetch or serve cached.
    arkLastSyncedAt: number | null;
    /**
     * Timestamp (ms) of the last successful encrypted datadir export to a
     * .cbark file. Drives the recoverability badges on the Capsules tab:
     * a Pubkey/Spendable VTXO is only ACTUALLY recoverable if a backup
     * was made AFTER the VTXO appeared.
     *
     * `null` = never backed up. Cleared on reset / disconnect so a stale
     * timestamp from a previous wallet doesn't grant false confidence to
     * the next one.
     */
    arkLastBackupAt: number | null;
    /**
     * Round-cadence in seconds, from the ASP's static config (wallet.arkInfo()).
     * Mainnet ≈ 3600, signet ≈ 300. Used to surface an upper-bound ETA on
     * "Refreshing…" labels — we can't show a real countdown because the SDK
     * doesn't expose `nextRoundAt`. Null until first successful fetch.
     */
    arkRoundIntervalSecs: number | null;
    /**
     * Unilateral-exit state — set when user taps "Emergency Exit" in
     * Settings. While true, `useArkSync` switches modes: it stops issuing
     * normal sync/refresh calls (they'd race the exit machinery) and instead
     * drives `progressArkExits` + `syncArkExits` per tick, then calls
     * `claimArkExitsToAddress` once VTXOs ripen past the CSV timelock.
     *
     * Cleared after the auto-claim succeeds and `resetArkWalletState` runs.
     */
    arkExitInProgress: boolean;
    /**
     * Where the user wants the on-chain funds to land after the timelock.
     * Captured at exit-start so the auto-claim loop has the address without
     * reprompting the user. Bitcoin address (mainnet bech32 / legacy / etc).
     */
    arkExitDestinationAddress: string | null;
    /**
     * Timestamp (ms) of `startArkEmergencyExit` success. Drives the
     * "started X hours ago" UI hint and the post-claim safety check
     * (don't auto-claim on a stale exit-in-progress flag from a crash).
     */
    arkExitStartedAt: number | null;
    arkUseHotVaultSeed: boolean;
    withdrawArkThreshold: any | null;
    reserveArkAmount: number;
    setArkAuth: (state: boolean) => void;
    setArkWallet: (state: any) => void;
    setArkBalance: (state: number) => void;
    setArkBalanceDetail: (state: ArkBalanceSummary | null) => void;
    setArkVtxos: (state: ArkVtxoView[]) => void;
    setArkPendingLnReceives: (state: ArkLightningReceiveView[]) => void;
    setArkChainTipHeight: (state: number | null) => void;
    setArkLastSyncedAt: (state: number | null) => void;
    setArkLastBackupAt: (state: number | null) => void;
    setArkRoundIntervalSecs: (state: number | null) => void;
    setArkExitInProgress: (state: boolean) => void;
    setArkExitDestinationAddress: (state: string | null) => void;
    setArkExitStartedAt: (state: number | null) => void;
    setArkUseHotVaultSeed: (state: boolean) => void;
    setWithdrawArkThreshold: (state: any) => void;
    setReserveArkAmount: (state: number) => void;

    // Background VTXO refresh (opt-in). Default off — see
    // src/services/ark/backgroundRefresh.ts for the policy and
    // src/services/ark/backgroundKeychain.ts for the keychain trade-off
    // the toggle gates.
    arkBgRefreshEnabled: boolean;
    /** Timestamp (ms) of the last successful background round. Drives 12h rate limit + UI status copy. */
    arkBgRefreshLastSuccessAt: number | null;
    /** Outcome of the most recent attempt (success OR otherwise). UI surfaces failures only. */
    arkBgRefreshLastAttempt: {
        at: number;
        outcome: string;
        elapsedMs: number;
        errorMsg: string | null;
    } | null;
    /** Counts only `error` outcomes. Resets to 0 on success. Drives the "couldn't auto-refresh" notification at 2. */
    arkBgRefreshConsecutiveFailures: number;
    /** Set when a post-refresh cloud-backup upload deferred (Phase 4). Surfaces a banner on next foreground. */
    arkBgRefreshDeferredBackup: boolean;
    /** Last fire time of the <24h-to-expiry notification. Used to suppress repeat fires within a 12h window. */
    arkBgRefreshLastWarn24hAt: number | null;
    /** Last fire time of the <2h-to-expiry notification. Used to suppress repeat fires within a 1h window. */
    arkBgRefreshLastWarn2hAt: number | null;
    /** User-configurable upper bound on the fee a background refresh round can auto-pay (sats). Default 5000. */
    arkBgRefreshMaxFeeSats: number;

    /**
     * iOS-only: true when the user satisfied the create-flow backup gate via
     * manual share+confirm (the only honest iOS path — Documents writes
     * auto-sync to iCloud Drive only if the user has enabled iCloud Drive
     * for Cypher Box, which we cannot probe). The flag stays on until the
     * user explicitly tells us iCloud Drive sync is enabled, after which
     * the auto-tick has a verifiable off-device channel and the snapshot
     * reminder no longer applies. Drives the post-create reminder + a
     * persistent banner reminding the user to re-export from
     * Settings → Ark Backup after every Lightning receive.
     */
    arkIosBackupReminderActive: boolean;
    setArkBgRefreshEnabled: (state: boolean) => void;
    setArkBgRefreshLastSuccessAt: (state: number | null) => void;
    setArkBgRefreshLastAttempt: (
        state: {
            at: number;
            outcome: string;
            elapsedMs: number;
            errorMsg: string | null;
        } | null,
    ) => void;
    setArkBgRefreshConsecutiveFailures: (state: number) => void;
    setArkBgRefreshDeferredBackup: (state: boolean) => void;
    setArkBgRefreshLastWarn24hAt: (state: number | null) => void;
    setArkBgRefreshLastWarn2hAt: (state: number | null) => void;
    setArkBgRefreshMaxFeeSats: (state: number) => void;
    setArkIosBackupReminderActive: (state: boolean) => void;

    clearArkAuth: () => void;

    // 2FA state
    twoFARequired: boolean;
    twoFAVerified: boolean;
    setTwoFARequired: (state: boolean) => void;
    setTwoFAVerified: (state: boolean) => void;
};

const createAuthStore = (
    set: SetState<AuthStateType>,
    get: GetState<AuthStateType>
): AuthStateType => ({
    user: null,
    token: null,
    allBTCWallets: [],
    withdrawThreshold: 500000,
    reserveAmount: 100000,
    isAuth: undefined,
    walletID: undefined,
    vaultTab: false,
    // userCreds removed — stored in keychain
    coldStorageWalletID: undefined,
    matchedRateStrike: 0,
    FirstTimeLightning: true,
    FirstTimeCoinOS: true,
    FirstTimeArk: true,
    hasSeenCustodialWarning: false,
    hotVaultKeychainBackups: {},

    // Ark (experimental) defaults
    isArkAuth: false,
    arkWallet: null,
    arkBalance: 0,
    arkBalanceDetail: null,
    arkVtxos: [],
    arkPendingLnReceives: [],
    arkChainTipHeight: null,
    arkLastSyncedAt: null,
    arkLastBackupAt: null,
    arkRoundIntervalSecs: null,
    arkExitInProgress: false,
    arkExitDestinationAddress: null,
    arkExitStartedAt: null,
    arkUseHotVaultSeed: false,
    withdrawArkThreshold: 500000,
    reserveArkAmount: 100000,
    // Default ON so newly-created wallets get the auto-refresh
    // safety net without an extra opt-in step. The actual scheduler
    // is armed at wallet-create time (ArkSeedPhraseScreen.handleContinue
    // calls setArkBackgroundRefreshEnabled), and the user can flip
    // this off via the Capsules tab toggle. Existing wallets created
    // before this default flipped retain whatever value persisted to
    // disk under their previous preference.
    arkBgRefreshEnabled: true,
    arkBgRefreshLastSuccessAt: null,
    arkBgRefreshLastAttempt: null,
    arkBgRefreshConsecutiveFailures: 0,
    arkBgRefreshDeferredBackup: false,
    arkBgRefreshLastWarn24hAt: null,
    arkBgRefreshLastWarn2hAt: null,
    arkBgRefreshMaxFeeSats: 5000,
    arkIosBackupReminderActive: false,
    // 2FA state
    twoFARequired: false,
    twoFAVerified: false,
    setMatchedRateStrike: (state: number) => set({ matchedRateStrike: state }),
    setAllBTCWallets: (state: string[]) => set({ allBTCWallets: state }),
    setAuth: (state: boolean | undefined) => set({ isAuth: state }),
    setVaultTab: (state: boolean) => set({ vaultTab: state }),
    setToken: (token: string) => set({ token: token }),
    setUser: (state: any) => set({ user: state }),
    setWalletID: (state: string | undefined) => set({walletID: state}),
    setColdStorageWalletID: (state: string | undefined) => set({coldStorageWalletID: state}),
    setReserveAmount: (state: any) => set({ reserveAmount: state }),
    setWithdrawThreshold: (state: any) => set({ withdrawThreshold: state }),
    setFirstTimeLightning: (state: boolean) => set({ FirstTimeLightning: state }),
    setFirstTimeCoinOS: (state: boolean) => set({ FirstTimeCoinOS: state }),
    setFirstTimeArk: (state: boolean) => set({ FirstTimeArk: state }),
    setHasSeenCustodialWarning: (state: boolean) => set({ hasSeenCustodialWarning: state }),
    setHotVaultKeychainBackup: (walletID: string, backedUp: boolean) =>
        set(state => {
            const next = { ...state.hotVaultKeychainBackups };
            if (backedUp) {
                next[walletID] = true;
            } else {
                delete next[walletID];
            }
            return { hotVaultKeychainBackups: next };
        }),
    // Ark setters
    setArkAuth: (state: boolean) => set({ isArkAuth: state }),
    setArkWallet: (state: any) => set({ arkWallet: state }),
    setArkBalance: (state: number) => set({ arkBalance: state }),
    setArkBalanceDetail: (state: ArkBalanceSummary | null) => set({ arkBalanceDetail: state }),
    setArkVtxos: (state: ArkVtxoView[]) => set({ arkVtxos: state }),
    setArkPendingLnReceives: (state: ArkLightningReceiveView[]) => set({ arkPendingLnReceives: state }),
    setArkChainTipHeight: (state: number | null) => set({ arkChainTipHeight: state }),
    setArkLastSyncedAt: (state: number | null) => set({ arkLastSyncedAt: state }),
    setArkLastBackupAt: (state: number | null) => set({ arkLastBackupAt: state }),
    setArkRoundIntervalSecs: (state: number | null) => set({ arkRoundIntervalSecs: state }),
    setArkExitInProgress: (state: boolean) => set({ arkExitInProgress: state }),
    setArkExitDestinationAddress: (state: string | null) => set({ arkExitDestinationAddress: state }),
    setArkExitStartedAt: (state: number | null) => set({ arkExitStartedAt: state }),
    setArkUseHotVaultSeed: (state: boolean) => set({ arkUseHotVaultSeed: state }),
    setWithdrawArkThreshold: (state: any) => set({ withdrawArkThreshold: state }),
    setReserveArkAmount: (state: number) => set({ reserveArkAmount: state }),
    setArkBgRefreshEnabled: (state: boolean) => set({ arkBgRefreshEnabled: state }),
    setArkBgRefreshLastSuccessAt: (state: number | null) => set({ arkBgRefreshLastSuccessAt: state }),
    setArkBgRefreshLastAttempt: (state) => set({ arkBgRefreshLastAttempt: state }),
    setArkBgRefreshConsecutiveFailures: (state: number) => set({ arkBgRefreshConsecutiveFailures: state }),
    setArkBgRefreshDeferredBackup: (state: boolean) => set({ arkBgRefreshDeferredBackup: state }),
    setArkBgRefreshLastWarn24hAt: (state: number | null) => set({ arkBgRefreshLastWarn24hAt: state }),
    setArkBgRefreshLastWarn2hAt: (state: number | null) => set({ arkBgRefreshLastWarn2hAt: state }),
    setArkBgRefreshMaxFeeSats: (state: number) => set({ arkBgRefreshMaxFeeSats: state }),
    setArkIosBackupReminderActive: (state: boolean) => set({ arkIosBackupReminderActive: state }),
    clearArkAuth: () =>
        set({
            isArkAuth: false,
            arkWallet: null,
            arkBalance: 0,
            arkBalanceDetail: null,
            arkVtxos: [],
            arkPendingLnReceives: [],
            arkChainTipHeight: null,
            arkLastSyncedAt: null,
            arkLastBackupAt: null,
            arkRoundIntervalSecs: null,
            arkExitInProgress: false,
            arkExitDestinationAddress: null,
            arkExitStartedAt: null,
            arkUseHotVaultSeed: false,
            allBTCWallets: get().allBTCWallets.filter(wallet => wallet !== 'ARK'),
            // Keep thresholds — don't reset on logout

            // Background-refresh state is wallet-scoped: clear on
            // disconnect so the next wallet doesn't inherit a previous
            // wallet's success timestamp / failure count. The keychain
            // entry itself is cleared by setArkBackgroundRefreshEnabled
            // (off path) which we call separately from the disconnect
            // flow.
            arkBgRefreshEnabled: false,
            arkBgRefreshLastSuccessAt: null,
            arkBgRefreshLastAttempt: null,
            arkBgRefreshConsecutiveFailures: 0,
            arkBgRefreshDeferredBackup: false,
            arkBgRefreshLastWarn24hAt: null,
            arkBgRefreshLastWarn2hAt: null,
            arkIosBackupReminderActive: false,
        }),
    // 2FA setters
    setTwoFARequired: (state: boolean) => set({ twoFARequired: state }),
    setTwoFAVerified: (state: boolean) => set({ twoFAVerified: state }),
    clearAuth: () =>
        set({
            vaultTab: false,
            isAuth: undefined,
            user: null,
            token: null,
            allBTCWallets: get().allBTCWallets.filter(wallet => wallet !== 'COINOS'),
            // Keep withdrawThreshold and reserveAmount — don't reset on logout
        }),
    //strike
    strikeMe: null,
    strikeUser: null,
    strikeCurrency: 'USD',
    walletTab: false,
    strikeToken: null,
    isStrikeAuth: false,
    reserveStrikeAmount: 100000,
    withdrawStrikeThreshold: 1000000,
    setStrikeMe: (state: any) => set({ strikeMe: state }),
    setStrikeUser: (state: any) => set({ strikeUser: state }),
    setStrikeCurrency: (state: string) => set({ strikeCurrency: state }),
    setWalletTab: (state: boolean) => set({ walletTab: state }),
    setStrikeToken: (token: string) => set({ strikeToken: token }),
    setStrikeAuth: (state: boolean | undefined) => set({ isStrikeAuth: state }),
    setReserveStrikeAmount: (state: number) => set({ reserveStrikeAmount: state }),
    setWithdrawStrikeThreshold: (state: any) => set({ withdrawStrikeThreshold: state }),
    clearStrikeAuth: () =>
        set({
            strikeMe: null,
            strikeUser: null,
            strikeCurrency: 'USD',
            walletTab: false,
            strikeToken: null,
            matchedRateStrike: 0,
            allBTCWallets: get().allBTCWallets.filter(wallet => wallet !== 'STRIKE'),
            isStrikeAuth: undefined,
            // Keep reserveStrikeAmount and withdrawStrikeThreshold — don't reset on logout
        }),
});

const useAuthStore = create<AuthStateType>()(
    persist(createAuthStore, {
        name: 'Auth',
        storage: createJSONStorage(() => zustandStorage)
    })
);

export default useAuthStore;

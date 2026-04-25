import { create, GetState, SetState } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "./index";
import type { ArkBalanceSummary, ArkVtxoView } from "@Cypher/services/ark";

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
    arkUseHotVaultSeed: boolean;
    withdrawArkThreshold: any | null;
    reserveArkAmount: number;
    setArkAuth: (state: boolean) => void;
    setArkWallet: (state: any) => void;
    setArkBalance: (state: number) => void;
    setArkBalanceDetail: (state: ArkBalanceSummary | null) => void;
    setArkVtxos: (state: ArkVtxoView[]) => void;
    setArkChainTipHeight: (state: number | null) => void;
    setArkLastSyncedAt: (state: number | null) => void;
    setArkLastBackupAt: (state: number | null) => void;
    setArkUseHotVaultSeed: (state: boolean) => void;
    setWithdrawArkThreshold: (state: any) => void;
    setReserveArkAmount: (state: number) => void;
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
    arkChainTipHeight: null,
    arkLastSyncedAt: null,
    arkLastBackupAt: null,
    arkUseHotVaultSeed: false,
    withdrawArkThreshold: 500000,
    reserveArkAmount: 100000,
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
    setArkChainTipHeight: (state: number | null) => set({ arkChainTipHeight: state }),
    setArkLastSyncedAt: (state: number | null) => set({ arkLastSyncedAt: state }),
    setArkLastBackupAt: (state: number | null) => set({ arkLastBackupAt: state }),
    setArkUseHotVaultSeed: (state: boolean) => set({ arkUseHotVaultSeed: state }),
    setWithdrawArkThreshold: (state: any) => set({ withdrawArkThreshold: state }),
    setReserveArkAmount: (state: number) => set({ reserveArkAmount: state }),
    clearArkAuth: () =>
        set({
            isArkAuth: false,
            arkWallet: null,
            arkBalance: 0,
            arkBalanceDetail: null,
            arkVtxos: [],
            arkChainTipHeight: null,
            arkLastSyncedAt: null,
            arkLastBackupAt: null,
            arkUseHotVaultSeed: false,
            allBTCWallets: get().allBTCWallets.filter(wallet => wallet !== 'ARK'),
            // Keep thresholds — don't reset on logout
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

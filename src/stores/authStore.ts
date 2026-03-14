import { create, GetState, SetState } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "./index";

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
    allBTCWallets: string[];
    strikeToken: string | null;
    reserveStrikeAmount: number;
    withdrawStrikeThreshold: any | null;
    matchedRateStrike: number;
    setMatchedRateStrike: (state: number) => void;
    setStrikeMe: (state: any) => void;
    setStrikeUser: (state: any) => void;
    setAllBTCWallets: (state: string[]) => void;
    setWalletTab: (state: boolean) => void;
    setStrikeToken: (token: string) => void;
    setReserveStrikeAmount: (state: number) => void;
    setWithdrawStrikeThreshold: (state: any) => void;
    setStrikeAuth: (state: boolean | undefined) => void;

    // first-time tracking
    FirstTimeLightning: boolean;
    FirstTimeCoinOS: boolean;
    hasSeenCustodialWarning: boolean;
    setFirstTimeLightning: (state: boolean) => void;
    setFirstTimeCoinOS: (state: boolean) => void;
    setHasSeenCustodialWarning: (state: boolean) => void;
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
    hasSeenCustodialWarning: false,
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
    setHasSeenCustodialWarning: (state: boolean) => set({ hasSeenCustodialWarning: state }),
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
    walletTab: false,
    strikeToken: null,
    isStrikeAuth: false,
    reserveStrikeAmount: 100000,
    withdrawStrikeThreshold: 1000000,
    setStrikeMe: (state: any) => set({ strikeMe: state }),
    setStrikeUser: (state: any) => set({ strikeUser: state }),
    setWalletTab: (state: boolean) => set({ walletTab: state }),
    setStrikeToken: (token: string) => set({ strikeToken: token }),
    setStrikeAuth: (state: boolean | undefined) => set({ isStrikeAuth: state }),
    setReserveStrikeAmount: (state: number) => set({ reserveStrikeAmount: state }),
    setWithdrawStrikeThreshold: (state: any) => set({ withdrawStrikeThreshold: state }),
    clearStrikeAuth: () =>
        set({
            strikeMe: null,
            strikeUser: null,
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

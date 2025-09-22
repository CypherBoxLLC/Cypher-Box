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
    userCreds: {email: string, password: string, isRememberMe: boolean} | undefined;
    setUserCreds: (state: {email: string, password: string, isRememberMe: boolean} | undefined) => void;
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
};

const createAuthStore = (
    set: SetState<AuthStateType>,
    get: GetState<AuthStateType>
): AuthStateType => ({
    user: null,
    token: null,
    allBTCWallets: [],
    withdrawThreshold: 2000000,
    reserveAmount: 100000,
    isAuth: undefined,
    walletID: undefined,
    vaultTab: false,
    userCreds: undefined,
    coldStorageWalletID: undefined,
    matchedRateStrike: 0,
    setMatchedRateStrike: (state: number) => set({ matchedRateStrike: state }),
    setAllBTCWallets: (state: string[]) => set({ allBTCWallets: state }),
    setAuth: (state: boolean | undefined) => set({ isAuth: state }),
    setVaultTab: (state: boolean) => set({ vaultTab: state }),
    setUserCreds: (state: {email: string, password: string, isRememberMe: boolean} | undefined) => set( { userCreds: state }),
    setToken: (token: string) => set({ token: token }),
    setUser: (state: any) => set({ user: state }),
    setWalletID: (state: string | undefined) => set({walletID: state}),
    setColdStorageWalletID: (state: string | undefined) => set({coldStorageWalletID: state}),
    setReserveAmount: (state: any) => set({ reserveAmount: state }),
    setWithdrawThreshold: (state: any) => set({ withdrawThreshold: state }),
    clearAuth: () =>
        set({
            vaultTab: false,
            isAuth: undefined,
            user: null,
            token: null,
            allBTCWallets: get().allBTCWallets.filter(wallet => wallet !== 'COINOS'),
            withdrawThreshold: 2000000,
            reserveAmount: 100000,
        }),
    //strike
    strikeMe: null,
    strikeUser: null,
    walletTab: false,
    strikeToken: null,
    isStrikeAuth: false,
    reserveStrikeAmount: 100000,
    withdrawStrikeThreshold: 2000000,
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
            reserveStrikeAmount: 100000,
            withdrawStrikeThreshold: 2000000,
        }),
});

const useAuthStore = create<AuthStateType>()(
    persist(createAuthStore, {
        name: 'Auth',
        storage: createJSONStorage(() => zustandStorage)
    })
);

export default useAuthStore;

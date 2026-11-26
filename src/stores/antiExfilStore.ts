import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "./index";

/**
 * "Verify my signing phone" (anti-exfil), the Cold Vault's opt-in, default OFF. When ON, every phone-to-phone spend
 * runs the sign-to-contract exchange (helpers/antiExfilController) as an ADDITIONAL layer on top of the existing
 * signed-transaction-vs-reviewed check, and the Cold Vault refuses to send a transaction that was signed without it.
 *
 * Only the switch is kept. The exchange's in-flight state (the Cold Vault's secret `rho`, the signing phone's
 * commitments) lives in the screens' memory for the minutes the exchange takes: an app closed midway starts a fresh
 * exchange over the same transaction, so nothing secret needs to be stored.
 */
export type AntiExfilStateType = {
    verifySigningPhone: boolean;
    setVerifySigningPhone: (enabled: boolean) => void;
};

const useAntiExfilStore = create<AntiExfilStateType>()(
    persist(
        (set) => ({
            verifySigningPhone: false,
            setVerifySigningPhone: (enabled: boolean) => set({ verifySigningPhone: enabled }),
        }),
        {
            name: "anti-exfil-store",
            storage: createJSONStorage(() => zustandStorage),
        },
    ),
);

export default useAntiExfilStore;

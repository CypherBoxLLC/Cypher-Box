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

/**
 * Hidden until the next release: the exchange works, but its four alternating scans need a step guide on both phones
 * before users meet it. While false, the switch isn't drawn (screens/ColdStorage) and the store never reports it on,
 * whatever an earlier build saved, so the Cold Vault keeps the plain signing flow, a resumed spend keeps it too, and
 * nothing is refused on import. The signing phone's handling of a verified request stays: nothing sends one.
 * Flip to true to bring the feature back.
 */
export const VERIFY_SIGNING_PHONE_AVAILABLE = false;

export type AntiExfilStateType = {
    verifySigningPhone: boolean;
    setVerifySigningPhone: (enabled: boolean) => void;
};

const useAntiExfilStore = create<AntiExfilStateType>()(
    persist(
        (set) => ({
            verifySigningPhone: false,
            setVerifySigningPhone: (enabled: boolean) => set({ verifySigningPhone: VERIFY_SIGNING_PHONE_AVAILABLE && enabled }),
        }),
        {
            name: "anti-exfil-store",
            storage: createJSONStorage(() => zustandStorage),
            // what an earlier build saved counts only while the feature is available
            merge: (persisted, current) => {
                const saved = (persisted ?? {}) as Partial<AntiExfilStateType>;
                return {
                    ...current,
                    verifySigningPhone: VERIFY_SIGNING_PHONE_AVAILABLE && saved.verifySigningPhone === true,
                };
            },
        },
    ),
);

export default useAntiExfilStore;

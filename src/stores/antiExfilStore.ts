import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "./index";
import type { HostSession, SignerSession } from "@Cypher/helpers/antiExfilController";

/**
 * Anti-exfil (sign-to-contract) state.
 *
 * `verifySigningPhone` is the opt-in Cold Vault setting ("Verify my signing
 * phone"), default OFF. When ON, every phone-to-phone spend runs the anti-exfil
 * protocol as an ADDITIONAL layer on top of the existing signed-tx-vs-reviewed-
 * PSBT match check.
 *
 * `hostSession` / `signerSession` hold the in-flight protocol state BETWEEN the
 * air-gap hops so an app-kill mid-signing can resume rather than stranding the
 * spend. Persisted via the same encrypted MMKV store as authStore
 * (keychain-held device key). The host session contains `rho`, the host secret;
 * it is persisted encrypted and must never be logged. Only one session of each
 * role is in flight at a time on a given device (host on the Cold Vault, signer
 * on the Hot Vault), so a single slot each is enough.
 */
export type AntiExfilStateType = {
    verifySigningPhone: boolean;
    hostSession: HostSession | null;
    signerSession: SignerSession | null;

    setVerifySigningPhone: (enabled: boolean) => void;
    setHostSession: (session: HostSession | null) => void;
    clearHostSession: () => void;
    setSignerSession: (session: SignerSession | null) => void;
    clearSignerSession: () => void;
};

const useAntiExfilStore = create<AntiExfilStateType>()(
    persist(
        (set) => ({
            verifySigningPhone: false,
            hostSession: null,
            signerSession: null,

            setVerifySigningPhone: (enabled: boolean) => set({ verifySigningPhone: enabled }),
            setHostSession: (session: HostSession | null) => set({ hostSession: session }),
            clearHostSession: () => set({ hostSession: null }),
            setSignerSession: (session: SignerSession | null) => set({ signerSession: session }),
            clearSignerSession: () => set({ signerSession: null }),
        }),
        {
            name: "anti-exfil-store",
            storage: createJSONStorage(() => zustandStorage),
        },
    ),
);

export default useAntiExfilStore;

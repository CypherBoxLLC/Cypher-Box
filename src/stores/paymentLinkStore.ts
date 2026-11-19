import { create } from "zustand";

/**
 * A bitcoin: or lightning: link the phone opened Cypher Box with, waiting for the home screen's "Scan with" picker to
 * ask which wallet pays it. In memory only, so a link from an earlier run is never offered again.
 */
interface PaymentLinkState {
    link: string | null;
    setLink: (link: string) => void;
    clearLink: () => void;
}

const usePaymentLinkStore = create<PaymentLinkState>()((set) => ({
    link: null,
    setLink: (link) => set({ link }),
    clearLink: () => set({ link: null }),
}));

export default usePaymentLinkStore;

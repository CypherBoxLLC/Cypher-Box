import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "./index";

// Capsules (on-chain UTXOs) that reached the Hot Vault or the Cold Vault and wait
// for the user to label or ignore them, plus, per vault wallet, the capsules
// already handled so each one pops up once. Kept in the encrypted MMKV store,
// so a capsule that arrives while the app is closed still pops up on the next
// open. See services/capsuleReceived for how capsules get here.

export type CapsuleVault = "hot" | "cold";

export type ReceivedCapsule = {
    /** `${txid}:${vout}`, the key BlueWallet uses for UTXO metadata */
    id: string;
    vault: CapsuleVault;
    walletId: string;
    txid: string;
    vout: number;
    sats: number;
    /** block height it confirmed in */
    height: number;
    /** ms epoch when the app first saw it confirmed */
    seenAt: number;
};

export type CapsuleCursor = {
    /** outpoints already announced or skipped on purpose (change, consolidations, older coins) */
    seen: string[];
    /**
     * Chain height, less a margin, when the app first looked at this wallet.
     * A confirmed capsule at or below it was there before, so it never pops up.
     */
    baseHeight: number;
};

type CapsuleReceivedState = {
    queue: ReceivedCapsule[];
    cursors: Record<string, CapsuleCursor>;
    setCursor: (walletId: string, cursor: CapsuleCursor) => void;
    enqueue: (items: ReceivedCapsule[]) => void;
    /** removes one capsule, after it was labeled or ignored */
    dequeue: (walletId: string, id: string) => void;
    /** removes every queued capsule (Ignore all) */
    clearQueue: () => void;
    /** drops this wallet's queued capsules that are no longer unspent */
    retainLive: (walletId: string, liveIds: string[]) => void;
};

const sameCapsule = (a: ReceivedCapsule, walletId: string, id: string) => a.walletId === walletId && a.id === id;

const useCapsuleReceivedStore = create<CapsuleReceivedState>()(
    persist(
        (set, get) => ({
            queue: [],
            cursors: {},
            setCursor: (walletId, cursor) => set({ cursors: { ...get().cursors, [walletId]: cursor } }),
            enqueue: (items) => {
                const queue = get().queue;
                const fresh = items.filter(
                    (item, i) =>
                        !queue.some(q => sameCapsule(q, item.walletId, item.id)) &&
                        items.findIndex(other => sameCapsule(other, item.walletId, item.id)) === i,
                );
                if (fresh.length > 0) set({ queue: [...queue, ...fresh] });
            },
            dequeue: (walletId, id) => set({ queue: get().queue.filter(q => !sameCapsule(q, walletId, id)) }),
            clearQueue: () => set({ queue: [] }),
            retainLive: (walletId, liveIds) => {
                const live = new Set(liveIds);
                const queue = get().queue;
                const kept = queue.filter(q => q.walletId !== walletId || live.has(q.id));
                if (kept.length !== queue.length) set({ queue: kept });
            },
        }),
        {
            name: "capsule-received-store",
            storage: createJSONStorage(() => zustandStorage),
            partialize: (state) => ({ queue: state.queue, cursors: state.cursors }),
            // Loaded by hydrateCapsuleStore, not at start-up: the app's JS can start in
            // the background while the phone is locked, when the store's key can't be
            // read, and an empty load saved over the real one would lose the queue.
            skipHydration: true,
        },
    ),
);

let hydrating: Promise<void> | null = null;

/**
 * Loads the saved queue and record, once. Call it only while the app is in the
 * foreground with the wallets unlocked, when the store's key can be read.
 */
export const hydrateCapsuleStore = (): Promise<void> => {
    if (!hydrating) {
        hydrating = Promise.resolve(useCapsuleReceivedStore.persist.rehydrate()).catch(() => {
            hydrating = null; // try again next time
        });
    }
    return hydrating;
};

export const isCapsuleStoreHydrated = (): boolean => useCapsuleReceivedStore.persist.hasHydrated();

/** Runs `callback` once the persisted queue and cursors are loaded (at once if they already are). */
export const onCapsuleStoreHydrated = (callback: () => void): (() => void) => {
    if (isCapsuleStoreHydrated()) {
        callback();
        return () => {};
    }
    return useCapsuleReceivedStore.persist.onFinishHydration(() => callback());
};

export default useCapsuleReceivedStore;

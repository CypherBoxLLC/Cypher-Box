import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "./index";

export type EventWallet = "coinos" | "strike" | "hot-vault" | "ark";

type EventBase = {
    id: string;
    ts: number;
};

export type AppEvent =
    | (EventBase & {
        kind: "ln-sent";
        wallet: Extract<EventWallet, "coinos" | "strike" | "ark">;
        sats: number;
    })
    | (EventBase & {
        kind: "ln-received";
        wallet: Extract<EventWallet, "coinos" | "strike" | "ark">;
        sats: number;
    })
    | (EventBase & {
        kind: "onchain-sent";
        wallet: Extract<EventWallet, "hot-vault">;
        sats: number;
    })
    | (EventBase & {
        kind: "onchain-received";
        wallet: Extract<EventWallet, "hot-vault">;
        sats: number;
    })
    | (EventBase & { kind: "hot-vault-created" })
    | (EventBase & {
        kind: "hot-vault-recovered";
        source: "cloud" | "seed";
    })
    | (EventBase & { kind: "cold-vault-created" })
    | (EventBase & { kind: "cold-vault-deleted" })
    | (EventBase & { kind: "ark-created" })
    | (EventBase & { kind: "ark-recovered" })
    | (EventBase & {
        kind: "ark-exit-started";
        sats: number;
        correlationId: string;
    })
    | (EventBase & {
        kind: "ark-exit-finished";
        correlationId: string;
        result: "success" | "failure";
    })
    | (EventBase & {
        kind: "ark-refresh-started";
        vtxoCount: number;
        totalSats: number;
        correlationId: string;
    })
    | (EventBase & {
        kind: "ark-refresh-finished";
        correlationId: string;
        result: "success" | "failure";
        durationMs: number;
    })
    | (EventBase & {
        kind: "auto-backup";
        result: "success" | "failure";
        target: "local" | "cloud";
    });

export type AppEventKind = AppEvent["kind"];

// Distributive Omit — needed so the discriminated union survives the
// removal of id+ts. A plain Omit<AppEvent, "id" | "ts"> collapses every
// variant into the intersection of common fields, which loses `wallet`,
// `result`, etc. and breaks call-site type checking.
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
export type AppEventInput = DistributiveOmit<AppEvent, "id" | "ts">;

const MAX_EVENTS = 200;

type EventLogState = {
    events: AppEvent[];
    recordEvent: (ev: AppEventInput) => void;
    clear: () => void;
};

const makeId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const useEventLogStore = create<EventLogState>()(
    persist(
        (set, get) => ({
            events: [],
            recordEvent: (input) => {
                const next: AppEvent = {
                    id: makeId(),
                    ts: Date.now(),
                    ...input,
                } as AppEvent;
                const trimmed = [next, ...get().events].slice(0, MAX_EVENTS);
                set({ events: trimmed });
            },
            clear: () => set({ events: [] }),
        }),
        {
            name: "event-log-store",
            storage: createJSONStorage(() => zustandStorage),
        }
    )
);

export const recordEvent = (ev: AppEventInput) =>
    useEventLogStore.getState().recordEvent(ev);

export default useEventLogStore;

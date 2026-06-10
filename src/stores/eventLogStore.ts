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
        // A below-minimum on-chain boarding deposit (too small to ever board
        // into a VTXO) was drained back out on-chain via the F3 recover flow.
        // Not an Ark/VTXO movement, so it never appears in bark's history —
        // this event is the only record of it for the history/activity UIs.
        kind: "ark-onchain-recovered";
        /** Sats that landed at the destination (confirmed minus on-chain fee). */
        sats: number;
        /** On-chain fee paid for the drain. */
        feeSats: number;
        /** Drain txid, for the mempool.space explorer link in history. */
        txid: string;
        /** Where it went: the user's Hot Vault (prefilled) or a pasted address. */
        dest: "hot-vault" | "external";
    })
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
    })
    /**
     * Background-refresh attempt outcome.
     *
     * Distinct from `ark-refresh-{started,finished}` which only fires for
     * user-tapped foreground refresh. This kind covers the unattended path —
     * the BGAppRefreshTask / WorkManager wake, silent-push trigger, and the
     * foreground urgency sweep in useArkSync. The detailed rolling buffer
     * still lives in `backgroundTelemetry.ts` (AsyncStorage); this event is
     * the user-visible subset that surfaces in the activity dropdown.
     *
     * Recorded only for outcomes the user would want to know about
     * (success, error, fee_gated, dust_*, no_seed). Boring outcomes
     * (rate_limited, no_eligible_vtxos, disabled, pending_round_conflict)
     * are filtered at the call site to keep the dropdown signal-dense.
     *
     * Type union is inlined here (rather than imported from
     * `@Cypher/services/ark`) to avoid an import cycle:
     * services/ark/backgroundRefresh.ts already imports `recordEvent`
     * from this store.
     */
    | (EventBase & {
        kind: "ark-bg-refresh";
        trigger: "scheduled" | "push" | "manual-test" | "arrival" | "foreground";
        outcome:
            | "success"
            | "no_eligible_vtxos"
            | "rate_limited"
            | "pending_round_conflict"
            | "fee_gated"
            | "dust_uneconomic"
            | "dust_stranded"
            | "no_seed"
            | "disabled"
            | "error";
        elapsedMs: number;
        vtxoCount?: number;
        feeSats?: number;
        errorMsg?: string;
    })
    /**
     * Arkoor-receive popup lifecycle event.
     *
     * Surfaces every meaningful step of the popup feature into the
     * in-app Activity feed so issues are diagnosable without having to
     * hook up Metro / a debugger. Without this, the popup's silent
     * failure modes (toggle off, app backgrounded, prompt-in-flight ref
     * stuck) are invisible to the user and only inferable from a Metro
     * console — which production users can't tail.
     *
     * Subkinds:
     *   - "fired"             — Alert.alert was successfully invoked.
     *   - "skipped-disabled"  — toggle off in Ark Settings.
     *   - "skipped-background" — app not foregrounded when receive landed; will retry on next foreground.
     *   - "skipped-in-flight" — promptInFlight ref was already true; another alert blocking.
     *   - "skipped-vtxo-gone" — vtxo was already refreshed/consumed before the hook could render the alert (race lost to auto-refresh).
     *   - "refresh-now"       — user tapped "Refresh now"; refreshArkVtxosAndSync kicked.
     *   - "use-immediately"   — user tapped "Use immediately"; VTXO deferred from auto-refresh.
     *   - "auto-skipped"      — bg-refresh orchestrator honoured the deferral and excluded N VTXOs from the round.
     */
    | (EventBase & {
        kind: "arkoor-prompt";
        outcome:
            | "fired"
            | "skipped-disabled"
            | "skipped-background"
            | "skipped-in-flight"
            | "skipped-vtxo-gone"
            | "refresh-now"
            | "use-immediately"
            | "auto-skipped";
        /** Short prefix of the VTXO id (12 chars) for readability in the activity row. */
        vtxoIdPrefix?: string;
        /** Amount the user is being prompted about; absent on auto-skipped events. */
        sats?: number;
        /** For auto-skipped: how many user-deferred VTXOs were excluded from the round. */
        vtxoCount?: number;
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

export const recordEvent = (ev: AppEventInput) => {
    // Dev-only console mirror for the arkoor-prompt feature so the
    // outcomes are tailable from Metro while we're hardening it. Drop
    // this once the activity feed is the canonical surface.
    if (__DEV__ && ev.kind === 'arkoor-prompt') {
        console.log('[arkoor-prompt event]', JSON.stringify(ev));
    }
    return useEventLogStore.getState().recordEvent(ev);
};

export default useEventLogStore;

import { getItem, removeItem, setItem } from "@Cypher/stores/storageService";

// Cursors used by the Activity log to suppress historical/duplicate emits
// across app restarts. Each is a thin typed wrapper over MMKV so the
// activity-diff modules don't have to spread raw key strings around.
//
// First-sync convention: getter returns null when nothing has been
// persisted yet. Diff helpers must treat null as "first time we've ever
// looked — write the high watermark, do NOT emit historical events."

const KEY_ARK_EXIT_CORRELATION = "activity-ark-exit-correlation-id";
const KEY_ARK_LAST_MOVEMENT_ID = "activity-ark-last-movement-id";
const KEY_HOTVAULT_SEEN_TXIDS = "activity-hotvault-seen-txids";
const KEY_STRIKE_LAST_INVOICE_ID = "activity-strike-last-invoice-id";

// --- Ark exit correlation id ----------------------------------------------

export const getArkExitCorrelationId = (): string | null => {
    const v = getItem(KEY_ARK_EXIT_CORRELATION);
    return typeof v === "string" ? v : null;
};

export const setArkExitCorrelationId = (id: string | null): void => {
    if (id === null) {
        removeItem(KEY_ARK_EXIT_CORRELATION);
    } else {
        setItem(KEY_ARK_EXIT_CORRELATION, id);
    }
};

// --- Ark history (movements) cursor ---------------------------------------

export const getArkLastSeenMovementId = (): number | null => {
    const v = getItem(KEY_ARK_LAST_MOVEMENT_ID);
    return typeof v === "number" ? v : null;
};

export const setArkLastSeenMovementId = (id: number): void => {
    setItem(KEY_ARK_LAST_MOVEMENT_ID, id);
};

// --- Hot Vault tx-id set (serialised) -------------------------------------
//
// Stored as a string[] not Set — MMKV/JSON only handles plain values.
// Bounded at 1000 entries to keep MMKV writes fast; the oldest 200 get
// pruned when the cap is hit. 1000 is far above the entries any single
// hot-vault wallet will produce in normal use.

const HOTVAULT_TXID_CAP = 1000;
const HOTVAULT_TXID_PRUNE = 200;

export const getHotVaultSeenTxids = (): string[] | null => {
    const v = getItem(KEY_HOTVAULT_SEEN_TXIDS);
    return Array.isArray(v) ? (v as string[]) : null;
};

export const setHotVaultSeenTxids = (ids: string[]): void => {
    const trimmed = ids.length > HOTVAULT_TXID_CAP ? ids.slice(HOTVAULT_TXID_PRUNE) : ids;
    setItem(KEY_HOTVAULT_SEEN_TXIDS, trimmed);
};

// --- Strike last-seen received-invoice id ---------------------------------

export const getStrikeLastSeenInvoiceId = (): string | null => {
    const v = getItem(KEY_STRIKE_LAST_INVOICE_ID);
    return typeof v === "string" ? v : null;
};

export const setStrikeLastSeenInvoiceId = (id: string): void => {
    setItem(KEY_STRIKE_LAST_INVOICE_ID, id);
};

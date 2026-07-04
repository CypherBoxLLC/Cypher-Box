import { recordEvent } from "@Cypher/stores/eventLogStore";
import {
    getStrikeLastSeenInvoiceId,
    setStrikeLastSeenInvoiceId,
} from "@Cypher/services/activityCursors";
import { getInvoices } from "@Cypher/api/strikeAPIs";

// Detect Strike Lightning receives by polling /invoices and diffing against
// the last invoice id we've already processed.
//
// Strike has no real-time webhook accessible from the app, so this is a
// best-effort detector: only fires when something else is calling
// loadStrikeData (HomeScreen focus / refresh). Receives that arrive while
// the app is closed will surface the next time the user opens the app.
//
// First-sync suppression: when no cursor exists, snapshot the most-recent
// PAID invoice id without emitting. Without this, a fresh install on an
// active Strike account would dump the user's full receive history into
// Activity.
//
// Field shape per Strike API:
//   { invoiceId, amount: { amount, currency }, state, created, ... }
// `state` we look for is "PAID" (also seen: "UNPAID", "PENDING", "CANCELLED").
// `amount.currency === 'BTC'` rows are sat-denominated; fiat-denominated
// rows need conversion which we deliberately don't do (the source-of-truth
// for sats received is Strike itself; we'd be guessing at the rate).

type StrikeInvoice = {
    invoiceId?: string;
    amount?: { amount?: number | string; currency?: string };
    state?: string;
    created?: string;
};

const PAID_STATE = "PAID";

function parseAmountSats(inv: StrikeInvoice): number | null {
    const amt = inv.amount?.amount;
    const cur = inv.amount?.currency;
    if (cur !== "BTC") return null;
    const n = typeof amt === "number" ? amt : Number(amt);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Strike returns BTC as a decimal string ("0.00001234"). Convert to sats.
    return Math.round(n * 1e8);
}

export async function processStrikeInvoicesForActivity(): Promise<void> {
    let response;
    try {
        response = await getInvoices();
    } catch {
        return;
    }
    const items: StrikeInvoice[] = Array.isArray(response?.items) ? response.items : [];
    if (items.length === 0) return;

    // Strike returns invoices newest-first. The "most recent" id is items[0].
    const newestId = items[0]?.invoiceId;
    if (!newestId) return;

    const cursor = getStrikeLastSeenInvoiceId();

    if (cursor === null) {
        setStrikeLastSeenInvoiceId(newestId);
        return;
    }

    // Walk newest → oldest, stop at the cursor. Any PAID, BTC, sat-positive
    // invoice we encounter before the cursor is a new receive.
    const fresh: Array<{ id: string; sats: number }> = [];
    for (const inv of items) {
        if (!inv.invoiceId) continue;
        if (inv.invoiceId === cursor) break;
        if (inv.state !== PAID_STATE) continue;
        const sats = parseAmountSats(inv);
        if (sats === null) continue;
        fresh.push({ id: inv.invoiceId, sats });
    }

    // Emit oldest-first so chronological order in the Activity list is sane.
    for (const r of fresh.reverse()) {
        recordEvent({ kind: "ln-received", wallet: "strike", sats: r.sats });
    }

    if (newestId !== cursor) {
        setStrikeLastSeenInvoiceId(newestId);
    }
}

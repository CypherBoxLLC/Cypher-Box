import { recordEvent } from "@Cypher/stores/eventLogStore";
import {
    getArkLastSeenMovementId,
    setArkLastSeenMovementId,
} from "@Cypher/services/activityCursors";
import { fetchArkHistory } from "./history";

// Detect Ark Lightning receives by diffing the SDK's movement list.
//
// The Bark FFI's `wallet.history()` returns every movement (LN send/recv,
// arkoor, refresh, board, exit) as a Movement struct keyed by a stable
// SDK-assigned `id` (monotonically increasing). We track the highest id
// we've ever processed and emit ln-received events for any NEW rows whose
// subsystem is Lightning, status is successful, and effective balance
// delta is positive.
//
// First-sync suppression: when no cursor exists, snapshot the current max
// id without emitting. Otherwise a fresh install on an existing wallet
// (rare today since Ark recovery is limited, but real once recovery
// ships) would dump the full history into Activity.
//
// Why not also emit ln-sent here: outbound LN is already emitted at the
// executeArkSend boundary in send.ts — no double-counting.
//
// Why not on-chain receive (boarding) here: the v1 schema's
// `onchain-received` discriminator is scoped to `wallet: 'hot-vault'`.
// Boarded sats show up in the Ark balance separately; surfacing them as
// a distinct event is a future-schema decision.

export async function processArkMovementsForActivity(): Promise<void> {
    let movements;
    try {
        movements = await fetchArkHistory();
    } catch {
        return;
    }
    if (!movements || movements.length === 0) return;

    const cursor = getArkLastSeenMovementId();
    const maxId = movements.reduce((m, mv) => (mv.id > m ? mv.id : m), 0);

    if (cursor === null) {
        setArkLastSeenMovementId(maxId);
        return;
    }

    const fresh = movements
        .filter((m) => m.id > cursor)
        .filter((m) => m.kind === "lightning")
        .filter((m) => m.status === "successful")
        .filter((m) => m.amountSats > 0)
        .sort((a, b) => a.id - b.id);

    for (const mv of fresh) {
        recordEvent({ kind: "ln-received", wallet: "ark", sats: mv.amountSats });
    }

    if (maxId > cursor) {
        setArkLastSeenMovementId(maxId);
    }
}

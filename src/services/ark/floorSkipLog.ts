/**
 * Which exit-runway-floor skips are worth putting on the record, and which are
 * the same skip the wallet already recorded.
 *
 * WHY THIS EXISTS
 *
 * The foreground sweep records something for every outcome it has except one:
 * a capsule left alone because it has less life left than its own unilateral
 * exit would need. That silence mattered because it is also the exact decision
 * the depth-aware floor changed. `refreshFloorBlocks` falls back to the flat
 * 28h whenever a capsule reports no depth or the wallet has not learned the
 * server's exit delta, and a floor falling back for every capsule produces
 * observably identical behaviour to one applying depth correctly: in both cases
 * the capsule is simply not refreshed. Nothing in a running wallet
 * distinguished them.
 *
 * WHY IT IS NOT JUST A recordEvent AT THE SKIP
 *
 * The selection loop runs every sync tick (30s iOS / 60s Android) and a capsule
 * below the floor stays below it for hours, so the naive version emits ~120
 * events an hour, evicts the entire 200-entry activity log, and destroys the
 * user's real history to report one unchanging fact.
 *
 * What is worth recording is the DECISION, not its persistence. So: once per
 * capsule, and again only if the floor that applies to it actually changes,
 * which happens when the wallet learns the server's delta (fallback to
 * depth-aware) or the capsule's depth moves under it. `blocksLeft` is
 * deliberately absent from the signature: it decrements every block and would
 * put the firehose straight back.
 *
 * Pure and import-free apart from the floor predicate, matching dustSweep.ts
 * and exitTriage.ts, so the dedupe and the per-tick cap are unit-testable
 * without the native bark module.
 */

import { isDepthAwareFloorAvailable } from './exitTriage';

export type FloorSkip = {
    id: string;
    exitDepth?: number | null;
    /** `expiryHeight - tip` at the moment of the decision. */
    blocksLeft: number;
    /** What `refreshFloorBlocks` returned for this capsule. */
    floorBlocks: number;
};

export type FloorSkipEvent = {
    vtxoIdPrefix: string;
    exitDepth: number | null;
    blocksLeft: number;
    floorBlocks: number;
    /**
     * The field to read first. False means the flat fallback applied and the
     * depth-aware rule was a no-op for this decision.
     */
    floorDepthAware: boolean;
};

export type FloorSkipPlan = {
    /** Events to record, already capped. */
    events: FloorSkipEvent[];
    /** Replacement for the caller's dedupe map: vtxo id -> decision signature. */
    nextRecorded: Map<string, string>;
};

/** Ceiling on how many floor skips one tick may record. A wallet whose capsules
 *  all cross the floor together would otherwise flush the activity log in a
 *  single pass; the rest land on following ticks, since the dedupe map only
 *  remembers what was actually recorded. */
export const MAX_FLOOR_EVENTS_PER_TICK = 3;

/** Length of the vtxo id prefix carried into the event. Matches the 12 chars
 *  the arkoor-prompt events already use, so the two read the same in the feed. */
const ID_PREFIX_LEN = 12;

export function planFloorSkipEvents(args: {
    skips: FloorSkip[];
    /** Every id still in the spendable set, for pruning. */
    liveIds: Iterable<string>;
    /** What has already been recorded, from the previous tick. */
    recorded: ReadonlyMap<string, string>;
    exitDeltaBlocks: number | null;
    maxPerTick?: number;
}): FloorSkipPlan {
    const { skips, liveIds, recorded, exitDeltaBlocks } = args;
    const maxPerTick = args.maxPerTick ?? MAX_FLOOR_EVENTS_PER_TICK;

    // Prune first, unconditionally, even on a tick with no skips at all. A
    // capsule that left the spendable set was refreshed, spent or replaced, so
    // its decision is stale and its entry would otherwise sit in the map for
    // the life of the process. Pruning re-arms the id too, but ids do not
    // survive a refresh, so in practice this is purely the bound on the map.
    const live = new Set(liveIds);
    const nextRecorded = new Map<string, string>();
    for (const [id, signature] of recorded) {
        if (live.has(id)) nextRecorded.set(id, signature);
    }

    const events: FloorSkipEvent[] = [];
    for (const skip of skips) {
        if (events.length >= maxPerTick) break;
        const floorDepthAware = isDepthAwareFloorAvailable(skip.exitDepth, exitDeltaBlocks);
        const signature = `${skip.floorBlocks}:${floorDepthAware}`;
        if (nextRecorded.get(skip.id) === signature) continue; // already on the record
        nextRecorded.set(skip.id, signature);
        events.push({
            vtxoIdPrefix: skip.id.slice(0, ID_PREFIX_LEN),
            exitDepth: skip.exitDepth ?? null,
            blocksLeft: skip.blocksLeft,
            floorBlocks: skip.floorBlocks,
            floorDepthAware,
        });
    }

    return { events, nextRecorded };
}

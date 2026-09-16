/**
 * Putting the exit-runway-floor skip on the record, without destroying the
 * record in the process.
 *
 * The decision this reports is the one the depth-aware floor changed, and it
 * was the only sweep outcome that left no trace at all. The trap is that the
 * obvious fix makes things worse: the selection loop runs every sync tick and a
 * capsule below the floor stays below it for hours, so recording at the skip
 * emits ~120 events an hour into a 200-entry log and evicts the user's real
 * history to restate one unchanging fact.
 *
 * So these tests are mostly about what is NOT recorded.
 */

import {
    MAX_FLOOR_EVENTS_PER_TICK,
    planFloorSkipEvents,
    type FloorSkip,
} from '../../src/services/ark/floorSkipLog';
import { refreshFloorBlocks } from '../../src/services/ark/exitTriage';

/** The live mainnet vtxo exit delta, read off the ASP 2026-09-12. */
const MAINNET_DELTA = 144;
/** ARK_EXIT_RUNWAY_HOURS (28h) at AVG_BLOCK_MINUTES (10). */
const FLAT_FLOOR_BLOCKS = 168;

const skip = (over: Partial<FloorSkip> = {}): FloorSkip => ({
    id: 'aaaaaaaaaaaabbbbbbbbbbbb',
    exitDepth: 3,
    blocksLeft: 100,
    floorBlocks: 186,
    ...over,
});

const plan = (args: {
    skips: FloorSkip[];
    recorded?: ReadonlyMap<string, string>;
    liveIds?: string[];
    exitDeltaBlocks?: number | null;
    maxPerTick?: number;
}) =>
    planFloorSkipEvents({
        skips: args.skips,
        liveIds: args.liveIds ?? args.skips.map((s) => s.id),
        recorded: args.recorded ?? new Map(),
        exitDeltaBlocks: args.exitDeltaBlocks === undefined ? MAINNET_DELTA : args.exitDeltaBlocks,
        maxPerTick: args.maxPerTick,
    });

describe('planFloorSkipEvents', () => {
    it('records a skip the first time it sees it', () => {
        const { events } = plan({ skips: [skip()] });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            vtxoIdPrefix: 'aaaaaaaaaaaa',
            exitDepth: 3,
            blocksLeft: 100,
            floorBlocks: 186,
            floorDepthAware: true,
        });
    });

    it('truncates the vtxo id to 12 chars, matching the arkoor-prompt events', () => {
        const { events } = plan({ skips: [skip({ id: '0123456789abcdefghij' })] });
        expect(events[0].vtxoIdPrefix).toBe('0123456789ab');
    });

    it('does not record the same decision again on the next tick', () => {
        const first = plan({ skips: [skip()] });
        const second = plan({ skips: [skip()], recorded: first.nextRecorded });
        expect(second.events).toHaveLength(0);
    });

    it('stays silent for hours of ticks while the capsule sits below the floor', () => {
        // The failure this exists to prevent: 120 events an hour, 200-entry log.
        let recorded: ReadonlyMap<string, string> = new Map();
        let total = 0;
        // 6 hours of iOS ticks at 30s.
        for (let tick = 0; tick < 720; tick += 1) {
            // blocksLeft decrements as the chain advances; the floor does not.
            const res = plan({
                skips: [skip({ blocksLeft: 160 - Math.floor(tick / 20) })],
                recorded,
            });
            total += res.events.length;
            recorded = res.nextRecorded;
        }
        expect(total).toBe(1);
    });

    it('records again when the floor that applies actually changes', () => {
        // The case that matters: the wallet learns the server's delta, so the
        // same capsule flips from the flat fallback to the depth-aware floor.
        const fallback = plan({
            skips: [skip({ floorBlocks: FLAT_FLOOR_BLOCKS })],
            exitDeltaBlocks: null,
        });
        expect(fallback.events[0].floorDepthAware).toBe(false);

        const aware = plan({
            skips: [skip({ floorBlocks: 186 })],
            recorded: fallback.nextRecorded,
            exitDeltaBlocks: MAINNET_DELTA,
        });
        expect(aware.events).toHaveLength(1);
        expect(aware.events[0].floorDepthAware).toBe(true);
    });

    it('reports the flat fallback as such when the capsule has no depth', () => {
        const { events } = plan({
            skips: [skip({ exitDepth: undefined, floorBlocks: FLAT_FLOOR_BLOCKS })],
        });
        expect(events[0]).toMatchObject({ exitDepth: null, floorDepthAware: false });
    });

    it('agrees with the floor the sweep actually applied', () => {
        // The whole point of the flag is that it cannot drift from the
        // decision. Assert it against refreshFloorBlocks rather than against a
        // restatement of the predicate.
        for (const exitDepth of [undefined, 0, 1, 3, 17, 49]) {
            for (const delta of [null, MAINNET_DELTA]) {
                const floorBlocks = refreshFloorBlocks(exitDepth, delta, FLAT_FLOOR_BLOCKS);
                const { events } = plan({
                    skips: [skip({ exitDepth, floorBlocks })],
                    exitDeltaBlocks: delta,
                });
                const fellBack = floorBlocks === FLAT_FLOOR_BLOCKS && !(exitDepth && delta);
                expect(events[0].floorDepthAware).toBe(!fellBack);
            }
        }
    });

    it('caps how many it records in one tick', () => {
        const skips = Array.from({ length: 10 }, (_, i) =>
            skip({ id: `capsule-${i}-padding` }),
        );
        const { events, nextRecorded } = plan({ skips });
        expect(events).toHaveLength(MAX_FLOOR_EVENTS_PER_TICK);
        // Only what was recorded is remembered, so the rest are not silently
        // swallowed: the next tick picks up where this one stopped.
        expect(nextRecorded.size).toBe(MAX_FLOOR_EVENTS_PER_TICK);
    });

    it('drains the backlog over following ticks rather than dropping it', () => {
        const skips = Array.from({ length: 7 }, (_, i) => skip({ id: `capsule-${i}-padding` }));
        let recorded: ReadonlyMap<string, string> = new Map();
        const seen: string[] = [];
        for (let tick = 0; tick < 3; tick += 1) {
            const res = plan({ skips, recorded });
            seen.push(...res.events.map((e) => e.vtxoIdPrefix));
            recorded = res.nextRecorded;
        }
        expect(new Set(seen).size).toBe(7);
    });

    it('forgets a capsule that left the spendable set', () => {
        // Refreshed, spent or replaced: the decision is stale and the entry
        // would otherwise sit in the map for the life of the process.
        const first = plan({ skips: [skip()] });
        expect(first.nextRecorded.size).toBe(1);
        const second = plan({ skips: [], liveIds: [], recorded: first.nextRecorded });
        expect(second.nextRecorded.size).toBe(0);
    });

    it('prunes on a tick with no skips at all', () => {
        const recorded = new Map([['gone', '186:true'], ['here', '186:true']]);
        const { nextRecorded } = plan({ skips: [], liveIds: ['here'], recorded });
        expect([...nextRecorded.keys()]).toEqual(['here']);
    });

    it('does not mutate the map it was given', () => {
        const recorded = new Map<string, string>();
        const { nextRecorded } = plan({ skips: [skip()], recorded });
        expect(recorded.size).toBe(0);
        expect(nextRecorded.size).toBe(1);
    });
});

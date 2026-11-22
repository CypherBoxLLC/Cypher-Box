/**
 * Exits the user did not start.
 *
 * bark 0.9.0's `sync` runs `syncForceExitedVtxos()` on its own: it scans for
 * capsules another party pushed on-chain (a round co-holder exiting, which
 * publishes the shared tree, or the same seed exiting from another device) and
 * routes them into the unilateral-exit flow so the funds can still be claimed.
 * From the app's side such a capsule simply appears in `getExitVtxos()` with an
 * active record, exactly as if the user had tapped Emergency Exit.
 *
 * The drive in useArkSync already picks these up (its self-heal re-arms the
 * exit flag from bark's records) and claims them to the saved destination. What
 * was missing is the telling: nothing said an exit the user never asked for was
 * under way, nothing said what it needs (the app open, miner fees in the
 * on-chain wallet), and the capsule rows read "Exiting on-chain" as if the user
 * had done it.
 *
 * TELLING THE TWO APART
 *
 * `startArkEmergencyExit` records the ids it hands bark in
 * `arkExitStartedVtxoIds`. An active exit record whose id is not there was not
 * started on this device. One carve-out keeps an upgrade honest: an exit that
 * was running before ids were tracked has `arkExitStartedAt` set and an empty
 * list, and every record then belongs to the user.
 *
 * A restore onto a new device mid-exit also reads as "not started here", which
 * is true, and the notice's wording allows for it.
 *
 * Pure and import-free apart from the state helpers and the copy, so the rules
 * and the text are testable without the SDK, matching exitTriage.ts.
 */

import { isActiveExit } from './barkState';
import { approxDuration } from './exitPhaseSummary';
import loc from '../../../loc';

/** The fields of bark's `ExitVtxo` this module reads. */
export type ExitRecordLike = {
    vtxoId: string;
    amountSats?: bigint | number;
    state: unknown;
    isClaimable?: boolean;
};

export type ForcedExitContext = {
    /** `arkExitStartedVtxoIds`: capsules the user started an exit for here. */
    startedIds: readonly string[];
    /** `arkExitStartedAt`: set whenever the user started an exit here. */
    exitStartedAt: number | null;
};

const lower = (id: unknown) => String(id ?? '').toLowerCase();

/**
 * An exit started on this device before ids were tracked: the started-at
 * stamp is set and the id list is empty. Everything active is then the user's
 * own exit. Without this, the first launch of this build during an exit would
 * call the user's own exit forced.
 */
export function isLegacyUserExit(ctx: ForcedExitContext): boolean {
    return ctx.exitStartedAt != null && ctx.startedIds.length === 0;
}

/**
 * Ids of the ACTIVE exit records the user did not start here, lowercased.
 * Terminal records are not forced exits any more, whatever their origin.
 */
export function forcedExitIds(
    exits: readonly ExitRecordLike[],
    ctx: ForcedExitContext,
): Set<string> {
    const out = new Set<string>();
    if (isLegacyUserExit(ctx)) return out;
    const started = new Set(ctx.startedIds.map(lower));
    for (const e of exits) {
        if (!isActiveExit(e)) continue;
        const id = lower(e.vtxoId);
        if (!started.has(id)) out.add(id);
    }
    return out;
}

/**
 * Active exit records split by who started them. `forced` is what
 * forcedExitIds returns; `userStarted` is every other active record. Terminal
 * records are in neither.
 *
 * This is the split the wallet-wide exit lock turns on: a user-started exit
 * still locks every spend (assertNoActiveArkExit), a forced one locks only its
 * own capsules (forcedExitLock.ts). A mix locks everything, because the user's
 * exit is in it.
 */
export function classifyExitRecords(
    exits: readonly ExitRecordLike[],
    ctx: ForcedExitContext,
): { userStarted: ExitRecordLike[]; forced: ExitRecordLike[] } {
    const forcedIds = forcedExitIds(exits, ctx);
    const userStarted: ExitRecordLike[] = [];
    const forced: ExitRecordLike[] = [];
    for (const e of exits) {
        if (!isActiveExit(e)) continue;
        (forcedIds.has(lower(e.vtxoId)) ? forced : userStarted).push(e);
    }
    return { userStarted, forced };
}

/** The forced records the user has not been told about yet. */
export function pickForcedExitsToNotice(
    exits: readonly ExitRecordLike[],
    ctx: ForcedExitContext,
    noticedIds: readonly string[],
): ExitRecordLike[] {
    const forced = forcedExitIds(exits, ctx);
    if (forced.size === 0) return [];
    const noticed = new Set(noticedIds.map(lower));
    return exits.filter((e) => forced.has(lower(e.vtxoId)) && !noticed.has(lower(e.vtxoId)));
}

/**
 * Started ids whose exit is still live, or has no record yet.
 *
 * An id is dropped only when bark holds a record for it that has finished:
 * a record that is missing may simply not be visible yet in the tick after
 * `startExitForVtxos`, and dropping it then would make the user's own exit
 * read as forced one tick later.
 */
export function pruneStartedExitIds(
    startedIds: readonly string[],
    exits: readonly ExitRecordLike[],
): string[] {
    const byId = new Map<string, ExitRecordLike>();
    for (const e of exits) byId.set(lower(e.vtxoId), e);
    return startedIds.filter((id) => {
        const rec = byId.get(lower(id));
        return rec == null || isActiveExit(rec);
    });
}

export function sumExitSats(exits: readonly ExitRecordLike[]): number {
    return exits.reduce((acc, e) => acc + Number(e.amountSats ?? 0), 0);
}

export type ForcedExitNoticeInput = {
    sats: number;
    count: number;
    /** `arkExitDestinationAddress`, or null when none is set. */
    destination: string | null;
    /** Blocks until the exit can be collected, when known. */
    waitBlocks: number | null;
    blockMinutes: number;
    /** On-chain fee wallet balance. */
    feeHeldSats: number;
    /** Reserve the forced capsules need for their CPFP fees, when it could be
     *  priced. The fee clause is shown only when `feeHeldSats` is short. */
    feeNeededSats: number | null;
};

/** Shortened address for copy, so the body stays readable. */
export function shortAddress(address: string): string {
    const a = address.trim();
    return a.length <= 18 ? a : `${a.slice(0, 8)}…${a.slice(-6)}`;
}

/**
 * The one Alert for a forced exit: what moved, where it is going, and what the
 * user has to do (keep the app open, fund fees when the plan says so).
 *
 * COPY: Bam finalizes.
 */
export function buildForcedExitNotice(input: ForcedExitNoticeInput): { title: string; body: string } {
    const t = loc.cypherbox.services.ark_exit;
    const sats = Math.max(0, Math.floor(input.sats)).toLocaleString();
    const count = Math.max(1, Math.floor(input.count));
    const wait =
        input.waitBlocks != null && Number.isFinite(input.waitBlocks) && input.waitBlocks > 0
            ? approxDuration(input.waitBlocks, input.blockMinutes)
            : t.forced_exit_wait_unknown;
    const dest = input.destination ? shortAddress(input.destination) : t.forced_exit_dest_unknown;
    const parts: string[] = [
        String(
            loc.formatString(count === 1 ? t.forced_exit_body_one : t.forced_exit_body_other, {
                sats,
                count,
                dest,
                wait,
            }),
        ),
    ];
    if (!input.destination) {
        parts.push(t.forced_exit_no_destination);
    }
    if (
        input.feeNeededSats != null &&
        Number.isFinite(input.feeNeededSats) &&
        input.feeHeldSats < input.feeNeededSats
    ) {
        parts.push(
            String(
                loc.formatString(t.forced_exit_fees_short, {
                    held: Math.max(0, Math.floor(input.feeHeldSats)).toLocaleString(),
                    needed: Math.floor(input.feeNeededSats).toLocaleString(),
                }),
            ),
        );
    }
    return { title: t.forced_exit_title, body: parts.join('\n\n') };
}

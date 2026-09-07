/**
 * Nominal minutes per block, mirroring `AVG_BLOCK_MINUTES` in ./chainTip.
 *
 * Deliberately re-declared rather than imported: chainTip.ts imports
 * ./config, which imports the bark SDK, and config.ts cannot be loaded under
 * jest. Keeping this module free of that edge is what lets the rules below be
 * unit-tested. Same reasoning (and same trade) as ./esploraProviders.
 *
 * If AVG_BLOCK_MINUTES ever changes, change this with it. The unit suite
 * pins the value so the drift is at least loud.
 */
export const NOMINAL_BLOCK_MINUTES = 10;

/**
 * How old the cached chain tip is allowed to get before the vault's expiry
 * numbers stop being presented as verified.
 *
 * Background (the bug this module exists to close): `arkChainTipHeight` is
 * only written when `fetchChainTipHeight()` succeeds. On an esplora outage
 * the previous value is deliberately left in place, so every consumer that
 * computes `expiryHeight - tip` freezes at whatever it read last. The
 * VTXO countdown then stops ticking down and holds a value that is too
 * generous, and it holds it silently: a frozen "25 days left" renders
 * identically to a true one. The whole store is persisted (there is no
 * `partialize`), so the stale tip also survives a force-quit, and the
 * usual user remedy of relaunching reconfirms the wrong number instead of
 * clearing it. Issue #204 was the same defect reached by a different route
 * (the exit path returned before refreshing the tip) and its fix notes call
 * the result "stale and over-optimistic".
 *
 * Two thresholds, both deliberately generous relative to the sync cadence
 * (30s on iOS, 60s on Android) so a single missed tick never alarms:
 *
 *   - FRESH   (<= 3 min)  roughly 3-6 ticks of slack. Normal operation.
 *   - DEGRADED(<= 20 min) esplora is flaking or the device is offline.
 *                         Numbers are still shown but marked estimated.
 *   - STALE   (> 20 min)  two block intervals with no contact. Nothing read
 *                         from the chain can be asserted, including whether
 *                         a VTXO is dead.
 *
 * Intentionally STRICTER than `MAX_TIP_AGE_FOR_TRIAGE_MS` (1 hour, in
 * ./exitFunding), and the difference is not an oversight. That threshold
 * decides whether to REFUSE to compute an exit plan, so it is set where the
 * drift would actually change the answer. These thresholds decide how to
 * LABEL a number we are showing either way, so they sit where the number
 * stops being current. Do not collapse them into one value.
 */
export const TIP_FRESH_MS = 3 * 60 * 1000;
export const TIP_DEGRADED_MS = 20 * 60 * 1000;

export type TipFreshnessLevel = 'fresh' | 'degraded' | 'stale' | 'unknown';

export interface TipFreshness {
    level: TipFreshnessLevel;
    /** Age of the cached tip in ms, or null when we have never fetched one. */
    ageMs: number | null;
    /**
     * Whether a chain-derived assertion may be treated as authoritative.
     * False for 'stale' and 'unknown'. Callers use this to avoid asserting
     * the UNSAFE-if-wrong direction of a claim: specifically, "this VTXO is
     * expired" must not be shown off a tip we cannot vouch for, because that
     * tells the user their funds are gone when they may still be refreshable
     * inside the ASP's post-expiry grace window.
     */
    trusted: boolean;
}

/**
 * Classify how much we can rely on the cached chain tip.
 *
 * `fetchedAtMs` is the wall-clock time the tip was last successfully read,
 * null when the app has never reached esplora.
 */
export function deriveTipFreshness(args: {
    fetchedAtMs: number | null;
    nowMs: number;
}): TipFreshness {
    const { fetchedAtMs, nowMs } = args;
    if (fetchedAtMs === null || !Number.isFinite(fetchedAtMs)) {
        return { level: 'unknown', ageMs: null, trusted: false };
    }
    // A clock that moved backwards (timezone change, NTP correction, user
    // edit) would otherwise read as a negative age and pass every threshold
    // as "fresh". Clamp: we cannot prove freshness, so do not claim it.
    const ageMs = Math.max(0, nowMs - fetchedAtMs);
    if (ageMs <= TIP_FRESH_MS) return { level: 'fresh', ageMs, trusted: true };
    if (ageMs <= TIP_DEGRADED_MS) return { level: 'degraded', ageMs, trusted: true };
    return { level: 'stale', ageMs, trusted: false };
}

/**
 * The chain tip to actually compute expiry against: the last fetched height
 * advanced by however many blocks are likely to have been mined since.
 *
 * Freezing the tip is the failure we are fixing, so doing nothing is not an
 * option. Extrapolating at the nominal block interval is an estimate, but it
 * errs in the SAFE direction and freezing errs in the unsafe one:
 *
 *   - Extrapolating too fast  -> we understate remaining life -> the user
 *     refreshes earlier than strictly needed. Costs a few sats of round fee.
 *   - Freezing                -> we overstate remaining life -> the user
 *     does nothing and the VTXO expires. Costs the VTXO.
 *
 * Real inter-block time runs slightly under the nominal 10 minutes whenever
 * hashrate is growing, so this estimate is, if anything, mildly conservative
 * too, which is the direction we want.
 *
 * Deliberately uncapped. The cold-launch case is exactly why: an app reopened
 * after three weeks offline reads its persisted tip from disk, and adding the
 * elapsed blocks is what correctly renders those VTXOs as long gone rather
 * than showing the 25-days-left number they had when the app was last closed.
 *
 * Returns null when there is no tip at all, which callers already handle as
 * "expiry unknown".
 */
export function effectiveChainTip(args: {
    tip: number | null;
    fetchedAtMs: number | null;
    nowMs: number;
}): number | null {
    const { tip, fetchedAtMs, nowMs } = args;
    if (tip === null || !Number.isFinite(tip)) return null;
    if (fetchedAtMs === null || !Number.isFinite(fetchedAtMs)) return tip;
    const ageMs = Math.max(0, nowMs - fetchedAtMs);
    const blockMs = NOMINAL_BLOCK_MINUTES * 60 * 1000;
    return tip + Math.floor(ageMs / blockMs);
}

/**
 * Traffic-light summary of whether the vault can currently see the chain.
 *
 * The vault UI previously looked identical whether esplora was answering or
 * had been unreachable for a day, which is what let a frozen countdown pass
 * for a live one. This is the signal that makes the difference visible.
 *
 * Two inputs, because they fail independently:
 *   - the chain tip (esplora), which is what every expiry number is computed
 *     against, and
 *   - the sync loop's own completion stamp, which goes stale when the wallet
 *     handle is wedged or the ASP is unreachable even while esplora is fine.
 *
 * The worse of the two wins. A vault that can read the chain but cannot
 * complete a sync is not healthy, and neither is the reverse.
 */
export type VaultConnectivityLevel = 'green' | 'yellow' | 'red';

export interface VaultConnectivity {
    level: VaultConnectivityLevel;
    tip: TipFreshness;
    /** Age of the last completed sync cycle in ms, null if never completed. */
    syncAgeMs: number | null;
}

export function deriveVaultConnectivity(args: {
    tipFetchedAtMs: number | null;
    lastSyncedAtMs: number | null;
    nowMs: number;
}): VaultConnectivity {
    const { tipFetchedAtMs, lastSyncedAtMs, nowMs } = args;
    const tip = deriveTipFreshness({ fetchedAtMs: tipFetchedAtMs, nowMs });

    const syncAgeMs =
        lastSyncedAtMs === null || !Number.isFinite(lastSyncedAtMs)
            ? null
            : Math.max(0, nowMs - lastSyncedAtMs);

    const tipLevel: VaultConnectivityLevel =
        tip.level === 'fresh' ? 'green' : tip.level === 'degraded' ? 'yellow' : 'red';

    const syncLevel: VaultConnectivityLevel =
        syncAgeMs === null
            ? 'red'
            : syncAgeMs <= TIP_FRESH_MS
                ? 'green'
                : syncAgeMs <= TIP_DEGRADED_MS
                    ? 'yellow'
                    : 'red';

    const rank: Record<VaultConnectivityLevel, number> = { green: 0, yellow: 1, red: 2 };
    const level = rank[syncLevel] > rank[tipLevel] ? syncLevel : tipLevel;

    return { level, tip, syncAgeMs };
}

/**
 * Maximum drift tolerated between a queued expiry alarm and the current best
 * estimate of when the VTXO actually expires, before the alarm is re-queued.
 *
 * Two hours: the tightest warnings in the schedule are at 12h and 6h before
 * expiry, so drift beyond a couple of hours is what starts moving those
 * across the deadline they exist to precede.
 */
export const EXPIRY_ALARM_MAX_DRIFT_MS = 2 * 60 * 60 * 1000;

/**
 * Whether a VTXO's queued OS expiry alarms should be re-scheduled.
 *
 * The bug this closes: the alarms are computed ONCE, at the first sync that
 * sees the VTXO, as `now + blocksLeft * 10 minutes`, and the scheduling call
 * is then guarded on "have we scheduled this id before". Every later tick
 * recomputes the estimate against a fresh tip and stores it, but never
 * re-queues, so the stored estimate silently converges on the truth while the
 * OS alarms stay pinned to the original guess. Nothing compared the two.
 *
 * The 10-minute nominal block interval is the source of the drift: real
 * inter-block time runs under 10 minutes whenever hashrate is growing, so
 * real expiry arrives EARLIER than the original projection and every alarm
 * fires late. Over a full 28-day life that can be enough to push the last
 * warnings past the expiry they were meant to precede.
 *
 * Re-scheduling is safe and cheap: the OS replaces an entry with the same id
 * (see scheduleVtxoExpiryWarnings), so this is an update, not a duplicate.
 * Gated on a threshold rather than run every tick because re-queueing five
 * alarms per VTXO every 30 seconds would be wasteful and races the OS
 * scheduler for no gain.
 *
 * `previousAtMs` is null when this VTXO has never been scheduled, which is
 * always a yes.
 */
export function shouldRescheduleExpiryWarning(args: {
    previousAtMs: number | null;
    currentAtMs: number;
    maxDriftMs?: number;
}): boolean {
    const { previousAtMs, currentAtMs, maxDriftMs = EXPIRY_ALARM_MAX_DRIFT_MS } = args;
    if (previousAtMs === null || !Number.isFinite(previousAtMs)) return true;
    return Math.abs(currentAtMs - previousAtMs) > maxDriftMs;
}

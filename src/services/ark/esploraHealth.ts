/**
 * One shared record of which chain sources are currently unhappy.
 *
 * WHY THIS IS SHARED AND NOT PER-CALLER
 *
 * The cooldown machinery in esploraProviders.ts had exactly one caller. The
 * open path in restore.ts kept its own module-level map and routed around a
 * 429 correctly. Every other JS-side chain call walked the raw list from index
 * 0 every single time, so what the open path learned was thrown away:
 *
 *   - chainTip.ts, which during a unilateral exit is the DOMINANT request
 *     source. #219 turned the drive into a tip poll every 2 to 10 minutes, so
 *     a ~24h wait is roughly 180 polls, and a two-day exit several hundred.
 *     Each one started at blockstream.info, including in the hour after
 *     blockstream had answered 429 and been put on a one-hour cooldown by the
 *     open path standing right next to it.
 *   - exitFunding.ts's fee lookups, on the screen the user is staring at while
 *     trying to fund the exit that cannot proceed without it.
 *
 * That is #194's "rotation is reactive and can rotate INTO an already-exhausted
 * provider", still live after the cooldown logic that was supposed to fix it,
 * because the logic was never wired to the callers that spend the most.
 *
 * Sharing it also makes the learning cross-pollinate: a quota discovered while
 * opening the wallet is known by the next tip poll, and a tip poll that eats a
 * 429 steers the next open. One IP, one quota, so one map.
 *
 * DELIBERATELY IN MEMORY ONLY
 *
 * Resets on app restart, matching the behaviour restore.ts already had and
 * documented. A cooldown is a guess from a single observation, and persisting
 * guesses across launches would let one bad minute mis-route a wallet for an
 * hour after the user tried to fix it by relaunching. The first failure after
 * launch re-learns it at a cost of one request.
 *
 * This module owns MUTABLE state, which is why it is separate from
 * esploraProviders.ts. That file stays pure and import-free so its rules can be
 * unit-tested without standing up the SDK.
 */
import {
    classifyEsploraFailure,
    esploraUrlsByHealth,
    type EsploraHealth,
} from './esploraProviders';

const health: EsploraHealth = {};

/** The live map. Exported for the open path, which passes it to the chooser. */
export function getEsploraHealth(): EsploraHealth {
    return health;
}

/**
 * Record that `url` failed, classifying the cause so the cooldown fits it.
 *
 * `detail` is the raw error text. classifyEsploraFailure reads a 429 out of it,
 * including the disguised form where bark feeds a rate-limit JSON body to a hex
 * parser and complains about blockhash length.
 */
export function noteEsploraFailure(url: string, detail: string, now = Date.now()): void {
    health[url] = { failedAt: now, kind: classifyEsploraFailure(detail) };
}

/** Forget a provider's failure, e.g. after it answers successfully again. */
export function noteEsploraSuccess(url: string): void {
    delete health[url];
}

/**
 * The providers to walk, best first. Never drops one: see esploraUrlsByHealth.
 *
 * Callers that walk a list until something answers should use this instead of
 * ESPLORA_URLS directly.
 */
export function orderedEsploraUrls(urls: readonly string[], now = Date.now()): string[] {
    return esploraUrlsByHealth({ urls, health, now });
}

/** Test seam. Not used in app code. */
export function __resetEsploraHealthForTests(): void {
    for (const k of Object.keys(health)) delete health[k];
}

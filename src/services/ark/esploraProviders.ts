/**
 * The chain sources the wallet falls back through, and the invariant that
 * makes the list actually work.
 *
 * Pure and import-free so it stays unit-testable without the native bark
 * module, matching exitTriage.ts, refreshBatch.ts and the other decision
 * helpers. It lived in config.ts, which cannot be imported under jest because
 * config.ts pulls in the SDK, so the list's invariants were unenforceable.
 *
 * WHY THIS MATTERS
 *
 * The list held two entries. On 2026-08-21 one of them was down for an entire
 * session while the other rate-limited the device, so there was nowhere to
 * rotate to: five open attempts alternating between a 429 and a dead host,
 * for hours, and the wallet simply would not open. A unilateral exit that was
 * already in flight stalled with it, because the drive cannot advance an exit
 * tree without a chain source, and the UI showed nothing wrong the whole time.
 *
 * Two entries is not redundancy. It is a single point of failure with a spare
 * that has to be perfect.
 */

/**
 * Providers in rotation order.
 *
 * Ordered by OPERATOR INDEPENDENCE rather than preference. The first two are
 * what we already relied on; the community mirror sits between the two
 * mempool.space entries so one operator's outage cannot take out consecutive
 * attempts, which is precisely the failure that happened. The regional
 * mempool.space node is last because it stayed up while the apex did not,
 * making it the useful backstop rather than a first choice.
 *
 * Verified 2026-08-21: each answered `/blocks/tip/hash` with a valid 64-char
 * hash and served `/fee-estimates`.
 *
 * PRIVACY: rotation only happens once the provider before it has FAILED, and
 * the wallet still opens against the first entry alone. A healthy wallet talks
 * to exactly one provider, as it always did. These extra entries change who
 * sees an address only in the case where the alternative is not working at all.
 */
export const ESPLORA_FALLBACK_URLS = [
    'https://blockstream.info/api',
    'https://mempool.space/api',
    'https://mempool.emzy.de/api',
    'https://mempool.va1.mempool.space/api',
] as const;

/**
 * Attempts the open-with-retry loop makes.
 *
 * MUST be >= the provider count, or the last entries are never reached and
 * adding a provider silently does nothing. That is the trap this module exists
 * to make visible: the old list had no such check, so its second entry being
 * dead was invisible until it mattered.
 */
export const ESPLORA_OPEN_ATTEMPTS = 5;

/** Operator for a provider URL, used to keep same-operator entries apart. */
export function esploraOperator(url: string): string {
    const host = url.replace(/^https?:\/\//, '').split('/')[0];
    return host.split('.').slice(-2).join('.');
}

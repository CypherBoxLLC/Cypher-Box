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

/**
 * How long a provider stays out of rotation after failing.
 *
 * Split by CAUSE, because the two failures have very different recovery times.
 * A 429 from Blockstream is an hourly quota: coming back in five minutes just
 * spends another request to be told the same thing. A connection failure is
 * usually transient and the host may be back almost immediately.
 *
 * These are deliberately not equal, and that asymmetry is the whole point of
 * tracking the cause rather than just "it failed".
 */
export const ESPLORA_RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;
export const ESPLORA_UNREACHABLE_COOLDOWN_MS = 5 * 60 * 1000;

export type EsploraFailureKind = 'rate-limited' | 'unreachable';

/** When a provider last failed, and why. Absent means never failed. */
export type EsploraHealth = Record<string, { failedAt: number; kind: EsploraFailureKind }>;

/**
 * Classify an open/fetch failure so the cooldown can be sized to it.
 *
 * A 429 body reaches us disguised: Blockstream answers with a ~330 byte JSON
 * notice, bark feeds it to a hex parser expecting a blockhash, and the error
 * says "not a blockhash ... invalid hex string length 338". So the hex-length
 * complaint IS a rate-limit tell in this specific context, unlike in
 * networkFault.ts where it stays ambiguous because any error page produces it.
 * Here the cost of guessing wrong is only a longer cooldown on one provider.
 */
export function classifyEsploraFailure(detail: string): EsploraFailureKind {
    if (/\b429\b|too many requests|rate limit|request rate|exceeds the current limit/i.test(detail)) {
        return 'rate-limited';
    }
    if (/invalid hex string length|not a blockhash|failed to parse hex/i.test(detail)) {
        return 'rate-limited';
    }
    return 'unreachable';
}

function cooldownFor(kind: EsploraFailureKind): number {
    return kind === 'rate-limited'
        ? ESPLORA_RATE_LIMIT_COOLDOWN_MS
        : ESPLORA_UNREACHABLE_COOLDOWN_MS;
}

/**
 * Pick the provider to try next, skipping any still cooling down.
 *
 * Rules, in order:
 *
 *  1. Prefer providers in list order that are NOT cooling down. A healthy
 *     wallet therefore keeps talking to exactly one provider, which is the
 *     privacy property the list ordering already documents.
 *  2. Among those, skip one whose OPERATOR just failed, so a Blockstream 429
 *     does not immediately retry another Blockstream host. Falls back to
 *     allowing the same operator if that leaves nothing.
 *  3. If everything is cooling down, return the one whose cooldown expires
 *     SOONEST rather than nothing. A stale provider is worth more than no
 *     chain source at all, and the caller has no better option.
 *
 * Never returns null: the caller always needs somewhere to point.
 */
export function chooseEsploraProvider(args: {
    urls: readonly string[];
    health: EsploraHealth;
    now: number;
}): { url: string; coolingDown: boolean } {
    const { urls, health, now } = args;
    const isCooling = (u: string) => {
        const h = health[u];
        return h != null && now - h.failedAt < cooldownFor(h.kind);
    };

    const available = urls.filter((u) => !isCooling(u));
    if (available.length > 0) {
        // Avoid an operator that failed recently, even if a different host of
        // theirs has no record of its own: a quota is per IP-and-operator, not
        // per hostname.
        const burnedOperators = new Set(
            urls.filter(isCooling).map((u) => esploraOperator(u)),
        );
        const clean = available.filter((u) => !burnedOperators.has(esploraOperator(u)));
        return { url: (clean[0] ?? available[0]) as string, coolingDown: false };
    }

    // Everything is cooling. Take whichever recovers first.
    const soonest = [...urls].sort((a, b) => {
        const ha = health[a];
        const hb = health[b];
        const ea = ha ? ha.failedAt + cooldownFor(ha.kind) : 0;
        const eb = hb ? hb.failedAt + cooldownFor(hb.kind) : 0;
        return ea - eb;
    })[0];
    return { url: soonest as string, coolingDown: true };
}

/**
 * The full provider list, reordered so the ones worth trying come first.
 *
 * WHY THIS EXISTS SEPARATELY FROM chooseEsploraProvider
 *
 * `chooseEsploraProvider` answers "which ONE do I point the wallet at", which
 * is what the open path needs: bark takes a single esplora address in its
 * config. But the JS-side callers do not pick one, they WALK the list until
 * something answers. Handing them a single URL would throw away the fallback
 * that makes them work at all.
 *
 * So this returns every provider, in the order a walker should try them. Same
 * health rules, different shape.
 *
 * NOTHING IS EVER DROPPED
 *
 * A cooling-down provider is demoted, never removed. Cooldowns are a guess
 * built on one observed failure, and a wrong guess must not be able to take a
 * provider out of service: the walker still reaches it after the healthy ones,
 * which is strictly better than today's blind order and never worse. With an
 * empty health map the output is `urls` unchanged, so a fresh launch behaves
 * exactly as it did before.
 *
 * THE ORDER
 *
 *  1. Available, and no sibling host of the same operator is cooling down.
 *     A quota is per IP-and-operator, so a Blockstream 429 makes every
 *     Blockstream host a bad bet, not just the one that answered.
 *  2. Available, but an operator sibling is cooling down.
 *  3. Cooling down, soonest to recover first.
 *
 * List order is preserved inside each tier, so the privacy property the list
 * ordering documents still holds: a healthy wallet talks to the first entry.
 */
export function esploraUrlsByHealth(args: {
    urls: readonly string[];
    health: EsploraHealth;
    now: number;
}): string[] {
    const { urls, health, now } = args;
    const isCooling = (u: string) => {
        const h = health[u];
        return h != null && now - h.failedAt < cooldownFor(h.kind);
    };
    const recoversAt = (u: string) => {
        const h = health[u];
        return h ? h.failedAt + cooldownFor(h.kind) : 0;
    };

    const burnedOperators = new Set(
        urls.filter(isCooling).map((u) => esploraOperator(u)),
    );

    const clean: string[] = [];
    const tainted: string[] = [];
    const cooling: string[] = [];
    for (const u of urls) {
        if (isCooling(u)) cooling.push(u);
        else if (burnedOperators.has(esploraOperator(u))) tainted.push(u);
        else clean.push(u);
    }
    cooling.sort((a, b) => recoversAt(a) - recoversAt(b));
    return [...clean, ...tainted, ...cooling];
}

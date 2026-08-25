/**
 * Which side of the network is unreachable, and what to tell the user.
 *
 * The Bark Vault talks to two independent services and a failure in either
 * surfaces to the user as the same shrug of a raw SDK error string. They need
 * opposite responses:
 *
 *   - CHAIN SOURCE (esplora): the wallet cannot read the chain. Observed on
 *     device when Blockstream served its Cloudflare bot-block page and
 *     mempool.space TCP-timed out from the same Wi-Fi, while both answered
 *     instantly from a browser on the same network. Switching to mobile data
 *     fixed it. So here, suggesting a network change is genuinely useful.
 *
 *   - ARK SERVER (the ASP): rounds, sends and Lightning invoices need it.
 *     Changing network will not help if the server itself is down, and telling
 *     someone to fiddle with Wi-Fi while their funds look stuck is worse than
 *     saying nothing. What matters here is the reassurance: the unilateral exit
 *     does not need this server.
 *
 * DISCRIMINATION IS BY HOSTNAME, deliberately. The tempting shortcut, matching
 * `BarkError.ServerConnection`, is wrong: our own config notes that exact tag
 * appearing for an esplora 429 during recovery, so it does not identify a side.
 * Hostnames do. Phrase matching is only a fallback for errors that name no host.
 *
 * Returns 'unknown' rather than guessing. A wrong suggestion (telling someone to
 * switch networks when the server is down) costs more than no suggestion.
 */

export type ArkNetworkFault =
    | 'chain-source'
    | 'chain-source-rate-limited'
    | 'ark-server'
    | 'unknown';

/** Flatten a thrown value into searchable text. BarkError hides detail in `inner`. */
export function arkErrorText(err: unknown): string {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    const e = err as {
        tag?: unknown;
        message?: unknown;
        inner?: { errorMessage?: unknown; message?: unknown };
    };
    return [
        e.tag,
        e.message,
        e.inner?.errorMessage,
        e.inner?.message,
    ]
        .filter((p) => typeof p === 'string')
        .join(' ');
}

function hostOf(url: string): string | null {
    // Deliberately not `new URL()`: it is available in Hermes but throws on the
    // malformed values that can reach here from user-supplied endpoints, and a
    // classifier must never throw on the error path.
    const m = /^[a-z]+:\/\/([^/:?#]+)/i.exec(url.trim());
    return m ? m[1].toLowerCase() : null;
}

/** Phrases only ever produced by the chain-data client. */
const CHAIN_SOURCE_PHRASES =
    /not a blockhash|failed to parse hex|esplora|chain source|Sync failed/i;

/**
 * A quota rejection, as distinct from the provider being unreachable.
 *
 * These need opposite advice. Unreachable means try another network. Rate
 * limited means the provider is working fine and is refusing US, so the remedy
 * is to wait it out or present a different IP.
 *
 * Worth separating because the symptom actively misleads. Blockstream answers a
 * 429 with a ~330 byte JSON notice, bark hands that body to a hex parser
 * expecting a 64 character blockhash, and the user is shown "not a blockhash ...
 * Esplora client possibly misconfigured". That points at their wallet and their
 * network when the actual cause is a quota. Observed 2026-08-20 on mainnet, and
 * it cost hours chasing TLS interception.
 *
 * NOT matched here: the long-hex-string symptom on its own. A body where a
 * blockhash belongs proves the provider returned an error page, not which error,
 * so it stays a plain chain-source fault. Claiming "rate limited" for a 500 would
 * be the same class of confident wrong answer this module exists to avoid.
 */
const RATE_LIMIT_PHRASES =
    /\b429\b|too many requests|rate limit|request rate|exceeds the current limit/i;

export function classifyArkNetworkFault(
    err: unknown,
    endpoints: { chainUrls?: readonly string[]; arkUrl?: string | null } = {},
): ArkNetworkFault {
    const text = arkErrorText(err);
    if (!text) return 'unknown';
    const haystack = text.toLowerCase();

    const rateLimited = RATE_LIMIT_PHRASES.test(text);

    // Hostname match first: unambiguous, and survives SDK wording changes.
    for (const url of endpoints.chainUrls ?? []) {
        const host = hostOf(url);
        if (host && haystack.includes(host)) {
            return rateLimited ? 'chain-source-rate-limited' : 'chain-source';
        }
    }
    const arkHost = endpoints.arkUrl ? hostOf(endpoints.arkUrl) : null;
    // Checked before the hostless rate-limit fallback below, so a quota
    // rejection that DOES name the ASP is still reported as an ASP fault.
    if (arkHost && haystack.includes(arkHost)) return 'ark-server';

    // A quota rejection often names no host of ours, because the body is the
    // provider's own notice rather than a connection error. Only the chain
    // source is polled hard enough to earn one.
    if (rateLimited) return 'chain-source-rate-limited';
    if (CHAIN_SOURCE_PHRASES.test(text)) return 'chain-source';

    return 'unknown';
}

/**
 * User-facing sentence for a fault, or null when we do not know enough to say
 * anything useful. Callers append this to their own context rather than
 * replacing it, so the user still learns which action failed.
 */
export function arkNetworkFaultMessage(fault: ArkNetworkFault): string | null {
    switch (fault) {
        case 'chain-source':
            return "Can't reach the Bitcoin network data provider. If you're on Wi-Fi, try mobile data, then try again.";
        case 'chain-source-rate-limited':
            // Says "not your wallet" explicitly: the raw symptom claims the
            // opposite, and that is the whole reason this case exists.
            return 'The Bitcoin network data provider is limiting how many requests this connection can make. Nothing is wrong with your wallet. It clears within the hour, or switch networks to get a different address.';
        case 'ark-server':
            // No network advice: if the server is down, switching networks
            // achieves nothing and wastes the user's time.
            return 'The Ark server is not responding right now. Your funds are safe, and an emergency exit does not need this server.';
        default:
            return null;
    }
}

/**
 * The whole pattern in one call: classify, and fall back to the raw SDK text
 * only when the cause is not recognisable.
 *
 * This exists because the two-step version did not get used. `classifyArkNetworkFault`
 * and `arkNetworkFaultMessage` shipped with unit tests and were wired into
 * exactly ONE screen out of every Ark failure surface in the app, so a refresh
 * that could not reach blockstream showed the user:
 *
 *     Refresh failed: Exception.Inner: Reqwest(reqwest::Error { kind: Request,
 *     url: "https://blockstream.info/api/blocks/tip/height", source: ...
 *     ConnectError("dns error", ...) })
 *
 * captured on device 2026-08-25. That string even names the chain source, so
 * the classifier would have got it right had anyone asked it.
 *
 * Endpoints stay a parameter rather than being read from ./config, so this
 * module keeps no import of the native bark binding and stays unit-testable.
 *
 * `context` is the action that failed, phrased so it reads before either
 * ending: "Refresh failed", "Couldn't start exit".
 */
export function describeArkFailure(
    err: unknown,
    context: string,
    endpoints: { chainUrls?: readonly string[]; arkUrl?: string | null },
): string {
    const fault = arkNetworkFaultMessage(classifyArkNetworkFault(err, endpoints));
    if (fault) return `${context}. ${fault}`;
    const raw = arkErrorText(err);
    return raw ? `${context}: ${raw}` : `${context}: unknown error`;
}

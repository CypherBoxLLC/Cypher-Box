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

export type ArkNetworkFault = 'chain-source' | 'ark-server' | 'unknown';

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

export function classifyArkNetworkFault(
    err: unknown,
    endpoints: { chainUrls?: readonly string[]; arkUrl?: string | null } = {},
): ArkNetworkFault {
    const text = arkErrorText(err);
    if (!text) return 'unknown';
    const haystack = text.toLowerCase();

    // Hostname match first: unambiguous, and survives SDK wording changes.
    for (const url of endpoints.chainUrls ?? []) {
        const host = hostOf(url);
        if (host && haystack.includes(host)) return 'chain-source';
    }
    const arkHost = endpoints.arkUrl ? hostOf(endpoints.arkUrl) : null;
    if (arkHost && haystack.includes(arkHost)) return 'ark-server';

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
        case 'ark-server':
            // No network advice: if the server is down, switching networks
            // achieves nothing and wastes the user's time.
            return 'The Ark server is not responding right now. Your funds are safe, and an emergency exit does not need this server.';
        default:
            return null;
    }
}

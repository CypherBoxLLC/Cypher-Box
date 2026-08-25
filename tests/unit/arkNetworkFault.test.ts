/**
 * Telling the user which side of the network is unreachable.
 *
 * Chain-source failures and Ark-server failures look identical to a user and
 * need opposite advice. Switching to mobile data genuinely fixed a chain-source
 * outage on device; suggesting it while the ASP is down is noise at the exact
 * moment someone thinks their money is stuck.
 *
 * Every error string below is one we actually captured on device.
 */

import {
    arkErrorText,
    arkNetworkFaultMessage,
    classifyArkNetworkFault,
    describeArkFailure,
} from '../../src/services/ark/networkFault';

const ENDPOINTS = {
    chainUrls: ['https://blockstream.info/api', 'https://mempool.space/api'],
    arkUrl: 'https://ark.second.tech',
};

const classify = (err: unknown) => classifyArkNetworkFault(err, ENDPOINTS);

describe('chain-source failures', () => {
    it('recognises the Blockstream bot-block page', () => {
        // The literal error from the device, typo and all.
        const err = {
            tag: 'Inner',
            message:
                'Exception.Inner: Failed to create chain source: bad response from server (not a blockhash). Esplora client possibly misconfigured: failed to parse hex: invilad hex string length 338 (expected 64)',
        };
        expect(classify(err)).toBe('chain-source');
    });

    it('recognises the mempool.space TCP timeout by hostname', () => {
        const err = {
            tag: 'Inner',
            message:
                'Sync failed: Reqwest(reqwest::Error { kind: Request, url: "https://mempool.space/api/scripthash/abc/txs", source: Os { code: 60, kind: TimedOut } })',
        };
        expect(classify(err)).toBe('chain-source');
    });

    it('reads detail out of a BarkError inner payload', () => {
        const err = { tag: 'ServerConnection', inner: { errorMessage: 'esplora request failed' } };
        expect(classify(err)).toBe('chain-source');
    });

    it('suggests switching networks, which is the fix that worked', () => {
        expect(arkNetworkFaultMessage('chain-source')).toMatch(/mobile data/i);
    });
});

describe('ark-server failures', () => {
    it('recognises the ASP by hostname', () => {
        const err = { message: 'transport error connecting to https://ark.second.tech' };
        expect(classify(err)).toBe('ark-server');
    });

    it('does NOT suggest switching networks', () => {
        // The whole point of splitting the two. A network switch cannot fix a
        // server that is down, and the advice wastes the user's time while
        // their balance looks wrong.
        const msg = arkNetworkFaultMessage('ark-server');
        expect(msg).not.toMatch(/wi-?fi|mobile data|cellular/i);
    });

    it('says the exit does not depend on that server', () => {
        expect(arkNetworkFaultMessage('ark-server')).toMatch(/exit/i);
    });
});

describe('what it refuses to guess', () => {
    it('does not treat ServerConnection alone as an Ark-server fault', () => {
        // The tempting shortcut, and wrong: config.ts records that exact tag
        // appearing for an esplora 429 during recovery. It identifies no side.
        expect(classify({ tag: 'ServerConnection', message: 'BarkError.ServerConnection' })).toBe('unknown');
    });

    it('returns unknown for an unrelated failure', () => {
        expect(classify(new Error('Insufficient balance'))).toBe('unknown');
    });

    it.each([null, undefined, '', {}])('returns unknown for %p', (v) => {
        expect(classify(v)).toBe('unknown');
    });

    it('offers no message when it does not know', () => {
        // Better silent than misleading: the caller still shows its own
        // context, so the user is not left with nothing.
        expect(arkNetworkFaultMessage('unknown')).toBeNull();
    });

    it('never throws on a malformed endpoint', () => {
        expect(() =>
            classifyArkNetworkFault({ message: 'boom' }, { chainUrls: ['not a url', ''], arkUrl: '::::' }),
        ).not.toThrow();
    });
});

describe('arkErrorText', () => {
    it('flattens tag, message and inner detail together', () => {
        const t = arkErrorText({ tag: 'Inner', message: 'outer', inner: { errorMessage: 'deep cause' } });
        expect(t).toContain('outer');
        expect(t).toContain('deep cause');
    });

    it('passes a plain string through', () => {
        expect(arkErrorText('just text')).toBe('just text');
    });

    it('is empty for a value carrying no text', () => {
        expect(arkErrorText({ code: 7 })).toBe('');
    });
});

describe('rate limiting, which the raw symptom misreports as corruption', () => {
    // The real 429 body, captured on mainnet 2026-08-20.
    const BLOCKSTREAM_429 =
        'Sync failed: HttpResponse { status: 429, message: "{\\"message\\":\\"Blockstream ' +
        'Explorer API NOTICE: Your request rate exceeds the current limit..." }';

    it('names a 429 as a quota rejection rather than a chain-source outage', () => {
        expect(classify(BLOCKSTREAM_429)).toBe('chain-source-rate-limited');
    });

    it('still names it when the provider hostname is present', () => {
        expect(
            classify('https://blockstream.info/api failed: 429 Too Many Requests'),
        ).toBe('chain-source-rate-limited');
    });

    it('tells the user it is not their wallet, because the raw error implies it is', () => {
        const msg = arkNetworkFaultMessage('chain-source-rate-limited') ?? '';
        expect(msg.toLowerCase()).toContain('nothing is wrong with your wallet');
    });

    it('does not tell them to switch to mobile data, which does not clear a quota', () => {
        const msg = arkNetworkFaultMessage('chain-source-rate-limited') ?? '';
        expect(msg.toLowerCase()).not.toContain('mobile data');
    });

    // The 338-byte hex string is the 429 body being parsed as a blockhash. But a
    // body where a blockhash belongs only proves the provider returned an error
    // page, not WHICH error, so this stays the general chain-source fault.
    // Guessing "rate limited" for a 500 would be the confident-wrong-answer this
    // module exists to avoid.
    it('does NOT infer rate limiting from the parse failure alone', () => {
        expect(
            classify(
                'Failed to create chain source: bad response from server (not a blockhash). ' +
                'failed to parse hex: invalid hex string length 338 (expected 64)',
            ),
        ).toBe('chain-source');
    });

    it('reports a quota rejection that names the ASP as an Ark-server fault', () => {
        expect(classify('https://ark.second.tech: 429 too many requests')).toBe(
            'ark-server',
        );
    });
});

describe('describeArkFailure: the one-call form that call sites actually use', () => {
    // The two-step form shipped tested and was wired into exactly ONE screen,
    // so a refresh that could not reach blockstream showed the user a raw
    // Reqwest error. These pin the shape that replaced it.

    /** Verbatim from the device, 2026-08-25, airplane mode, tapping Refresh. */
    const DEVICE_DNS_ERROR = {
        tag: 'Inner',
        message:
            'Exception.Inner: Reqwest(reqwest::Error { kind: Request, url: ' +
            '"https://blockstream.info/api/blocks/tip/height", source: ' +
            'hyper_util::client::legacy::Error(Connect, ConnectError("dns error", ' +
            'Custom { kind: Uncategorized, error: "failed to lookup address ' +
            'information: nodename nor servname provided, or not known" })) })',
    };

    it('turns the exact error the user saw into advice, not a stack trace', () => {
        const out = describeArkFailure(DEVICE_DNS_ERROR, 'Refresh failed', ENDPOINTS);
        expect(out).toContain('Refresh failed.');
        expect(out).toContain('try mobile data');
        // The whole point: none of the SDK internals reach the user.
        expect(out).not.toMatch(/Reqwest|hyper_util|ConnectError|Exception\.Inner/);
    });

    it('names the Ark server without suggesting a network switch', () => {
        const out = describeArkFailure(
            { message: 'error trying to connect to https://ark.second.tech' },
            "Couldn't start exit",
            ENDPOINTS,
        );
        expect(out).toContain("Couldn't start exit.");
        expect(out).toContain('Ark server is not responding');
        expect(out).not.toContain('mobile data');
    });

    it('falls back to the raw text when the cause is not recognisable', () => {
        const out = describeArkFailure({ message: 'something odd' }, 'Send failed', ENDPOINTS);
        expect(out).toBe('Send failed: something odd');
    });

    it('never renders an empty tail for a null error', () => {
        expect(describeArkFailure(null, 'Send failed', ENDPOINTS)).toBe('Send failed: unknown error');
        expect(describeArkFailure(undefined, 'Refresh failed', ENDPOINTS)).toBe(
            'Refresh failed: unknown error',
        );
    });

    it('keeps context and advice as separate sentences, so both survive', () => {
        // Callers append their own clauses (for instance "Your funds were not
        // moved."), so the string must end cleanly rather than mid-phrase.
        const out = describeArkFailure(DEVICE_DNS_ERROR, 'Send failed', ENDPOINTS);
        expect(out.startsWith('Send failed. ')).toBe(true);
        expect(out.trim().endsWith('.')).toBe(true);
    });
});

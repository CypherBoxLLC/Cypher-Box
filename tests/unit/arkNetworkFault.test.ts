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

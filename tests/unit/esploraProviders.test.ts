import {
    ESPLORA_FALLBACK_URLS,
    ESPLORA_OPEN_ATTEMPTS,
    esploraOperator,
    chooseEsploraProvider,
    esploraUrlsByHealth,
    classifyEsploraFailure,
    ESPLORA_RATE_LIMIT_COOLDOWN_MS,
    type EsploraHealth,
} from '../../src/services/ark/esploraProviders';

describe('esplora fallback list', () => {
  it('has more than one real alternative', () => {
    // The list held two entries on 2026-08-21. One was down all session and the
    // other rate-limited the device, so there was nowhere to rotate to and the
    // wallet could not open for hours. Two is not redundancy.
    expect(ESPLORA_FALLBACK_URLS.length).toBeGreaterThanOrEqual(3);
  });

  it('is fully reachable within the attempt budget', () => {
    // The trap this module exists to make visible: a provider added past the
    // attempt count is never tried, and nothing anywhere would have said so.
    expect(ESPLORA_OPEN_ATTEMPTS).toBeGreaterThanOrEqual(ESPLORA_FALLBACK_URLS.length);
  });

  it('never places two providers from one operator back to back', () => {
    // A single operator's outage must not be able to burn consecutive
    // attempts. mempool.space's apex was down while its regional node was up,
    // so the two must not sit next to each other.
    const ops = ESPLORA_FALLBACK_URLS.map(esploraOperator);
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i]).not.toBe(ops[i - 1]);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(ESPLORA_FALLBACK_URLS).size).toBe(ESPLORA_FALLBACK_URLS.length);
  });

  it('is https only, with no trailing slash', () => {
    for (const u of ESPLORA_FALLBACK_URLS) {
      expect(u.startsWith('https://')).toBe(true);
      expect(u.endsWith('/')).toBe(false);
    }
  });

  it('keeps the previously configured primary first', () => {
    // Changing the primary changes who sees every healthy wallet's addresses.
    // That is a deliberate decision, not something to drift into by reordering.
    expect(ESPLORA_FALLBACK_URLS[0]).toBe('https://blockstream.info/api');
  });

  it('reads the operator from the registrable domain', () => {
    expect(esploraOperator('https://mempool.va1.mempool.space/api')).toBe('mempool.space');
    expect(esploraOperator('https://mempool.space/api')).toBe('mempool.space');
    expect(esploraOperator('https://blockstream.info/api')).toBe('blockstream.info');
    expect(esploraOperator('https://mempool.emzy.de/api')).toBe('emzy.de');
  });
});

describe('provider health, so rotation does not walk back into a burned provider', () => {
    const URLS = [
        'https://blockstream.info/api',
        'https://mempool.space/api',
        'https://mempool.emzy.de/api',
        'https://mempool.va1.mempool.space/api',
    ];
    const NOW = 1_700_000_000_000;
    const pick = (health: EsploraHealth, now = NOW) =>
        chooseEsploraProvider({ urls: URLS, health, now });

    it('a healthy wallet keeps using exactly one provider', () => {
        // The privacy property: extra entries only change who sees an address
        // when the alternative is not working at all.
        expect(pick({}).url).toBe(URLS[0]);
        expect(pick({}).coolingDown).toBe(false);
    });

    it('skips a rate-limited provider instead of retrying into the quota', () => {
        const h: EsploraHealth = {
            [URLS[0]]: { failedAt: NOW - 60_000, kind: 'rate-limited' },
        };
        expect(pick(h).url).not.toBe(URLS[0]);
    });

    it('keeps a 429 out of rotation far longer than an unreachable host', () => {
        const rl: EsploraHealth = { [URLS[0]]: { failedAt: NOW, kind: 'rate-limited' } };
        const un: EsploraHealth = { [URLS[0]]: { failedAt: NOW, kind: 'unreachable' } };
        const tenMin = NOW + 10 * 60 * 1000;
        // Ten minutes on: the unreachable host is back, the quota is not.
        expect(pick(un, tenMin).url).toBe(URLS[0]);
        expect(pick(rl, tenMin).url).not.toBe(URLS[0]);
    });

    it('returns a rate-limited provider once its hour is up', () => {
        const h: EsploraHealth = { [URLS[0]]: { failedAt: NOW, kind: 'rate-limited' } };
        expect(pick(h, NOW + ESPLORA_RATE_LIMIT_COOLDOWN_MS + 1).url).toBe(URLS[0]);
    });

    it('avoids another host from the operator that just failed', () => {
        // mempool.space apex burned; the va1 node is the same operator, so the
        // community mirror should win even though it is later in the list.
        const h: EsploraHealth = {
            [URLS[0]]: { failedAt: NOW, kind: 'rate-limited' },
            [URLS[1]]: { failedAt: NOW, kind: 'rate-limited' },
        };
        expect(pick(h).url).toBe('https://mempool.emzy.de/api');
    });

    it('never returns nothing: falls back to whichever recovers soonest', () => {
        // A stale provider beats having no chain source, which is what left a
        // wallet unopenable and an in-flight exit stalled.
        const h: EsploraHealth = {
            [URLS[0]]: { failedAt: NOW, kind: 'rate-limited' },
            [URLS[1]]: { failedAt: NOW, kind: 'rate-limited' },
            [URLS[2]]: { failedAt: NOW - 4 * 60 * 1000, kind: 'unreachable' },
            [URLS[3]]: { failedAt: NOW, kind: 'rate-limited' },
        };
        const got = pick(h);
        expect(got.coolingDown).toBe(true);
        expect(got.url).toBe(URLS[2]); // unreachable 4 min ago, 1 min left
    });
});

describe('classifying an esplora failure', () => {
    it('reads the disguised 429: a 338-byte "hex string" is the notice body', () => {
        expect(
            classifyEsploraFailure(
                'bad response from server (not a blockhash). failed to parse hex: invalid hex string length 338 (expected 64)',
            ),
        ).toBe('rate-limited');
    });

    it('reads an explicit 429', () => {
        expect(classifyEsploraFailure('HttpResponse { status: 429 }')).toBe('rate-limited');
    });

    it('treats a connection failure as unreachable, which cools down briefly', () => {
        expect(classifyEsploraFailure('ServerConnection: timed out')).toBe('unreachable');
    });
});

describe('walking the list, for callers that try every provider in turn', () => {
    // chooseEsploraProvider answers "which ONE", which is what bark's config
    // needs. The JS-side callers (chainTip, exit fee lookups) walk the list
    // until something answers, so handing them one URL would throw away the
    // fallback. Same health rules, different shape.
    const URLS = [
        'https://blockstream.info/api',
        'https://mempool.space/api',
        'https://mempool.emzy.de/api',
        'https://mempool.va1.mempool.space/api',
    ];
    const NOW = 1_700_000_000_000;
    const order = (health: EsploraHealth, now = NOW) =>
        esploraUrlsByHealth({ urls: URLS, health, now });

    it('changes nothing at all when no provider has failed', () => {
        // The safety property that makes this landable without ceremony: a
        // fresh launch behaves exactly as the blind order did.
        expect(order({})).toEqual(URLS);
    });

    it('never drops a provider, only demotes it', () => {
        // A cooldown is a guess from ONE observation. A wrong guess must not
        // be able to take a provider out of service.
        const h: EsploraHealth = {
            [URLS[0]]: { failedAt: NOW - 60_000, kind: 'rate-limited' },
            [URLS[1]]: { failedAt: NOW - 10_000, kind: 'unreachable' },
            [URLS[2]]: { failedAt: NOW - 10_000, kind: 'unreachable' },
            [URLS[3]]: { failedAt: NOW - 10_000, kind: 'unreachable' },
        };
        expect([...order(h)].sort()).toEqual([...URLS].sort());
    });

    it('demotes a rate-limited provider below the healthy ones', () => {
        // #194: several hundred tip polls over a two-day exit each started at
        // blockstream, in the hour after blockstream had already answered 429.
        const h: EsploraHealth = {
            [URLS[0]]: { failedAt: NOW - 60_000, kind: 'rate-limited' },
        };
        expect(order(h)[0]).not.toBe(URLS[0]);
        expect(order(h).indexOf(URLS[0])).toBe(URLS.length - 1);
    });

    it('demotes an operator sibling of a burned provider too', () => {
        // A quota is per IP-and-operator, so a mempool.space 429 makes the
        // regional mempool.space node a bad bet as well.
        const h: EsploraHealth = {
            [URLS[1]]: { failedAt: NOW - 60_000, kind: 'rate-limited' },
        };
        const o = order(h);
        expect(o[0]).toBe(URLS[0]);
        // The va1 sibling shares mempool.space, so it ranks below the
        // independent community mirror despite coming first in list order.
        expect(o.indexOf(URLS[2])).toBeLessThan(o.indexOf(URLS[3]));
    });

    it('puts the soonest-to-recover first when everything is cooling', () => {
        // A stale provider beats no chain source, and the exit drive has no
        // better option than to try something.
        const h: EsploraHealth = {
            [URLS[0]]: { failedAt: NOW, kind: 'rate-limited' },
            [URLS[1]]: { failedAt: NOW, kind: 'unreachable' },
            [URLS[2]]: { failedAt: NOW, kind: 'rate-limited' },
            [URLS[3]]: { failedAt: NOW, kind: 'rate-limited' },
        };
        // unreachable carries the short cooldown, so it recovers first.
        expect(order(h)[0]).toBe(URLS[1]);
    });

    it('restores a provider once its cooldown has expired', () => {
        const h: EsploraHealth = {
            [URLS[0]]: { failedAt: NOW - ESPLORA_RATE_LIMIT_COOLDOWN_MS - 1, kind: 'rate-limited' },
        };
        expect(order(h)).toEqual(URLS);
    });

    it('preserves list order inside a tier', () => {
        // The privacy property the list ordering documents still holds.
        const h: EsploraHealth = {
            [URLS[0]]: { failedAt: NOW - 60_000, kind: 'rate-limited' },
        };
        const healthy = order(h).slice(0, 3);
        expect(healthy).toEqual([URLS[1], URLS[2], URLS[3]]);
    });
});

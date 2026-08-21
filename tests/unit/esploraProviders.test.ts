import {
  ESPLORA_FALLBACK_URLS,
  ESPLORA_OPEN_ATTEMPTS,
  esploraOperator,
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

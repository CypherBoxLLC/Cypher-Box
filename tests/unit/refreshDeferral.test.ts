import {
    buildDeferredVtxoIds,
    SPEND_GRACE_MS,
    RECENT_OBSERVE_WINDOW_MS,
} from '../../src/services/ark/refreshDeferral';

describe('buildDeferredVtxoIds spend-immediately consent gate', () => {
    const now = 1_700_000_000_000;

    it('defers a vtxo whose arkoor popup is still unanswered (pending)', () => {
        const s = buildDeferredVtxoIds({ a: { status: 'pending', observedAt: 0 } }, now);
        expect(s.has('a')).toBe(true);
    });

    it('defers a vtxo inside its "use immediately" grace window', () => {
        const s = buildDeferredVtxoIds(
            { a: { status: 'dismissed', observedAt: 0, deferUntil: now + 1000 } },
            now,
        );
        expect(s.has('a')).toBe(true);
    });

    it('does NOT defer once the grace has lapsed (time-boxed, not permanent)', () => {
        const s = buildDeferredVtxoIds(
            { a: { status: 'dismissed', observedAt: 0, deferUntil: now - 1 } },
            now,
        );
        expect(s.has('a')).toBe(false);
    });

    it('does NOT defer a plain dismissed entry with no grace (back-compat)', () => {
        const s = buildDeferredVtxoIds({ a: { status: 'dismissed', observedAt: 0 } }, now);
        expect(s.has('a')).toBe(false);
    });

    it('defers a just-observed vtxo within the 90s race window regardless of status', () => {
        const s = buildDeferredVtxoIds(
            { a: { status: 'refreshed', observedAt: now - 1000 } },
            now,
        );
        expect(s.has('a')).toBe(true);
    });

    it('does NOT defer an old observation with no pending/grace', () => {
        const s = buildDeferredVtxoIds(
            { a: { status: 'refreshed', observedAt: now - RECENT_OBSERVE_WINDOW_MS - 1 } },
            now,
        );
        expect(s.has('a')).toBe(false);
    });

    it('honours the full 3h grace end-to-end (deferred during, free after)', () => {
        const deferUntil = now + SPEND_GRACE_MS; // set when "Use immediately" is tapped
        const entry = { a: { status: 'dismissed' as const, observedAt: now, deferUntil } };
        expect(buildDeferredVtxoIds(entry, now + SPEND_GRACE_MS - 1).has('a')).toBe(true);
        expect(buildDeferredVtxoIds(entry, now + SPEND_GRACE_MS + 1).has('a')).toBe(false);
    });

    it('only defers the affected id in a mixed set', () => {
        const s = buildDeferredVtxoIds(
            {
                grace: { status: 'dismissed', observedAt: 0, deferUntil: now + 1000 },
                lapsed: { status: 'dismissed', observedAt: 0, deferUntil: now - 1000 },
                done: { status: 'refreshed', observedAt: 0 },
            },
            now,
        );
        expect([...s]).toEqual(['grace']);
    });

    it('returns empty for null / empty state', () => {
        expect(buildDeferredVtxoIds(null, now).size).toBe(0);
        expect(buildDeferredVtxoIds({}, now).size).toBe(0);
    });
});

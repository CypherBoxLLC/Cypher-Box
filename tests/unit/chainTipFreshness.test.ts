import {
    deriveTipFreshness,
    deriveVaultConnectivity,
    effectiveChainTip,
    EXPIRY_ALARM_MAX_DRIFT_MS,
    NOMINAL_BLOCK_MINUTES,
    shouldRescheduleExpiryWarning,
    TIP_DEGRADED_MS,
    TIP_FRESH_MS,
} from '../../src/services/ark/chainTipFreshness';

const MIN = 60 * 1000;
const NOW = 1_800_000_000_000;

describe('NOMINAL_BLOCK_MINUTES', () => {
    // Pinned because the constant is re-declared rather than imported from
    // chainTip.ts (which pulls config.ts and the bark SDK, unloadable under
    // jest). If AVG_BLOCK_MINUTES moves, this fails and points at the drift.
    it('mirrors AVG_BLOCK_MINUTES', () => {
        expect(NOMINAL_BLOCK_MINUTES).toBe(10);
    });
});

describe('deriveTipFreshness', () => {
    it('reports unknown when the tip has never been fetched', () => {
        const r = deriveTipFreshness({ fetchedAtMs: null, nowMs: NOW });
        expect(r.level).toBe('unknown');
        expect(r.ageMs).toBeNull();
        expect(r.trusted).toBe(false);
    });

    it('reports fresh inside the fresh window', () => {
        expect(deriveTipFreshness({ fetchedAtMs: NOW, nowMs: NOW }).level).toBe('fresh');
        expect(
            deriveTipFreshness({ fetchedAtMs: NOW - TIP_FRESH_MS, nowMs: NOW }).level,
        ).toBe('fresh');
    });

    it('reports degraded past the fresh window but inside the degraded one', () => {
        const r = deriveTipFreshness({ fetchedAtMs: NOW - TIP_FRESH_MS - 1, nowMs: NOW });
        expect(r.level).toBe('degraded');
        // Still trusted: the numbers are usable, just no longer pristine.
        expect(r.trusted).toBe(true);
        expect(
            deriveTipFreshness({ fetchedAtMs: NOW - TIP_DEGRADED_MS, nowMs: NOW }).level,
        ).toBe('degraded');
    });

    it('reports stale and untrusted past the degraded window', () => {
        const r = deriveTipFreshness({ fetchedAtMs: NOW - TIP_DEGRADED_MS - 1, nowMs: NOW });
        expect(r.level).toBe('stale');
        expect(r.trusted).toBe(false);
    });

    it('never claims freshness from a backwards clock', () => {
        // Clock jumped forward then corrected back, so fetchedAt is "future".
        const r = deriveTipFreshness({ fetchedAtMs: NOW + 60 * MIN, nowMs: NOW });
        expect(r.ageMs).toBe(0);
        expect(r.level).toBe('fresh');
    });

    it('surfaces the age so callers can render it', () => {
        expect(deriveTipFreshness({ fetchedAtMs: NOW - 7 * MIN, nowMs: NOW }).ageMs).toBe(
            7 * MIN,
        );
    });
});

describe('effectiveChainTip', () => {
    it('returns null when there is no tip at all', () => {
        expect(effectiveChainTip({ tip: null, fetchedAtMs: NOW, nowMs: NOW })).toBeNull();
    });

    it('returns the raw tip when it has no fetch stamp', () => {
        // Pre-upgrade persisted state: a tip exists but was written before the
        // timestamp field was added. Do not invent an age for it.
        expect(effectiveChainTip({ tip: 900_000, fetchedAtMs: null, nowMs: NOW })).toBe(900_000);
    });

    it('does not advance the tip within one block interval', () => {
        expect(
            effectiveChainTip({ tip: 900_000, fetchedAtMs: NOW - 9 * MIN, nowMs: NOW }),
        ).toBe(900_000);
    });

    it('advances one block per nominal block interval', () => {
        expect(
            effectiveChainTip({ tip: 900_000, fetchedAtMs: NOW - 10 * MIN, nowMs: NOW }),
        ).toBe(900_001);
        expect(
            effectiveChainTip({ tip: 900_000, fetchedAtMs: NOW - 60 * MIN, nowMs: NOW }),
        ).toBe(900_006);
    });

    it('is uncapped, so a long offline gap expires what should be expired', () => {
        // The regression this exists for: app closed 21 days, reopened offline.
        // Freezing would render a VTXO with 25 days of nominal life as still
        // having 25 days left. Extrapolating burns the 3024 blocks that
        // actually elapsed.
        const threeWeeksMs = 21 * 24 * 60 * MIN;
        expect(
            effectiveChainTip({ tip: 900_000, fetchedAtMs: NOW - threeWeeksMs, nowMs: NOW }),
        ).toBe(900_000 + 3024);
    });

    it('never runs the tip backwards on a backwards clock', () => {
        expect(
            effectiveChainTip({ tip: 900_000, fetchedAtMs: NOW + 60 * MIN, nowMs: NOW }),
        ).toBe(900_000);
    });
});

describe('deriveVaultConnectivity', () => {
    it('is green when both the tip and the sync loop are current', () => {
        const r = deriveVaultConnectivity({
            tipFetchedAtMs: NOW,
            lastSyncedAtMs: NOW,
            nowMs: NOW,
        });
        expect(r.level).toBe('green');
        expect(r.syncAgeMs).toBe(0);
    });

    it('is yellow when the tip is merely degraded', () => {
        expect(
            deriveVaultConnectivity({
                tipFetchedAtMs: NOW - 10 * MIN,
                lastSyncedAtMs: NOW,
                nowMs: NOW,
            }).level,
        ).toBe('yellow');
    });

    it('is red once the tip is stale', () => {
        expect(
            deriveVaultConnectivity({
                tipFetchedAtMs: NOW - 45 * MIN,
                lastSyncedAtMs: NOW,
                nowMs: NOW,
            }).level,
        ).toBe('red');
    });

    it('takes the worse of the two signals, sync side', () => {
        // esplora answering fine, but the wallet handle is wedged so no cycle
        // has completed. Not a healthy vault.
        expect(
            deriveVaultConnectivity({
                tipFetchedAtMs: NOW,
                lastSyncedAtMs: NOW - 45 * MIN,
                nowMs: NOW,
            }).level,
        ).toBe('red');
    });

    it('takes the worse of the two signals, tip side', () => {
        expect(
            deriveVaultConnectivity({
                tipFetchedAtMs: NOW - 45 * MIN,
                lastSyncedAtMs: NOW - 10 * MIN,
                nowMs: NOW,
            }).level,
        ).toBe('red');
    });

    it('is red when no sync has ever completed', () => {
        expect(
            deriveVaultConnectivity({
                tipFetchedAtMs: NOW,
                lastSyncedAtMs: null,
                nowMs: NOW,
            }).level,
        ).toBe('red');
    });

    it('carries the tip detail through for rendering', () => {
        const r = deriveVaultConnectivity({
            tipFetchedAtMs: NOW - 45 * MIN,
            lastSyncedAtMs: NOW,
            nowMs: NOW,
        });
        expect(r.tip.level).toBe('stale');
        expect(r.tip.trusted).toBe(false);
    });
});

describe('shouldRescheduleExpiryWarning', () => {
    it('schedules a VTXO that has never been scheduled', () => {
        expect(
            shouldRescheduleExpiryWarning({ previousAtMs: null, currentAtMs: NOW }),
        ).toBe(true);
    });

    it('leaves an alarm alone while the estimate has barely moved', () => {
        expect(
            shouldRescheduleExpiryWarning({
                previousAtMs: NOW,
                currentAtMs: NOW + 30 * MIN,
            }),
        ).toBe(false);
    });

    it('does not re-queue exactly at the threshold', () => {
        expect(
            shouldRescheduleExpiryWarning({
                previousAtMs: NOW,
                currentAtMs: NOW + EXPIRY_ALARM_MAX_DRIFT_MS,
            }),
        ).toBe(false);
    });

    it('re-queues once the estimate has drifted past the threshold', () => {
        expect(
            shouldRescheduleExpiryWarning({
                previousAtMs: NOW,
                currentAtMs: NOW + EXPIRY_ALARM_MAX_DRIFT_MS + 1,
            }),
        ).toBe(true);
    });

    it('re-queues when expiry turns out to be EARLIER than projected', () => {
        // The direction that actually bites: nominal 10-minute blocks
        // overestimate remaining life, so the corrected deadline moves
        // backwards and the queued warnings would otherwise fire late.
        expect(
            shouldRescheduleExpiryWarning({
                previousAtMs: NOW,
                currentAtMs: NOW - (EXPIRY_ALARM_MAX_DRIFT_MS + 1),
            }),
        ).toBe(true);
    });

    it('honours a caller-supplied threshold', () => {
        expect(
            shouldRescheduleExpiryWarning({
                previousAtMs: NOW,
                currentAtMs: NOW + 5 * MIN,
                maxDriftMs: 1 * MIN,
            }),
        ).toBe(true);
    });
});

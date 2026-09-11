/**
 * A stuck swap must stop looking like a slow one.
 *
 * A venue that cannot process a deposit automatically may park the order for
 * human review. Some venues report that as an explicit status. Many do not,
 * and the order sits in an ordinary in-flight state indefinitely, so a wallet
 * renders a spinner while the user's money is stuck.
 *
 * So there are two paths to the same outcome. A reported hold escalates
 * immediately. Where the venue says nothing, we infer a stall from time
 * without movement, which is most of this file.
 *
 * The two failure modes pull in opposite directions:
 *   - Too slow to fire, and we are the spinner-while-money-is-stuck wallet.
 *   - Too eager, and we cry wolf on healthy swaps until people learn to ignore
 *     the warning, which is worse than never warning at all.
 *
 * Hence: measured from the last status CHANGE, never from creation, and
 * `awaiting_deposit` is exempt because that clock is the user's own.
 */

import {
    evaluateStall,
    isInFlight,
    isTerminal,
    DEFAULT_STALL_THRESHOLDS,
    type ChainSwapStatus,
} from '../../src/services/chainSwap/types';

const MIN = 60 * 1000;
const T0 = new Date('2026-09-02T12:00:00.000Z');
const at = (msAfter: number) => new Date(T0.getTime() + msAfter);

const stallAt = (status: ChainSwapStatus, msSinceChange: number) =>
    evaluateStall(status, T0, at(msSinceChange));

describe('terminal statuses never escalate', () => {
    // Money has either arrived or come back. Warning about it would be
    // nonsense, and these are the states a completed swap rests in forever.
    const terminal: ChainSwapStatus[] = ['settled', 'refunded', 'expired', 'failed'];

    it.each(terminal)('%s is never escalated, even after a week', s => {
        expect(isTerminal(s)).toBe(true);
        expect(stallAt(s, 7 * 24 * 60 * MIN)).toBe('none');
    });
});

describe('a reported hold escalates immediately', () => {
    // The venue has told us the order is under human review. There is nothing
    // to infer and no reason to make the user wait on a timer.
    it('is held at the moment it is reported', () => {
        expect(stallAt('held', 0)).toBe('held');
    });

    it('stays held however long it lasts', () => {
        expect(stallAt('held', 7 * 24 * 60 * MIN)).toBe('held');
    });

    it('is in flight, not terminal: it can still settle or refund', () => {
        expect(isInFlight('held')).toBe(true);
        expect(isTerminal('held')).toBe(false);
    });
});

describe('awaiting_deposit is exempt', () => {
    // The clock here is the user's own: they have not sent funds yet. Nagging
    // them about their own inaction is noise, and expiry already handles the
    // case where they never do.
    it('does not escalate regardless of elapsed time', () => {
        expect(isInFlight('awaiting_deposit')).toBe(true);
        expect(stallAt('awaiting_deposit', 0)).toBe('none');
        expect(stallAt('awaiting_deposit', 6 * 60 * MIN)).toBe('none');
    });
});

describe('processing escalates by time', () => {
    it('is quiet before the slow threshold', () => {
        expect(stallAt('processing', 0)).toBe('none');
        expect(stallAt('processing', 14 * MIN)).toBe('none');
    });

    it('reports slow at the threshold', () => {
        expect(stallAt('processing', DEFAULT_STALL_THRESHOLDS.slowMs)).toBe('slow');
    });

    it('stays slow between thresholds', () => {
        expect(stallAt('processing', 30 * MIN)).toBe('slow');
    });

    it('reports stalled at the threshold', () => {
        expect(stallAt('processing', DEFAULT_STALL_THRESHOLDS.stalledMs)).toBe('stalled');
    });

    it('stays stalled afterwards', () => {
        expect(stallAt('processing', 4 * 60 * MIN)).toBe('stalled');
    });
});

describe('other in-flight states escalate the same way', () => {
    // A deposit seen but never confirmed, a settlement that never confirms and
    // a refund that never lands are all stuck in the same sense. Where the
    // venue reports no hold, time is the only signal available.
    it.each(['confirming', 'settling', 'refunding'] as ChainSwapStatus[])(
        '%s escalates none -> slow -> stalled',
        s => {
            expect(stallAt(s, 1 * MIN)).toBe('none');
            expect(stallAt(s, 20 * MIN)).toBe('slow');
            expect(stallAt(s, 60 * MIN)).toBe('stalled');
        },
    );
});

describe('boundaries are inclusive', () => {
    // Off-by-one here means the warning fires a poll interval late forever.
    it('fires exactly at the threshold, not one ms after', () => {
        const { slowMs, stalledMs } = DEFAULT_STALL_THRESHOLDS;
        expect(stallAt('processing', slowMs - 1)).toBe('none');
        expect(stallAt('processing', slowMs)).toBe('slow');
        expect(stallAt('processing', stalledMs - 1)).toBe('slow');
        expect(stallAt('processing', stalledMs)).toBe('stalled');
    });
});

describe('measured from the last change, not from creation', () => {
    // The whole point. A swap that spent two hours legitimately waiting for a
    // deposit, then moved to processing one minute ago, is healthy. Measuring
    // from creation would flag it instantly and permanently.
    it('a long-lived order that just moved is not stalled', () => {
        const createdLongAgo = new Date(T0.getTime() - 6 * 60 * MIN);
        const justChanged = new Date(T0.getTime() - 1 * MIN);
        expect(evaluateStall('processing', justChanged, T0)).toBe('none');
        // Sanity: the same order measured from creation would have alarmed.
        expect(evaluateStall('processing', createdLongAgo, T0)).toBe('stalled');
    });
});

describe('thresholds are injectable', () => {
    // So a future venue with genuinely slower settlement can be tuned without
    // forking the rule, and so tests stay fast.
    it('honours custom thresholds', () => {
        const tight = { slowMs: 10, stalledMs: 20 };
        expect(evaluateStall('processing', T0, at(5), tight)).toBe('none');
        expect(evaluateStall('processing', T0, at(10), tight)).toBe('slow');
        expect(evaluateStall('processing', T0, at(20), tight)).toBe('stalled');
    });
});

describe('clock skew does not produce a false alarm', () => {
    // Device clocks drift and venue timestamps are server-side. A negative
    // elapsed time must read as "no movement yet", never wrap into a warning.
    it('treats a future statusChangedAt as not stalled', () => {
        const future = new Date(T0.getTime() + 60 * MIN);
        expect(evaluateStall('processing', future, T0)).toBe('none');
    });
});

describe('in-flight classification', () => {
    it('splits the state machine exactly once', () => {
        const all: ChainSwapStatus[] = [
            'awaiting_deposit', 'confirming', 'processing', 'held', 'settling',
            'settled', 'refunding', 'refunded', 'expired', 'failed',
        ];
        for (const s of all) {
            expect(isInFlight(s)).toBe(!isTerminal(s));
        }
        expect(all.filter(isInFlight)).toEqual([
            'awaiting_deposit', 'confirming', 'processing', 'held', 'settling', 'refunding',
        ]);
    });
});

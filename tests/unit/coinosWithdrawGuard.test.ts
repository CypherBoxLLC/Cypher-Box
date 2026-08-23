/**
 * CoinOS on-chain withdrawals must not be sendable twice.
 *
 * `POST /bitcoin/send` crosses the network, so a dropped connection leaves the
 * outcome unknown: the request may have reached CoinOS. The withdraw screen
 * treated every failure as "never sent", told the user "Please try again", and
 * re-armed the button. Following that instruction sends the money again.
 */

import {
    WITHDRAW_DUPLICATE_WINDOW_MS,
    findRecentMatchingWithdrawal,
    isCoinosWithdrawIndeterminate,
    isNetworkShapedFailure,
    markWithdrawIndeterminate,
} from '../../src/services/coinos/withdrawGuard';

const ADDR = 'bc1qdph4zqqkvf72nd6uz87q2c5hw9tzapfnkmq93c';
const OTHER = 'bc1qtmcfj7lvgjp866w8lytdpap82u7eege58jy52hp4ctk0hsncegyqel8prp';
const NOW = 1_700_000_000_000;

const payment = (over: Record<string, unknown> = {}) => ({
    amount: -10_000,
    created: NOW - 60_000,
    type: 'bitcoin',
    onchain: { address: ADDR },
    ...over,
});

const find = (payments: any[], over: Record<string, unknown> = {}) =>
    findRecentMatchingWithdrawal(payments, {
        address: ADDR,
        amountSats: 10_000,
        now: NOW,
        ...over,
    });

describe('spotting a withdrawal that already went out', () => {
    it('matches the same address and amount within the window', () => {
        expect(find([payment()])).not.toBeNull();
    });

    it('compares amount by magnitude, since outgoing payments are negative', () => {
        expect(find([payment({ amount: -10_000 })])).not.toBeNull();
        expect(find([payment({ amount: 10_000 })])).not.toBeNull();
    });

    it('accepts a string amount', () => {
        expect(find([payment({ amount: '-10000' })])).not.toBeNull();
    });

    it('reads the address from the flat field as well as the onchain object', () => {
        expect(find([{ amount: -10_000, created: NOW - 1000, address: ADDR }])).not.toBeNull();
    });

    it('is case and whitespace insensitive on the address', () => {
        expect(find([payment({ onchain: { address: `  ${ADDR.toUpperCase()} ` } })])).not.toBeNull();
    });

    it('handles a seconds-based timestamp', () => {
        expect(find([payment({ created: Math.floor((NOW - 60_000) / 1000) })])).not.toBeNull();
    });

    it('handles an ISO timestamp', () => {
        expect(find([payment({ created: new Date(NOW - 60_000).toISOString() })])).not.toBeNull();
    });

    it('matches when the timestamp is unusable, erring toward blocking', () => {
        // A false positive costs a confirmation tap. A false negative costs the
        // user the money.
        expect(find([payment({ created: 'not a date' })])).not.toBeNull();
        expect(find([payment({ created: null })])).not.toBeNull();
    });
});

describe('what must NOT be treated as a duplicate', () => {
    it('a payment to a different address', () => {
        expect(find([payment({ onchain: { address: OTHER } })])).toBeNull();
    });

    it('a different amount to the same address', () => {
        // Address alone would flag a legitimate second payment to the same
        // destination.
        expect(find([payment({ amount: -9_999 })])).toBeNull();
    });

    it('the same payment from outside the window', () => {
        expect(find([payment({ created: NOW - WITHDRAW_DUPLICATE_WINDOW_MS - 1 })])).toBeNull();
    });

    it('an empty or missing history', () => {
        expect(find([])).toBeNull();
        expect(findRecentMatchingWithdrawal(null, { address: ADDR, amountSats: 1, now: NOW })).toBeNull();
        expect(findRecentMatchingWithdrawal(undefined, { address: ADDR, amountSats: 1, now: NOW })).toBeNull();
    });

    it('records with no amount at all', () => {
        expect(find([{ onchain: { address: ADDR }, created: NOW }])).toBeNull();
    });

    it('does not crash on malformed records', () => {
        expect(() => find([null as any, {} as any, { onchain: null } as any, payment()])).not.toThrow();
        expect(find([null as any, {} as any, payment()])).not.toBeNull();
    });
});

describe('unknown outcomes are not failures', () => {
    it.each([
        'Network request failed',
        'The request timed out',
        'Aborted',
        'socket hang up',
        'ECONNRESET',
        'Failed to fetch',
    ])('treats %p as network-shaped, so the outcome is unknown', (msg) => {
        expect(isNetworkShapedFailure(new Error(msg))).toBe(true);
    });

    it('does not treat a server rejection as unknown', () => {
        // CoinOS answered, so nothing was sent. Retrying is safe here.
        expect(isNetworkShapedFailure(new Error('Insufficient funds'))).toBe(false);
        expect(isNetworkShapedFailure(new Error('invalid address'))).toBe(false);
    });

    it('flags an indeterminate error so callers can branch on a marker', () => {
        const e = markWithdrawIndeterminate('may have been sent');
        expect(isCoinosWithdrawIndeterminate(e)).toBe(true);
    });

    it.each([null, undefined, 'string', {}, new Error('ordinary')])(
        'is not indeterminate for %p',
        (v) => {
            expect(isCoinosWithdrawIndeterminate(v)).toBe(false);
        },
    );

    it('is not satisfied by a truthy-but-not-true marker', () => {
        expect(isCoinosWithdrawIndeterminate({ coinosWithdrawIndeterminate: 'yes' })).toBe(false);
    });
});

describe('the double-send scenario, end to end', () => {
    it('the retry after a lost reply is caught by the history check', () => {
        // First attempt: reply lost, so the app cannot know it succeeded.
        const err = markWithdrawIndeterminate('unknown');
        expect(isCoinosWithdrawIndeterminate(err)).toBe(true);

        // CoinOS did send it, so it is in the history.
        const history = [payment({ created: NOW - 5_000 })];

        // The retry is blocked before any second request is made.
        expect(find(history)).not.toBeNull();
    });
});

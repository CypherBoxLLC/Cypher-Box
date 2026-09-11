/**
 * SideShift's wire format has to map onto the contract exactly, because the
 * failures here are quiet and expensive.
 *
 * Two traps drive most of this file, both confirmed against SideShift's
 * published docs and live responses on 2026-09-11:
 *
 *   - Status: `refund` means "queued for refund", possibly waiting on an
 *     address. Mapping it to a terminal refunded state would tell a user their
 *     money is back while it is still in flight.
 *
 *   - Errors: SideShift's HTTP status and error code do not line up.
 *     BAD_USER_INPUT arrives as 400, 403 and 500, and "Invalid network" is a
 *     500. Anything that decides retryability from HTTP status tells users to
 *     retry inputs that can never succeed, so mapping keys on code and message.
 */

import {
    mapSideShiftError,
    mapSideShiftStatus,
    pairPath,
    parseRangeAmount,
    toSideShiftMethod,
} from '../../src/services/chainSwap/providers/sideshiftMapping';
import {
    AmountOutOfRangeError,
    ChainSwapError,
    InvalidAddressError,
    JurisdictionBlockedError,
    QuoteExpiredError,
    VenueConfigError,
    VenueUnavailableError,
    asset,
    isTerminal,
    type ChainSwapStatus,
} from '../../src/services/chainSwap/types';

describe('asset wire format', () => {
    it('sends an upper-case ticker and a lower-case network', () => {
        expect(toSideShiftMethod(asset('btc', 'Bitcoin'))).toEqual({ coin: 'BTC', network: 'bitcoin' });
    });

    it('builds the path the pair endpoint expects', () => {
        expect(pairPath(asset('btc', 'bitcoin'), asset('usdt', 'tron'))).toBe('BTC-bitcoin/USDT-tron');
    });

    it('normalises mixed-case input', () => {
        expect(pairPath(asset('BtC', 'BITCOIN'), asset('UsDt', 'Tron'))).toBe('BTC-bitcoin/USDT-tron');
    });
});

describe('status mapping follows the documented table', () => {
    const table: Array<[string, ChainSwapStatus]> = [
        ['waiting', 'awaiting_deposit'],
        ['pending', 'confirming'],
        ['processing', 'processing'],
        ['review', 'held'],
        ['settling', 'settling'],
        ['settled', 'settled'],
        ['refund', 'refunding'],
        ['refunding', 'refunding'],
        ['refunded', 'refunded'],
        ['expired', 'expired'],
    ];

    it.each(table)('%s -> %s', (wire, expected) => {
        expect(mapSideShiftStatus(wire).status).toBe(expected);
    });

    it('never maps a queued refund to a finished one', () => {
        // The trap: `refund` is queued, possibly still waiting on an address.
        const mapped = mapSideShiftStatus('refund').status;
        expect(mapped).not.toBe('refunded');
        expect(isTerminal(mapped)).toBe(false);
    });

    it('treats only settled, refunded and expired as terminal', () => {
        const terminal = table.filter(([, s]) => isTerminal(s)).map(([w]) => w);
        expect(terminal).toEqual(['settled', 'refunded', 'expired']);
    });
});

describe('the venue reason travels with the status', () => {
    it('carries the issue on a hold', () => {
        expect(mapSideShiftStatus('review', 'rate drift')).toEqual({ status: 'held', issue: 'rate drift' });
    });

    it('carries the issue on a queued refund', () => {
        expect(mapSideShiftStatus('refund', 'incorrect amount')).toEqual({
            status: 'refunding',
            issue: 'incorrect amount',
        });
    });

    it('omits issue when the venue gives none', () => {
        expect(mapSideShiftStatus('processing')).toEqual({ status: 'processing' });
        expect(mapSideShiftStatus('processing', null)).toEqual({ status: 'processing' });
    });
});

describe('anomalies escalate instead of reporting success', () => {
    it('surfaces multiple deposits as a hold with an explicit issue', () => {
        // We send exactly one deposit, so a second one means something went
        // wrong upstream. Escalate rather than report a clean result.
        expect(mapSideShiftStatus('multiple')).toEqual({ status: 'held', issue: 'multiple deposits' });
    });

    it('keeps the venue issue on a multiple-deposit order when given', () => {
        expect(mapSideShiftStatus('multiple', 'duplicate')).toEqual({ status: 'held', issue: 'duplicate' });
    });

    it('maps an unrecognised status to a hold, never to success', () => {
        const r = mapSideShiftStatus('some_future_status');
        expect(r.status).toBe('held');
        expect(r.issue).toContain('some_future_status');
    });
});

describe('errors key on code and message, never on HTTP status', () => {
    it('treats a 500 "Invalid network" as bad input, not a transient outage', () => {
        // The trap. As VenueUnavailableError the UI would offer a retry for an
        // input that can never succeed.
        const e = mapSideShiftError(500, { error: { code: 'BAD_USER_INPUT', message: 'Invalid network' } });
        expect(e).not.toBeInstanceOf(VenueUnavailableError);
        expect(e.name).toBe('ChainSwapError');
    });

    it('treats a 403 "too many open orders" as retryable, not a jurisdiction block', () => {
        const e = mapSideShiftError(403, {
            error: {
                code: 'BAD_USER_INPUT',
                message: 'You have too many open orders. Cancel some, use the existing ones, or wait.',
            },
        });
        expect(e).toBeInstanceOf(VenueUnavailableError);
        expect((e as VenueUnavailableError).retryable).toBe(true);
        expect(e).not.toBeInstanceOf(JurisdictionBlockedError);
    });

    it('treats swapping an asset for itself as bad input we built, not an outage', () => {
        const e = mapSideShiftError(500, {
            error: { code: 'SHIFT_UNAVAILABLE', message: 'Deposit and settle method must be different' },
        });
        expect(e).not.toBeInstanceOf(VenueUnavailableError);
        expect(e.name).toBe('ChainSwapError');
    });
});

describe('jurisdiction and configuration', () => {
    it('maps ACCESS_DENIED to a jurisdiction block', () => {
        const e = mapSideShiftError(403, {
            error: { code: 'ACCESS_DENIED', message: 'Access denied. See https://sideshift.ai/access-denied' },
        });
        expect(e).toBeInstanceOf(JurisdictionBlockedError);
    });

    const configCases: Array<[number, string | undefined, string]> = [
        [401, 'SESSION_REQUIRED', 'Do not use the example affiliateId and x-sideshift-secret header from the documentation.'],
        [404, 'NOT_FOUND', 'Account not found'],
        [400, 'BAD_USER_INPUT', 'Unknown affiliateId'],
        [400, 'BAD_USER_INPUT', 'Quote has different affiliateId than input'],
        [400, undefined, 'The x-user-ip header must be set to the end-user IP address'],
    ];

    it.each(configCases)('treats %i %s "%s" as our own misconfiguration', (http, code, message) => {
        const e = mapSideShiftError(http, { error: { ...(code ? { code } : {}), message } });
        expect(e).toBeInstanceOf(VenueConfigError);
        // The raw message names internals and must not reach the user.
        expect(e.message).not.toContain('x-sideshift-secret');
        expect(e.message).not.toContain('x-user-ip');
    });
});

describe('amount out of range', () => {
    it('reads the minimum from a QUOTE_UNAVAILABLE "too low" message', () => {
        const e = mapSideShiftError(
            500,
            { error: { code: 'QUOTE_UNAVAILABLE', message: 'Amount too low. Minimum deposit amount: 0.00037639' } },
            '0.0001',
        );
        expect(e).toBeInstanceOf(AmountOutOfRangeError);
        const r = e as AmountOutOfRangeError;
        expect(r.min).toBe('0.00037639');
        expect(r.max).toBeUndefined();
        expect(r.amount).toBe('0.0001');
    });

    it('reads the maximum from a "too high" message', () => {
        const r = mapSideShiftError(500, {
            error: { code: 'QUOTE_UNAVAILABLE', message: 'Amount too high. Maximum deposit amount: 0.78' },
        }) as AmountOutOfRangeError;
        expect(r).toBeInstanceOf(AmountOutOfRangeError);
        expect(r.max).toBe('0.78');
        expect(r.min).toBeUndefined();
    });

    it('prefers the structured bound over parsing the message', () => {
        const r = mapSideShiftError(500, {
            error: {
                code: 'QUOTE_UNAVAILABLE',
                message: 'Amount too low. Minimum deposit amount: 9.99',
                depositRangeMin: '0.0005',
            },
        }) as AmountOutOfRangeError;
        expect(r.min).toBe('0.0005');
    });

    it('keeps amounts as strings so precision survives', () => {
        const r = mapSideShiftError(500, {
            error: { code: 'QUOTE_UNAVAILABLE', message: 'Amount too low. Minimum deposit amount: 0.00000001' },
        }) as AmountOutOfRangeError;
        expect(r.min).toBe('0.00000001');
    });
});

describe('recoverable request failures', () => {
    it('maps an expired quote so the UI can re-quote silently', () => {
        const e = mapSideShiftError(400, {
            error: { code: 'BAD_USER_INPUT', message: 'Quote has already expired. Request a new quote.' },
        });
        expect(e).toBeInstanceOf(QuoteExpiredError);
    });

    it('identifies a rejected settle address', () => {
        const e = mapSideShiftError(400, {
            error: { code: 'BAD_USER_INPUT', message: 'Invalid receiving address' },
        }) as InvalidAddressError;
        expect(e).toBeInstanceOf(InvalidAddressError);
        expect(e.field).toBe('settle');
    });

    it('identifies a rejected refund address', () => {
        const e = mapSideShiftError(400, {
            error: { code: 'BAD_USER_INPUT', message: 'Invalid refundDestination' },
        }) as InvalidAddressError;
        expect(e.field).toBe('refund');
    });

    it('marks a paused method as retryable', () => {
        const e = mapSideShiftError(500, {
            error: { code: 'SHIFT_UNAVAILABLE', message: 'Deposit method unavailable' },
        }) as VenueUnavailableError;
        expect(e).toBeInstanceOf(VenueUnavailableError);
        expect(e.retryable).toBe(true);
    });

    it('treats HTTP 429 as a retryable rate limit', () => {
        const e = mapSideShiftError(429, { error: { message: 'Rate limit exceeded' } }) as VenueUnavailableError;
        expect(e).toBeInstanceOf(VenueUnavailableError);
        expect(e.retryable).toBe(true);
    });
});

describe('when the venue gives us nothing', () => {
    it('treats a body-less 5xx as retryable gateway trouble', () => {
        const e = mapSideShiftError(502, null);
        expect(e).toBeInstanceOf(VenueUnavailableError);
        expect((e as VenueUnavailableError).retryable).toBe(true);
    });

    it('treats a body-less 4xx as a non-retryable failure', () => {
        const e = mapSideShiftError(400, null);
        expect(e.name).toBe('ChainSwapError');
        expect(e.message).toContain('400');
    });

    it('maps METHOD_NOT_FOUND to a non-retryable input error', () => {
        const e = mapSideShiftError(400, {
            error: { code: 'METHOD_NOT_FOUND', message: 'Method ETH/bitcoin not found' },
        });
        expect(e.name).toBe('ChainSwapError');
    });
});

describe('parseRangeAmount', () => {
    it('extracts the decimal bound', () => {
        expect(parseRangeAmount('Amount too low. Minimum deposit amount: 0.00037639')).toBe('0.00037639');
        expect(parseRangeAmount('Amount too high. Maximum deposit amount: 60000')).toBe('60000');
    });

    it('returns undefined rather than guessing', () => {
        expect(parseRangeAmount('Amount too low. Settle amount is less than or equals to 0')).toBeUndefined();
    });
});

describe('error classes survive the toolchain', () => {
    // The UI branches on instanceof. If a transpile step ever breaks the
    // prototype chain of Error subclasses, this fails loudly here instead of
    // silently misrouting a real user's error.
    it('keeps subclass identity through instanceof', () => {
        const e = new VenueUnavailableError('sideshift', true);
        expect(e).toBeInstanceOf(VenueUnavailableError);
        expect(e).toBeInstanceOf(ChainSwapError);
        expect(e).toBeInstanceOf(Error);
    });
});

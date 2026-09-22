/**
 * What the swap screens tell a user about their money.
 *
 * What this protects:
 *   - Every refusal to quote names what to do next, and the action the screen
 *     offers matches it: a minimum sends them to the amount, a rejected
 *     destination to the destination.
 *   - An unconfirmed deposit is never described as not sent, and a refund or
 *     failure always shows the reference to take to support.
 *   - The steps follow the order's status, and a completed swap reports what
 *     Flashnet delivered rather than what the quote estimated.
 *   - No em dash reaches the copy.
 */

import {
    AmountOutOfRangeError,
    ChainSwapError,
    InvalidAddressError,
    JurisdictionBlockedError,
    QuoteExpiredError,
    VenueConfigError,
    VenueUnavailableError,
    asset,
    type ChainSwapStatus,
} from '../../src/services/chainSwap';
import { USDT_ON_TRON } from '../../src/services/tron/conversion';
import { TronSendError } from '../../src/services/tron/send';
import {
    describeNotReady,
    describeQuoteError,
    describeUsdtSwap,
    shortDestination,
    type UsdtSwapView,
} from '../../src/services/tron/swapMessages';
import type { UsdtSwapRecord } from '../../src/services/tron/swapRun';

const EM_DASH = '\u2014';

const record = (over: Partial<UsdtSwapRecord> = {}, status: ChainSwapStatus = 'awaiting_deposit'): UsdtSwapRecord => ({
    id: 'q_1',
    phase: 'following',
    startedAtMs: 0,
    updatedAtMs: 0,
    request: { usdtAmount: '150', destination: 'satoshi@strike.me' },
    quote: { depositAmount: '150', settleAmount: '0.0014', settleAmountIsFirm: false, minSettleAmount: null },
    order: {
        id: 'ord_1',
        status,
        depositAddress: 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs',
        depositAsset: USDT_ON_TRON,
        settleAsset: asset('btc', 'lightning'),
        depositAmount: '150',
        settleAmount: null,
        settleAddress: 'satoshi@strike.me',
        refundAddress: 'TNrDPeCdW8CFQqkM6uJxT381MhJyusgaJq',
        depositTxId: 'tx_a',
        createdAtMs: 0,
        expiresAtMs: 0,
        statusChangedAtMs: 0,
    },
    transfers: [{ txID: 'tx_a', expirationMs: 0 }],
    stall: 'none',
    ...over,
});

const noEmDash = (view: UsdtSwapView) => {
    expect(view.title).not.toContain(EM_DASH);
    expect(view.detail).not.toContain(EM_DASH);
    expect(view.notice ?? '').not.toContain(EM_DASH);
};

describe('describeNotReady', () => {
    it('sends a below-minimum amount back to the amount, naming the minimum', () => {
        expect(describeNotReady({ ready: false, code: 'BELOW_MINIMUM', minAmount: '100' }, false)).toEqual({
            message: 'The smallest swap is 100 USDT. Enter a larger amount.',
            action: 'change_amount',
        });
    });

    it('points a short balance at the amount, or at the invoice when the invoice set it', () => {
        expect(describeNotReady({ ready: false, code: 'INSUFFICIENT_USDT' }, false).action).toBe('change_amount');
        expect(describeNotReady({ ready: false, code: 'INSUFFICIENT_USDT' }, true).action).toBe('change_destination');
    });

    it('says how long to wait for bandwidth, in words', () => {
        const wait = (retryAfterSeconds: number) =>
            describeNotReady({ ready: false, code: 'BANDWIDTH_UNAVAILABLE', retryAfterSeconds }, false).message;
        expect(wait(30)).toContain('try again in about a minute.');
        expect(wait(12 * 60)).toContain('try again in about 12 minutes.');
        expect(wait(5 * 3600)).toContain('try again in about 5 hours.');
        expect(describeNotReady({ ready: false, code: 'BANDWIDTH_UNAVAILABLE' }, false).action).toBe('none');
    });
});

describe('describeQuoteError', () => {
    it('passes a Tron send error through with its own safe message', () => {
        const error = new TronSendError('TRON_UNREACHABLE', 'retry', 'Could not reach the Tron network. Nothing was sent.');
        expect(describeQuoteError(error, false)).toEqual({ message: error.message, action: 'retry' });
    });

    it('names the minimum from a range error, and blames the invoice on exact_out', () => {
        expect(describeQuoteError(new AmountOutOfRangeError(undefined, '100', undefined), false)).toEqual({
            message: 'The smallest swap is 100 USDT. Enter a larger amount.',
            action: 'change_amount',
        });
        expect(describeQuoteError(new AmountOutOfRangeError(undefined, '100', undefined), true).action).toBe(
            'change_destination',
        );
        expect(describeQuoteError(new AmountOutOfRangeError('9', undefined, '5000'), false).message).toBe(
            'The most one swap can take is 5,000 USDT. Enter a smaller amount.',
        );
    });

    it('sends a rejected destination back to the destination', () => {
        expect(describeQuoteError(new InvalidAddressError('settle'), false).action).toBe('change_destination');
        expect(describeQuoteError(new InvalidAddressError('refund'), false).action).toBe('retry');
    });

    it('offers a retry for venue trouble and nothing for a region block', () => {
        expect(describeQuoteError(new VenueUnavailableError('flashnet', true), false).action).toBe('retry');
        expect(describeQuoteError(new VenueConfigError('flashnet'), false).action).toBe('retry');
        expect(describeQuoteError(new QuoteExpiredError(), false).action).toBe('retry');
        expect(describeQuoteError(new ChainSwapError('mismatch'), false).action).toBe('retry');
        expect(describeQuoteError(new JurisdictionBlockedError('flashnet'), false)).toEqual({
            message: 'Swaps are not available in your region.',
            action: 'none',
        });
        expect(describeQuoteError(new Error('socket'), false).action).toBe('retry');
    });

    it('never uses an em dash', () => {
        const errors = [
            new AmountOutOfRangeError(undefined, '100', undefined),
            new AmountOutOfRangeError(undefined, undefined, '5000'),
            new AmountOutOfRangeError(undefined, undefined, undefined),
            new InvalidAddressError('settle'),
            new InvalidAddressError('refund'),
            new JurisdictionBlockedError('flashnet'),
            new VenueUnavailableError('flashnet', true),
            new VenueConfigError('flashnet'),
            new QuoteExpiredError(),
            new ChainSwapError('x'),
            new Error('x'),
        ];
        for (const error of errors) {
            for (const exactOut of [false, true]) {
                expect(describeQuoteError(error, exactOut).message).not.toContain(EM_DASH);
            }
        }
    });
});

describe('describeUsdtSwap', () => {
    it('shows sending and checking as work under way, on the first step', () => {
        for (const phase of ['sending', 'checking'] as const) {
            const view = describeUsdtSwap(record({ phase }));
            expect(view).toMatchObject({ tone: 'working', busy: true, showSupport: false });
            expect(view.steps?.map(s => s.state)).toEqual(['active', 'pending', 'pending', 'pending']);
            noEmDash(view);
        }
        expect(describeUsdtSwap(record({ phase: 'sending' })).detail).toContain('150 USDT deposit');
    });

    it('never calls an unconfirmed deposit not sent, and gives the reference', () => {
        const view = describeUsdtSwap(
            record({
                phase: 'unconfirmed',
                sendError: { code: 'OUTCOME_UNKNOWN', message: 'Could not confirm whether your deposit went out.', remedy: 'check_status' },
            }),
        );
        expect(view.title).toBe('Deposit not confirmed yet');
        expect(view.title).not.toMatch(/not sent|nothing/i);
        expect(view.showSupport).toBe(true);
    });

    it('shows a deposit that did not go out with the reason it did not', () => {
        const view = describeUsdtSwap(
            record({
                phase: 'not_sent',
                sendError: { code: 'QUOTE_EXPIRING', message: 'This quote expires too soon to pay into.', remedy: 'requote' },
            }),
        );
        expect(view).toMatchObject({ title: 'Nothing was sent', detail: 'This quote expires too soon to pay into.', showSupport: false });
    });

    it('moves through the steps with the order', () => {
        const done = (status: ChainSwapStatus) =>
            describeUsdtSwap(record({}, status)).steps?.filter(s => s.state === 'done').length;
        expect(done('awaiting_deposit')).toBe(1);
        expect(done('confirming')).toBe(1);
        expect(done('processing')).toBe(2);
        expect(done('settling')).toBe(3);
        expect(describeUsdtSwap(record({ phase: 'finished' }, 'settled')).steps?.every(s => s.state === 'done')).toBe(true);
    });

    it('reassures on a slow swap and escalates a stalled one to support', () => {
        const slow = describeUsdtSwap(record({ stall: 'slow' }, 'processing'));
        expect(slow).toMatchObject({ tone: 'working', showSupport: false });
        expect(slow.notice).toContain('taking longer than usual');

        const stalled = describeUsdtSwap(record({ stall: 'stalled' }, 'processing'));
        expect(stalled).toMatchObject({ tone: 'problem', showSupport: true });
        expect(stalled.notice).toContain('contact Cypher Box support');
    });

    it('treats a hold as a problem with support, and shows a read failure', () => {
        const held = describeUsdtSwap(record({ followError: 'Flashnet is not answering right now.' }, 'held'));
        expect(held).toMatchObject({ title: 'Held for review', tone: 'problem', showSupport: true });
        expect(held.notice).toBe('Flashnet is not answering right now.');
    });

    it('reports what Flashnet delivered once it says, and the quote until then', () => {
        const base = record({ phase: 'finished' }, 'settled');
        expect(describeUsdtSwap(base).detail).toBe('140,000 sats paid to satoshi@strike.me.');
        const delivered = { ...base, order: { ...base.order, settleAmount: '0.00139876' } };
        expect(describeUsdtSwap(delivered).detail).toBe('139,876 sats paid to satoshi@strike.me.');
    });

    it('warns that on-chain bitcoin still has to confirm, and shortens a long address', () => {
        const address = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
        const base = record({ phase: 'finished' }, 'settled');
        const onchain = {
            ...base,
            order: { ...base.order, settleAsset: asset('btc', 'bitcoin'), settleAddress: address },
        };
        expect(describeUsdtSwap(onchain).detail).toBe(
            `140,000 sats sent to ${shortDestination(address)}. On-chain bitcoin can take an hour or more to confirm.`,
        );
        expect(shortDestination(address)).toBe('bc1qrp33g0q5...3qccfmv3');
        expect(shortDestination('satoshi@strike.me')).toBe('satoshi@strike.me');
    });

    it('gives every unhappy ending the reference to take to support', () => {
        for (const status of ['refunded', 'expired', 'failed'] as const) {
            const view = describeUsdtSwap(record({ phase: 'finished' }, status));
            expect(view).toMatchObject({ tone: 'problem', showSupport: true, busy: false, steps: null });
            noEmDash(view);
        }
        expect(describeUsdtSwap(record({}, 'refunding'))).toMatchObject({ title: 'Returning your USDT', steps: null });
    });
});

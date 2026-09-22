/**
 * What the swap screens say: why a quote was not given, and where a swap is.
 *
 * Kept out of the screens so the mapping, which decides what a user is told
 * about their money, is unit-tested. Every refusal names what to do next, and
 * nothing here claims money moved or did not move beyond what the record
 * knows: an unconfirmed deposit is never described as not sent.
 */

import BigNumber from 'bignumber.js';

import {
    AmountOutOfRangeError,
    ChainSwapError,
    InvalidAddressError,
    JurisdictionBlockedError,
    QuoteExpiredError,
    VenueConfigError,
    VenueUnavailableError,
} from '../chainSwap/types';
import type { PreparedUsdtConversion } from './conversion';
import { formatUsdtExact } from './format';
import { TronSendError } from './send';
import { formatSats } from './swapDestination';
import type { UsdtSwapRecord } from './swapRun';

/** What the confirm screen offers after a refusal. */
export type QuoteRefusalAction = 'retry' | 'change_amount' | 'change_destination' | 'none';

export type QuoteRefusal = { readonly message: string; readonly action: QuoteRefusalAction };

/** "a minute", "12 minutes", "3 hours". */
function waitPhrase(seconds: number): string {
    const minutes = Math.ceil(seconds / 60);
    if (minutes <= 1) return 'a minute';
    if (minutes < 90) return `${minutes} minutes`;
    return `${Math.round(minutes / 60)} hours`;
}

/** Why prepareUsdtConversion booked nothing. */
export function describeNotReady(
    notReady: Exclude<PreparedUsdtConversion, { ready: true }>,
    exactOut: boolean,
): QuoteRefusal {
    switch (notReady.code) {
        case 'BELOW_MINIMUM':
            return {
                message: `The smallest swap is ${formatUsdtExact(notReady.minAmount)} USDT. Enter a larger amount.`,
                action: 'change_amount',
            };
        case 'INSUFFICIENT_USDT':
            return exactOut
                ? {
                      message: 'Your USDT balance does not cover this invoice. Receive more USDT, or use a smaller invoice.',
                      action: 'change_destination',
                  }
                : { message: 'Your USDT balance is lower than this amount. Enter a smaller amount.', action: 'change_amount' };
        case 'BANDWIDTH_UNAVAILABLE':
            return notReady.retryAfterSeconds !== undefined
                ? {
                      message: `This wallet has used its free Tron network allowance for now. It refills over the day, so try again in about ${waitPhrase(notReady.retryAfterSeconds)}.`,
                      action: 'retry',
                  }
                : {
                      message: "This wallet's free Tron network allowance is too small for a transfer. Contact Cypher Box support.",
                      action: 'none',
                  };
    }
}

/** Why asking for a quote failed. */
export function describeQuoteError(error: unknown, exactOut: boolean): QuoteRefusal {
    if (error instanceof TronSendError) {
        return { message: error.message, action: error.remedy === 'none' ? 'none' : 'retry' };
    }
    if (error instanceof AmountOutOfRangeError) {
        if (error.min !== undefined) {
            return exactOut
                ? {
                      message: `The smallest swap is ${formatUsdtExact(error.min)} USDT, and this invoice needs less. Use a larger invoice.`,
                      action: 'change_destination',
                  }
                : {
                      message: `The smallest swap is ${formatUsdtExact(error.min)} USDT. Enter a larger amount.`,
                      action: 'change_amount',
                  };
        }
        if (error.max !== undefined) {
            return exactOut
                ? { message: 'This invoice is larger than one swap can pay. Use a smaller invoice.', action: 'change_destination' }
                : {
                      message: `The most one swap can take is ${formatUsdtExact(error.max)} USDT. Enter a smaller amount.`,
                      action: 'change_amount',
                  };
        }
        return exactOut
            ? { message: 'Flashnet cannot pay an invoice of this size. Use a different invoice.', action: 'change_destination' }
            : { message: 'Flashnet does not take this amount. Enter a different amount.', action: 'change_amount' };
    }
    if (error instanceof InvalidAddressError) {
        return error.field === 'settle'
            ? { message: 'Flashnet did not accept this destination. Check it, or use a different one.', action: 'change_destination' }
            : { message: "Flashnet did not accept this wallet's Tron address for refunds. Try again later.", action: 'retry' };
    }
    if (error instanceof JurisdictionBlockedError) {
        return { message: 'Swaps are not available in your region.', action: 'none' };
    }
    if (error instanceof VenueUnavailableError) {
        return { message: 'Flashnet is not responding right now. Nothing was booked. Try again shortly.', action: 'retry' };
    }
    if (error instanceof VenueConfigError) {
        return { message: 'Swaps are not available right now. Nothing was booked. Try again later.', action: 'retry' };
    }
    if (error instanceof QuoteExpiredError) {
        return { message: 'The quote expired before it could be used. Get a new one.', action: 'retry' };
    }
    if (error instanceof ChainSwapError) {
        return {
            message: 'Flashnet could not quote this swap. Try again, or use a different destination.',
            action: 'retry',
        };
    }
    return { message: 'Could not get a quote. Check your connection and try again.', action: 'retry' };
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export type SwapStepState = 'done' | 'active' | 'pending';

export type SwapStep = { readonly label: string; readonly state: SwapStepState };

export type UsdtSwapView = {
    readonly title: string;
    readonly detail: string;
    /** A line about a slow or stuck swap, or an order that could not be read. */
    readonly notice?: string;
    readonly tone: 'working' | 'success' | 'problem';
    /** The steps of a swap on its way, or null once it left that path. */
    readonly steps: readonly SwapStep[] | null;
    /** Show the swap's references and how to reach support. */
    readonly showSupport: boolean;
    /** Work is under way: show a spinner. */
    readonly busy: boolean;
};

const STEP_LABELS = ['Deposit sent', 'Received by Flashnet', 'Swapped to bitcoin', 'Bitcoin delivered'] as const;

/** The steps with the first `done` finished and the next one under way. */
function steps(done: number): SwapStep[] {
    return STEP_LABELS.map((label, i) => ({
        label,
        state: i < done ? 'done' : i === done ? 'active' : 'pending',
    }));
}

/** A long invoice or address, shortened for a sentence. */
export function shortDestination(value: string): string {
    return value.length > 24 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

const SUPPORT_LINE = 'contact Cypher Box support with the reference below';

/** The sats a swap delivers: Flashnet's figure once it has one, the quote's until then. */
function settleSats(record: UsdtSwapRecord): string {
    const btc = record.order.settleAmount ?? record.quote.settleAmount;
    return formatSats(new BigNumber(btc).shiftedBy(8).toFixed(0, BigNumber.ROUND_DOWN));
}

function finished(record: UsdtSwapRecord, onchain: boolean): UsdtSwapView {
    const done = (title: string, detail: string): UsdtSwapView => ({
        title,
        detail,
        tone: 'problem',
        steps: null,
        showSupport: true,
        busy: false,
    });
    switch (record.order.status) {
        case 'settled': {
            const to = shortDestination(record.order.settleAddress);
            return {
                title: 'Swap complete',
                detail: onchain
                    ? `${settleSats(record)} sats sent to ${to}. On-chain bitcoin can take an hour or more to confirm.`
                    : `${settleSats(record)} sats paid to ${to}.`,
                tone: 'success',
                steps: steps(STEP_LABELS.length),
                showSupport: false,
                busy: false,
            };
        }
        case 'refunded':
            return done(
                'USDT returned',
                'Flashnet could not complete the swap and returned your USDT to your wallet. It can be less than you sent, because fees already paid are not returned.',
            );
        case 'expired':
            return done(
                'Swap expired',
                `Flashnet did not complete this swap in time. If your USDT left your wallet and has not come back, ${SUPPORT_LINE}.`,
            );
        case 'failed':
        default:
            return done(
                'Swap failed',
                `Flashnet reported that this swap failed. If your USDT left your wallet and has not come back, ${SUPPORT_LINE}.`,
            );
    }
}

function following(record: UsdtSwapRecord, usdt: string, onchain: boolean): UsdtSwapView {
    const stalled = record.stall === 'stalled';
    const notice = record.followError
        ? record.followError
        : stalled
          ? `This swap has not moved for a while. It can still finish, but ${SUPPORT_LINE}.`
          : record.stall === 'slow'
            ? 'This is taking longer than usual. It can still finish, and there is nothing to do yet.'
            : undefined;
    const working = (title: string, detail: string, done: number): UsdtSwapView => ({
        title,
        detail,
        ...(notice ? { notice } : {}),
        tone: stalled ? 'problem' : 'working',
        steps: steps(done),
        showSupport: stalled,
        busy: true,
    });

    switch (record.order.status) {
        case 'awaiting_deposit':
            return working(
                'Waiting for Flashnet',
                `Your ${usdt} USDT deposit is on the Tron network. Flashnet usually picks it up within a minute.`,
                1,
            );
        case 'confirming':
            return working('Flashnet has your deposit', 'It is confirming the deposit before the swap.', 1);
        case 'processing':
            return working('Swapping to bitcoin', 'Flashnet is swapping your USDT for bitcoin.', 2);
        case 'held':
            return {
                title: 'Held for review',
                detail: `Flashnet has paused this swap for a check. It can still complete, or be refunded to your wallet. If it stays here, ${SUPPORT_LINE}.`,
                ...(record.followError ? { notice: record.followError } : {}),
                tone: 'problem',
                steps: steps(2),
                showSupport: true,
                busy: true,
            };
        case 'settling':
            return onchain
                ? working('Sending your bitcoin', 'Flashnet is sending the bitcoin on chain.', 3)
                : working('Paying out over Lightning', 'Flashnet is paying the bitcoin over Lightning.', 3);
        case 'refunding':
            return {
                title: 'Returning your USDT',
                detail: 'Flashnet could not complete the swap and is returning your USDT to your wallet.',
                ...(notice ? { notice } : {}),
                tone: 'problem',
                steps: null,
                showSupport: stalled,
                busy: true,
            };
        default:
            // A terminal status, read in the moment before the record is
            // marked finished.
            return finished(record, onchain);
    }
}

/** Where a swap is, for the progress screen. */
export function describeUsdtSwap(record: UsdtSwapRecord): UsdtSwapView {
    const usdt = formatUsdtExact(record.quote.depositAmount);
    const onchain = record.order.settleAsset.network === 'bitcoin';
    const problem = (title: string, detail: string, showSupport = true): UsdtSwapView => ({
        title,
        detail,
        tone: 'problem',
        steps: null,
        showSupport,
        busy: false,
    });

    switch (record.phase) {
        case 'sending':
            return {
                title: 'Sending your USDT',
                detail: `Your ${usdt} USDT deposit is on its way to Flashnet. This usually takes about a minute.`,
                tone: 'working',
                steps: steps(0),
                showSupport: false,
                busy: true,
            };
        case 'checking':
            return {
                title: 'Checking your deposit',
                detail: 'The app closed while your deposit was being sent. Checking the Tron network to see whether it went out.',
                tone: 'working',
                steps: steps(0),
                showSupport: false,
                busy: true,
            };
        case 'unconfirmed':
            return problem('Deposit not confirmed yet', record.sendError?.message ?? 'Could not confirm whether your deposit went out.');
        case 'not_sent':
            return problem(
                'Nothing was sent',
                record.sendError?.message ?? 'The deposit did not go out, so no USDT moved.',
                false,
            );
        case 'following':
            return following(record, usdt, onchain);
        case 'finished':
            return finished(record, onchain);
    }
}

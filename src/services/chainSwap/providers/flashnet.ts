/**
 * Flashnet Orchestra chain swap provider.
 *
 * A thin adapter: transport lives in src/api/flashnetAPIs.ts and translation
 * in ./flashnetMapping.ts, both unit-tested on their own.
 *
 * Flashnet works differently from SideShift in one way the UI has to respect.
 * A quote is what allocates the deposit address, so it needs the settle and
 * refund addresses up front and its price holds for only two minutes, whether
 * or not the user pays. So the flow is: price with getPair while the user
 * types, collect the addresses, then quote at the moment they commit and show
 * the deposit address straight away.
 */

import {
    getFlashnetOrder,
    getFlashnetPair,
    requestFlashnetQuote,
} from '../../../api/flashnetAPIs';
import { register } from '../registry';
import type { ChainSwapOrder, ChainSwapProvider } from '../types';
import { ChainSwapError, evaluateStall } from '../types';

const flashnetProvider: ChainSwapProvider = {
    id: 'flashnet',
    displayName: 'Flashnet',
    // Flashnet documents no end-user support channel, only partner and legal
    // contacts, so a stuck order has to escalate to us rather than to them.
    supportUrl: 'https://cypherbox.io/',

    quoteNeedsAddresses: true,
    // Needed to pay a Lightning invoice, which carries its own amount.
    supportsExactOut: true,

    // Nothing to configure on the device. The partner key lives on the
    // backend, which answers with a config error until it is set.
    isAvailable() {
        return true;
    },

    /**
     * Flashnet publishes no jurisdiction pre-flight: no permissions endpoint,
     * and no country or IP field anywhere in its API. Screening happens per
     * order, on the addresses, after the user commits. So there is nothing to
     * check here and nothing to fail closed on, which also means the region
     * decision is ours to make rather than theirs to answer.
     */
    async checkPermission() {
        return { allowed: true };
    },

    getPair(deposit, settle, depositAmount) {
        return getFlashnetPair(deposit, settle, depositAmount);
    },

    // async so a missing address rejects rather than throwing synchronously:
    // the contract promises a promise, and callers only wrap .catch.
    async requestQuote(deposit, settle, depositAmount, addresses, mode) {
        if (!addresses?.settleAddress || !addresses?.refundAddress) {
            throw new ChainSwapError('Flashnet needs the settle and refund addresses before it can quote');
        }
        return requestFlashnetQuote(deposit, settle, depositAmount, addresses, mode);
    },

    /**
     * No network call: the quote already carries the deposit instructions,
     * because Flashnet allocated them when it priced the swap. That makes this
     * safe to call twice, and it means the quote's two-minute expiry is the
     * deposit deadline the user is racing.
     */
    async createShift(quote, settleAddress, refundAddress) {
        if (!quote.depositAddress) {
            throw new ChainSwapError('Flashnet quote carries no deposit address');
        }
        const now = new Date();
        const order: ChainSwapOrder = {
            id: quote.id,
            status: 'awaiting_deposit',
            depositAddress: quote.depositAddress,
            ...(quote.depositMemo ? { depositMemo: quote.depositMemo } : {}),
            depositAsset: quote.depositAsset,
            settleAsset: quote.settleAsset,
            depositAmount: quote.depositAmount,
            settleAmount: quote.settleAmount,
            settleAddress,
            refundAddress,
            createdAt: now,
            expiresAt: quote.expiresAt,
            statusChangedAt: now,
        };
        return order;
    },

    async pollShift(previous) {
        // One clock for the progress check and the verdict, so a poll cannot
        // straddle a threshold between the two.
        const now = new Date();
        const order = await getFlashnetOrder(previous, now);
        // Flashnet shows no order until it detects the deposit, so an order we
        // paid ourselves still reads as awaiting one, which never escalates.
        // Once our deposit is on chain it is in flight like any other, and a
        // deposit Flashnet never picks up has to surface as a stall.
        const inFlight = order.status === 'awaiting_deposit' && order.depositTxId !== undefined;
        return { order, stall: evaluateStall(inFlight ? 'confirming' : order.status, order.statusChangedAt, now) };
    },
};

register(flashnetProvider);

export default flashnetProvider;

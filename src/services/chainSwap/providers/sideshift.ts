/**
 * SideShift chain swap provider.
 *
 * A thin adapter: transport and translation live in src/api/sideshiftAPIs.ts
 * and ./sideshiftMapping.ts, both unit-tested on their own. Public reads go
 * straight from the device, while quote and shift creation go through our
 * backend, which holds the account secret.
 */

import {
    createSideShiftShift,
    getSideShiftPair,
    getSideShiftPermission,
    getSideShiftShift,
    requestSideShiftQuote,
} from '../../../api/sideshiftAPIs';
import { register } from '../registry';
import type { ChainSwapProvider } from '../types';
import { ChainSwapError, evaluateStall } from '../types';

const sideshiftProvider: ChainSwapProvider = {
    id: 'sideshift',
    displayName: 'SideShift',
    supportUrl: 'https://help.sideshift.ai/en/',

    // Nothing to configure on the device. Credentials live on the backend,
    // which answers with a config error until they are set, and whether this
    // user may swap at all is checkPermission's job.
    isAvailable() {
        return true;
    },

    checkPermission() {
        return getSideShiftPermission();
    },

    getPair(deposit, settle, depositAmount) {
        return getSideShiftPair(deposit, settle, depositAmount);
    },

    async requestQuote(deposit, settle, depositAmount, _addresses, mode) {
        // SideShift prices forwards only: a fixed shift is created from a
        // deposit amount, so there is no way to work back from a target.
        if (mode === 'exact_out') {
            throw new ChainSwapError('SideShift can only price from the deposit amount');
        }
        return requestSideShiftQuote(deposit, settle, depositAmount);
    },

    createShift(quote, settleAddress, refundAddress) {
        return createSideShiftShift(quote, settleAddress, refundAddress);
    },

    async pollShift(previous) {
        // One clock for both the progress check and the verdict, so a poll
        // cannot straddle a threshold between the two.
        const now = new Date();
        const order = await getSideShiftShift(previous, now);
        return { order, stall: evaluateStall(order.status, order.statusChangedAt, now) };
    },
};

register(sideshiftProvider);

export default sideshiftProvider;

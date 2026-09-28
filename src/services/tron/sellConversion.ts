/**
 * Selling bitcoin for USDT on Tron, from one of the app's own vaults.
 *
 * The mirror of conversion.ts, and deliberately much smaller, because the two
 * directions are not symmetrical:
 *
 *   - Buying, the deposit is USDT on Tron. That transfer costs energy this
 *     wallet does not hold, so our backend pays it, and it only does so for a
 *     quote it booked from the address that quote refunds to. Hence all the
 *     readiness checking in conversion.ts.
 *   - Selling, the deposit is bitcoin on chain. The vault pays its own miner
 *     fee out of the coins the user picked, through the app's existing vault
 *     send. Nothing is sponsored, so there is nothing to check with the
 *     backend beyond the quote itself.
 *
 * What this returns is an address and an exact amount. Building, signing and
 * broadcasting the transaction that pays it is the vault send's job, not this
 * module's: that path already selects capsules, prices the miner fee, routes
 * change and broadcasts, and it is not worth a second implementation.
 *
 * Nothing here logs.
 */

import type { ChainAsset, ChainSwapOrder, ChainSwapQuote } from '../chainSwap';
import { ChainSwapError, JurisdictionBlockedError, asset, requireChainSwapProvider } from '../chainSwap';

/** What this sells, and what it sells it for. */
export const ONCHAIN_BTC_DEPOSIT: ChainAsset = asset('btc', 'bitcoin');
export const USDT_TRON_SETTLE: ChainAsset = asset('usdt', 'tron');

/**
 * Time to get a transaction built and broadcast before the price lapses.
 *
 * A quote holds for about two minutes. Unlike a USDT deposit, which this app
 * signs and posts in one step, a vault send takes the user through capsule
 * selection and a fee choice first, so the margin is wider.
 */
export const SALE_BROADCAST_MARGIN_MS = 90_000;

export type BitcoinSaleRequest = {
    /** Exact bitcoin to sell, as a decimal string. */
    readonly amountBtc: string;
    /** Where the USDT arrives: this wallet's own Tron address. */
    readonly settleAddress: string;
    /**
     * Where the bitcoin goes back if the swap fails.
     *
     * An address on the vault the coins are leaving, so a refund lands back
     * where it came from. This is the piece that has no answer for the
     * Lightning rails, and the reason only the vaults can sell today.
     */
    readonly refundAddress: string;
};

export type PreparedBitcoinSale = {
    readonly quote: ChainSwapQuote;
    /** The order to follow once the deposit is broadcast. */
    readonly order: ChainSwapOrder;
    /** The bitcoin address the vault must pay. */
    readonly depositAddress: string;
    /** Exactly what it must pay, as a decimal string of bitcoin. */
    readonly depositAmount: string;
    /** What arrives, in USDT, as the quote states it. */
    readonly settleAmount: string;
    /**
     * Broadcast before this or the price may be restated.
     *
     * Flashnet keeps the deposit address, so a late deposit is not lost, but
     * what it settles at is then out of the quote's hands. The screen says so
     * rather than pretending the address dies with the clock.
     */
    readonly broadcastBy: Date;
};

/**
 * Book a quote to sell `amountBtc` for USDT on Tron.
 *
 * exact_in: the bitcoin the user sends is what they fixed, and the USDT that
 * arrives is what the quote works out. That is the right way round for a vault
 * send, whose amount the user is choosing in coins.
 *
 * Venue errors pass through as the chainSwap errors.
 */
export async function prepareBitcoinSale(request: BitcoinSaleRequest): Promise<PreparedBitcoinSale> {
    const { amountBtc, settleAddress, refundAddress } = request;

    const provider = requireChainSwapProvider('flashnet');
    const permission = await provider.checkPermission();
    if (!permission.allowed) {
        throw new JurisdictionBlockedError('flashnet', permission.reason);
    }

    const quote = await provider.requestQuote(
        ONCHAIN_BTC_DEPOSIT,
        USDT_TRON_SETTLE,
        amountBtc,
        { settleAddress, refundAddress },
        'exact_in',
    );
    if (!quote.depositAddress) {
        throw new ChainSwapError('Flashnet returned a quote with nowhere to deposit');
    }
    if (quote.depositMemo) {
        // A bitcoin transaction carries no memo field, so a route that needs
        // one cannot be paid by a vault send.
        throw new ChainSwapError('This conversion needs a deposit memo, which a bitcoin send cannot carry');
    }

    const order = await provider.createShift(quote, settleAddress, refundAddress);
    return {
        quote,
        order,
        depositAddress: quote.depositAddress,
        depositAmount: quote.depositAmount,
        settleAmount: quote.settleAmount,
        broadcastBy: new Date(quote.expiresAt.getTime() - SALE_BROADCAST_MARGIN_MS),
    };
}

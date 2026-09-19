/**
 * Converting USDT on Tron to bitcoin, from the user's own Tron account.
 *
 * Three steps, one per moment of the flow, so a screen only renders states:
 *   - prepareUsdtConversion, when the user asks for a price: checks the wallet
 *     can pay now, books a Flashnet quote that refunds to the user's own Tron
 *     address, and returns the order to confirm and the time to confirm by.
 *   - payUsdtConversion, when they confirm: sends the deposit through our
 *     backend, which pays its network fee, and waits for it to land.
 *   - followUsdtConversion, after: reads the order until it settles, is
 *     refunded or fails, with a verdict whenever it is slow or stuck.
 *
 * Flashnet only, on purpose. Our backend pays a deposit's network fee only for
 * a quote it booked through /flashnet/quote, from the address that quote
 * refunds to, for the amount it asked for. That is why the refund address is
 * always the sending account, and why no other venue can be swapped in here.
 *
 * Nothing here logs.
 */

import BigNumber from 'bignumber.js';

import { getTronConversionTerms } from '../../api/flashnetAPIs';
import type { ChainAsset, ChainSwapAmountMode, ChainSwapOrder, ChainSwapPollResult, ChainSwapQuote } from '../chainSwap';
import {
    ChainSwapError,
    JurisdictionBlockedError,
    VenueUnavailableError,
    asset,
    isTerminal,
    requireChainSwapProvider,
} from '../chainSwap';
import { USDT_DECIMALS } from './constants';
import { decimalToUnits } from './contract';
import {
    CONVERSION_SEND_MARGIN_MS,
    type SendingAccount,
    type SubmittedTransfer,
    type TronSendClock,
    type UsdtSendReadiness,
    type UsdtSendReceipt,
    checkUsdtSendReadiness,
    confirmUsdtTransfer,
    sendUsdtConversionDeposit,
    systemClock,
} from './send';
import type { UsdtTransferSigner } from './transaction';

/** USDT on Tron, the only thing these conversions take in. */
export const USDT_ON_TRON: ChainAsset = asset('usdt', 'tron');

/**
 * How often to read the order while following it. Flashnet suggests every 3
 * seconds; our backend allows a client 60 order reads a minute.
 */
const FOLLOW_INTERVAL_MS = 5_000;

export type UsdtConversionRequest = {
    /** The user's Tron account. The deposit comes from it, and any refund goes back to it. */
    readonly account: SendingAccount;
    /** What arrives: bitcoin on chain, or over Lightning. */
    readonly settle: ChainAsset;
    /** Where it arrives: a bitcoin address, or a Lightning invoice. */
    readonly settleAddress: string;
    /** Decimal string: USDT on exact_in, the settle asset on exact_out. */
    readonly amount: string;
    /** Defaults to exact_in. Paying a Lightning invoice that carries an amount needs exact_out. */
    readonly mode?: ChainSwapAmountMode;
};

export type PreparedUsdtConversion =
    | {
          /** Under the smallest conversion we quote. `minAmount` is in USDT. */
          readonly ready: false;
          readonly code: 'BELOW_MINIMUM';
          readonly minAmount: string;
      }
    | {
          readonly ready: true;
          readonly quote: ChainSwapQuote;
          /** The order to pay into: hand it to payUsdtConversion. */
          readonly order: ChainSwapOrder;
          /**
           * The deposit will not start after this: the quote's expiry less the
           * time a deposit needs to be seen. The quote's expiry is Flashnet's
           * clock, so a countdown on the phone's is approximate; the send
           * itself judges by the network's.
           */
          readonly confirmBy: Date;
      }
    | Exclude<UsdtSendReadiness, { ready: true }>;

/**
 * Check the wallet can pay, then book the quote and its order.
 *
 * Nothing is booked for a wallet short of USDT or bandwidth, since a quote
 * holds for two minutes and the wait can be hours. On exact_out the deposit is
 * only known once the quote works it out, so bandwidth is checked first and
 * the balance after; a quote the wallet cannot cover then simply expires.
 *
 * Venue errors pass through as the chainSwap errors, TRON_UNREACHABLE as a
 * TronSendError.
 *
 * A conversion under the minimum is refused here on exact_in, where the user
 * fixed the deposit. On exact_out the deposit is only known once Flashnet
 * works it out, so the backend refuses that one and it arrives as an
 * AmountOutOfRangeError.
 */
export async function prepareUsdtConversion(
    request: UsdtConversionRequest,
    clock: TronSendClock = systemClock,
): Promise<PreparedUsdtConversion> {
    const { account, settle, settleAddress, amount } = request;
    const mode = request.mode ?? 'exact_in';
    const exactIn = mode === 'exact_in';

    // Cheap and cached, and it decides whether reading the chain is worth it.
    const terms = await getTronConversionTerms();
    if (exactIn && new BigNumber(amount).isLessThan(terms.minimum)) {
        return { ready: false, code: 'BELOW_MINIMUM', minAmount: terms.minimum };
    }

    const before = await checkUsdtSendReadiness(
        account.address,
        exactIn ? decimalToUnits(amount, USDT_DECIMALS) : undefined,
        clock,
    );
    if (!before.ready) {
        return before;
    }

    const provider = requireChainSwapProvider('flashnet');
    const permission = await provider.checkPermission();
    if (!permission.allowed) {
        throw new JurisdictionBlockedError('flashnet', permission.reason);
    }
    const quote = await provider.requestQuote(
        USDT_ON_TRON,
        settle,
        amount,
        { settleAddress, refundAddress: account.address },
        mode,
    );
    if (!quote.depositAddress) {
        throw new ChainSwapError('Flashnet returned a quote with nowhere to deposit');
    }
    if (quote.depositMemo) {
        // A memo costs a TRX our users do not hold, and the backend refuses one.
        throw new ChainSwapError('This conversion needs a deposit memo, which a USDT send here cannot carry');
    }

    if (!exactIn) {
        const after = await checkUsdtSendReadiness(
            account.address,
            decimalToUnits(quote.depositAmount, USDT_DECIMALS),
            clock,
        );
        if (!after.ready) {
            return after;
        }
    }

    const order = await provider.createShift(quote, settleAddress, account.address);
    return {
        ready: true,
        quote,
        order,
        confirmBy: new Date(quote.expiresAt.getTime() - CONVERSION_SEND_MARGIN_MS),
    };
}

export type UsdtConversionPayment = {
    /** The order prepareUsdtConversion returned. */
    readonly order: ChainSwapOrder;
    readonly account: SendingAccount;
    readonly sign: UsdtTransferSigner;
    /** See UsdtSendParams.onSubmit: keep the transfer if the app might close mid-send. */
    readonly onSubmit?: (transfer: SubmittedTransfer) => void;
    /** Called once the backend has broadcast the deposit, before it lands. */
    readonly onSent?: (receipt: UsdtSendReceipt) => void;
};

/**
 * Pay the deposit and wait for it to land in a block.
 *
 * Returns the order to follow, carrying the deposit's transaction id and with
 * its clock restarted at the landing, so a deposit Flashnet never picks up
 * escalates from then. Throws what the send does. An indeterminate
 * TronSendError means the deposit may still land: never offer to pay again,
 * and settle it with awaitUsdtTransferOutcome or by following the order.
 */
export async function payUsdtConversion(
    payment: UsdtConversionPayment,
    clock: TronSendClock = systemClock,
): Promise<ChainSwapOrder> {
    const receipt = await sendUsdtConversionDeposit(
        { order: payment.order, from: payment.account, sign: payment.sign, onSubmit: payment.onSubmit },
        clock,
    );
    payment.onSent?.(receipt);
    await confirmUsdtTransfer(receipt, clock);
    return { ...payment.order, depositTxId: receipt.txID, statusChangedAt: new Date(clock.now()) };
}

export type FollowUsdtConversionOptions = {
    /** Called after every reading, with the order and how worried to be about it. */
    readonly onUpdate?: (result: ChainSwapPollResult) => void;
    /** Stops following, for example when the screen closes. The last reading is returned. */
    readonly signal?: AbortSignal;
};

/**
 * Read the order until it settles, is refunded, expires or fails, and return
 * the last reading.
 *
 * A venue that is briefly unreachable does not end it; any other error does.
 * Nor does a stall verdict: the order can still move, and what to show is the
 * caller's call.
 */
export async function followUsdtConversion(
    order: ChainSwapOrder,
    options: FollowUsdtConversionOptions = {},
    clock: TronSendClock = systemClock,
): Promise<ChainSwapPollResult> {
    const provider = requireChainSwapProvider('flashnet');
    let latest: ChainSwapPollResult = { order, stall: 'none' };
    while (!options.signal?.aborted) {
        try {
            latest = await provider.pollShift(latest.order);
            options.onUpdate?.(latest);
            if (isTerminal(latest.order.status)) {
                return latest;
            }
        } catch (error) {
            if (!(error instanceof VenueUnavailableError) || !error.retryable) {
                throw error;
            }
        }
        await clock.sleep(FOLLOW_INTERVAL_MS);
    }
    return latest;
}

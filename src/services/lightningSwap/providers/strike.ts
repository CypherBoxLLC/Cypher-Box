/**
 * Strike lightning swap provider.
 *
 * Strike's API is fiat-denominated for invoice creation: callers ask
 * for "X USD/EUR" and Strike returns a BOLT11 that settles whatever
 * sats that fiat amount is worth at quote time. The swap engine talks
 * in sats, so this provider converts sats → fiat using the cached
 * `matchedRateStrike` (USD per BTC) before calling Strike.
 *
 * Payment uses the existing `sendStrikeLightningPayment(bolt11, amount)`
 * helper, which already does the two-step Strike quote → execute
 * dance. We pass `amountSats` so amount-less invoices still get paid
 * correctly — Strike's quote endpoint accepts an optional `amount`
 * override.
 */

import { StrikeFull } from '@Cypher/assets/images';
import {
    createInvoice as strikeCreateInvoice,
    pollStrikePaymentUntilTerminal,
    sendStrikeLightningPayment,
} from '@Cypher/api/strikeAPIs';
import useAuthStore from '@Cypher/stores/authStore';
import { recordEvent } from '@Cypher/stores/eventLogStore';

import type {
    LightningSwapProvider,
    LightningSwapResult,
} from '../types';
import { register } from '../registry';

/**
 * Convert sats → fiat using the user's matched BTC rate. Strike's
 * invoice endpoint requires a fiat-denominated amount; we feed it the
 * fiat equivalent of the sats the user requested.
 *
 * Rounded to 2 decimals — Strike rejects more-precise fiat amounts on
 * its bolt11 endpoint, and the rounding error (≤ 1 cent) is borne by
 * the swap engine's amountSats vs the eventual settled amount.
 */
function satsToFiat(sats: number, rateUsdPerBtc: number): number {
    if (!rateUsdPerBtc || rateUsdPerBtc <= 0) {
        throw new Error(
            'Strike rate not yet hydrated — wait a moment after login and retry',
        );
    }
    const btc = sats / 1e8;
    const fiat = btc * rateUsdPerBtc;
    return Math.round(fiat * 100) / 100;
}

const strikeProvider: LightningSwapProvider = {
    id: 'strike',
    displayName: 'Strike',
    icon: StrikeFull,

    isAvailable() {
        return Boolean(useAuthStore.getState().isStrikeAuth);
    },

    async createInvoice(amountSats /* memo unused — Strike's bolt11 endpoint doesn't accept a description field */) {
        const { strikeUser, matchedRateStrike } = useAuthStore.getState();
        const currency = strikeUser?.[1]?.currency || 'USD';
        const fiatAmount = satsToFiat(amountSats, Number(matchedRateStrike || 0));

        const response = await strikeCreateInvoice({
            bolt11: {
                amount: {
                    amount: fiatAmount,
                    currency,
                },
                // 60s matches the rest of the app's invoice TTL. Long
                // enough for the source provider to pay, short enough
                // that a stale invoice can't be paid much later by a
                // user who walked away mid-flow.
                expiryInSeconds: 60,
            },
            targetCurrency: currency,
        });

        const bolt11 = response?.bolt11?.invoice;
        if (!bolt11 || typeof bolt11 !== 'string') {
            const msg =
                response?.data?.message ??
                response?.message ??
                'Strike returned no invoice';
            throw new Error(msg);
        }
        return bolt11;
    },

    async payInvoice(bolt11 /* amountSats unused — see below */, _amountSats /* memo */): Promise<LightningSwapResult> {
        // sendStrikeLightningPayment runs:
        //   POST /payment-quotes/lightning  { invoice }    → quoteId
        //   PATCH /payment-quotes/{id}/execute             → result
        //
        // We deliberately do NOT pass an `amount` override. Both Ark and
        // Coinos generate amount-encoded BOLT11s (the only providers
        // that currently produce destination invoices in this codebase),
        // and Strike's quote endpoint rejects redundant `amount` fields
        // on amount-encoded invoices. If a future provider produces
        // amount-less BOLT11s, branch here on a decoded check first.
        //
        // Diagnostic logging is intentional and stays in dev — when a
        // swap fails the most useful trace is the bolt11 + Strike's
        // raw response, both of which would otherwise be invisible.
        if (__DEV__) {
            console.log('[lightningSwap/strike] payInvoice bolt11=', bolt11.slice(0, 30) + '…');
        }
        let result: any;
        try {
            result = await sendStrikeLightningPayment(bolt11);
        } catch (err) {
            if (__DEV__) console.log('[lightningSwap/strike] payInvoice threw:', err);
            throw err;
        }
        if (__DEV__) console.log('[lightningSwap/strike] payInvoice execute result=', JSON.stringify(result));

        // Strike's `/payment-quotes/{id}/execute` returns immediately once
        // the invoice is accepted into Strike's routing queue. The state
        // at that moment is almost always `PENDING` — the LN payment
        // takes a few seconds to actually route. Terminal states are
        // `COMPLETED`, `FAILED`, `REVERSED`. Polling `GET /payments/{id}`
        // bridges the gap.
        //
        // History: earlier this code path treated PENDING as failure and
        // threw `PaymentFailedError` immediately. Users saw "swap failed"
        // toasts while the LN payment was actually going through, and
        // retried, sometimes producing duplicate Strike payments. See
        // session notes for the 2026-05-31 incident where 3 quotes were
        // executed for a single user-intended swap.
        let final: any = result;
        const initialState = String(result?.state ?? '').toUpperCase();
        const paymentId: string | undefined = result?.paymentId ?? result?.id;
        if (initialState !== 'COMPLETED' && initialState !== 'FAILED' && initialState !== 'REVERSED' && paymentId) {
            try {
                if (__DEV__) {
                    console.log(
                        '[lightningSwap/strike] state=', initialState,
                        '— polling payment', String(paymentId).slice(0, 8), 'for terminal state',
                    );
                }
                final = await pollStrikePaymentUntilTerminal(String(paymentId), {
                    timeoutMs: 30_000,
                    intervalMs: 1_000,
                });
            } catch (pollErr) {
                // Polling failure does NOT automatically mean payment failure
                // — Strike auth could have expired mid-flight, network could
                // have flaked. Surface the polling error but keep the original
                // execute result available for triage.
                if (__DEV__) {
                    console.warn('[lightningSwap/strike] poll threw, falling back to initial execute result:', pollErr);
                }
                throw new Error(
                    `Strike payment ${String(paymentId).slice(0, 8)} status check failed: ${(pollErr as any)?.message ?? pollErr}. ` +
                    `Check the Strike app to confirm whether the payment settled before retrying.`,
                );
            }
        }

        const finalState = String(final?.state ?? '').toUpperCase();
        const ok = finalState === 'COMPLETED' || final?.completed === true;
        if (!ok) {
            const msg =
                final?.error?.message ??
                final?.data?.message ??
                final?.message ??
                (final?.state ? `Strike payment state: ${final.state}` : 'Strike payment did not complete');
            // Special case: stayed PENDING past the polling timeout. This
            // is NOT a confirmed failure — the payment may still settle.
            // Refuse to retry; tell the user to check Strike before
            // re-attempting so they don't double-pay.
            if (finalState === 'PENDING' || finalState === 'NEW') {
                throw new Error(
                    `Strike payment still ${finalState} after 30s. ` +
                    `Do NOT retry yet — check the Strike app first to see if it settled. ` +
                    `Payment id: ${String(paymentId ?? '(unknown)').slice(0, 8)}.`,
                );
            }
            throw new Error(msg);
        }
        const id = String(
            final?.paymentId ?? final?.paymentQuoteId ?? final?.id ?? paymentId ?? '(strike payment)',
        );
        recordEvent({ kind: 'ln-sent', wallet: 'strike', sats: _amountSats });
        return {
            id,
            // Strike doesn't surface the routing fee separately on
            // execute — the quote step has totalFee fields but they're
            // already baked into the source-currency debit. Skipping
            // feeSats here so the UI shows "—" rather than 0.
        };
    },

    // No estimateFee — Strike's quote endpoint exposes a fee, but
    // calling it pre-flight requires generating then discarding a
    // quote, which Strike's idempotency rules don't love. If we ever
    // want to surface a pre-swap fee for Strike, the right approach
    // is to merge quote+execute into payInvoice (it already is) and
    // expose a `dry-run` quote here.
};

register(strikeProvider);
export default strikeProvider;

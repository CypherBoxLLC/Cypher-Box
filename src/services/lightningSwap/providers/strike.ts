/**
 * Strike lightning swap provider.
 *
 * Invoice creation is BTC-denominated. A swap is sats -> sats, so we ask
 * Strike for a bolt11 worth exactly `amountSats` and let Strike convert it
 * to the user's fiat balance on receipt (`targetCurrency`). We deliberately
 * do NOT round-trip through fiat to build the invoice: doing so made Strike
 * re-derive the sat amount at its own rate, landing a few sats ABOVE the
 * request and overshooting the source rail's spendable balance near MAX.
 * See `createInvoice` for the full rationale.
 *
 * Payment (only used when Strike is the SOURCE of a swap) goes through the
 * existing `sendStrikeLightningPayment(bolt11)` helper, which does the
 * two-step Strike quote -> execute dance against the destination's
 * amount-encoded bolt11.
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
import { PaymentPendingError } from '../types';
import { register } from '../registry';

/**
 * Format an integer sats amount as a BTC decimal string for Strike's
 * invoice endpoint (e.g. 53032 -> "0.00053032").
 *
 * String, not number: `JSON.stringify` renders small floats in scientific
 * notation (0.0000001 -> "1e-7"), which Strike rejects. `toFixed(8)` pins
 * exactly one sat of resolution and always recovers the integer sat count
 * (the float error is ~1e-19, far below 1e-8), so there is no rounding
 * drift and the encoded invoice amount equals `amountSats` exactly.
 */
function satsToBtcString(sats: number): string {
    return (sats / 1e8).toFixed(8);
}

const strikeProvider: LightningSwapProvider = {
    id: 'strike',
    displayName: 'Strike',
    icon: StrikeFull,

    isAvailable() {
        return Boolean(useAuthStore.getState().isStrikeAuth);
    },

    async createInvoice(amountSats, _memo, sourceId /* _memo unused: Strike's bolt11 endpoint takes no description field */) {
        const { strikeUser } = useAuthStore.getState();
        // The currency Strike credits the user in on receipt (their account
        // balance currency). This is NOT the invoice denomination — see below.
        const targetCurrency = strikeUser?.[1]?.currency || 'USD';

        // Denominate the invoice in BTC, not fiat.
        //
        // A swap is sats -> sats: the user picks an exact sats amount and the
        // source rail pays exactly that. The old path converted sats -> fiat
        // HERE and asked Strike for a fiat-denominated bolt11; Strike then
        // re-derived the sat amount at ITS OWN rate, landing a few sats ABOVE
        // the request (observed: 53,032 requested -> 53,076 encoded). That
        // drift overshot the source's spendable balance and broke swaps at or
        // near MAX with "not enough balance".
        //
        // Encoding in BTC removes the round-trip entirely: the bolt11 carries
        // exactly `amountSats`. `targetCurrency` stays the user's account
        // currency, so Strike still converts to fiat and credits their fiat
        // balance on receipt (its core feature). Only the denomination the
        // payer settles is changing, not what the user ends up holding.
        const amountBtc = satsToBtcString(amountSats);

        const response = await strikeCreateInvoice({
            bolt11: {
                amount: {
                    amount: amountBtc,
                    currency: 'BTC',
                },
                // Source-aware TTL. Fast custodial sources (Coinos) pay in
                // seconds, so 60s is fine and limits how long a stale
                // invoice stays payable. But an Ark send takes MINUTES
                // (HTLC build + ASP round-trip), so 60s expires before it
                // can settle, give Ark-sourced swaps 10 minutes.
                expiryInSeconds: sourceId === 'ark' ? 600 : 60,
            },
            targetCurrency,
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
        // the invoice is accepted into Strike's routing queue. When Strike
        // can route synchronously the state is already `COMPLETED`. When
        // routing is slow (or failing — e.g. no route to the destination
        // ASP) it returns `PENDING`, debits/reserves the source balance,
        // and the payment then either settles or times out and refunds.
        // Terminal states are `COMPLETED`, `FAILED`, `REVERSED`.
        //
        // Confirming a PENDING outcome requires `GET /payments/{id}`, but
        // the mobile client's Strike token does NOT carry the scope for
        // that endpoint — it returns `403 Insufficient permissions`
        // (observed live 2026-05-31). So we attempt the poll defensively
        // (in case a future token has the scope) but treat ANY inability
        // to confirm as PENDING, not as failure.
        //
        // History: this path used to throw `PaymentFailedError` on the
        // PENDING state. Users saw "swap failed" while the LN payment was
        // actually in-flight, retried, and each retry reserved another
        // real payment. On 2026-05-31 a single intended swap became three
        // reserved Strike payments this way. PENDING must surface as its
        // own "submitted, do not retry" outcome.
        let final: any = result;
        const initialState = String(result?.state ?? '').toUpperCase();
        const paymentId: string | undefined = result?.paymentId ?? result?.id;
        const pidShort = String(paymentId ?? '(unknown)').slice(0, 8);

        if (initialState !== 'COMPLETED' && initialState !== 'FAILED' && initialState !== 'REVERSED' && paymentId) {
            try {
                if (__DEV__) {
                    console.log(
                        '[lightningSwap/strike] state=', initialState,
                        '— attempting to poll payment', pidShort, 'for terminal state',
                    );
                }
                final = await pollStrikePaymentUntilTerminal(String(paymentId), {
                    timeoutMs: 30_000,
                    intervalMs: 1_000,
                });
            } catch (pollErr) {
                // Can't confirm (403 no-scope, auth expiry, network flake).
                // This is NOT a failure — the payment is in-flight and will
                // settle or auto-refund. Surface as PENDING so the UI tells
                // the user to wait and check Strike, NOT to retry.
                if (__DEV__) {
                    console.warn('[lightningSwap/strike] cannot poll payment status, treating as PENDING:', pollErr);
                }
                throw new PaymentPendingError(
                    'strike',
                    `Strike accepted your payment (id ${pidShort}) but it's still settling on Lightning and the app can't confirm the result. ` +
                    `Do NOT retry. Open the Strike app to check: it will either complete or refund automatically within a few hours.`,
                    String(paymentId),
                );
            }
        }

        const finalState = String(final?.state ?? '').toUpperCase();
        const ok = finalState === 'COMPLETED' || final?.completed === true;
        if (!ok) {
            // Still PENDING/NEW after the poll window → in-flight, not failed.
            // Surface as PENDING (do-not-retry), never as a retryable failure.
            if (finalState === 'PENDING' || finalState === 'NEW' || finalState === '') {
                throw new PaymentPendingError(
                    'strike',
                    `Strike payment ${pidShort} is still settling on Lightning. ` +
                    `Do NOT retry — open the Strike app to check. It will complete or refund automatically within a few hours.`,
                    String(paymentId ?? ''),
                );
            }
            // Genuinely terminal failure (FAILED / REVERSED) → the source
            // balance is refunded, safe to surface as a real failure.
            const msg =
                final?.error?.message ??
                final?.data?.message ??
                final?.message ??
                `Strike payment ${finalState.toLowerCase()}`;
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

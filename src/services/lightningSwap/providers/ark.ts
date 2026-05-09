/**
 * Ark lightning swap provider.
 *
 * Wraps the existing Ark service helpers in src/services/ark/. Unlike
 * the custodial providers (Coinos, Strike) Ark is *non-custodial* and
 * can quote routing fees ahead of time via the SDK's
 * `estimateLightningSendFee` — so this provider implements optional
 * `estimateFee()` and surfaces a real number to the swap UI before the
 * user confirms.
 *
 * No logo asset exists for Ark yet — `icon` is left undefined and the
 * SwapSheet falls back to rendering `displayName` as text. Add an asset
 * + this provider's `icon` field when one's available; nothing else
 * needs to change.
 */

import {
    applyExpiredVtxoFilter,
    classifyArkDestination,
    createArkLightningInvoice,
    estimateArkSendFee,
    executeArkSend,
    fetchArkBalance,
    fetchArkVtxos,
    fetchChainTipHeight,
} from '@Cypher/services/ark';
import useAuthStore from '@Cypher/stores/authStore';

import type {
    LightningSwapProvider,
    LightningSwapResult,
} from '../types';
import { register } from '../registry';

const arkProvider: LightningSwapProvider = {
    id: 'ark',
    displayName: 'Ark',
    // No icon — SwapSheet renders the displayName as a text badge.

    isAvailable() {
        return Boolean(useAuthStore.getState().isArkAuth);
    },

    async createInvoice(amountSats /* memo */) {
        // The current Bark FFI's `bolt11Invoice` takes only an amount
        // — no memo/description field is exposed yet. We accept the
        // memo arg for interface uniformity but drop it. When the SDK
        // grows a memo param, thread it through here.
        const bolt11 = await createArkLightningInvoice(amountSats);
        if (__DEV__) {
            console.log(
                '[lightningSwap/ark] createInvoice amount=', amountSats,
                'bolt11=', bolt11.slice(0, 30) + '…',
            );
        }
        return bolt11;
    },

    async payInvoice(bolt11, amountSats, memo): Promise<LightningSwapResult> {
        // classifyArkDestination handles BOLT11 / BOLT12 / LN-address
        // disambiguation. For swaps we always feed it a BOLT11 (other
        // providers don't generate offers/addresses), but routing it
        // through the classifier keeps the call site identical to the
        // app's regular Ark send path — same code, same logging, same
        // failure modes.
        const dest = classifyArkDestination(bolt11);
        if (dest.kind !== 'ln-invoice') {
            throw new Error(
                `Expected a BOLT11 invoice for the Ark swap but got "${dest.kind}"`,
            );
        }

        // ----- Preflight: balance + fee headroom ---------------------
        //
        // The Bark SDK's `payLightningInvoice` throws an opaque
        // `BarkError.Internal` when the user has exactly enough sats
        // for `amountSats` but no room left for the routing fee. The
        // SDK doesn't auto-deduct the fee from the amount; the caller
        // is expected to leave headroom. Without this preflight the
        // user sees a useless "BarkError.Internal" and has no way to
        // know they need to swap a smaller amount.
        //
        // We fetch fresh balance + fee estimate and short-circuit with
        // a clear message if `spendable < amount + fee`. This costs
        // one extra round-trip to the ASP but only on swap submit, not
        // on every keystroke (the SwapAmount fee preview already runs
        // its own debounced estimate).
        try {
            // Pull vtxos + chain tip alongside balance so the preflight
            // check uses the same expired-dust-filtered spendable number
            // the headline shows. Without this, the SDK's raw
            // `spendableSats` includes expired VTXOs the user can't
            // actually select for a send, and the preflight greenlights
            // a swap that fails inside the SDK with `BarkError.Internal`.
            const [balance, feeView, vtxosResult, tip] = await Promise.all([
                fetchArkBalance(),
                estimateArkSendFee(dest, amountSats),
                fetchArkVtxos(),
                fetchChainTipHeight(),
            ]);
            const filteredBalance = balance
                ? applyExpiredVtxoFilter(balance, vtxosResult?.all, tip)
                : null;
            const spendable = filteredBalance?.spendableSats ?? 0;
            const fee = Number(feeView.feeSats || 0);
            const required = amountSats + fee;
            if (spendable < required) {
                throw new Error(
                    `Not enough Ark balance — need ${required} sats ` +
                    `(${amountSats} + ${fee} routing fee) but only ${spendable} spendable. ` +
                    `Try swapping ${Math.max(0, spendable - fee)} sats.`,
                );
            }
        } catch (err) {
            // Re-throw the friendly message verbatim. If the preflight
            // itself crashed for an unrelated reason (e.g. transient
            // ASP timeout on `estimateLightningSendFee`), fall through
            // to the actual send attempt — the SDK's own error is more
            // informative than a "preflight failed" wrapper would be.
            if (err instanceof Error && err.message.startsWith('Not enough Ark balance')) {
                throw err;
            }
            if (__DEV__) console.warn('[lightningSwap/ark] preflight check failed, attempting send anyway:', err);
        }

        const result = await executeArkSend(dest, amountSats, memo);
        return {
            id: result.id,
            // Ark surfaces the exact routing fee in the result — feed
            // it into the LightningSwapResult so the success view can
            // show "Network fee: N sats" instead of a placeholder.
            feeSats: result.feeSats,
        };
    },

    async estimateFee(amountSats) {
        // estimateLightningSendFee under the hood. Independent of which
        // BOLT11 we'll later pay — Bark's routing model only needs the
        // amount.
        //
        // We call classifyArkDestination on a placeholder so the helper
        // accepts our request, but the SDK call inside doesn't read the
        // invoice value for the LN-invoice fee path. This avoids needing
        // to generate a throwaway invoice just to get an estimate.
        try {
            const fee = await estimateArkSendFee(
                { kind: 'ln-invoice', value: '' },
                amountSats,
            );
            return {
                feeSats: Number(fee.feeSats || 0),
                note: 'Ark routing fee',
            };
        } catch (err) {
            if (__DEV__) console.warn('[lightningSwap/ark] estimateFee failed:', err);
            return null;
        }
    },
};

register(arkProvider);
export default arkProvider;

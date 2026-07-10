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
    fetchArkPendingLightningReceives,
    fetchArkVtxos,
    fetchChainTipHeight,
} from '@Cypher/services/ark';
// Direct module import (not via the ark barrel): movementWatcher is kept out
// of the barrel to avoid the walletHandle <-> movementWatcher import cycle.
import { hadSuccessfulReceiveSince } from '@Cypher/services/ark/movementWatcher';
import useAuthStore from '@Cypher/stores/authStore';

import type {
    LightningSwapProvider,
    LightningSwapResult,
} from '../types';
import { register } from '../registry';
import bolt11 from 'bolt11';

/**
 * Decode the sat amount encoded in an amount-bearing BOLT11, or null if the
 * invoice is amountless / unparseable. Kept local so the swap provider stays
 * self-contained (mirrors the helper in screens/Send).
 */
function decodeBolt11Sats(invoice: string): number | null {
    try {
        const decoded = bolt11.decode(invoice);
        if (decoded?.satoshis && decoded.satoshis > 0) return decoded.satoshis;
        if (decoded?.millisatoshis) {
            const msat = Number(decoded.millisatoshis);
            if (Number.isFinite(msat) && msat > 0) return Math.floor(msat / 1000);
        }
        return null;
    } catch (err) {
        if (__DEV__) console.log('[lightningSwap/ark] bolt11 decode failed:', err);
        return null;
    }
}

/**
 * Extract the lower-cased hex payment hash from a BOLT11, or null. Used by
 * confirmReceived to match a paid invoice against bark's pending Lightning
 * receives (which key on the same hash).
 */
function decodeBolt11PaymentHash(invoice: string): string | null {
    try {
        const decoded = bolt11.decode(invoice);
        const tag = decoded?.tags?.find((t: any) => t.tagName === 'payment_hash');
        const hash = tag?.data;
        return typeof hash === 'string' && hash.length > 0 ? hash.toLowerCase() : null;
    } catch (err) {
        if (__DEV__) console.log('[lightningSwap/ark] payment_hash decode failed:', err);
        return null;
    }
}

const arkProvider: LightningSwapProvider = {
    id: 'ark',
    displayName: 'Bark Vault',
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

        // Pay the invoice's ENCODED amount, not the originally-requested
        // `amountSats`. The BOLT11 is the source of truth for what the
        // recipient will accept: passing a sat count that differs from the
        // encoded amount trips bark's `BarkError.InvalidInvoice: invalid user
        // amount`. Strike invoices are now BTC-denominated so the encoded
        // amount equals `amountSats`, but decoding keeps this robust against
        // any destination whose invoice amount differs from what we asked
        // (and we fall back to the requested amount if it's amountless).
        const invoiceSats = decodeBolt11Sats(bolt11);
        const sendSats = invoiceSats ?? amountSats;

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
                estimateArkSendFee(dest, sendSats),
                fetchArkVtxos(),
                fetchChainTipHeight(),
            ]);
            const filteredBalance = balance
                ? applyExpiredVtxoFilter(balance, vtxosResult?.all, tip)
                : null;
            const spendable = filteredBalance?.spendableSats ?? 0;
            const fee = Number(feeView.feeSats || 0);
            const required = sendSats + fee;
            if (spendable < required) {
                throw new Error(
                    `Not enough Ark balance, need ${required} sats ` +
                    `(${sendSats} + ${fee} routing fee) but only ${spendable} spendable. ` +
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

        const result = await executeArkSend(dest, sendSats, memo);
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

    async confirmReceived(invoice, sinceMs) {
        // Has the payment for this invoice actually arrived?
        //
        // PRIMARY signal: a successful receive MOVEMENT (subsystem=receive
        // status=successful) for this exact sat amount, observed at/after the
        // swap started. The movement watcher records these. This is the
        // reliable signal — verified live 2026-07-08 that the
        // pendingLightningReceives hasHtlcVtxos/preimageRevealed flags do NOT
        // flip in time (they stayed false through a receive that succeeded 8s
        // after the window closed).
        //
        // SECONDARY (belt-and-suspenders): the pending-receive flags, in case
        // the movement was missed (e.g. watcher restart mid-swap). Cheap and
        // can only make us MORE likely to confirm a real arrival.
        const sats = decodeBolt11Sats(invoice);
        const since = typeof sinceMs === 'number' ? sinceMs : 0;
        if (sats && hadSuccessfulReceiveSince(sats, since)) {
            if (__DEV__) console.log('[lightningSwap/ark] confirmReceived: movement matched', sats, 'sats');
            return true;
        }
        const hash = decodeBolt11PaymentHash(invoice);
        if (!hash) return false;
        try {
            const pending = await fetchArkPendingLightningReceives();
            const match = pending.find((r) => r.paymentHash?.toLowerCase() === hash);
            if (__DEV__) {
                console.log(
                    '[lightningSwap/ark] confirmReceived hash=', hash.slice(0, 12),
                    'sats=', sats,
                    'flagMatch=', match ? `hasHtlc=${match.hasHtlcVtxos} preimage=${match.preimageRevealed}` : 'none',
                );
            }
            return Boolean(match && (match.hasHtlcVtxos || match.preimageRevealed));
        } catch {
            return false;
        }
    },

    async maxFeeReserve(balanceSats) {
        // Headroom reserved off the Max button. Ark charges the LN routing fee
        // ON TOP of the sent amount (it is not deducted from it), so Max must
        // leave room or the SDK rejects the send for `amount + fee > spendable`.
        //
        // The reserve is computed from the SAME math as the send preflight:
        // expired-filtered spendable, measured fresh, minus a padded fee.
        // The UI's sourceBalance can be stale or unfiltered relative to what
        // coin-selection actually has — on an active wallet, receives claiming
        // into rounds move sats between spendable and pending constantly.
        // Observed live: Max quoted 917 off a stale balance, the preflight
        // then found fewer spendable sats and refused the swap. A blind flat
        // floor can't absorb an arbitrary stale-balance gap; measuring
        // spendable directly can.
        //
        // The old floor/pad insights survive on the FEE side:
        //   - FLOOR_SATS guards a zero/failed estimate (else Max consumes the
        //     whole balance and the send can't cover its fee).
        //   - PAD adds margin for route variance and for the fee being quoted
        //     at full spendable while the actual send is slightly smaller.
        const FLOOR_SATS = 350; // comfortably above the observed ~265 fee
        const PAD = 1.25;
        try {
            const [balance, vtxosResult, tip] = await Promise.all([
                fetchArkBalance(),
                fetchArkVtxos(),
                fetchChainTipHeight(),
            ]);
            const filtered = balance
                ? applyExpiredVtxoFilter(balance, vtxosResult?.all, tip)
                : null;
            const spendable = filtered?.spendableSats ?? 0;
            if (spendable <= 0) return balanceSats; // nothing sendable: Max = 0
            const est = await estimateArkSendFee(
                { kind: 'ln-invoice', value: '' },
                spendable,
            ).catch(() => null);
            const padded = Math.ceil(Number(est?.feeSats || 0) * PAD);
            const fee = padded > 0 ? padded : FLOOR_SATS; // zero/failed estimate: hold back the floor
            const maxSend = Math.max(0, spendable - fee);
            return Math.max(0, balanceSats - maxSend);
        } catch (err) {
            if (__DEV__) console.warn('[lightningSwap/ark] maxFeeReserve spendable lookup failed, using floor:', err);
            return FLOOR_SATS;
        }
    },
};

register(arkProvider);
export default arkProvider;

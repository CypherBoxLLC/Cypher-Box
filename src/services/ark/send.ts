import {
    FeeEstimate,
    LightningSend,
    validateArkAddress,
} from '@secondts/bark-react-native';

import { getArkWalletHandle } from './walletHandle';
import { fetchArkBalance } from './balance';
import { fetchArkVtxos } from './vtxos';

/**
 * What kind of thing the user pasted into the destination field.
 *
 * `unknown` is a valid terminal state — the screen renders a "not a valid
 * destination" message and disables Send. We don't try to guess; the user
 * re-pastes.
 */
export type ArkDestinationKind =
    | 'ln-invoice'
    | 'ln-offer'
    | 'ln-address'
    | 'ark'
    | 'onchain'
    | 'unknown';

export type ArkDestination = {
    kind: ArkDestinationKind;
    /** The trimmed raw string, ready to hand to the SDK. */
    value: string;
};

export type ArkSendFeeView = {
    feeSats: number;
    grossAmountSats: number;
    netAmountSats: number;
    vtxosSpent: string[];
};

export type ArkSendResult = {
    /** Kind of send that was executed — helps callers route to the right toast. */
    kind: ArkDestinationKind;
    /**
     * For on-chain / Arkoor sends: the txid or vtxo id returned by the SDK.
     * For Lightning sends: the payment identifier from the LightningSend
     * struct (typically the payment hash). Opaque to callers.
     */
    id: string;
    /** The amount that ultimately left the wallet (after fees). */
    netAmountSats: number;
    /** Fee paid for the send, in sats. */
    feeSats: number;
};

function requireHandle() {
    const handle = getArkWalletHandle();
    if (!handle) throw new Error('Ark wallet not open — cannot send');
    return handle;
}

// --- Classification ---------------------------------------------------------
//
// Prefix-based checks first because they're cheap and unambiguous. The
// SDK's `validateArkAddress` is synchronous but we only reach for it after
// the prefix checks have ruled out Lightning. On-chain is last because
// "starts with a letter or digit and contains only base58/bech32 chars"
// is the loosest bucket and would false-positive on malformed input.

const LN_INVOICE_PREFIX = /^(lnbc|lntb|lnbcrt)/i;
const LN_OFFER_PREFIX = /^lno/i;
// Very permissive — the SDK / backend does the real parsing. We just need
// to pick the right send method.
const LN_ADDRESS_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Covers bech32 (bc1, tb1, bcrt1) and base58 (1, 3, m, n, 2). Length check
// is loose — 14–90 chars covers legacy, p2sh, segwit v0, and taproot.
const ONCHAIN_RX = /^(bc1|tb1|bcrt1|[13mn2])[a-zA-HJ-NP-Z0-9]{13,89}$/;

export function classifyArkDestination(raw: string): ArkDestination {
    const value = raw.trim();
    if (!value) return { kind: 'unknown', value };

    if (LN_INVOICE_PREFIX.test(value)) return { kind: 'ln-invoice', value };
    if (LN_OFFER_PREFIX.test(value)) return { kind: 'ln-offer', value };
    if (LN_ADDRESS_RX.test(value)) return { kind: 'ln-address', value };

    // validateArkAddress is a cheap bech32-ish format check — not a network
    // round-trip. Safe to call synchronously from render if needed.
    try {
        if (validateArkAddress(value)) return { kind: 'ark', value };
    } catch {
        // Swallow: SDK raised on malformed input. Fall through to onchain.
    }

    if (ONCHAIN_RX.test(value)) return { kind: 'onchain', value };

    return { kind: 'unknown', value };
}

// --- Fee estimation ---------------------------------------------------------
//
// Routes to the SDK method that matches the destination kind. Each method
// returns the same FeeEstimate shape, which we flatten to plain numbers at
// this boundary so the UI never touches bigints.

function viewFee(fe: FeeEstimate): ArkSendFeeView {
    return {
        feeSats: Number(fe.feeSats),
        grossAmountSats: Number(fe.grossAmountSats),
        netAmountSats: Number(fe.netAmountSats),
        vtxosSpent: fe.vtxosSpent,
    };
}

export async function estimateArkSendFee(
    dest: ArkDestination,
    amountSats: number,
): Promise<ArkSendFeeView> {
    const handle = requireHandle();
    const amount = BigInt(amountSats);

    switch (dest.kind) {
        case 'ln-invoice':
        case 'ln-offer':
        case 'ln-address':
            // All three Lightning methods share one estimate — the SDK's
            // routing cost model doesn't depend on which LN destination form
            // you ultimately pay.
            return viewFee(await handle.estimateLightningSendFee(amount));
        case 'ark':
            return viewFee(await handle.estimateArkoorPaymentFee(amount));
        case 'onchain':
            return viewFee(await handle.estimateSendOnchainFee(dest.value, amount));
        case 'unknown':
            throw new Error('Cannot estimate fee for an unrecognised destination');
    }
}

// --- Execution --------------------------------------------------------------
//
// Each branch returns an opaque string id:
//   - Arkoor / onchain: SDK's direct return (txid or vtxo id).
//   - Lightning: the LightningSend struct's `paymentHash` (or equivalent
//     identifier) so callers have *something* to show in a receipt.
//
// After the send resolves we refresh balance + vtxos so the home card and
// capsules tab update without needing to wait for the 30s tick.

function lightningSendId(send: LightningSend): string {
    // The LightningSend struct from Bark has a payment hash among its
    // fields; we pick whichever string identifier is present so callers
    // have a receipt handle. Keep this resilient to SDK field additions
    // — just return the most identifying string we can find.
    const anyShape = send as unknown as Record<string, unknown>;
    const candidates = ['paymentHash', 'id', 'hash', 'preimage'];
    for (const key of candidates) {
        const v = anyShape[key];
        if (typeof v === 'string' && v.length > 0) return v;
    }
    return '(lightning send — no id returned)';
}

export async function executeArkSend(
    dest: ArkDestination,
    amountSats: number,
    comment?: string,
): Promise<ArkSendResult> {
    const handle = requireHandle();
    const amount = BigInt(amountSats);

    // Pre-compute fee view so the result can carry it — useful for the
    // success screen so users see what they paid without re-estimating
    // against a now-spent VTXO set.
    const fee = await estimateArkSendFee(dest, amountSats);

    let kind: ArkDestinationKind = dest.kind;
    let id: string;

    console.log('[Ark send] executing', dest.kind, 'amount=', amountSats, 'sats');

    switch (dest.kind) {
        case 'ln-invoice':
            id = lightningSendId(await handle.payLightningInvoice(dest.value, amount));
            break;
        case 'ln-offer':
            id = lightningSendId(await handle.payLightningOffer(dest.value, amount));
            break;
        case 'ln-address':
            id = lightningSendId(
                await handle.payLightningAddress(dest.value, amount, comment),
            );
            break;
        case 'ark':
            id = await handle.sendArkoorPayment(dest.value, amount);
            break;
        case 'onchain':
            id = await handle.sendOnchain(dest.value, amount);
            break;
        case 'unknown':
            throw new Error('Cannot send to an unrecognised destination');
    }

    console.log('[Ark send]', dest.kind, 'resolved id=', id.slice(0, 16) + '…');

    // Re-read local state so the UI reflects the send before the 30s poll.
    //
    // CRITICAL: `handle.sync()` MUST run before the balance/vtxo refetch.
    // The SDK call (sendOnchain / sendArkoorPayment / payLightning*)
    // returns once the request is accepted server-side — it does NOT
    // ingest the resulting state change into the local datadir. Without
    // sync, `allVtxos()` still reports the spent VTXOs as `Locked` (the
    // UI labels these "in-flight refreshing"), the balance stays at its
    // pre-send value, and the user sees a phantom "stuck" wallet even
    // though the on-chain tx has already confirmed. Same gotcha drove
    // the wallet.sync() call in `refreshArkVtxosAndSync`.
    //
    // Failures here are non-fatal — the send itself already succeeded;
    // a flaky sync just means the user sees slightly stale data for
    // ≤30s until the periodic poll catches up.
    try {
        await handle.sync();
        await Promise.all([fetchArkBalance(), fetchArkVtxos()]);
    } catch (err) {
        console.warn('[Ark send] post-send sync/refresh failed:', err);
    }

    return {
        kind,
        id,
        netAmountSats: fee.netAmountSats,
        feeSats: fee.feeSats,
    };
}

/**
 * Human-readable label for a destination kind. Used in the confirmation
 * screen so the user knows what they're about to sign off on — "Pay
 * Lightning invoice", "Pay Ark address", etc.
 */
export function labelForDestinationKind(kind: ArkDestinationKind): string {
    switch (kind) {
        case 'ln-invoice': return 'Lightning invoice';
        case 'ln-offer': return 'Lightning offer';
        case 'ln-address': return 'Lightning address';
        case 'ark': return 'Ark address';
        case 'onchain': return 'Bitcoin on-chain address';
        case 'unknown': return 'Unknown destination';
    }
}

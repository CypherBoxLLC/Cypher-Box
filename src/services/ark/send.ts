import {
    FeeEstimate,
    LightningSendStatus,
    LightningSendStatus_Tags,
    validateArkAddress,
} from '@secondts/bark-react-native';

import { ensureArkWalletHandleReady } from './restore';
import { fetchArkBalance } from './balance';
import { fetchArkVtxos } from './vtxos';
import { recordEvent } from '@Cypher/stores/eventLogStore';

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

// Wait for the wallet handle instead of throwing "not open" the instant it's
// null. At boot the open lags a user pasting an invoice / tapping send, and
// the old hard throw failed the estimate/send until the user retried (the
// recurring "ark wallet not open" the receive path already fixed).
// ensureArkWalletHandleReady awaits the in-flight open — reusing the cached
// seed, so no FaceID — and only throws a friendly message on timeout.
async function requireHandle() {
    return ensureArkWalletHandleReady();
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
    const handle = await requireHandle();
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
//   - onchain: SDK's direct return (txid). Arkoor returns void in 0.11.3, so
//     its id is left empty (no caller reads it).
//   - Lightning: the `paymentHash` from a Paid LightningSendStatus, else the
//     resolved bolt11, so callers have *something* to show in a receipt.
//
// After the send resolves we refresh balance + vtxos so the home card and
// capsules tab update without needing to wait for the 30s tick.

/**
 * Wait for an Ark Lightning send to reach a terminal state.
 *
 * `payLightning*` (called with wait=false) returns once the HTLC is DISPATCHED,
 * not once it settles, so a non-`Paid` LightningSendStatus is not proof of
 * payment. We poll the local movement history for the `send` movement matching
 * this invoice and report its outcome so callers never declare a false success:
 *   - 'settled' — movement status `successful`
 *   - 'failed'  — movement status `failed` / `canceled` (the HTLC was refunded)
 *   - 'pending' — still pending when the timeout elapsed (do NOT claim success)
 *
 * Matching is by the resolved bolt11 appearing in the movement's
 * `sentToAddresses` (the SDK stores it as `{"type":"invoice","value":"<bolt11>"}`).
 * The background sync loop + notification watcher advance the movement's status
 * in the local DB while we await between polls.
 */
async function waitForArkLightningSettlement(
    handle: Awaited<ReturnType<typeof requireHandle>>,
    invoice: string,
    opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<'settled' | 'failed' | 'pending'> {
    const timeoutMs = opts.timeoutMs ?? 75_000;
    const pollMs = opts.pollMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            const movements = await handle.history();
            const m = movements
                .filter(
                    (mv) =>
                        String(mv.subsystemKind).toLowerCase() === 'send' &&
                        !!invoice &&
                        mv.sentToAddresses.some(
                            (a) => typeof a === 'string' && a.includes(invoice),
                        ),
                )
                .sort((a, b) => b.id - a.id)[0];
            if (m) {
                const st = String(m.status).toLowerCase();
                if (__DEV__) console.log('[Ark send] settlement poll: movement', m.id, 'status=', st);
                if (st === 'successful') return 'settled';
                if (st === 'failed' || st === 'canceled') return 'failed';
            }
        } catch (err) {
            if (__DEV__) console.warn('[Ark send] settlement poll error (continuing):', err);
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    if (__DEV__) console.log('[Ark send] settlement wait timed out — reporting pending');
    return 'pending';
}

/**
 * Dispatch the correct payLightning* call for an LN destination kind. Extracted
 * so the dispatch + settlement-wait can run inside a retry loop.
 */
async function dispatchLnSend(
    handle: Awaited<ReturnType<typeof requireHandle>>,
    dest: ArkDestination,
    amount: bigint,
    comment?: string,
): Promise<LightningSendStatus> {
    // 0.11.3 crash-safe send model: pay_lightning_* now take a `wait` flag and
    // return a LightningSendStatus (Unknown | InProgress{send} | Paid{...}).
    // We initiate with wait=false (dispatch-and-return, matching the old
    // return-at-dispatch contract the retry/settlement loop below was built
    // around) and confirm settlement ourselves via the movement-history poll.
    switch (dest.kind) {
        case 'ln-invoice':
            return handle.payLightningInvoice(dest.value, amount, false);
        case 'ln-offer':
            return handle.payLightningOffer(dest.value, amount, false);
        case 'ln-address':
            return handle.payLightningAddress(dest.value, amount, comment, false);
        default:
            throw new Error('dispatchLnSend called with a non-Lightning destination');
    }
}

/**
 * Max attempts for an Ark->Lightning send. The ASP's route to the destination
 * settles intermittently; a failed HTLC is fully refunded, so re-attempting is
 * safe. ~50% per-attempt failure -> ~94% success over 4 attempts.
 */
const MAX_LN_SEND_ATTEMPTS = 4;

export async function executeArkSend(
    dest: ArkDestination,
    amountSats: number,
    comment?: string,
): Promise<ArkSendResult> {
    const handle = await requireHandle();
    const amount = BigInt(amountSats);

    // NOTE: a pre-send `handle.maintenance()` used to run here to reconcile
    // ASP-"unregistered" VTXOs before coin-selection. Removed 2026-07-09: on a
    // wallet wedged on stuck rounds, maintenance() takes the wallet lock and
    // blocks for minutes (it froze a live Bark->CoinOS swap mid-send, and no
    // payment could proceed behind it), and it did not reliably clear the
    // unregistered-change it was meant to fix. We accept the small risk that
    // coin-selection picks an unregistered VTXO (the send then fails fast and
    // safe) rather than let a blocking reconcile stall every send. If
    // unregistered-VTXO send failures resurface, fix them without a blocking
    // pre-send call.

    // Pre-compute fee view so the result can carry it — useful for the
    // success screen so users see what they paid without re-estimating
    // against a now-spent VTXO set.
    const fee = await estimateArkSendFee(dest, amountSats);

    let kind: ArkDestinationKind = dest.kind;
    let id!: string;

    console.log('[Ark send] executing', dest.kind, 'amount=', amountSats, 'sats');

    const isLn =
        dest.kind === 'ln-invoice' ||
        dest.kind === 'ln-offer' ||
        dest.kind === 'ln-address';

    if (isLn) {
        // --- LN send with settlement-confirmed retry ------------------------
        //
        // Two facts drive this loop:
        //  1. payLightning*(wait=false) returns at DISPATCH, not settlement. It
        //     yields a `Paid` LightningSendStatus (with preimage) only once
        //     settled; a non-Paid status is NOT proof of payment (it may still
        //     fail and refund). We always wait for the movement to reach a
        //     terminal state rather than trusting the call returning.
        //  2. The ASP's route to the destination settles INTERMITTENTLY
        //     (confirmed: two identical 500-sat sends 12s apart, one settled and
        //     one failed; a 7,890-sat send succeeded while a 53k one failed). A
        //     FAILED HTLC is fully refunded, so re-attempting is safe and turns
        //     ~50% per-attempt into ~90%+ over a few tries.
        //
        // We retry ONLY on a confirmed `failed` (refunded, so safe). We never
        // retry on `pending` (it might still settle, a double-pay risk); that
        // throws so the user checks Activity instead of being silently re-sent.
        let settled = false;
        for (let attempt = 1; attempt <= MAX_LN_SEND_ATTEMPTS; attempt++) {
            const status = await dispatchLnSend(handle, dest, amount, comment);

            // Fast path: bark settled at dispatch and handed us the preimage.
            if (status.tag === LightningSendStatus_Tags.Paid) {
                id = status.inner.paymentHash;
                if (__DEV__) console.log('[Ark send] LN attempt', attempt, 'Paid at dispatch (preimage in hand)');
                settled = true;
                break;
            }

            // InProgress carries the resolved bolt11 (for offer/address kinds
            // this is the only place we learn it); Unknown carries nothing, so
            // fall back to the raw destination for the settlement match. (Offer/
            // address + Unknown will not match the movement poll and so fail
            // safe to 'pending' rather than a false success.)
            const resolvedInvoice =
                status.tag === LightningSendStatus_Tags.InProgress
                    ? status.inner.send.invoice
                    : dest.value;
            // Receipt handle until we have a preimage: the invoice we paid.
            id = resolvedInvoice;
            if (__DEV__) {
                console.log(
                    '[Ark send] LN attempt', attempt, 'of', MAX_LN_SEND_ATTEMPTS,
                    'status=', status.tag,
                    status.tag === LightningSendStatus_Tags.InProgress
                        ? `htlcVtxoCount=${status.inner.send.htlcVtxoCount}`
                        : '',
                );
            }

            const outcome = await waitForArkLightningSettlement(handle, resolvedInvoice);
            if (outcome === 'settled') { settled = true; break; }
            if (outcome === 'pending') {
                throw new Error(
                    'Lightning payment is still confirming. Check Activity before retrying so you do not send twice.',
                );
            }
            // outcome === 'failed' -> HTLC refunded, funds back. Retry if attempts remain.
            console.log(
                '[Ark send] LN attempt', attempt, 'failed and refunded;',
                attempt < MAX_LN_SEND_ATTEMPTS ? 'retrying' : 'no attempts left',
            );
        }
        if (!settled) {
            throw new Error(
                'Lightning payment failed after several attempts and was refunded. Your Ark funds are safe, nothing was sent.',
            );
        }
    } else {
        switch (dest.kind) {
            case 'ark':
                // 0.11.3 sendArkoorPayment returns void (no vtxo/tx id
                // surfaced). No caller reads the id for ark-to-ark sends, so
                // leave it empty.
                await handle.sendArkoorPayment(dest.value, amount);
                id = '';
                break;
            case 'onchain':
                id = await handle.sendOnchain(dest.value, amount);
                break;
            case 'unknown':
            default:
                throw new Error('Cannot send to an unrecognised destination');
        }
    }

    console.log('[Ark send]', dest.kind, 'resolved id=', id.slice(0, 16) + '…');

    // Slow-broadcast hint for `onchain` direction. The ASP sets the round's
    // on-chain fee rate at construction; empirically it picks at-or-below
    // mempool's economyFee floor to maximise its margin (the user paid Y
    // sats but only ~45% of that hit miners; rest is server margin). This
    // routinely lands withdrawals at ~2 sat/vb, meaning hours of mempool
    // wait. Fire off a non-blocking mempool fee-rate fetch + warn-log if
    // the resulting tx is well below current `fastestFee`. Pre-broadcast
    // disclosure already exists on ArkWithdrawReviewScreen; this log is
    // the breadcrumb a downstream auto-CPFP-prompt feature would key on.
    //
    // Fire-and-forget so we don't add latency to the send return path.
    // 2-second budget on the mempool fetch; bail silently on error or
    // timeout. Only runs for 'onchain' direction since LN sends route off
    // chain and the rate concept doesn't apply.
    if (dest.kind === 'onchain') {
        const onchainTxid = id;
        void (async () => {
            try {
                const controller = new AbortController();
                const t = setTimeout(() => controller.abort(), 2000);
                const [txRes, feeRes] = await Promise.all([
                    fetch(`https://mempool.space/api/tx/${onchainTxid}`, { signal: controller.signal }),
                    fetch('https://mempool.space/api/v1/fees/recommended', { signal: controller.signal }),
                ]);
                clearTimeout(t);
                if (!txRes.ok || !feeRes.ok) return;
                const tx = await txRes.json();
                const feeRecs = await feeRes.json();
                const vsize = (tx?.weight ?? 0) / 4;
                const fee = tx?.fee ?? 0;
                if (!vsize || !fee) return;
                const broadcastRate = fee / vsize;
                const fastest = Number(feeRecs?.fastestFee ?? 1);
                if (broadcastRate < fastest / 2) {
                    console.warn(
                        '[Ark send] onchain broadcast at ' + broadcastRate.toFixed(1) +
                        ' sat/vb (current fastestFee=' + fastest + ' sat/vb). ' +
                        'Tx ' + onchainTxid.slice(0, 12) + '… may take hours to confirm. ' +
                        'User can speed up via CPFP on the receiving wallet (see Hot Vault → tap pending → "Accelerate transaction").',
                    );
                }
            } catch {
                /* swallow — best-effort breadcrumb only */
            }
        })();
    }

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

    // Activity log: only Lightning kinds map to the wallet-cross-cutting
    // "ln-sent" event in the Activity feed. Ark-to-ark and on-chain Ark
    // sends are out of scope for the v1 event-log schema.
    if (dest.kind === 'ln-invoice' || dest.kind === 'ln-offer' || dest.kind === 'ln-address') {
        recordEvent({ kind: 'ln-sent', wallet: 'ark', sats: amountSats });
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

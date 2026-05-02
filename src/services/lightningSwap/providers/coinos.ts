/**
 * Coinos lightning swap provider.
 *
 * Wraps the existing Coinos REST helpers in src/api/coinOSApis. Nothing
 * here is Coinos-specific to the swap layer — it's all the same calls
 * the rest of the app makes for receive/send. We isolate them behind
 * the LightningSwapProvider interface so the engine can compose them
 * with Strike/Ark without an if/else.
 */

import { CoinOS } from '@Cypher/assets/images';
import {
    createInvoice as coinosCreateInvoice,
    sendLightningPayment as coinosSendLightning,
} from '@Cypher/api/coinOSApis';
import useAuthStore from '@Cypher/stores/authStore';

import type {
    LightningSwapProvider,
    LightningSwapResult,
} from '../types';
import { register } from '../registry';

/**
 * Parse Coinos's `sendLightningPayment` response. The helper returns raw
 * text from the API that may or may not be JSON — successful payments
 * come back as a JSON object with `id`/`confirmed`/`hash`, failures as
 * a string error or a JSON object with `message`. We accept both shapes
 * and surface a string id for the receipt.
 */
function parsePayResponse(raw: unknown): { ok: boolean; id?: string; message?: string } {
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return parsePayResponse(parsed);
        } catch {
            return { ok: false, message: raw };
        }
    }
    if (raw && typeof raw === 'object') {
        const r = raw as Record<string, any>;
        if (r.confirmed || r.id || r.hash) {
            return { ok: true, id: String(r.id ?? r.hash ?? '(no id)') };
        }
        return { ok: false, message: r.message ?? 'Coinos payment failed' };
    }
    return { ok: false, message: 'Coinos payment failed' };
}

const coinosProvider: LightningSwapProvider = {
    id: 'coinos',
    displayName: 'Coinos',
    icon: CoinOS,

    isAvailable() {
        // `isAuth` is the historical Coinos-auth flag in this codebase
        // (predates Strike/Ark). Reading it via `getState()` rather than
        // a hook so the provider stays a plain object usable from
        // anywhere — including outside React.
        return Boolean(useAuthStore.getState().isAuth);
    },

    async createInvoice(amountSats, memo) {
        const response = await coinosCreateInvoice({
            amount: amountSats,
            type: 'lightning',
            // Coinos uses the optional `memo` as the invoice description
            // shown in their dashboard / paid-from history.
            ...(memo ? { memo } : {}),
        });
        const bolt11 = response?.hash;
        if (!bolt11 || typeof bolt11 !== 'string') {
            throw new Error(
                response?.message
                    ? `Coinos invoice error: ${response.message}`
                    : 'Coinos returned no invoice',
            );
        }
        return bolt11;
    },

    async payInvoice(bolt11, amountSats, memo): Promise<LightningSwapResult> {
        // Coinos's helper accepts an optional explicit `amount` for
        // amount-less invoices. We pass `amountSats` defensively even
        // when the bolt11 already encodes the amount — the API ignores
        // the override in that case.
        const raw = await coinosSendLightning(bolt11, memo ?? '', amountSats);
        const parsed = parsePayResponse(raw);
        if (!parsed.ok) {
            // Coinos returns the literal string `"Insufficient funds ⚡️X / Y"`
            // where X is the user's balance and Y is the required total
            // (amount + routing fee). The fee can't be quoted ahead of
            // time on Coinos, so this is the first chance we have to
            // tell the user how much they're short.
            //
            // We parse the X/Y pair and rewrite the message so the
            // toast shows a helpful suggestion ("Try swapping ${X-fee}
            // sats") instead of an opaque error.
            const insufficientMatch = parsed.message?.match(/(\d+)\s*\/\s*(\d+)/);
            if (parsed.message?.includes('Insufficient') && insufficientMatch) {
                const balance = Number(insufficientMatch[1]);
                const required = Number(insufficientMatch[2]);
                const fee = Math.max(0, required - amountSats);
                const safeMax = Math.max(0, balance - fee);
                throw new Error(
                    `Coinos balance is short by ${required - balance} sats ` +
                    `(needs ${amountSats} + ${fee} routing fee = ${required}, you have ${balance}). ` +
                    `Try swapping ${safeMax} sats.`,
                );
            }
            throw new Error(parsed.message ?? 'Coinos payment failed');
        }
        return {
            id: parsed.id ?? '(coinos payment)',
            // Coinos doesn't currently surface the routing fee in its
            // payment response in a structured field — leaving feeSats
            // off so the success view shows it as "—" rather than "0".
        };
    },

    // No estimateFee() — Coinos has no quote endpoint, so we can't show
    // the user a real number under the amount input. The UI will hide
    // the fee row entirely for Coinos sources, which is more honest
    // than rendering a defensive buffer as if it were a quote.

    /**
     * Max-button headroom only. Empirically Coinos charges ~0.5% routing
     * fee on outbound LN sends (94 sats on 18705 was the failing case
     * we calibrated against). We reserve 0.6% with a 2-sat floor —
     * just enough margin that "tap Max → tap Swap" succeeds, without
     * stranding meaningful sats. The actual fee Coinos deducts is
     * always less than this reserve in normal conditions; if a swap
     * does land on "Insufficient funds" anyway, the rewritten error in
     * `payInvoice` above tells the user exactly how many sats to retry
     * with.
     *
     * 0.6% × 1 sat-per-vbyte routing math:
     *   amount   reserve   typical actual fee
     *      100        2     1
     *    1,000        6     3-5
     *   10,000       60    30-50
     *  100,000      600   300-500
     */
    async maxFeeReserve(amountSats) {
        return Math.max(2, Math.ceil(amountSats * 0.006));
    },
};

register(coinosProvider);
export default coinosProvider;

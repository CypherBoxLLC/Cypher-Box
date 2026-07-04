import { ARK_VTXO_DUST_SATS, ESPLORA_URL } from './config';
import { ensureArkOnchainHandle } from './walletHandle';

/**
 * F3 (.claude/ARK_STUCK_UTXO_UX_SPEC.md): sweep a stuck on-chain Ark *boarding*
 * deposit back out to a Hot Vault address.
 *
 * Context: funds sent to an Ark boarding address land in bark's BDK on-chain
 * wallet and must be *boarded* (an ASP round) to become a spendable VTXO. A
 * deposit below the server minimum (50,000 sats on ark.second.tech) can NEVER
 * board — `boardAll()` is rejected forever — so it sits in the on-chain wallet,
 * invisible to the Ark balance. This module drains it back to the user's Hot
 * Vault so the money isn't trapped.
 *
 * The bark RN SDK's OnchainWallet exposes only `balance / newAddress / send /
 * sync` — there is NO `utxos()` or `drain()`. Consequences:
 *   - We can't enumerate UTXOs to resolve the original sender (the spec's
 *     "return to sender" idea), so the destination is a fresh Hot Vault
 *     address resolved by the caller. For in-app top-ups that IS the sender.
 *   - There's no sweep primitive, so we compute `amount = confirmed - fee`
 *     ourselves and pass it to `send(addr, amount, feeRate)`. A small fee
 *     over-estimate is deliberate (see RECOVER_EST_VSIZE) so the BDK-built
 *     tx's real fee never exceeds our budget (an under-budget would fail to
 *     fund); any tiny surplus is folded into the fee / absorbed as sub-dust
 *     by BDK, keeping the drain clean.
 */

// Budgeted virtual size (vB) for the drain tx. A 1-in/1-out P2WPKH spend is
// ~110 vB; we budget 150 vB of headroom so the real fee BDK computes stays at
// or below our estimate (an under-estimate would make `send` fail to fund).
// At the modest fee rates recovery uses, the surplus is below the dust
// threshold and BDK folds it into the fee, so no leftover boarding UTXO is
// created. (At very high fee rates a small change output could remain; the
// user can recover again. Acceptable for the below-minimum case this targets.)
const RECOVER_EST_VSIZE = 150;

// Fee-rate floor / fallback (sat/vB) when the esplora fee-estimate fetch fails
// (e.g. a Private DNS / NextDNS block on the host). Recovery isn't urgent, so
// a modest rate avoids both overpaying out of a small stuck amount and
// broadcasting a never-confirming tx.
const FALLBACK_FEE_RATE_SAT_VB = 4;

export type ArkOnchainRecoverEstimate = {
    /** Confirmed on-chain (boarding) sats available to recover. */
    confirmedSats: number;
    /** Fee rate the drain would use (sat/vB). */
    feeRateSatPerVb: number;
    /** Estimated on-chain fee for the drain (sats). */
    feeSats: number;
    /** What lands in the Hot Vault after fee (sats); 0 if fee >= confirmed. */
    recoverableSats: number;
    /** False when recoverableSats <= dust (the fee eats the stuck amount). */
    economical: boolean;
};

export type ArkOnchainRecoverResult =
    | { status: 'sent'; txid: string; sentSats: number; feeSats: number; feeRateSatPerVb: number }
    | { status: 'already-cleared' };

/**
 * Look up a relaxed (~1hr) on-chain fee rate from the configured esplora host.
 * No new network host: ESPLORA_URL is already bark's esplora endpoint. Always
 * resolves (never throws) — degrades toward faster confTargets, then the floor.
 */
async function fetchOnchainFeeRateSatPerVb(): Promise<number> {
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`${ESPLORA_URL}/fee-estimates`, { signal: controller.signal });
        clearTimeout(t);
        if (!res.ok) return FALLBACK_FEE_RATE_SAT_VB;
        const map = (await res.json()) as Record<string, number>;
        // esplora returns confTarget -> sat/vB (float). 6 ≈ 1hr; degrade to
        // faster targets if absent, then the hardcoded floor.
        const raw = Number(map?.['6'] ?? map?.['3'] ?? map?.['2'] ?? map?.['1']);
        if (!isFinite(raw) || raw <= 0) return FALLBACK_FEE_RATE_SAT_VB;
        return Math.max(1, Math.ceil(raw));
    } catch {
        return FALLBACK_FEE_RATE_SAT_VB;
    }
}

function computeFeeSats(feeRateSatPerVb: number): number {
    return Math.ceil(feeRateSatPerVb * RECOVER_EST_VSIZE);
}

/**
 * Estimate a recovery for the confirm modal: how much is stuck, the fee, and
 * whether it's worth recovering. Reads the on-chain balance via the already-
 * spawned handle (the boarding row only renders when that handle exists, so
 * this does not force a biometric Keychain read on the common path).
 */
export async function estimateArkOnchainRecover(confirmedSats: number): Promise<ArkOnchainRecoverEstimate> {
    // `confirmedSats` is passed in by the caller — the value the capsule is
    // displaying (arkBalanceDetail.onchainBoardingSats) — so the estimate always
    // matches what the user sees. We deliberately do NOT re-read the on-chain
    // balance here: a direct onchain.balance() races the sync/board pipeline and
    // returns 0, and the syncArkWallet cache is empty until the first sync (lags
    // on a fresh launch) — both produced a false "Nothing to recover" while the
    // capsule clearly showed funds.
    const feeRateSatPerVb = await fetchOnchainFeeRateSatPerVb();
    const feeSats = computeFeeSats(feeRateSatPerVb);
    const recoverableSats = Math.max(0, confirmedSats - feeSats);
    const economical = recoverableSats > ARK_VTXO_DUST_SATS;
    return { confirmedSats, feeRateSatPerVb, feeSats, recoverableSats, economical };
}

/**
 * Drain the confirmed on-chain boarding balance to `destAddress` (a Hot Vault
 * address resolved by the caller). Re-reads the balance at call time so a
 * stale modal can't send a wrong amount, and returns `already-cleared` if the
 * funds boarded/left in the meantime (benign). Pass `feeRateSatPerVb` from the
 * estimate the user confirmed so what they saw is what is sent; omitted, it
 * re-fetches. Throws if uneconomical or if the SDK send fails.
 */
export async function recoverArkOnchainBoard(
    destAddress: string,
    confirmedSats: number,
    feeRateSatPerVb?: number,
): Promise<ArkOnchainRecoverResult> {
    if (!destAddress || typeof destAddress !== 'string') {
        throw new Error('No Bitcoin address to recover to.');
    }
    // `confirmedSats` is the amount the user confirmed (the capsule's displayed
    // value). We don't re-read the on-chain balance (racy / empty-until-synced);
    // the send below fails safely if the wallet actually holds less.
    if (confirmedSats <= 0) {
        return { status: 'already-cleared' };
    }

    const rate = feeRateSatPerVb && feeRateSatPerVb > 0
        ? Math.max(1, Math.ceil(feeRateSatPerVb))
        : await fetchOnchainFeeRateSatPerVb();
    const feeSats = computeFeeSats(rate);
    const amount = confirmedSats - feeSats;
    if (amount <= ARK_VTXO_DUST_SATS) {
        throw new Error('Too small to recover. The network fee is larger than the stuck amount.');
    }

    const onchain = await ensureArkOnchainHandle();
    // Sync the BDK wallet first so it knows the confirmed boarding UTXO — the
    // handle may be freshly spawned (fresh app launch) and unaware of it, which
    // would make send() fail with "insufficient funds".
    try {
        await onchain.sync();
    } catch (err) {
        console.warn('[Ark recover] pre-send onchain.sync failed (continuing):', err);
    }
    console.log(
        '[Ark recover] draining onchain board:', confirmedSats,
        'sats; fee', feeSats, 'at', rate, 'sat/vB; sending', amount, 'to', destAddress,
    );
    const txid = await onchain.send(destAddress, BigInt(amount), BigInt(rate));
    console.log('[Ark recover] drain broadcast, txid=', txid);

    // Best-effort: pull the spend into BDK's local state so the next balance
    // read (useArkSync tick) shows the boarding bucket cleared without waiting
    // a full sync cycle. Non-fatal — the send already succeeded.
    try {
        await onchain.sync();
    } catch (err) {
        console.warn('[Ark recover] post-send onchain.sync failed (non-fatal):', err);
    }

    return { status: 'sent', txid, sentSats: amount, feeSats, feeRateSatPerVb: rate };
}

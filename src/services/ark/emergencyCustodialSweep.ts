import { Platform } from 'react-native';
import PushNotification from 'react-native-push-notification';

import { fetchChainTipHeight } from './chainTip';
import { ARK_VTXO_DUST_SATS } from './config';
import { fetchArkPendingRoundStates } from './refresh';
import { fetchArkVtxos, type ArkVtxoView } from './vtxos';
import { estimateArkSendFee } from './send';
import { getArkWalletHandle } from './walletHandle';
import {
    getLightningSwapProvider,
    swap,
    InvoiceCreationFailedError,
    PaymentFailedError,
    type LightningSwapProviderId,
} from '@Cypher/services/lightningSwap';

/**
 * Emergency custodial sweep — last-resort safety net before VTXO expiry.
 *
 * Feature spec B per .claude/OPEN_BUGS.md. When a VTXO is < 72 blocks
 * (~12h) from expiry and refresh has not extended its lifetime (for any
 * reason: ASP outage, repeated rate-limit hits, deterministic SDK bug,
 * etc.), forwarding the funds to a custodial Lightning balance avoids
 * the on-chain unilateral-exit cost that would otherwise be the user's
 * only recourse.
 *
 * Mechanism: Strike (preferred) or CoinOS creates a BOLT11 invoice for
 * the imminent-vtxo total minus a small fee budget; the Ark wallet pays
 * it via the existing `payLightningInvoice` send path. The Bark SDK
 * selects which VTXOs to spend internally — we cannot pin selection to
 * the imminent ones, so this works best when the imminent VTXOs are the
 * shortest-expiry inputs in the wallet (Bark's selection tends to drain
 * those first). For small mainnet wallets (5–50k sats) the imminent
 * VTXOs are usually the only spendable ones, making this a non-issue.
 *
 * Idempotency: a process-local rate-limit prevents back-to-back sweeps
 * if the orchestrator re-enters between the LN payment landing and the
 * VTXO state catching up. Anchored on Date.now() of the last attempt,
 * not on VTXO id — even a failed attempt cools down the trigger so a
 * deterministic invoice-creation failure doesn't spam.
 */

// ---------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------

/**
 * Block distance from expiry at which the sweep fires. 72 blocks ≈ 12h
 * on mainnet (10-min avg) — well past the point where refresh would
 * normally have run, but with enough buffer that LN routing failure
 * leaves time for the user to act manually before the actual expiry.
 *
 * Lower (36 / ~6h) is more aggressive: catches more last-minute saves
 * but also fires on transient ASP outages that would have self-resolved.
 * Higher (144 / ~24h) is more defensive: leaves more buffer but burns
 * custodial inbound liquidity on healthier VTXOs.
 *
 * To temporarily trigger the sweep on a current vtxo for live testing:
 * set this to a high value (e.g. 1000) and observe `[Ark sweep]` logs;
 * verify funds arrive in the custodial balance; then revert before
 * committing.
 */
export const CUSTODIAL_SWEEP_THRESHOLD = 72;

/**
 * LN routing fee reserve, subtracted off the gross before sweeping so the
 * Ark `payLightningInvoice` doesn't fail with "not enough balance" (amount
 * + fee > spendable).
 *
 * History: this was a flat 50-sat-per-VTXO budget. That was wrong on two
 * counts, surfaced by a live mainnet test 2026-06-01: (1) the routing fee
 * is charged ONCE per LN payment, not per VTXO; (2) real mainnet fees run
 * ~0.5% of the amount — 276 sats on a 55k sweep — far above any flat
 * 50/VTXO budget. Under-reserving made the pay step fail outright.
 *
 * We now estimate the actual fee via `estimateArkSendFee` and reserve it
 * plus a small margin. If the estimate call fails we fall back to a
 * percentage reserve with a floor.
 */
const LN_FEE_SAFETY_MARGIN = 10;      // sats added on top of the estimate
const LN_FEE_FALLBACK_PCT = 0.01;     // 1% reserve if estimate unavailable
const LN_FEE_FALLBACK_FLOOR = 50;     // never reserve less than this

/**
 * Minimum interval between sweep attempts (ms). Anchored to last attempt
 * regardless of outcome — even a failed Strike + failed CoinOS pass
 * cools down for this window before re-triggering. Prevents tight loops
 * if every wake re-enters the sweep path on the same imminent VTXOs.
 *
 * 5 minutes is short enough to retry within an oncoming-expiry window
 * (a 72-block threshold leaves ~144 attempts before the actual expiry)
 * and long enough to avoid hammering custodial APIs on transient errors.
 */
const SWEEP_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Custodian priority. Strike first because its API is faster and more
 * predictable under load; CoinOS as fallback.
 */
const CUSTODIAN_PRIORITY: readonly LightningSwapProviderId[] = ['strike', 'coinos'] as const;

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------

/** Module-scoped attempt timestamp. Process-local — survives JS hot reload via the closure. */
let lastSweepAttemptAt: number | null = null;

/** Re-entrancy guard. The sweep is async with side effects on shared state; prevent overlap. */
let sweepInFlight = false;

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type EmergencySweepOutcome =
    | 'no_handle'
    | 'no_imminent_vtxos'
    | 'pending_round_conflict'
    | 'rate_limited'
    | 'no_custodian'
    | 'all_custodians_failed'
    | 'success'
    | 'reentry_blocked';

export type EmergencySweepResult = {
    outcome: EmergencySweepOutcome;
    /** Custodian that received the funds on success, null otherwise. */
    custodian?: LightningSwapProviderId | null;
    /** Sum sweep amount (post fee-budget deduction) in sats, when applicable. */
    sweptSats?: number;
    /** Number of imminent VTXOs detected at trigger time. */
    imminentCount?: number;
    /** Ids of imminent VTXOs (truncated to 12 chars each for logs). */
    imminentIdPrefixes?: string[];
    /** Per-custodian failure reasons collected during fall-through. */
    failures?: Array<{ custodian: LightningSwapProviderId; stage: 'invoice' | 'payment' | 'unavailable'; message: string }>;
};

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function pickImminentVtxos(spendable: ArkVtxoView[], chainTip: number): ArkVtxoView[] {
    const imminent: ArkVtxoView[] = [];
    for (const v of spendable) {
        if (v.expiryHeight === 0) continue; // arkoor with unknown TTL — handled by separate notif path
        const blocksLeft = v.expiryHeight - chainTip;
        if (blocksLeft >= 0 && blocksLeft < CUSTODIAL_SWEEP_THRESHOLD) {
            imminent.push(v);
        }
    }
    return imminent;
}

/**
 * Push notification used for "no custodian connected" and
 * "all-paths-fail" branches. Mirrors the channel/options shape of
 * `backgroundNotifications.fire()` so notifications land in the same
 * channel and use the same userInfo prefix.
 */
function pushSweepAlert(title: string, message: string): void {
    try {
        if (Platform.OS === 'android') {
            PushNotification.createChannel(
                {
                    channelId: 'ark-bg-refresh',
                    channelName: 'Bark capsule refresh',
                    channelDescription:
                        'Alerts about Bark capsule auto-refresh outcomes (failures, expiring capsules, unusual fees).',
                    importance: 4,
                    vibrate: true,
                },
                () => {},
            );
        }
        PushNotification.localNotification({
            channelId: 'ark-bg-refresh',
            title,
            message,
            priority: 'high',
            importance: 'high',
            userInfo: { source: 'ark-bg-refresh', kind: 'emergency-sweep' },
            playSound: true,
            soundName: 'default',
        });
    } catch (err) {
        // Notification failure must not break the sweep flow.
        console.warn('[Ark sweep] push notification threw:', err);
    }
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------

/**
 * Run one emergency-sweep attempt. Idempotent, never throws.
 *
 * Designed to be called AFTER `runBackgroundRefresh` resolves on every
 * scheduled / push wake. Refresh wins when it can; the sweep only fires
 * if refresh did not extend the imminent VTXOs' lifetimes for whatever
 * reason.
 *
 * Trigger condition: any spendable VTXO with `expiry - tip <
 * CUSTODIAL_SWEEP_THRESHOLD`. The trigger does NOT consider refresh
 * attempt history — if a VTXO is that close to expiry, refresh has
 * either failed or not yet caught up; either way the sweep is the
 * safety net.
 *
 * Deferral: if a pending round is in flight, defer to next tick so
 * the in-progress refresh can resolve first. Without this, two
 * concurrent fund movements compete for VTXO selection and the LN
 * sweep can fail with `vtxo already locked` from the SDK.
 */
export async function runEmergencyCustodialSweep(
    trigger: 'scheduled' | 'push' | 'foreground' | 'manual-test' = 'scheduled',
): Promise<EmergencySweepResult> {
    if (sweepInFlight) {
        console.log('[Ark sweep] re-entry blocked — previous attempt still in flight');
        return { outcome: 'reentry_blocked' };
    }
    sweepInFlight = true;

    try {
        const handle = getArkWalletHandle();
        if (!handle) {
            return { outcome: 'no_handle' };
        }

        // Rate-limit anchor on last-attempt. Even failures cool down so a
        // deterministic custodian error doesn't loop.
        if (
            lastSweepAttemptAt !== null &&
            Date.now() - lastSweepAttemptAt < SWEEP_COOLDOWN_MS
        ) {
            const ageMs = Date.now() - lastSweepAttemptAt;
            console.log(
                '[Ark sweep] rate-limited — last attempt was',
                Math.round(ageMs / 1000),
                's ago (cooldown',
                Math.round(SWEEP_COOLDOWN_MS / 1000),
                's)',
            );
            return { outcome: 'rate_limited' };
        }

        // Defer to in-flight refresh round. The refresh path also locks
        // the VTXOs we'd want to sweep; running concurrently produces
        // `vtxo already locked` SDK errors that consume the fee budget
        // for nothing.
        try {
            const pending = await fetchArkPendingRoundStates();
            if (pending.some((r) => r.ongoing)) {
                console.log('[Ark sweep] deferring — round in flight');
                return { outcome: 'pending_round_conflict' };
            }
        } catch (err) {
            // Probe failure isn't fatal — the LN-pay path will surface
            // any real conflict via its own error. Log and continue.
            console.warn('[Ark sweep] pendingRoundStates probe failed:', err);
        }

        // Read tip + vtxos for the imminent scan. Both calls are cheap;
        // doing them after the rate-limit check avoids burning quota on
        // the cooldown path.
        const [tip, vtxos] = await Promise.all([
            fetchChainTipHeight(),
            fetchArkVtxos(),
        ]);
        if (tip === null) {
            console.warn('[Ark sweep] tip fetch failed — skipping');
            return { outcome: 'no_imminent_vtxos' };
        }
        if (!vtxos) {
            return { outcome: 'no_handle' };
        }

        const imminent = pickImminentVtxos(vtxos.spendable, tip);
        if (imminent.length === 0) {
            return { outcome: 'no_imminent_vtxos' };
        }

        // Sweep amount: gross sum minus the real LN routing fee. The Bark
        // SDK's `payLightningInvoice` decides actual VTXO selection
        // internally; the amount we ask for is what determines whether
        // the imminent ones get spent (small enough → SDK picks them;
        // larger than imminent total → SDK pulls in fresher VTXOs as
        // well, leaving imminent ones unspent). We bias toward the
        // first behaviour by sizing to imminent total minus the fee.
        //
        // CRITICAL: the fee must be reserved or `payLightningInvoice`
        // fails with "not enough balance" (amount + routing fee >
        // spendable). Estimate the actual fee for the gross amount rather
        // than guessing a flat budget — see the LN_FEE_* constants above
        // for why a flat per-VTXO budget was wrong.
        const grossSats = imminent.reduce((a, v) => a + v.sats, 0);
        const idPrefixes = imminent.map((v) => v.id.slice(0, 12));

        let feeReserve = Math.max(
            LN_FEE_FALLBACK_FLOOR,
            Math.ceil(grossSats * LN_FEE_FALLBACK_PCT),
        );
        try {
            const feeView = await estimateArkSendFee(
                { kind: 'ln-invoice', value: '' },
                grossSats,
            );
            const estFee = Number(feeView.feeSats || 0);
            if (estFee > 0) feeReserve = estFee + LN_FEE_SAFETY_MARGIN;
        } catch (err) {
            console.warn(
                '[Ark sweep] LN fee estimate failed, using fallback reserve',
                feeReserve, ':', err,
            );
        }
        // Also reserve one dust limit so the LN send's CHANGE output isn't
        // sub-dust. Bark rejects a sub-dust change VTXO with
        // BarkError.Internal (observed live 2026-06-01: a 55211/55498 sweep
        // left 11 sats change and failed). Reserving fee + dust guarantees
        // the change is >= dust (a fresh-expiry VTXO, so not at risk) and
        // the send goes through. We strand ~fee+dust (~600 sats) of a 55k
        // sweep — acceptable for a safety net that rescues the other 99%.
        const sweepSats = grossSats - feeReserve - ARK_VTXO_DUST_SATS;

        if (sweepSats <= 0) {
            console.warn(
                '[Ark sweep] imminent gross below fee + dust reserve — skipping',
                'gross=', grossSats, 'reserve=', feeReserve + ARK_VTXO_DUST_SATS,
                'count=', imminent.length,
            );
            return {
                outcome: 'no_imminent_vtxos',
                imminentCount: imminent.length,
                imminentIdPrefixes: idPrefixes,
            };
        }

        // Mark the attempt timestamp BEFORE the network calls so a hung
        // LN payment doesn't block future attempts via the in-flight
        // guard alone — even if `sweepInFlight` is somehow held past
        // process death, the cooldown bounds the next attempt at
        // `SWEEP_COOLDOWN_MS`.
        lastSweepAttemptAt = Date.now();

        console.log(
            '[Ark sweep] trigger=', trigger,
            'imminent vtxos count=', imminent.length,
            'gross=', grossSats,
            'fee_reserve=', feeReserve,
            'sweep_amount=', sweepSats,
            'tip=', tip,
            'ids=', idPrefixes.join(','),
            'min_blocks_left=', Math.min(...imminent.map((v) => v.expiryHeight - tip)),
        );

        // Try each custodian in priority order. Per spec B edge case:
        // "Custodian invoice creation fails → fall through to the
        // other custodian." Payment failure does NOT fall through (we
        // don't want to double-spend if Strike's invoice landed but
        // the LN-pay timed out mid-flight; better to leave the VTXOs
        // for next tick than re-pay via CoinOS).
        const failures: NonNullable<EmergencySweepResult['failures']> = [];
        for (const custodianId of CUSTODIAN_PRIORITY) {
            let provider;
            try {
                provider = getLightningSwapProvider(custodianId);
            } catch (err) {
                failures.push({
                    custodian: custodianId,
                    stage: 'unavailable',
                    message: `provider not registered: ${err}`,
                });
                continue;
            }
            if (!provider.isAvailable()) {
                failures.push({
                    custodian: custodianId,
                    stage: 'unavailable',
                    message: 'not authenticated',
                });
                continue;
            }

            try {
                const result = await swap('ark', custodianId, sweepSats, {
                    memo: `Ark emergency sweep (${imminent.length} vtxo${imminent.length === 1 ? '' : 's'})`,
                });
                console.log(
                    '[Ark sweep] SUCCESS custodian=', custodianId,
                    'amount=', sweepSats,
                    'payment_id=', result.id,
                    'fee_paid=', result.feeSats ?? '(unknown)',
                );
                return {
                    outcome: 'success',
                    custodian: custodianId,
                    sweptSats: sweepSats,
                    imminentCount: imminent.length,
                    imminentIdPrefixes: idPrefixes,
                    failures: failures.length > 0 ? failures : undefined,
                };
            } catch (err) {
                if (err instanceof InvoiceCreationFailedError) {
                    failures.push({
                        custodian: custodianId,
                        stage: 'invoice',
                        message: `${err.message} (cause: ${(err.cause as any)?.message ?? err.cause})`,
                    });
                    console.warn(
                        '[Ark sweep] invoice creation failed on', custodianId,
                        '— falling through to next custodian:', err.message,
                    );
                    continue;
                }
                if (err instanceof PaymentFailedError) {
                    failures.push({
                        custodian: custodianId,
                        stage: 'payment',
                        message: `${err.message} (cause: ${(err.cause as any)?.message ?? err.cause})`,
                    });
                    console.warn(
                        '[Ark sweep] payment failed on', custodianId,
                        '— NOT falling through (invoice may have landed):',
                        err.message,
                    );
                    // Break — don't try the next custodian when the LN
                    // payment itself failed. Avoid double-spend risk
                    // from a partially-settled invoice.
                    break;
                }
                // Unknown error class — treat conservatively as a
                // payment failure (don't fall through).
                failures.push({
                    custodian: custodianId,
                    stage: 'payment',
                    message: `unknown error: ${(err as any)?.message ?? err}`,
                });
                console.warn(
                    '[Ark sweep] unknown error on', custodianId,
                    '— NOT falling through:', err,
                );
                break;
            }
        }

        // Did any custodian even attempt? If every priority entry was
        // 'unavailable', this is the "no custodian connected" branch
        // — surface a push to the user since their funds are at real
        // risk and we cannot act on their behalf without a connected
        // rail.
        const allUnavailable = failures.every((f) => f.stage === 'unavailable');
        if (allUnavailable) {
            console.warn(
                '[Ark sweep] no custodial fallback available',
                '— VTXO at risk · unilateral exit may be needed',
                'imminent_ids=', idPrefixes.join(','),
            );
            pushSweepAlert(
                'Act now or you may lose Bitcoin 🚨',
                'Some of your Ark vault balance expires in about 12 hours and there is no connected wallet to move it to. Open Cypher Box now to keep it safe.',
            );
            return {
                outcome: 'no_custodian',
                imminentCount: imminent.length,
                imminentIdPrefixes: idPrefixes,
                failures,
            };
        }

        // At least one custodian was tried and all attempts failed.
        // Per spec B all-paths-fail: activity event + push + log.
        // Activity event would normally be a new event-log kind; the
        // store schema lives in src/stores/eventLogStore.ts which is
        // currently in another session's uncommitted edit set, so we
        // fall back to console log + push for now. When the schema
        // change lands, add a `recordEvent({kind: 'ark-sweep', ...})`
        // call here.
        console.warn(
            '[Ark sweep] all_custodians_failed',
            'imminent_ids=', idPrefixes.join(','),
            'failures=', JSON.stringify(failures),
        );
        pushSweepAlert(
            'Act now or you may lose Bitcoin 🚨',
            'Some of your Ark vault balance expires in about 12 hours and an automatic transfer failed. Open Cypher Box now to keep it safe.',
        );
        return {
            outcome: 'all_custodians_failed',
            imminentCount: imminent.length,
            imminentIdPrefixes: idPrefixes,
            failures,
        };
    } catch (err) {
        // Defensive — every named branch above already returns through
        // an outcome. Re-entry guard is in finally so the cooldown
        // does its job even on an unexpected throw.
        console.warn('[Ark sweep] unexpected throw:', err);
        return { outcome: 'all_custodians_failed', failures: [{ custodian: 'strike', stage: 'unavailable', message: `defensive catch: ${(err as any)?.message ?? err}` }] };
    } finally {
        sweepInFlight = false;
    }
}

/**
 * Reset the rate-limit cooldown. Test-only — called by integration
 * tests that need to fire the sweep multiple times in succession.
 * Not exposed via the barrel and not intended for runtime use.
 */
export function _resetEmergencyCustodialSweepStateForTest(): void {
    lastSweepAttemptAt = null;
    sweepInFlight = false;
}

/**
 * What a vault send spends, worked out exactly the way the wallet will build it.
 *
 * The review screen used to quote the fee with wallet.coinselect() on bare
 * UTXOs, while createTransaction first tells coinselect how big a segwit input
 * is. Without that hint every input is sized as legacy, 148 vB instead of 68 for
 * a bc1 vault, so the quote came out about 2.2x the real fee. Consolidate and
 * the moves then asked for a fixed amount (the total minus that inflated fee)
 * that coinselect could reach without the smallest capsules, which stayed
 * behind. Both the review and the send now go through planCapsuleSpend(), which
 * takes the size hints and the selection itself from the module the wallet uses
 * (class/wallets/coin-selection.ts), and returns the targets to hand to
 * createTransaction.
 *
 * Pure: no wallet, no React. The wallet's own createTransaction still builds,
 * signs and checks the transaction; this only decides what to ask it for.
 */
import BigNumber from 'bignumber.js';

import { inputScriptHint, outputScriptHint, selectCoins } from '../../class/wallets/coin-selection';
import { outpointKey } from './capsuleSelection';

export { inputScriptHint } from '../../class/wallets/coin-selection';

/**
 * - `max`: everything selected goes to the destination in one output, no change.
 * - `exact`: the destination gets `amountSats`, every selected capsule is spent
 *   and the rest comes back as change (or goes to the fee when it is too small
 *   to be worth a change output). Used when the user ticked the capsules: what
 *   you tick is what is spent, as with coin control in Bitcoin Core or Sparrow.
 * - `pool`: the destination gets `amountSats` and coinselect picks which of the
 *   capsules to spend. Used when the app pre-selected every capsule for the user.
 */
export type SpendMode = 'max' | 'exact' | 'pool';

export type SpendUtxo = {
    txid: string;
    vout: number;
    value: number;
    address?: string;
    [key: string]: any;
};

export type SpendTarget = { address: string; value?: number };

export interface CapsuleSpendPlan {
    mode: SpendMode;
    /** what to pass to createTransaction as its targets */
    targets: SpendTarget[];
    /** the capsules this spends */
    inputs: SpendUtxo[];
    /** sats to the destination */
    amountSats: number;
    /** sats back as change, 0 when there is no change output */
    changeSats: number;
    feeSats: number;
    /** the size coinselect charged for, in vbytes */
    vbytes: number;
}

export type CapsuleSpendError = 'no_capsules' | 'fee_rate' | 'amount' | 'destination' | 'insufficient';

export type CapsuleSpendResult =
    | { plan: CapsuleSpendPlan; error?: undefined }
    | { plan?: undefined; error: CapsuleSpendError };

export interface CapsuleSpendRequest {
    mode: SpendMode;
    utxos: readonly SpendUtxo[] | null | undefined;
    destination: string;
    amountSats?: number | null;
    feeRate: number;
    /** the wallet's first receive address, which is what createTransaction sizes inputs by */
    firstAddress?: string | null;
}

/**
 * Asks for change from every capsule given (see isChangeRequest in
 * coin-selection.ts). createTransaction fills in the change address and, for a
 * watch-only vault, the change's derivation path the signing device needs to
 * show it as change. It has to be an empty string, not a missing address:
 * createTransaction reads `target.address` before it selects.
 */
const CHANGE_REQUEST: SpendTarget = { address: '' };

// coinselect's own size constants (node_modules/coinselect/utils.js)
const TX_EMPTY_SIZE = 4 + 1 + 1 + 4;
const TX_INPUT_BASE = 32 + 4 + 1 + 4;
const TX_INPUT_PUBKEYHASH = 107;
const TX_OUTPUT_BASE = 8 + 1;
const TX_OUTPUT_PUBKEYHASH = 25;

type Sized = { script?: { length: number } };

/** Throws on an address bitcoinjs can't pay to, as createTransaction would. */
function sizedTarget(t: SpendTarget): SpendTarget & Sized {
    if (t.address === CHANGE_REQUEST.address) return { ...t };
    const script = outputScriptHint(t.address);
    return script ? { ...t, script } : { ...t };
}

/** Transaction size as coinselect counts it. */
export function estimatedVbytes(inputs: readonly Sized[], outputs: readonly Sized[]): number {
    return (
        TX_EMPTY_SIZE +
        inputs.reduce((sum, i) => sum + TX_INPUT_BASE + (i.script ? i.script.length : TX_INPUT_PUBKEYHASH), 0) +
        outputs.reduce((sum, o) => sum + TX_OUTPUT_BASE + (o.script ? o.script.length : TX_OUTPUT_PUBKEYHASH), 0)
    );
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * The spend for `utxos` (the capsules this send may use) to `destination`.
 */
export function planCapsuleSpend(o: CapsuleSpendRequest): CapsuleSpendResult {
    if (!o.utxos || o.utxos.length === 0) return { error: 'no_capsules' };
    // coinselect only works with whole sat/vB and returns nothing otherwise
    if (!Number.isInteger(o.feeRate) || o.feeRate < 1) return { error: 'fee_rate' };
    const amount = o.amountSats;
    if (o.mode !== 'max' && (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0)) {
        return { error: 'amount' };
    }
    if (!o.destination) return { error: 'destination' };

    const pay: SpendTarget = o.mode === 'max' ? { address: o.destination } : { address: o.destination, value: amount as number };
    const targets: SpendTarget[] = o.mode === 'exact' ? [pay, CHANGE_REQUEST] : [pay];

    let sized: (SpendTarget & Sized)[];
    try {
        sized = targets.map(sizedTarget);
    } catch (_) {
        return { error: 'destination' };
    }
    const hint = inputScriptHint(o.firstAddress);
    const inputs = o.utxos.map((u) => (hint ? { ...u, script: hint } : { ...u }));

    const picked = selectCoins(inputs, sized, o.feeRate);
    if (!picked.inputs || !picked.outputs) return { error: 'insufficient' };
    const toDestination = picked.outputs.filter((out) => out.address === o.destination);
    // outputs without an address are change: createTransaction gives them the change address
    const change = picked.outputs.filter((out) => !out.address);
    return {
        plan: {
            mode: o.mode,
            targets: targets.map((t) => ({ ...t })),
            inputs: picked.inputs,
            amountSats: sum(toDestination.map((out) => out.value)),
            changeSats: sum(change.map((out) => out.value)),
            feeSats: picked.fee,
            vbytes: estimatedVbytes(picked.inputs, picked.outputs),
        },
    };
}

/**
 * A typed amount from ticked capsules spends all of them. When fewer would
 * cover it, this is how many, and how much more the fee is for spending the
 * rest too. Null when every ticked capsule is needed.
 */
export function capsulesBeyondNeed(
    plan: CapsuleSpendPlan | undefined,
    request: CapsuleSpendRequest,
): { needed: number; extraFeeSats: number } | null {
    if (!plan || plan.mode !== 'exact') return null;
    const least = planCapsuleSpend({ ...request, mode: 'pool' }).plan;
    if (!least || least.inputs.length >= plan.inputs.length) return null;
    return { needed: least.inputs.length, extraFeeSats: Math.max(0, plan.feeSats - least.feeSats) };
}

/**
 * What createTransaction actually built, for the screens after the review.
 * Change outputs have the change address filled in by then, so anything not
 * paid to the destination is change.
 */
export function describeBuiltSpend(
    built: { inputs: { txid?: string; txId?: string; vout: number }[]; outputs: { address?: string; value: number }[]; fee: number },
    destination: string,
) {
    const amountSats = sum(built.outputs.filter((out) => out.address === destination).map((out) => out.value));
    return {
        amountSats,
        changeSats: sum(built.outputs.map((out) => out.value)) - amountSats,
        feeSats: built.fee,
        spentIds: built.inputs.map((i) => outpointKey({ txid: String(i.txid ?? i.txId), vout: i.vout })),
    };
}

/**
 * The amount the user typed, in sats. EditAmount passes it both in BTC
 * (`total`) and in fiat (`inUSD`); the BTC figure is exact, while converting
 * the fiat one back used to lose sats on every screen. Fiat is only the
 * fallback. Null when neither gives a positive amount.
 */
export function typedAmountSats(btc: unknown, fiat: unknown, fiatPerBtc: unknown): number | null {
    const fromBtc = new BigNumber(String(btc ?? '')).times(100_000_000).integerValue(BigNumber.ROUND_HALF_UP);
    if (fromBtc.isFinite() && fromBtc.gt(0)) return fromBtc.toNumber();
    const fromFiat = new BigNumber(String(fiat ?? ''))
        .div(new BigNumber(String(fiatPerBtc ?? '')))
        .times(100_000_000)
        .integerValue(BigNumber.ROUND_HALF_UP);
    if (fromFiat.isFinite() && fromFiat.gt(0)) return fromFiat.toNumber();
    return null;
}

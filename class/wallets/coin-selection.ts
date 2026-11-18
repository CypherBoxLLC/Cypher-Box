/**
 * Coin selection shared by the wallet and the screens that quote a send before building it.
 *
 * The send review used to quote its fee with wallet.coinselect() on bare UTXOs while createTransaction() first told
 * coinselect how big a segwit input is, so the quote sized every input as legacy (148 vB instead of 68 for a bc1
 * wallet) and came out about 2.2x the fee actually paid. Both now take the size hints and the algorithm from here.
 */
import coinSelect, { CoinSelectTarget } from 'coinselect';
import coinSelectSplit from 'coinselect/split';
import * as bitcoin from 'bitcoinjs-lib';

type ScriptHint = { length: number };

/**
 * The input size createTransaction() tells coinselect about, from the wallet's first receive address: native segwit
 * (bc1) inputs are 68 vB and wrapped segwit (3...) 91 vB, where coinselect assumes 148 vB. Anything else keeps
 * coinselect's default. Telling the two apart by address is good enough here: those are the only two HD wallet types.
 */
export function inputScriptHint(firstAddress?: string | null): ScriptHint | undefined {
  if (!firstAddress) return undefined;
  if (firstAddress.startsWith('bc1')) return { length: 27 };
  if (firstAddress.startsWith('3')) return { length: 50 };
  return undefined;
}

/**
 * The output size createTransaction() tells coinselect about: a bc1 address can take more bytes than coinselect's
 * default (a taproot output does). Throws, as bitcoinjs does, on a bc1 address it can't pay to. A QR code often
 * carries the address in capitals (BC1...), the same address, so it is sized the same.
 */
export function outputScriptHint(address?: string | null): ScriptHint | undefined {
  if (!address || !address.toLowerCase().startsWith('bc1')) return undefined;
  return { length: bitcoin.address.toOutputScript(address).length + 3 };
}

// coinselect's own sizes (node_modules/coinselect/utils.js): the scriptSig of a P2PKH spend, and the output script
// it assumes when a target has no size hint
const P2PKH_INPUT_SCRIPT = 107;
const DEFAULT_OUTPUT_SCRIPT = 25;

/**
 * The smallest change output worth keeping, in sats; less goes to the fee. coinselect keeps change worth more than
 * an input costs at the fee rate (148 vB x rate), which at 1 to 3 sat/vB is 148 to 444 sats, so it built change of a
 * few hundred sats that nodes refuse to relay as dust. 546 is the dust limit of a P2PKH output, the highest of the
 * scripts change can go to here (P2WPKH 294, taproot 330, P2SH 540).
 */
export const MIN_CHANGE_SATS = 546;

/**
 * A transaction with segwit inputs also carries the 2-byte marker and flag, half a vbyte that coinselect leaves out,
 * and its vsize rounds up: one vbyte more than coinselect counts. Without it a send whose outputs are all P2PKH (the
 * one output coinselect sizes exactly) paid just under the rate asked, at 1 sat/vB under the relay minimum. Inputs
 * hinted smaller than a P2PKH spend are segwit ones (their witness counts a quarter). The vbyte goes on the first
 * target: every algorithm sizes every target.
 */
function withSegwitMarker(utxos: { script?: ScriptHint }[], targets: CoinSelectTarget[]): CoinSelectTarget[] {
  const segwit = utxos.some(u => !!u.script && u.script.length < P2PKH_INPUT_SCRIPT);
  if (!segwit || targets.length === 0) return targets;
  const [first, ...rest] = targets;
  // a copy: callers keep their own targets' hints
  return [{ ...first, script: { length: (first.script ? first.script.length : DEFAULT_OUTPUT_SCRIPT) + 1 } }, ...rest];
}

type Selection<U> = {
  inputs?: (U & { script?: ScriptHint })[];
  outputs?: { address?: string; value: number; script?: ScriptHint }[];
  fee: number;
};

/**
 * Change below MIN_CHANGE_SATS goes to the fee, when another output is left to carry the rest. Change is an output
 * without an address: createTransaction() gives it the change address.
 */
function withoutDustChange<U>(selection: Selection<U>): Selection<U> {
  const { inputs, outputs } = selection;
  if (!inputs || !outputs) return selection;
  const dust = outputs.filter(o => !o.address && o.value < MIN_CHANGE_SATS);
  if (dust.length === 0 || dust.length === outputs.length) return selection;
  return {
    inputs,
    outputs: outputs.filter(o => !dust.includes(o)),
    fee: selection.fee + dust.reduce((sum, o) => sum + o.value, 0),
  };
}

/**
 * A target with neither an address nor a value asks for change from every UTXO given, the way coin control spends
 * exactly the coins the user picked. createTransaction() fills in the change address (and, for a watch-only wallet,
 * the derivation path a signing device needs to show it as change). Give it `address: ''` rather than leaving the
 * address out: createTransaction() reads `target.address` before selecting.
 */
export function isChangeRequest(target: { address?: string; value?: number }): boolean {
  return !target.address && !('value' in target);
}

/**
 * The selection LegacyWallet.coinselect() runs, so a quote can run the very same one. Returns coinselect's result,
 * with the two adjustments below: no `inputs`/`outputs` when the UTXOs can't pay for the targets at this fee rate.
 *
 * - A change request next to paying targets: every UTXO is spent (coinselect/split), the paying targets get their
 *   values, and finalize() keeps the remainder as a change output only when it is worth one (more than an input costs
 *   at this rate), otherwise it goes to the fee.
 * - A target without a value (and no change request): every UTXO is spent and that target gets the rest, i.e. MAX.
 * - Otherwise coinselect picks the UTXOs (blackjack, then accumulative from the largest) and adds change if worth it.
 *
 * Either way segwit inputs pay for the marker and flag, and change below MIN_CHANGE_SATS goes to the fee.
 */
export function selectCoins<U extends { value: number; script?: ScriptHint }>(utxos: U[], targets: CoinSelectTarget[], feeRate: number) {
  const paying = targets.filter(t => !isChangeRequest(t));
  let algo: any = coinSelect;
  let asked = targets;
  if (paying.length > 0 && paying.length < targets.length) {
    algo = coinSelectSplit;
    asked = paying;
  } else if (targets.some(t => !('value' in t))) {
    algo = coinSelectSplit;
  }
  return withoutDustChange<U>(algo(utxos, withSegwitMarker(utxos, asked), feeRate) as Selection<U>);
}

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
 * default (a taproot output does). Throws, as bitcoinjs does, on a bc1 address it can't pay to.
 */
export function outputScriptHint(address?: string | null): ScriptHint | undefined {
  if (!address || !address.startsWith('bc1')) return undefined;
  return { length: bitcoin.address.toOutputScript(address).length + 3 };
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
 * The selection LegacyWallet.coinselect() runs, so a quote can run the very same one. Returns coinselect's own result:
 * no `inputs`/`outputs` when the UTXOs can't pay for the targets at this fee rate.
 *
 * - A change request next to paying targets: every UTXO is spent (coinselect/split), the paying targets get their
 *   values, and finalize() keeps the remainder as a change output only when it is worth one (more than an input costs
 *   at this rate), otherwise it goes to the fee.
 * - A target without a value (and no change request): every UTXO is spent and that target gets the rest, i.e. MAX.
 * - Otherwise coinselect picks the UTXOs (blackjack, then accumulative from the largest) and adds change if worth it.
 */
export function selectCoins<U extends { value: number }>(utxos: U[], targets: CoinSelectTarget[], feeRate: number) {
  const paying = targets.filter(t => !isChangeRequest(t));
  let algo: any = coinSelect;
  let asked = targets;
  if (paying.length > 0 && paying.length < targets.length) {
    algo = coinSelectSplit;
    asked = paying;
  } else if (targets.some(t => !('value' in t))) {
    algo = coinSelectSplit;
  }
  return algo(utxos, asked, feeRate) as {
    inputs?: (U & { script?: ScriptHint })[];
    outputs?: { address?: string; value: number; script?: ScriptHint }[];
    fee: number;
  };
}

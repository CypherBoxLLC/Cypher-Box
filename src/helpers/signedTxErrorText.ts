import { SIGNED_TX_INVALID, SIGNED_TX_MISMATCH } from './signedTransaction';
import loc from '../../loc';

/**
 * A signed-transaction check's error in the app's language. signedTransaction.ts throws these in English, and its
 * tests match on that text, so they're translated here, where they're shown. A message it doesn't know (bitcoinjs's
 * own, for one) is returned as it is.
 */
export default function signedTxErrorText(message: string): string {
  const errors = loc.cypherbox.payments.confirm_hardware_transaction;
  const known: Record<string, string> = {
    [SIGNED_TX_MISMATCH]: errors.signed_tx_mismatch,
    [SIGNED_TX_INVALID]: errors.signed_tx_invalid,
  };
  return known[message] ?? message;
}

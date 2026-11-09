import {
  SIGN_BACKUP_MISMATCH,
  SIGN_FALSE_CHANGE,
  SIGN_INPUT_DETAILS,
  SIGN_INVALID_BACKUP,
  SIGN_MIXED_WALLETS,
  SIGN_MULTISIG_HOT_VAULT,
  SIGN_NOT_A_TRANSACTION,
  SIGN_NOTHING_SIGNED,
  SIGN_NO_KEY_INFO,
  SIGN_ON_SIGNING_DEVICE,
  SIGN_UNKNOWN_MULTISIG,
  SIGN_UNSUPPORTED_MULTISIG,
  SIGN_VAULT_MISMATCH,
} from '@Cypher/helpers';
import loc from '../../../loc';

/**
 * A signing error in the app's language. The signing helpers throw these in English, and their tests match on that
 * text, so they're translated here, where they're shown. A message it doesn't know is returned as it is.
 */
export default function signErrorText(message: string): string {
  const errors = loc.cypherbox.sign_once.errors;
  const known: Record<string, string> = {
    [SIGN_NOT_A_TRANSACTION]: errors.not_a_transaction,
    [SIGN_INVALID_BACKUP]: errors.invalid_backup,
    [SIGN_NO_KEY_INFO]: errors.no_key_info,
    [SIGN_BACKUP_MISMATCH]: errors.backup_mismatch,
    [SIGN_VAULT_MISMATCH]: errors.vault_mismatch,
    [SIGN_FALSE_CHANGE]: errors.false_change,
    [SIGN_NOTHING_SIGNED]: errors.nothing_signed,
    [SIGN_ON_SIGNING_DEVICE]: errors.on_signing_device,
    [SIGN_UNKNOWN_MULTISIG]: loc.cypherbox.sign_once.errors.unknown_multisig,
    [SIGN_UNSUPPORTED_MULTISIG]: loc.cypherbox.sign_once.errors.unsupported_multisig,
    [SIGN_MIXED_WALLETS]: loc.cypherbox.sign_once.errors.mixed_wallets,
    [SIGN_MULTISIG_HOT_VAULT]: loc.cypherbox.sign_once.errors.multisig_hot_vault,
    [SIGN_INPUT_DETAILS]: loc.cypherbox.sign_once.errors.input_details,
  };
  if (known[message]) return known[message];
  const word = /^"(.+)" isn't a recovery phrase word\. Check its spelling\.$/.exec(message);
  if (word) return String(loc.formatString(errors.unknown_word, { word: word[1] }));
  const count = /^That's (\d+) words\. A recovery phrase has 12 or 24\.$/.exec(message);
  if (count) return String(loc.formatString(errors.word_count, { count: count[1] }));
  return message;
}

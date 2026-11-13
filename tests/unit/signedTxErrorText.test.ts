/**
 * The Cold Vault's signed-transaction checks throw in English (their tests match on it), and the screens show the
 * message in an alert or in place of the summary. They go through signedTxErrorText, so in Arabic the reason is in
 * Arabic too; anything else, bitcoinjs's own errors for one, is shown as it was.
 */

// The modules under test are imported after the mock below.
/* eslint-disable import/first */

jest.mock('../../loc', () => ({
  __esModule: true,
  default: {
    cypherbox: {
      payments: { confirm_hardware_transaction: { signed_tx_mismatch: 'ar: not the one reviewed', signed_tx_invalid: 'ar: not signed' } },
    },
  },
}));

import { assertSignedTxMatchesPsbt, parseImportedTransaction } from '../../src/helpers/signedTransaction';
import signedTxErrorText from '../../src/helpers/signedTxErrorText';

const thrown = (run: () => unknown): string => {
  try {
    run();
  } catch (err: any) {
    return err.message;
  }
  throw new Error('it did not throw');
};

it('translates an import that is not a transaction', () => {
  expect(signedTxErrorText(thrown(() => parseImportedTransaction('hello world')))).toBe('ar: not signed');
  expect(signedTxErrorText(thrown(() => parseImportedTransaction('deadbeef')))).toBe('ar: not signed');
});

it('translates a signed transaction that is not the one reviewed', () => {
  expect(signedTxErrorText(thrown(() => assertSignedTxMatchesPsbt('00', undefined as any)))).toBe('ar: not the one reviewed');
});

it('returns any other message as it is', () => {
  expect(signedTxErrorText('Warning: You are paying around 0.5 in fees')).toBe('Warning: You are paying around 0.5 in fees');
});

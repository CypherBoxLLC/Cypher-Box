/* global jest, describe, it, expect, beforeEach, afterEach */
/**
 * Sync with a transaction that has thousands of inputs.
 *
 * fetchTransactions looks up the parent transaction of every input in the history, to show where each input came from
 * and what it was worth. A transaction with thousands of inputs that paid the wallet turned that into hundreds of
 * Electrum requests on every sync, and the vault hung. Above MAX_INPUTS_TO_RESOLVE inputs it now skips those parents.
 *
 * The limit has to stay far above a large consolidation the wallet makes itself (Consolidate has no cap on capsules),
 * which must still resolve, or its Activity and History rows would show a spend of the user's own as a receive.
 */
const BlueElectrum = require('../../blue_modules/BlueElectrum');
const { HDSegwitBech32Wallet } = require('../../class');
const { MAX_INPUTS_TO_RESOLVE } = require('../../class/wallets/abstract-hd-electrum-wallet');

// the public BIP39 test vector, never a real wallet
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ELSEWHERE = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const hex64 = (tag, n) => (tag + n.toString(16).padStart(8, '0')).padEnd(64, '0');

function receivedTx(txid, inputCount, parentTag, toAddress, sats) {
  return {
    txid,
    hash: txid,
    confirmations: 10,
    blocktime: 1763000000,
    time: 1763000000,
    vin: Array.from({ length: inputCount }, (_, i) => ({
      txid: hex64(parentTag, i),
      vout: 0,
    })),
    vout: [{ value: sats / 1e8, n: 0, scriptPubKey: { addresses: [toAddress] } }],
  };
}

let wallet;
let ours;
let txs;
let parentRequests;

beforeEach(() => {
  wallet = new HDSegwitBech32Wallet();
  wallet.setSecret(MNEMONIC);
  for (let c = 0; c < wallet.gap_limit + 1; c++) {
    wallet._balances_by_external_index[c] = { c: 0, u: 0 };
    wallet._balances_by_internal_index[c] = { c: 0, u: 0 };
  }
  ours = wallet._getExternalAddressByIndex(0);
  txs = {};
  parentRequests = [];

  jest.spyOn(BlueElectrum, 'multiGetHistoryByAddress').mockImplementation(async addresses => {
    const out = {};
    for (const address of addresses) {
      out[address] =
        address === ours
          ? Object.keys(txs).map(txHash => ({
              tx_hash: txHash,
              height: 849990,
            }))
          : [];
    }
    return out;
  });
  jest.spyOn(BlueElectrum, 'multiGetTransactionByTxid').mockImplementation(async txids => {
    const out = {};
    const asked = [];
    for (const txid of txids) {
      if (txs[txid]) {
        out[txid] = JSON.parse(JSON.stringify(txs[txid]));
      } else {
        // a parent: one output, from someone else's address
        asked.push(txid);
        out[txid] = {
          txid,
          vin: [],
          vout: [{ value: 0.0001, n: 0, scriptPubKey: { addresses: [ELSEWHERE] } }],
        };
      }
    }
    if (asked.length) parentRequests.push(...asked);
    return out;
  });
});

afterEach(() => jest.restoreAllMocks());

describe('sync with a transaction that has too many inputs', () => {
  it('skips the parents of a transaction above the limit, and still looks up the others', async () => {
    const big = hex64('b0', 1);
    const small = hex64('c0', 1);
    txs[big] = receivedTx(big, MAX_INPUTS_TO_RESOLVE + 1, 'b1', ours, 50000);
    txs[small] = receivedTx(small, 3, 'c1', ours, 20000);

    await wallet.fetchTransactions();

    expect(parentRequests.some(txid => txid.startsWith('b1'))).toBe(false);
    expect(parentRequests.filter(txid => txid.startsWith('c1'))).toHaveLength(3);
  });

  it('keeps the skipped receive in the history with the amount it paid the wallet', async () => {
    const big = hex64('b0', 2);
    txs[big] = receivedTx(big, MAX_INPUTS_TO_RESOLVE + 1, 'b2', ours, 50000);

    await wallet.fetchTransactions();
    const tx = wallet.getTransactions().find(t => t.txid === big);

    expect(tx).toBeDefined();
    expect(tx.value).toBe(50000);
    expect(tx.inputs).toHaveLength(MAX_INPUTS_TO_RESOLVE + 1);
    expect(tx.inputs[0].addresses).toBeUndefined();
  });

  it('still resolves a transaction with exactly the limit, far above a large consolidation', async () => {
    const atLimit = hex64('d0', 1);
    txs[atLimit] = receivedTx(atLimit, MAX_INPUTS_TO_RESOLVE, 'd1', ours, 30000);

    await wallet.fetchTransactions();
    const tx = wallet.getTransactions().find(t => t.txid === atLimit);

    expect(MAX_INPUTS_TO_RESOLVE).toBeGreaterThanOrEqual(1000);
    expect(parentRequests.filter(txid => txid.startsWith('d1'))).toHaveLength(MAX_INPUTS_TO_RESOLVE);
    expect(tx.inputs[0].addresses).toEqual([ELSEWHERE]);
  });
});

/* global jest, describe, it, expect, beforeEach, afterEach */
/**
 * BlueElectrum's batched calls against a scripted Electrum server: every batch settles, and a server that answers gets
 * exactly the requests it always got.
 *
 * Heavy-wallet test, 2026-11-12: mainnet.foundationdevices.com, and electrum.bitaroo.net when busy, answered a big
 * verbose transaction batch with `{"error":{"code":4,"message":"Batch limit exceeded"},"id":null}`. The Electrum client
 * couldn't route a reply without an id, so the batch never settled, History waited forever, and every pull to refresh
 * added another stuck batch. Now the refused batch fails at once (blue_modules/GuardedElectrumClient.js) and its items
 * are asked again in smaller batches, then one by one, still verbose.
 *
 * The real electrum-client runs here, over sockets that go nowhere: `global.net` is swapped for one whose sockets hand
 * what the client writes to the scripted server below, and `global.tls` is taken away, so nothing can reach a real
 * server.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EventEmitter } from 'events';

const bitcoin = require('bitcoinjs-lib');

// tests/setupAfterEnv.js (from #300 on) keeps unit suites from building an Electrum client; this one has no network
jest.unmock('electrum-client');
jest.unmock('../../blue_modules/BlueElectrum');
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const BlueElectrum = require('../../blue_modules/BlueElectrum');
const { REQUEST_TIMEOUT_MS: TIMEOUT_MS } = require('../../blue_modules/GuardedElectrumClient');
const { HDSegwitBech32Wallet } = require('../../class');

const TIP = 850000;
const BATCH_LIMIT_EXCEEDED = { jsonrpc: '2.0', error: { code: 4, message: 'Batch limit exceeded' }, id: null };

// a P2WPKH address per number, no keys needed
function addressOf(n) {
  const hash = Buffer.alloc(20, 7);
  hash.writeUInt16BE(n, 0);
  return bitcoin.payments.p2wpkh({ hash }).address;
}

function scripthashOf(address) {
  return Buffer.from(bitcoin.crypto.sha256(bitcoin.address.toOutputScript(address)))
    .reverse()
    .toString('hex');
}

function makeTx(seed, inputs, outputs) {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.locktime = seed; // keeps the txids apart
  for (const { txid, vout } of inputs) tx.addInput(Buffer.from(txid, 'hex').reverse(), vout);
  for (const { address, value } of outputs) tx.addOutput(bitcoin.address.toOutputScript(address), value);
  return tx;
}

// what bitcoind 22+ (behind Fulcrum or ElectrumX) sends for a verbose transaction
function verboseOf(tx, height) {
  const hex = tx.toHex();
  return {
    txid: tx.getId(),
    hash: tx.getId(),
    version: tx.version,
    size: hex.length / 2,
    vsize: tx.virtualSize(),
    weight: tx.weight(),
    locktime: tx.locktime,
    vin: tx.ins.map(input => ({
      txid: Buffer.from(input.hash).reverse().toString('hex'),
      vout: input.index,
      scriptSig: { asm: '', hex: '' },
      sequence: input.sequence,
    })),
    vout: tx.outs.map((output, n) => ({
      value: output.value / 1e8,
      n,
      scriptPubKey: {
        asm: '',
        hex: output.script.toString('hex'),
        address: bitcoin.address.fromOutputScript(output.script),
        type: 'witness_v0_keyhash',
      },
    })),
    hex,
    ...(height > 0 ? { blockhash: 'ab'.repeat(32), confirmations: TIP - height + 1, time: 1.6e9 + height, blocktime: 1.6e9 + height } : {}),
  };
}

// what the app has always made of a verbose answer: no hex, and the output address also as `addresses`
function asTheAppKeepsIt(verbose) {
  const kept = JSON.parse(JSON.stringify(verbose));
  delete kept.hex;
  for (const vout of kept.vout) vout.scriptPubKey.addresses = [vout.scriptPubKey.address];
  return kept;
}

// a transaction decoded here from its hex: the same inputs and outputs as the server's verbose answer (its confirmations
// and times are estimates)
function expectSameInsAndOuts(decoded, verbose) {
  const kept = asTheAppKeepsIt(verbose);
  expect(decoded.txid).toBe(kept.txid);
  expect(decoded.vin.map(({ txid, vout }) => [txid, vout])).toEqual(kept.vin.map(({ txid, vout }) => [txid, vout]));
  expect(decoded.vout.map(({ value, n, scriptPubKey }) => [value, n, scriptPubKey.addresses])).toEqual(
    kept.vout.map(({ value, n, scriptPubKey }) => [value, n, scriptPubKey.addresses]),
  );
}

function makeChain() {
  const txs = {};
  const histories = {};
  const balances = {};
  const utxos = {};
  const chain = {
    txs,
    // answers over the server's size limit: in a batch, as electrum.acinq.co answers the items after a batch's reply
    // passed 1 MB, or verbose even on their own
    tooLargeInBatch: new Set(),
    tooLarge: new Set(),
    addTx(tx, height) {
      txs[tx.getId()] = { tx, height };
      return tx.getId();
    },
    addHistory(address, txid, height) {
      const sh = scripthashOf(address);
      histories[sh] = histories[sh] || [];
      histories[sh].push(height > 0 ? { tx_hash: txid, height } : { tx_hash: txid, height, fee: 200 });
    },
    setBalance(address, confirmed, unconfirmed = 0) {
      balances[scripthashOf(address)] = { confirmed, unconfirmed };
    },
    addUtxo(address, txid, vout, value, height) {
      const sh = scripthashOf(address);
      utxos[sh] = utxos[sh] || [];
      utxos[sh].push({ tx_hash: txid, tx_pos: vout, value, height });
    },
    answer(method, params, inBatch) {
      switch (method) {
        case 'blockchain.scripthash.get_balance':
          return balances[params[0]] || { confirmed: 0, unconfirmed: 0 };
        case 'blockchain.scripthash.get_history':
          return JSON.parse(JSON.stringify(histories[params[0]] || []));
        case 'blockchain.scripthash.listunspent':
          return JSON.parse(JSON.stringify(utxos[params[0]] || []));
        case 'blockchain.transaction.get': {
          const known = txs[params[0]];
          if (!known) throw Object.assign(new Error('No such mempool or blockchain transaction'), { code: 2 });
          if ((inBatch && chain.tooLargeInBatch.has(params[0])) || (params[1] && chain.tooLarge.has(params[0]))) {
            throw Object.assign(new Error('response too large (over 1,000,000 bytes'), { code: -32600 });
          }
          return params[1] ? JSON.parse(JSON.stringify(verboseOf(known.tx, known.height))) : known.tx.toHex();
        }
        default:
          throw new Error('unknown method ' + method);
      }
    },
  };
  return chain;
}

// Answers what `batches` and `singles` say for each data request: 'answer', 'batch_limit' (the reply the two servers
// sent), 'silent' (no reply at all) or 'close' (drops the connection).
function makeServer(chain, { version = 'Fulcrum 1.10.0', batches = () => 'answer', singles = () => 'answer' } = {}) {
  const server = {
    log: [],
    // single requests received and not answered yet, and the most there were at once
    singlesWaiting: 0,
    mostSinglesWaiting: 0,
    unanswered: [],
    receive(socket, message) {
      const inBatch = Array.isArray(message);
      const answerOne = ({ id, method, params }) => {
        if (method === 'server.version') return { jsonrpc: '2.0', id, result: [version, '1.4'] };
        if (method === 'blockchain.headers.subscribe') return { jsonrpc: '2.0', id, result: { height: TIP, hex: '00' } };
        if (method === 'server.ping') return { jsonrpc: '2.0', id, result: null };
        try {
          return { jsonrpc: '2.0', id, result: chain.answer(method, params, inBatch) };
        } catch (error) {
          return { jsonrpc: '2.0', id, error: { code: error.code, message: error.message } };
        }
      };
      const connectionRequest =
        !Array.isArray(message) && ['server.version', 'blockchain.headers.subscribe', 'server.ping'].includes(message.method);
      if (connectionRequest) return socket.send(answerOne(message));

      const entry = Array.isArray(message)
        ? { batch: true, method: message[0].method, params: message.map(m => m.params) }
        : { batch: false, method: message.method, params: message.params };
      server.log.push(entry);
      const verdict = (entry.batch ? batches : singles)(entry);
      if (verdict === 'answer' && !entry.batch) {
        server.singlesWaiting++;
        server.mostSinglesWaiting = Math.max(server.mostSinglesWaiting, server.singlesWaiting);
        Promise.resolve().then(() => server.singlesWaiting--);
      }
      if (verdict === 'answer') return socket.send(Array.isArray(message) ? message.map(answerOne) : answerOne(message));
      server.unanswered.push(entry);
      if (verdict === 'batch_limit') socket.send(BATCH_LIMIT_EXCEEDED);
      if (verdict === 'close') Promise.resolve().then(() => socket.emit('close'));
    },
  };
  return server;
}

let currentServer;
class MockSocket extends EventEmitter {
  constructor() {
    super();
    this.server = currentServer;
  }

  setTimeout() {}
  setEncoding() {}
  setKeepAlive() {}
  setNoDelay() {}
  end() {}
  destroy() {}

  connect(port, host, onConnected) {
    Promise.resolve().then(() => {
      this.emit('connect');
      onConnected();
    });
  }

  write(data) {
    for (const line of String(data).split('\n')) if (line) this.server.receive(this, JSON.parse(line));
  }

  send(message) {
    Promise.resolve().then(() => this.emit('data', JSON.stringify(message) + '\n'));
  }
}

async function connectTo(server) {
  currentServer = server;
  await BlueElectrum.connectMain();
}

// requests in a short form: "batch blockchain.transaction.get x45 verbose", "one blockchain.scripthash.get_balance"
function shape(entry) {
  let verbosity = '';
  if (entry.method === 'blockchain.transaction.get') {
    const verbose = entry.batch ? entry.params[0][1] : entry.params[1];
    verbosity = verbose ? ' verbose' : ' raw';
  }
  return entry.batch ? `batch ${entry.method} x${entry.params.length}${verbosity}` : `one ${entry.method}${verbosity}`;
}

function someTxs(chain, count, firstSeed, height) {
  const txids = [];
  for (let i = 0; i < count; i++) {
    const seed = firstSeed + i;
    const tx = makeTx(
      seed,
      [{ txid: 'cd'.repeat(31) + (seed % 256).toString(16).padStart(2, '0'), vout: i % 3 }],
      [
        { address: addressOf(seed % 1000), value: 1000 + seed },
        { address: addressOf((seed + 1) % 1000), value: 2000 + seed },
      ],
    );
    txids.push(chain.addTx(tx, height));
  }
  return txids;
}

const savedNet = global.net;
const savedTls = global.tls;
let consoleLog;
let cacheWrites;

// spies on what multiGetTransactionByTxid writes to its Realm cache (tests/setup.js mocks Realm); undone after each test
async function watchCacheWrites() {
  const realm = await require('realm').open();
  cacheWrites = jest.spyOn(realm, 'create');
  return cacheWrites;
}

beforeEach(async () => {
  jest.useFakeTimers();
  global.net = { Socket: MockSocket };
  global.tls = undefined;
  consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  await AsyncStorage.setItem(BlueElectrum.ELECTRUM_HOST, 'electrum.example.test');
  await AsyncStorage.setItem(BlueElectrum.ELECTRUM_TCP_PORT, '50001');
});

afterEach(() => {
  cacheWrites?.mockRestore();
  cacheWrites = undefined;
  BlueElectrum.forceDisconnect();
  jest.clearAllTimers();
  jest.useRealTimers();
  global.net = savedNet;
  global.tls = savedTls;
  consoleLog.mockRestore();
});

describe('a server that takes batches', () => {
  it('gets the same batches as before, and the results are what the app always made of them', async () => {
    const chain = makeChain();
    const txids = someTxs(chain, 100, 1, 800000);
    const addresses = [];
    for (let n = 0; n < 250; n++) {
      const address = addressOf(n);
      addresses.push(address);
      chain.setBalance(address, n * 10, n % 2);
      chain.addHistory(address, txids[n % 100], 800000);
      chain.addUtxo(address, txids[n % 100], 0, 1000 + n, 800000);
    }
    const server = makeServer(chain);
    await connectTo(server);

    const verbose = await BlueElectrum.multiGetTransactionByTxid(txids);
    const raw = await BlueElectrum.multiGetTransactionByTxid(txids.slice(0, 20), 10, false);
    const balances = await BlueElectrum.multiGetBalanceByAddress(addresses);
    const histories = await BlueElectrum.multiGetHistoryByAddress(addresses.slice(0, 120));
    const utxos = await BlueElectrum.multiGetUtxoByAddress(addresses.slice(0, 120));

    expect(server.log.map(shape)).toEqual([
      'batch blockchain.transaction.get x45 verbose',
      'batch blockchain.transaction.get x45 verbose',
      'batch blockchain.transaction.get x10 verbose',
      'batch blockchain.transaction.get x10 raw',
      'batch blockchain.transaction.get x10 raw',
      'batch blockchain.scripthash.get_balance x200',
      'batch blockchain.scripthash.get_balance x50',
      'batch blockchain.scripthash.get_history x100',
      'batch blockchain.scripthash.get_history x20',
      'batch blockchain.scripthash.listunspent x100',
      'batch blockchain.scripthash.listunspent x20',
    ]);
    expect(server.unanswered).toEqual([]);

    for (const txid of txids) expect(verbose[txid]).toEqual(asTheAppKeepsIt(verboseOf(chain.txs[txid].tx, 800000)));
    for (const txid of txids.slice(0, 20)) expect(raw[txid]).toBe(chain.txs[txid].tx.toHex());
    expect(balances.balance).toBe(addresses.reduce((sum, a, n) => sum + n * 10, 0));
    expect(balances.unconfirmed_balance).toBe(125);
    expect(balances.addresses[addresses[7]]).toEqual({ confirmed: 70, unconfirmed: 1 });
    expect(histories[addresses[3]]).toEqual([{ tx_hash: txids[3], height: 800000, address: addresses[3] }]);
    expect(utxos[addresses[5]]).toEqual([{ txId: txids[5], vout: 0, value: 1005, height: 800000, address: addresses[5] }]);
  });

  it('an item the server could not fit in the batch reply is asked again on its own, raw, and decoded here as before', async () => {
    const chain = makeChain();
    const txids = someTxs(chain, 3, 500, 800000);
    chain.tooLargeInBatch.add(txids[1]);
    const server = makeServer(chain);
    await connectTo(server);

    const result = await BlueElectrum.multiGetTransactionByTxid(txids);

    expect(server.log.map(shape)).toEqual(['batch blockchain.transaction.get x3 verbose', 'one blockchain.transaction.get raw']);
    expect(result[txids[0]]).toEqual(asTheAppKeepsIt(verboseOf(chain.txs[txids[0]].tx, 800000)));
    expect(result[txids[2]]).toEqual(asTheAppKeepsIt(verboseOf(chain.txs[txids[2]].tx, 800000)));
    expectSameInsAndOuts(result[txids[1]], verboseOf(chain.txs[txids[1]].tx, 800000));
  });

  it('asked raw, such an item stays raw hex, as raw callers (PSBTs, legacy wallets) take it', async () => {
    const chain = makeChain();
    const txids = someTxs(chain, 3, 520, 800000);
    chain.tooLargeInBatch.add(txids[2]);
    const server = makeServer(chain);
    await connectTo(server);

    const result = await BlueElectrum.multiGetTransactionByTxid(txids, 10, false);

    expect(server.log.map(shape)).toEqual(['batch blockchain.transaction.get x3 raw', 'one blockchain.transaction.get raw']);
    for (const txid of txids) expect(result[txid]).toBe(chain.txs[txid].tx.toHex());
  });

  it('electrum.acinq.co: the items past its 1 MB reply limit are asked on their own, ten at a time, and all come back', async () => {
    const chain = makeChain();
    const txids = someTxs(chain, 90, 540, 800000);
    // in each batch of 45, the items after the first 20
    const past = txids.filter((txid, i) => i % 45 >= 20);
    for (const txid of past) chain.tooLargeInBatch.add(txid);
    const server = makeServer(chain, { version: 'ElectrumX 1.15.0' });
    await connectTo(server);

    const result = await BlueElectrum.multiGetTransactionByTxid(txids);

    expect(server.log.map(shape)).toEqual([
      'batch blockchain.transaction.get x45 verbose',
      ...Array(25).fill('one blockchain.transaction.get raw'),
      'batch blockchain.transaction.get x45 verbose',
      ...Array(25).fill('one blockchain.transaction.get raw'),
    ]);
    // ten at a time, not one after another
    expect(server.mostSinglesWaiting).toBe(10);
    for (const txid of txids) {
      const verbose = verboseOf(chain.txs[txid].tx, 800000);
      if (past.includes(txid)) expectSameInsAndOuts(result[txid], verbose);
      else expect(result[txid]).toEqual(asTheAppKeepsIt(verbose));
    }
  });

  it('a pending transaction decoded here has no confirmations, also with a pending parent (height -1)', async () => {
    const chain = makeChain();
    const [confirmed] = someTxs(chain, 1, 600, 840000);
    const [pending] = someTxs(chain, 1, 601, -1);
    chain.addHistory(addressOf(1), confirmed, 840000);
    chain.addHistory(addressOf(1), pending, -1);
    chain.tooLarge.add(confirmed);
    chain.tooLarge.add(pending);
    const server = makeServer(chain);
    await connectTo(server);
    await BlueElectrum.multiGetHistoryByAddress([addressOf(1)]);
    const cached = await watchCacheWrites();

    const result = await BlueElectrum.multiGetTransactionByTxid([confirmed, pending]);

    expect(result[pending].confirmations).toBe(0);
    expect(result[pending].blocktime).toBe(0);
    expect(result[confirmed].confirmations).toBe(TIP - 840000);
    // only the confirmed one is cached; a pending one isn't final
    expect(cached.mock.calls.map(([, row]) => row.cache_key)).toEqual([confirmed + '_verbose']);
  });
});

describe('a server that refuses a batch', () => {
  it('refused at once: asked again right away, verbose, in batches of 10, with the same results, cached as before', async () => {
    const chain = makeChain();
    const txids = someTxs(chain, 44, 1000, 840000);
    const pendingTxid = someTxs(chain, 1, 2000, -1)[0];
    for (const txid of txids) chain.addHistory(addressOf(1), txid, 840000);
    chain.addHistory(addressOf(2), pendingTxid, -1);
    // mainnet.foundationdevices.com: verbose batches of 30 and 100 refused, 10 answered
    const server = makeServer(chain, { batches: entry => (entry.params[0][1] && entry.params.length > 10 ? 'batch_limit' : 'answer') });
    await connectTo(server);
    await BlueElectrum.multiGetHistoryByAddress([addressOf(1), addressOf(2)]);
    const cached = await watchCacheWrites();

    const asked = [...txids, pendingTxid];
    // no timer has to run out: the refusal fails the batch at once
    const result = await BlueElectrum.multiGetTransactionByTxid(asked);

    expect(server.log.map(shape)).toEqual([
      'batch blockchain.scripthash.get_history x2',
      'batch blockchain.transaction.get x45 verbose',
      ...Array(4).fill('batch blockchain.transaction.get x10 verbose'),
      'batch blockchain.transaction.get x5 verbose',
    ]);
    // exactly what a batch the server took would have brought: the server's own confirmations and times
    for (const txid of asked) expect(result[txid]).toEqual(asTheAppKeepsIt(verboseOf(chain.txs[txid].tx, chain.txs[txid].height)));
    // and cached as before: everything but the pending one
    expect(cached.mock.calls.map(([, row]) => row.cache_key).sort()).toEqual(txids.map(txid => txid + '_verbose').sort());
    expect(consoleLog).not.toHaveBeenCalledWith("Can't get callback");

    // the connection remembers: the next fetch goes straight to batches of 10, without being refused first
    const again = await BlueElectrum.multiGetTransactionByTxid(txids.slice(0, 12));
    expect(again[txids[11]].txid).toBe(txids[11]);
    expect(server.log.slice(7).map(shape)).toEqual([
      'batch blockchain.transaction.get x10 verbose',
      'batch blockchain.transaction.get x2 verbose',
    ]);
    // so pulling to refresh again leaves no more refused batches behind
    expect(server.unanswered.length).toBe(1);
  });

  it('refusing every batch: the items are asked one by one, still verbose', async () => {
    const chain = makeChain();
    const txids = someTxs(chain, 12, 3000, 830000);
    const addresses = [];
    for (let n = 0; n < 30; n++) {
      addresses.push(addressOf(n));
      chain.addHistory(addressOf(n), txids[n % 12], 830000);
    }
    const server = makeServer(chain, { batches: () => 'batch_limit' });
    await connectTo(server);

    const historyResult = await BlueElectrum.multiGetHistoryByAddress(addresses);
    const txResult = await BlueElectrum.multiGetTransactionByTxid(txids);

    expect(server.log.map(shape)).toEqual([
      'batch blockchain.scripthash.get_history x30',
      'batch blockchain.scripthash.get_history x10',
      ...Array(30).fill('one blockchain.scripthash.get_history'),
      'batch blockchain.transaction.get x12 verbose',
      'batch blockchain.transaction.get x10 verbose',
      ...Array(12).fill('one blockchain.transaction.get verbose'),
    ]);
    for (let n = 0; n < 30; n++) {
      expect(historyResult[addresses[n]]).toEqual([{ tx_hash: txids[n % 12], height: 830000, address: addresses[n] }]);
    }
    for (const txid of txids) expect(txResult[txid]).toEqual(asTheAppKeepsIt(verboseOf(chain.txs[txid].tx, 830000)));
  });

  it('one by one, a transaction too large to send verbose is asked raw and decoded here', async () => {
    const chain = makeChain();
    const txids = someTxs(chain, 3, 3500, 830000);
    chain.tooLarge.add(txids[2]);
    const server = makeServer(chain, { batches: () => 'batch_limit' });
    await connectTo(server);

    const result = await BlueElectrum.multiGetTransactionByTxid(txids);

    expect(server.log.map(shape)).toEqual([
      'batch blockchain.transaction.get x3 verbose',
      ...Array(3).fill('one blockchain.transaction.get verbose'),
      'one blockchain.transaction.get raw',
    ]);
    expect(result[txids[0]]).toEqual(asTheAppKeepsIt(verboseOf(chain.txs[txids[0]].tx, 830000)));
    expect(result[txids[2]].txid).toBe(txids[2]);
    expect(result[txids[2]].vout.map(o => o.value)).toEqual([(1000 + 3502) / 1e8, (2000 + 3502) / 1e8]);
  });

  it('refusing batches above 20 items: smaller batches of 10 go through', async () => {
    const chain = makeChain();
    const addresses = [];
    for (let n = 0; n < 45; n++) {
      addresses.push(addressOf(n));
      chain.addUtxo(addressOf(n), 'ef'.repeat(32), n, 5000 + n, 820000);
    }
    const server = makeServer(chain, { batches: entry => (entry.params.length > 20 ? 'batch_limit' : 'answer') });
    await connectTo(server);

    const utxos = await BlueElectrum.multiGetUtxoByAddress(addresses);

    expect(server.log.map(shape)).toEqual([
      'batch blockchain.scripthash.listunspent x45',
      ...Array(4).fill('batch blockchain.scripthash.listunspent x10'),
      'batch blockchain.scripthash.listunspent x5',
    ]);
    for (let n = 0; n < 45; n++) {
      expect(utxos[addresses[n]]).toEqual([{ txId: 'ef'.repeat(32), vout: n, value: 5000 + n, height: 820000, address: addresses[n] }]);
    }
  });

  it('never answered: the batch is given up after the time limit, then smaller batches, then items one at a time', async () => {
    const chain = makeChain();
    const addresses = [];
    for (let n = 0; n < 25; n++) {
      addresses.push(addressOf(n));
      chain.setBalance(addressOf(n), 100 * n, n === 3 ? 7 : 0);
    }
    const server = makeServer(chain, { batches: () => 'silent' });
    await connectTo(server);

    const fetch = BlueElectrum.multiGetBalanceByAddress(addresses);
    let settled = false;
    fetch.then(
      () => (settled = true),
      () => (settled = true),
    );
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(server.log.map(shape).slice(-1)).toEqual(['batch blockchain.scripthash.get_balance x10']);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
    const balances = await fetch;

    expect(server.log.map(shape)).toEqual([
      'batch blockchain.scripthash.get_balance x25',
      'batch blockchain.scripthash.get_balance x10',
      ...Array(25).fill('one blockchain.scripthash.get_balance'),
    ]);
    expect(server.log.slice(2).map(entry => entry.params[0])).toEqual(addresses.map(scripthashOf));
    expect(balances.balance).toBe(addresses.reduce((sum, a, n) => sum + 100 * n, 0));
    expect(balances.unconfirmed_balance).toBe(7);
    expect(Object.keys(balances.addresses).sort()).toEqual([...addresses].sort());

    // and remembers it: the next call asks one by one straight away
    await BlueElectrum.multiGetBalanceByAddress(addresses.slice(0, 3));
    expect(server.log.slice(27).map(shape)).toEqual(Array(3).fill('one blockchain.scripthash.get_balance'));
    expect(server.unanswered.length).toBe(2);
  });
});

describe('nothing waits forever', () => {
  it('a server that answers no data request fails the call after the time limits', async () => {
    const chain = makeChain();
    const txids = someTxs(chain, 15, 4000, 830000);
    const server = makeServer(chain, { batches: () => 'silent', singles: () => 'silent' });
    await connectTo(server);

    const outcome = BlueElectrum.multiGetTransactionByTxid(txids).then(
      () => 'resolved',
      error => error.message,
    );
    await jest.advanceTimersByTimeAsync(3 * TIMEOUT_MS);

    expect(await outcome).toBe(`Electrum server did not answer blockchain.transaction.get in ${TIMEOUT_MS / 1000} s`);
    // the batch, one smaller batch, and the first ten items one by one, after which nothing more is sent
    expect(server.log.map(shape)).toEqual([
      'batch blockchain.transaction.get x15 verbose',
      'batch blockchain.transaction.get x10 verbose',
      ...Array(10).fill('one blockchain.transaction.get verbose'),
    ]);
  });

  it('a lost connection fails the call as before, without asking again', async () => {
    const chain = makeChain();
    const txids = someTxs(chain, 5, 5000, 830000);
    const server = makeServer(chain, { batches: () => 'close' });
    await connectTo(server);

    await expect(BlueElectrum.multiGetTransactionByTxid(txids)).rejects.toThrow('close connect');
    expect(server.log.map(shape)).toEqual(['batch blockchain.transaction.get x5 verbose']);
  });

  it('a connection the app closes fails what waits on it, without asking again', async () => {
    const chain = makeChain();
    const txids = someTxs(chain, 5, 5500, 830000);
    const server = makeServer(chain, { batches: () => 'silent' });
    await connectTo(server);

    const outcome = BlueElectrum.multiGetTransactionByTxid(txids).then(
      () => 'resolved',
      error => error.message,
    );
    await jest.advanceTimersByTimeAsync(1000);
    // e.g. after a keep-alive ping went unanswered (BlueElectrum's onError closes the connection and opens another)
    BlueElectrum.forceDisconnect();
    expect(await outcome).toBe('close connect');
    expect(server.log.map(shape)).toEqual(['batch blockchain.transaction.get x5 verbose']);
  });

  it('a new connection tries batches again', async () => {
    const chain = makeChain();
    const addresses = [addressOf(1), addressOf(2), addressOf(3)];
    const refusing = makeServer(chain, { batches: () => 'batch_limit' });
    await connectTo(refusing);
    await BlueElectrum.multiGetHistoryByAddress(addresses);
    expect(refusing.log.map(shape)).toEqual([
      'batch blockchain.scripthash.get_history x3',
      ...Array(3).fill('one blockchain.scripthash.get_history'),
    ]);

    BlueElectrum.forceDisconnect();
    const answering = makeServer(chain);
    await connectTo(answering);
    await BlueElectrum.multiGetHistoryByAddress(addresses);
    expect(answering.log.map(shape)).toEqual(['batch blockchain.scripthash.get_history x3']);
  });
});

describe("a Hot Vault's history", () => {
  const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  // two receives, a send with change, and a pending receive whose parent is unconfirmed too
  function walletChain() {
    const w = new HDSegwitBech32Wallet();
    w.setSecret(MNEMONIC);
    const [r0, r1, r2] = [0, 1, 2].map(i => w._getExternalAddressByIndex(i));
    const c0 = w._getInternalAddressByIndex(0);
    const chain = makeChain();
    const grand = chain.addTx(makeTx(1, [{ txid: '11'.repeat(32), vout: 0 }], [{ address: addressOf(900), value: 10000000 }]), 830000);
    const p1Tx = makeTx(
      2,
      [{ txid: grand, vout: 0 }],
      [
        { address: r0, value: 100000 },
        { address: addressOf(901), value: 9800000 },
      ],
    );
    const p1 = chain.addTx(p1Tx, 840000);
    const p2 = chain.addTx(makeTx(3, [{ txid: grand, vout: 0 }], [{ address: r1, value: 250000 }]), 840100);
    const t1 = chain.addTx(
      makeTx(
        4,
        [{ txid: p1, vout: 0 }],
        [
          { address: addressOf(902), value: 60000 },
          { address: c0, value: 39000 },
        ],
      ),
      845000,
    );
    const p3 = chain.addTx(makeTx(5, [{ txid: grand, vout: 0 }], [{ address: addressOf(903), value: 7000 }]), 0);
    const t2 = chain.addTx(makeTx(6, [{ txid: p3, vout: 0 }], [{ address: r2, value: 5000 }]), -1);
    chain.addHistory(r0, p1, 840000);
    chain.addHistory(r0, t1, 845000);
    chain.addHistory(r1, p2, 840100);
    chain.addHistory(r2, t2, -1);
    chain.addHistory(c0, t1, 845000);
    chain.setBalance(r1, 250000);
    chain.setBalance(r2, 0, 5000);
    chain.setBalance(c0, 39000);
    return { chain, ids: { p1, p2, t1, t2 } };
  }

  // what History shows of a transaction
  const shown = tx => ({
    txid: tx.txid,
    value: tx.value,
    confirmations: tx.confirmations,
    blocktime: tx.blocktime,
    received: tx.received,
    inputs: tx.inputs.map(i => [i.txid, i.vout, i.value, i.addresses]),
    outputs: tx.outputs.map(o => [o.value, o.n, o.scriptPubKey.addresses]),
  });

  async function loadHistory(server) {
    await connectTo(server);
    const w = new HDSegwitBech32Wallet();
    w.setSecret(MNEMONIC);
    await w.fetchBalance();
    await w.fetchTransactions();
    return w;
  }

  it('loads through a server that refuses verbose batches exactly as through one that takes them', async () => {
    const { chain, ids } = walletChain();
    const answering = makeServer(chain);
    const viaBatches = await loadHistory(answering);
    BlueElectrum.forceDisconnect();
    const refusing = makeServer(chain, { batches: entry => (entry.params[0][1] === true ? 'batch_limit' : 'answer') });
    const viaRetries = await loadHistory(refusing);

    expect(answering.log.every(entry => entry.batch)).toBe(true);
    expect(answering.unanswered).toEqual([]);
    const txs = viaBatches.getTransactions();
    expect(txs.map(tx => tx.txid).sort()).toEqual(Object.values(ids).sort());
    // confirmations and times included: the retries are verbose, so nothing is estimated
    expect(viaRetries.getTransactions().map(shown)).toEqual(txs.map(shown));
    expect(viaBatches.getBalance()).toBe(289000);
    expect(viaRetries.getBalance()).toBe(289000);
    // the wallet's transactions, then their inputs: each refused once, then asked one by one
    expect(refusing.unanswered.map(shape)).toEqual(['batch blockchain.transaction.get x4 verbose']);
    expect(refusing.log.filter(entry => entry.method === 'blockchain.transaction.get').map(shape)).toEqual([
      'batch blockchain.transaction.get x4 verbose',
      ...Array(4).fill('one blockchain.transaction.get verbose'),
      ...Array(3).fill('one blockchain.transaction.get verbose'),
    ]);
    expect(viaRetries.getTransactions().find(tx => tx.txid === ids.t2).confirmations).toBe(0);
    expect(viaRetries.getTransactions().find(tx => tx.txid === ids.t1).confirmations).toBe(TIP - 845000 + 1);
  });
});

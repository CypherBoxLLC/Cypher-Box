/* global jest, describe, it, expect, beforeEach, afterEach */
/**
 * GuardedElectrumClient: electrum-client with every request settling.
 *
 * Heavy-wallet test, 2026-11-12: mainnet.foundationdevices.com, and electrum.bitaroo.net when busy, refused a big
 * verbose transaction batch with `{"error":{"code":4,"message":"Batch limit exceeded"},"id":null}`. electrum-client
 * can't route a reply without an id ("Can't get callback"), so the batch never settled and History waited forever.
 *
 * The client runs here over a socket that goes nowhere: `net` is one whose sockets hand what the client writes to the
 * scripted server below, and there's no `tls`, so nothing can reach a real server.
 */
const { EventEmitter } = require('events');

// tests/setupAfterEnv.js (from #300 on) keeps unit suites from building an Electrum client; this one has no network
jest.unmock('electrum-client');

const GuardedElectrumClient = require('../../blue_modules/GuardedElectrumClient');

const TIMEOUT_MS = GuardedElectrumClient.REQUEST_TIMEOUT_MS;
const MAX_MS = GuardedElectrumClient.REQUEST_MAX_MS;
const BATCH_LIMIT_EXCEEDED = { jsonrpc: '2.0', error: { code: 4, message: 'Batch limit exceeded' }, id: null };

// Holds every request the client sends until the test answers it.
function makeServer() {
  const server = {
    socket: null,
    received: [],
    // the requests not answered yet, by method
    waiting(method) {
      return server.received.filter(r => !r.answered && r.method === method);
    },
    answer(request, result) {
      request.answered = true;
      server.socket.send(
        request.batch
          ? request.items.map(item => ({ jsonrpc: '2.0', id: item.id, result: result(item) }))
          : { jsonrpc: '2.0', id: request.id, result },
      );
    },
    send(message) {
      server.socket.send(message);
    },
    receive(message) {
      if (Array.isArray(message)) {
        server.received.push({ batch: true, method: message[0].method, items: message, ids: message.map(m => m.id) });
      } else {
        server.received.push({ batch: false, method: message.method, params: message.params, id: message.id });
      }
    },
  };
  return server;
}

let server;
class MockSocket extends EventEmitter {
  constructor() {
    super();
    server.socket = this;
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
    for (const line of String(data).split('\n')) if (line) server.receive(JSON.parse(line));
  }

  send(message) {
    Promise.resolve().then(() => this.emit('data', JSON.stringify(message) + '\n'));
  }
}

function track(promise) {
  const state = { settled: false, value: undefined, error: undefined };
  promise.then(
    value => {
      state.settled = true;
      state.value = value;
    },
    error => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}

const flush = () => jest.advanceTimersByTimeAsync(0);

let client;
let consoleLog;

beforeEach(async () => {
  jest.useFakeTimers();
  consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  server = makeServer();
  client = new GuardedElectrumClient({ Socket: MockSocket }, undefined, 50001, 'electrum.example.test', 'tcp');
  await client.connect();
});

afterEach(() => {
  client.close();
  jest.clearAllTimers();
  jest.useRealTimers();
  consoleLog.mockRestore();
});

describe('a server that answers', () => {
  it('gets the same requests as before, and the replies come back as before', async () => {
    const balance = track(client.blockchainScripthash_getBalance('aa'));
    const histories = track(client.blockchainScripthash_getHistoryBatch(['bb', 'cc']));
    await flush();

    expect(server.received).toEqual([
      { batch: false, method: 'blockchain.scripthash.get_balance', params: ['aa'], id: 1 },
      {
        batch: true,
        method: 'blockchain.scripthash.get_history',
        ids: [2, 3],
        items: [
          { jsonrpc: '2.0', method: 'blockchain.scripthash.get_history', params: ['bb'], id: 2 },
          { jsonrpc: '2.0', method: 'blockchain.scripthash.get_history', params: ['cc'], id: 3 },
        ],
      },
    ]);
    server.answer(server.received[0], { confirmed: 5, unconfirmed: 0 });
    server.answer(server.received[1], item => [{ tx_hash: item.params[0] + item.params[0], height: 1 }]);
    await flush();

    expect(balance.value).toEqual({ confirmed: 5, unconfirmed: 0 });
    expect(histories.value).toEqual([
      { jsonrpc: '2.0', id: 2, result: [{ tx_hash: 'bbbb', height: 1 }], param: 'bb' },
      { jsonrpc: '2.0', id: 3, result: [{ tx_hash: 'cccc', height: 1 }], param: 'cc' },
    ]);
    expect(client.callback_message_queue).toEqual({});
  });

  it('an error for one request reaches that request, as before', async () => {
    const tx = track(client.blockchainTransaction_get('ab'.repeat(32), true));
    await flush();
    server.send({ jsonrpc: '2.0', id: server.received[0].id, error: { code: 2, message: 'No such mempool or blockchain transaction' } });
    await flush();

    expect(tx.error).toEqual({ code: 2, message: 'No such mempool or blockchain transaction' });
    expect(client.callback_message_queue).toEqual({});
  });
});

describe('a refused batch', () => {
  it('fails at once with the server error, and nothing is kept waiting for it', async () => {
    const batch = track(client.blockchainTransaction_getBatch(['01'.repeat(32), '02'.repeat(32)], true));
    await flush();
    server.send(BATCH_LIMIT_EXCEEDED);
    await flush();

    expect(batch.error).toEqual({ code: 4, message: 'Batch limit exceeded' });
    expect(client.callback_message_queue).toEqual({});
    expect(consoleLog).not.toHaveBeenCalledWith("Can't get callback");
  });

  it('fails every batch waiting on the connection, since the reply cannot say which, but no single request', async () => {
    const first = track(client.blockchainScripthash_getBalanceBatch(['aa', 'bb']));
    const single = track(client.blockchainScripthash_getHistory('cc'));
    const second = track(client.blockchainTransaction_getBatch(['01'.repeat(32)], false));
    await flush();
    server.send(BATCH_LIMIT_EXCEEDED);
    await flush();

    expect(first.error).toEqual({ code: 4, message: 'Batch limit exceeded' });
    expect(second.error).toEqual({ code: 4, message: 'Batch limit exceeded' });
    expect(single.settled).toBe(false);

    // the single request is answered as usual, and a late reply to a failed batch is dropped as before
    server.answer(server.received[1], []);
    server.answer(server.received[0], () => ({ confirmed: 1, unconfirmed: 0 }));
    await flush();
    expect(single.value).toEqual([]);
    expect(consoleLog).toHaveBeenCalledWith("Can't get callback");
    expect(client.callback_message_queue).toEqual({});
  });

  it('also when the refusal comes as an array of errors without ids', async () => {
    const batch = track(client.blockchainScripthash_listunspentBatch(['aa', 'bb']));
    await flush();
    server.send([
      { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null },
      { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null },
    ]);
    await flush();

    expect(batch.error).toEqual({ code: -32600, message: 'Invalid Request' });
    expect(client.callback_message_queue).toEqual({});
  });

  it('with no batch waiting, a reply without an id is dropped as before', async () => {
    const single = track(client.blockchainScripthash_getBalance('aa'));
    await flush();
    server.send(BATCH_LIMIT_EXCEEDED);
    await flush();

    expect(consoleLog).toHaveBeenCalledWith("Can't get callback");
    expect(single.settled).toBe(false);
    server.answer(server.received[0], { confirmed: 0, unconfirmed: 0 });
    await flush();
    expect(single.value).toEqual({ confirmed: 0, unconfirmed: 0 });
  });
});

describe('a request with no reply', () => {
  it(`fails after ${TIMEOUT_MS / 1000} s, and a reply after that is dropped`, async () => {
    const batch = track(client.blockchainTransaction_getBatch(['01'.repeat(32)], true));
    const single = track(client.blockchainScripthash_getBalance('aa'));
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(batch.settled).toBe(false);
    expect(single.settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    expect(batch.error.message).toBe(`Electrum server did not answer blockchain.transaction.get in ${TIMEOUT_MS / 1000} s`);
    expect(single.error.message).toBe(`Electrum server did not answer blockchain.scripthash.get_balance in ${TIMEOUT_MS / 1000} s`);
    expect(client.callback_message_queue).toEqual({});

    server.answer(server.received[0], () => ({ txid: '01'.repeat(32) }));
    server.answer(server.received[1], { confirmed: 0, unconfirmed: 0 });
    await flush();
    expect(consoleLog).toHaveBeenCalledWith("Can't get callback");
  });

  it('a big reply still coming in over a slow network is waited for, however long it takes', async () => {
    const txids = ['01'.repeat(32), '02'.repeat(32)];
    const batch = track(client.blockchainTransaction_getBatch(txids, true));
    await flush();
    const [first, second] = server.received[0].ids;
    const line = JSON.stringify([
      { jsonrpc: '2.0', id: first, result: { txid: txids[0], padding: 'x'.repeat(5000) } },
      { jsonrpc: '2.0', id: second, result: { txid: txids[1], padding: 'y'.repeat(5000) } },
    ]);
    // a piece every 20 s for 2 minutes: never 30 s without anything, though far longer than 30 s in all
    const pieces = 6;
    const size = Math.ceil(line.length / pieces);
    for (let piece = 0; piece < pieces; piece++) {
      await jest.advanceTimersByTimeAsync(20000);
      expect(batch.settled).toBe(false);
      const last = piece === pieces - 1;
      server.socket.emit('data', line.slice(piece * size, (piece + 1) * size) + (last ? '\n' : ''));
    }
    await flush();

    expect(batch.error).toBeUndefined();
    expect(batch.value.map(item => [item.param, item.result.txid])).toEqual([
      [txids[0], txids[0]],
      [txids[1], txids[1]],
    ]);
    expect(client.callback_message_queue).toEqual({});
  });

  it(`but not past ${MAX_MS / 1000} s, even while something keeps coming`, async () => {
    const single = track(client.blockchainScripthash_getHistory('aa'));
    for (let waited = 0; waited < MAX_MS - 20000; waited += 20000) {
      await jest.advanceTimersByTimeAsync(20000);
      // part of some other reply
      server.socket.emit('data', '{"jsonrpc":"2.0","id":999,');
    }
    await jest.advanceTimersByTimeAsync(19999);
    expect(single.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    expect(single.error.message).toBe(`Electrum server did not answer blockchain.scripthash.get_history in ${MAX_MS / 1000} s`);
    expect(client.callback_message_queue).toEqual({});
  });

  it('a reply in time clears its timer', async () => {
    const single = track(client.blockchainScripthash_getBalance('aa'));
    await flush();
    server.answer(server.received[0], { confirmed: 3, unconfirmed: 0 });
    await flush();
    expect(single.value).toEqual({ confirmed: 3, unconfirmed: 0 });

    // after the answer only the client's own keep-alive is scheduled, which pings and is answered by nobody here
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(single.error).toBeUndefined();
  });

  it('a broadcast waits for its reply however long it takes: a missing one does not tell whether it went out', async () => {
    const broadcast = track(client.blockchainTransaction_broadcast('0200'));
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(broadcast.settled).toBe(false);

    server.answer(server.waiting('blockchain.transaction.broadcast')[0], 'ab'.repeat(32));
    await flush();
    expect(broadcast.value).toBe('ab'.repeat(32));
  });
});

describe('a connection that ends', () => {
  it('closed by the app: whatever still waits fails, a broadcast too, and nothing is kept', async () => {
    const batch = track(client.blockchainScripthash_getHistoryBatch(['aa', 'bb']));
    const single = track(client.blockchainScripthash_getBalance('cc'));
    const broadcast = track(client.blockchainTransaction_broadcast('0200'));
    await flush();
    client.close();
    await flush();

    expect(batch.error.message).toBe('close connect');
    expect(single.error.message).toBe('close connect');
    expect(broadcast.error.message).toBe('close connect');
    expect(client.callback_message_queue).toEqual({});
    // and their timers are gone with them
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(batch.error.message).toBe('close connect');
  });

  it('closed by the server: whatever still waits fails as before', async () => {
    const batch = track(client.blockchainScripthash_getHistoryBatch(['aa', 'bb']));
    await flush();
    server.socket.emit('close');
    await flush();

    expect(batch.error.message).toBe('close connect');
    expect(client.callback_message_queue).toEqual({});
  });

  it('a request on a connection that is down fails at once, as before', async () => {
    client.close();
    await expect(client.blockchainScripthash_getBalance('aa')).rejects.toThrow('Connection to server lost, please retry');
    await expect(client.blockchainScripthash_getBalanceBatch(['aa'])).rejects.toThrow('Connection to server lost, please retry');
  });
});

it('an empty batch resolves with nothing, without taking the place of the request before it', async () => {
  const single = track(client.blockchainScripthash_getBalance('aa'));
  await expect(client.blockchainScripthash_getBalanceBatch([])).resolves.toEqual([]);
  await flush();
  expect(server.received.length).toBe(1);

  server.answer(server.received[0], { confirmed: 9, unconfirmed: 0 });
  await flush();
  expect(single.value).toEqual({ confirmed: 9, unconfirmed: 0 });
});

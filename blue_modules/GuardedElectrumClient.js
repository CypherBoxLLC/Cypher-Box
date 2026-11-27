'use strict';
/**
 * The Electrum client BlueElectrum talks through: electrum-client, with every request settling.
 *
 * electrum-client keeps a callback for each request until a reply carrying that request's id comes back. Three cases
 * left a request waiting forever, and whatever awaited it (History, a send screen) with it:
 *
 * - A server that refuses a whole batch answers without an id, since JSON-RPC has none to give for it:
 *   `{"jsonrpc":"2.0","error":{"code":4,"message":"Batch limit exceeded"},"id":null}` from
 *   mainnet.foundationdevices.com and electrum.bitaroo.net (heavy-wallet test, 2026-11-12). electrum-client can't
 *   route that reply and drops it ("Can't get callback").
 * - A server that never answers a request.
 * - A connection the app closes itself: ElectrumClient.close() switches off onClose, which is what fails the requests
 *   still waiting when a connection ends.
 *
 * Here a batch refusal fails every batch waiting on that connection (the reply can't say which one it was; a batch that
 * wasn't the one is asked again by its caller, and a late reply to it is dropped as before), a request fails once
 * nothing has come from the server for REQUEST_TIMEOUT_MS while it waits (or after REQUEST_MAX_MS in any case), and
 * close() fails whatever still waits. A failed request's callback is removed, so nothing is kept for a reply that never
 * comes. A broadcast gets no time limit: a missing reply doesn't tell whether the transaction went out, so it waits as
 * before (and still fails when the connection ends).
 */
const ElectrumClient = require('electrum-client');

// Silence is what a dead connection, or a request the server dropped, looks like. A big reply coming in slowly over a
// slow phone network (a heavy wallet's verbose batch can be several MB) is still arriving, so it isn't cut off for
// taking long. Every batch a server answered in the heavy-wallet test began arriving within about 3 s.
const REQUEST_TIMEOUT_MS = 30000;
const REQUEST_MAX_MS = 180000;
const NO_TIME_LIMIT = new Set(['blockchain.transaction.broadcast']);

// a reply to no request: an error with a null id, alone or (from some servers) as every item of an array
function batchRefusal(msg) {
  const refusal = m => !!m && typeof m === 'object' && m.id === null && !!m.error;
  if (Array.isArray(msg)) return msg.length > 0 && msg.every(refusal) ? msg[0].error : null;
  return refusal(msg) ? msg.error : null;
}

class GuardedElectrumClient extends ElectrumClient {
  constructor(net, tls, port, host, protocol, options) {
    super(net, tls, port, host, protocol, options);
    this.requestTimeoutMs = REQUEST_TIMEOUT_MS;
    this.requestMaxMs = REQUEST_MAX_MS;
    // callback_message_queue keys of the batches still waiting for a reply
    this._waitingBatches = new Set();
    // when anything last came from the server
    this._lastDataAt = 0;
  }

  /**
   * Opens the socket the way electrum-client does, with the socket's end() switched off and, over TLS, the server's
   * certificate checked.
   *
   * electrum-client closes a connection by ending its socket and then destroying it: in close(), and when a reply can't
   * be parsed. On Android, react-native-tcp-socket removes the native socket on each of those calls, so the destroy
   * finds it gone and throws "No socket with id N" on a background thread, which kills the app. On a Galaxy A14 a server
   * accepted the connection and then refused it ("excessive resource usage"), BlueElectrum's bad-connection path closed
   * it, and the app crashed, then crashed again on relaunch against the same server. destroy() alone closes the socket.
   * Done here so it holds for every socket this client opens, including the new one reconnect() makes.
   */
  initSocket(protocol, options) {
    super.initSocket(protocol, options);
    this.conn.end = () => {};
    if (['tls', 'ssl'].includes(protocol || this._protocol)) validateCertificates(this.conn);
  }

  onRecv(chunk) {
    this._lastDataAt = Date.now();
    return super.onRecv(chunk);
  }

  request(method, params) {
    return this._settling(method, false, () => super.request(method, params));
  }

  requestBatch(method, params, secondParam) {
    // electrum-client files a batch's callback under its last item's id; an empty batch has no items, so it would take
    // the place of the request before it (and the server answers an empty batch with an error anyway)
    if (Array.isArray(params) && params.length === 0) return Promise.resolve([]);
    return this._settling(method, true, () => super.requestBatch(method, params, secondParam));
  }

  // Sends the request, then swaps the callback electrum-client filed for it for one that also settles in the cases above.
  _settling(method, isBatch, send) {
    const idBefore = this.id;
    const sentAt = Date.now();
    const reply = send();
    // nothing was sent (the connection is down), and the reply already says so
    if (this.id === idBefore) return reply;
    // the request's id; a batch's callback is filed under its last item's
    const key = this.id;
    const callback = this.callback_message_queue[key];
    if (!callback) return reply;

    let timer;
    const settle = (error, result) => {
      clearTimeout(timer);
      this._waitingBatches.delete(key);
      callback(error, result);
    };
    this.callback_message_queue[key] = settle;
    if (isBatch) this._waitingBatches.add(key);
    if (!NO_TIME_LIMIT.has(method) && this.requestTimeoutMs > 0) {
      const check = () => {
        if (this.callback_message_queue[key] !== settle) return;
        const now = Date.now();
        const silentFor = now - Math.max(sentAt, this._lastDataAt);
        const waitedFor = now - sentAt;
        if (silentFor < this.requestTimeoutMs && waitedFor < this.requestMaxMs) {
          // something came in meanwhile: wait until it's been quiet that long
          timer = setTimeout(check, Math.min(this.requestTimeoutMs - silentFor, this.requestMaxMs - waitedFor));
          return;
        }
        delete this.callback_message_queue[key];
        settle(new Error(`Electrum server did not answer ${method} in ${Math.round(waitedFor / 1000)} s`));
      };
      timer = setTimeout(check, this.requestTimeoutMs);
    }
    return reply;
  }

  response(msg) {
    const refusal = batchRefusal(msg);
    if (refusal && this._waitingBatches.size > 0) {
      console.log('Electrum server refused a batch:', JSON.stringify(refusal));
      for (const key of [...this._waitingBatches]) {
        const callback = this.callback_message_queue[key];
        delete this.callback_message_queue[key];
        this._waitingBatches.delete(key);
        // with the server's error, as electrum-client passes on any error a server sends
        if (callback) callback(refusal);
      }
      return;
    }
    return super.response(msg);
  }

  close() {
    super.close();
    for (const key of Object.keys(this.callback_message_queue)) {
      const callback = this.callback_message_queue[key];
      delete this.callback_message_queue[key];
      // the error the client gives when the server ends the connection
      callback(new Error('close connect'));
    }
  }
}

/**
 * Makes the wrapper electrum-client puts around a TLS socket open it with the server's certificate checked.
 *
 * electrum-client's TlsSocketWrapper opens its socket with `tls.connect({ port, host, rejectUnauthorized: false })`,
 * hardcoded, so whoever answered was taken for the server: anyone on the network path (a hostile Wi-Fi, an ISP) could
 * pose as it, show a false balance or history, swallow a transaction, or replace a just-sent one and get paid by its fee
 * bump (Electrum advisory GHSA-6jp4-8v48-cc5v). With `rejectUnauthorized: true` the certificate must come from an
 * authority the phone trusts and name the host dialed. node checks both. On the phone, blue_modules/tls.js passes the
 * flag to react-native-tcp-socket: iOS checks both; Android checks the chain, and the name once the hostname patch in
 * scripts/fix-compile-sdk.sh is in the build. A self-signed certificate is refused: a server of one's own needs a
 * certificate from a public authority, or its plain TCP port. The wrapper's socket is made inside connect(), so the
 * `tls` it was given is what's replaced here.
 */
function validateCertificates(wrapper) {
  const tls = wrapper._tls;
  wrapper._tls = {
    connect: (config, callback) => tls.connect({ ...config, rejectUnauthorized: true }, callback),
  };
}

GuardedElectrumClient.REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
GuardedElectrumClient.REQUEST_MAX_MS = REQUEST_MAX_MS;

module.exports = GuardedElectrumClient;

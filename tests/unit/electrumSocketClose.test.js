/* global jest, describe, it, expect, beforeEach, afterEach */
/**
 * Closing an Electrum connection must not crash Android.
 *
 * electrum-client closes a connection by ending its socket and then destroying it. On Android, react-native-tcp-socket
 * removes the native socket on each call, so the second finds it gone and throws "No socket with id N" on a background
 * thread, where nothing catches it and the app dies. A Galaxy A14 crashed that way when a server accepted the
 * connection and then refused it ("excessive resource usage"), and again on relaunch. GuardedElectrumClient switches off
 * end() on every socket it opens, so each close destroys the socket once.
 */
const { EventEmitter } = require('events');

// tests/setupAfterEnv.js keeps unit suites from building an Electrum client; this one has no network
jest.unmock('electrum-client');

const ElectrumClient = require('electrum-client');
const GuardedElectrumClient = require('../../blue_modules/GuardedElectrumClient');

// What react-native-tcp-socket 5.6.2 does on Android: end() and destroy() each remove the native socket, and the
// second call finds it gone and throws.
class AndroidLikeSocket extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.removed = false;
  }

  setTimeout() {}
  setEncoding() {}
  setKeepAlive() {}
  setNoDelay() {}
  write() {}

  connect(port, host, onConnected) {
    Promise.resolve().then(() => {
      this.emit('connect');
      onConnected();
    });
  }

  end() {
    this.calls.push('end');
    this.remove();
  }

  destroy() {
    this.calls.push('destroy');
    this.remove();
  }

  remove() {
    if (this.removed) throw new Error('No socket with id 2');
    this.removed = true;
  }
}

const net = { Socket: AndroidLikeSocket };
let consoleLog;

beforeEach(() => {
  jest.useFakeTimers();
  consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  consoleLog.mockRestore();
});

describe('closing an Electrum connection on Android', () => {
  it('crashes with the plain electrum-client, which is what the A14 hit', async () => {
    const plain = new ElectrumClient(net, undefined, 50001, 'electrum.example.test', 'tcp');
    await plain.connect();

    expect(() => plain.close()).toThrow('No socket with id');
  });

  it('destroys the socket once when the app closes the connection', async () => {
    const client = new GuardedElectrumClient(net, undefined, 50001, 'electrum.example.test', 'tcp');
    await client.connect();
    const socket = client.conn;

    expect(() => client.close()).not.toThrow();
    expect(socket.calls).toEqual(['destroy']);
  });

  it('destroys the socket once when a reply cannot be parsed', async () => {
    const client = new GuardedElectrumClient(net, undefined, 50001, 'electrum.example.test', 'tcp');
    await client.connect();
    const socket = client.conn;

    expect(() => socket.emit('data', 'not json\n')).not.toThrow();
    expect(socket.calls).toEqual(['destroy']);
    client.close();
  });

  it('switches end() off on the new socket a reconnect opens, too', async () => {
    const client = new GuardedElectrumClient(net, undefined, 50001, 'electrum.example.test', 'tcp');
    await client.connect();
    const first = client.conn;

    client.initSocket(); // what reconnect() does first
    const second = client.conn;
    second.end();

    expect(second).not.toBe(first);
    expect(second.calls).toEqual([]);
    client.close();
  });
});

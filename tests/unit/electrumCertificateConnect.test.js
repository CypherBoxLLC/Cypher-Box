/* global jest, describe, it, expect, beforeEach, afterEach */
/**
 * What BlueElectrum does when a server's certificate is refused, and with the built-in servers' new names.
 *
 * Every connection checks the server's certificate now (GuardedElectrumClient). A built-in server saved under a name its
 * certificate no longer carries is moved to the new name. A saved server whose certificate is refused is tried once and
 * the user is told what to do about it (it's their server); when the built-in servers' certificates are refused, that
 * is someone on the network posing as them, and the user is told that. A server that is merely down is retried as
 * before. The settings screen's test tells a refused certificate apart from a dead server.
 *
 * The real electrum-client runs here over sockets that go nowhere: `global.tls` is swapped for one that answers like an
 * Electrum server, or fails the handshake with the message a phone's TLS socket gives.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { EventEmitter } from 'events';
import loc from '../../loc';

// tests/setupAfterEnv.js keeps unit suites from building an Electrum client; this one has no network
jest.unmock('electrum-client');
jest.unmock('../../blue_modules/BlueElectrum');
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
// BlueElectrum shows no network alert while the app has no wallet (its hasNoWallets guard looks again later instead);
// these tests are about what the alert says, so they run with a wallet present
jest.mock('../../BlueApp', () => ({ getWallets: () => [{}] }));

const BlueElectrum = require('../../blue_modules/BlueElectrum');

// what react-native-tcp-socket hands JS when the handshake fails
const ANDROID_SELF_SIGNED = 'java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.';
const ANDROID_OTHER_NAME = 'Hostname node.example not verified:\n    certificate: sha256/abc=\n    DN: CN=other.example';
const IOS_REFUSED = 'The operation couldn’t be completed. (kCFStreamErrorDomainSSL error -9807.)';
const ANDROID_DOWN =
  'java.net.ConnectException: failed to connect to node.example (port 50002): connect failed: ECONNREFUSED (Connection refused)';
const ANSWER = 'answer';

// per host: ANSWER, or the handshake failure to report; '*' for any other host
let verdicts = {};
// every TLS connection asked for: { host, port, rejectUnauthorized }
let dialed = [];

class MockTlsSocket extends EventEmitter {
  setTimeout() {}
  setEncoding() {}
  setKeepAlive() {}
  setNoDelay() {}
  end() {}
  destroy() {}

  write(data) {
    for (const line of String(data).split('\n')) {
      if (!line) continue;
      const { id, method } = JSON.parse(line);
      let result = null;
      if (method === 'server.version') result = ['Fulcrum 1.10.0', '1.4'];
      if (method === 'blockchain.headers.subscribe') result = { height: 850000, hex: '00' };
      Promise.resolve().then(() => this.emit('data', JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'));
    }
  }
}

const mockTls = {
  connect(config, onConnected) {
    const socket = new MockTlsSocket();
    dialed.push({ host: config.host, port: config.port, rejectUnauthorized: config.rejectUnauthorized });
    const verdict = verdicts[config.host] ?? verdicts['*'] ?? ANDROID_DOWN;
    Promise.resolve().then(() => {
      if (verdict === ANSWER) {
        socket.emit('connect');
        onConnected();
      } else {
        socket.emit('error', verdict);
      }
    });
    return socket;
  },
};

const flush = () => new Promise(resolve => setImmediate(resolve));

const savedTls = global.tls;
let consoleLog;
let alertSpy;

beforeEach(async () => {
  global.tls = mockTls;
  verdicts = {};
  dialed = [];
  consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await AsyncStorage.clear();
});

afterEach(async () => {
  // the way out of the alert the user has: its Cancel resets the attempt count for the next test
  for (const [, , buttons] of alertSpy.mock.calls) buttons?.find(button => button.style === 'cancel')?.onPress();
  BlueElectrum.forceDisconnect();
  global.tls = savedTls;
  consoleLog.mockRestore();
  alertSpy.mockRestore();
});

async function saveServer(host, sslPort) {
  await AsyncStorage.setItem(BlueElectrum.ELECTRUM_HOST, host);
  await AsyncStorage.setItem(BlueElectrum.ELECTRUM_TCP_PORT, '');
  await AsyncStorage.setItem(BlueElectrum.ELECTRUM_SSL_PORT, sslPort);
}

describe('built-in servers under their new names', () => {
  it.each([
    ['mainnet.foundationdevices.com', 'mainnet-0.foundation.xyz'],
    ['electrum1.bluewallet.io', 'electrum2.bluewallet.io'],
    ['Electrum3.BlueWallet.io', 'electrum2.bluewallet.io'],
  ])('a server saved as %s is dialed as %s, the name its certificate is issued for, and saved so', async (oldHost, newHost) => {
    await saveServer(oldHost, '50002');
    verdicts['*'] = ANSWER;

    await BlueElectrum.connectMain();
    await flush();

    expect(dialed).toEqual([{ host: newHost, port: '50002', rejectUnauthorized: true }]);
    expect(await AsyncStorage.getItem(BlueElectrum.ELECTRUM_HOST)).toBe(newHost);
    expect(await AsyncStorage.getItem(BlueElectrum.ELECTRUM_SSL_PORT)).toBe('50002');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('canonicalHost moves only the renamed ones', () => {
    expect(BlueElectrum.canonicalHost('mainnet.foundationdevices.com')).toBe('mainnet-0.foundation.xyz');
    expect(BlueElectrum.canonicalHost(' ELECTRUM1.bluewallet.io ')).toBe('electrum2.bluewallet.io');
    expect(BlueElectrum.canonicalHost('node.example')).toBe('node.example');
    expect(BlueElectrum.canonicalHost('')).toBe('');
    expect(BlueElectrum.canonicalHost(null)).toBe(null);
  });

  it('every built-in server has a TLS port, and none of the dropped or renamed hosts is left', () => {
    const hosts = BlueElectrum.hardcodedPeers.map(peer => peer.host);
    expect(BlueElectrum.hardcodedPeers.every(peer => peer.ssl && !peer.tcp)).toBe(true);
    for (const gone of [
      'mainnet.foundationdevices.com',
      'electrum1.bluewallet.io',
      'electrum3.bluewallet.io',
      'bitcoin.lukechilds.co',
      'electrum.bitaroo.net',
      'electrum.jochen-hoenicke.de',
    ]) {
      expect(hosts).not.toContain(gone);
    }
  });
});

describe('a saved server whose certificate is refused', () => {
  it.each([
    ['self-signed, on Android', ANDROID_SELF_SIGNED],
    ['issued for another name, on Android', ANDROID_OTHER_NAME],
    ['on iOS', IOS_REFUSED],
  ])('is tried once and the user is told what to do (%s)', async (_, failure) => {
    await saveServer('node.example', '50002');
    verdicts['node.example'] = failure;

    await BlueElectrum.connectMain();
    await flush();

    expect(dialed.length).toBe(1);
    expect(dialed[0]).toEqual({ host: 'node.example', port: '50002', rejectUnauthorized: true });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe(loc.settings.electrum_cert_refused_title);
    expect(message).toBe(loc.formatString(loc.settings.electrum_cert_refused_saved, { server: 'node.example:50002' }));
    expect(message).toContain('TCP port');
    expect(buttons.map(button => button.text)).toEqual([loc.wallets.list_tryagain, loc.settings.electrum_reset, loc._.cancel]);
  });

  it('a saved server that is merely down is retried as before, and gets the network error', async () => {
    await saveServer('node.example', '50002');
    verdicts['node.example'] = ANDROID_DOWN;

    await BlueElectrum.connectMain();
    await flush();

    expect(dialed.length).toBe(5);
    expect(dialed.every(d => d.host === 'node.example')).toBe(true);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message] = alertSpy.mock.calls[0];
    expect(title).toBe(loc.errors.network);
    expect(message).toBe(loc.formatString(loc.settings.electrum_unable_to_connect, { server: 'node.example:50002' }));
  }, 15000);
});

describe('built-in servers whose certificates are refused', () => {
  it('each is tried in turn, then the user is warned about the network', async () => {
    verdicts['*'] = IOS_REFUSED;

    await BlueElectrum.connectMain();
    await flush();

    expect(dialed.length).toBe(5);
    expect(dialed.every(d => d.rejectUnauthorized === true)).toBe(true);
    // the rotation reaches every built-in server (it used to skip the last one)
    expect(new Set(dialed.map(d => d.host))).toEqual(new Set(BlueElectrum.hardcodedPeers.map(peer => peer.host)));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message] = alertSpy.mock.calls[0];
    const last = dialed[dialed.length - 1];
    expect(title).toBe(loc.settings.electrum_cert_refused_title);
    expect(message).toBe(loc.formatString(loc.settings.electrum_cert_refused_default, { server: `${last.host}:${last.port}` }));
    expect(message).toContain('another network');
  }, 15000);

  it('one impostor among them is skipped and the next server is used', async () => {
    verdicts['*'] = ANSWER;
    const first = BlueElectrum.hardcodedPeers.map(peer => peer.host);
    // whichever is dialed first refuses; found out by dialing
    verdicts.__first = true;
    const original = mockTls.connect;
    mockTls.connect = (config, onConnected) => {
      if (verdicts.__first) {
        verdicts.__first = false;
        verdicts[config.host] = ANDROID_SELF_SIGNED;
      }
      return original.call(mockTls, config, onConnected);
    };
    try {
      await BlueElectrum.connectMain();
      await flush();
    } finally {
      mockTls.connect = original;
    }

    expect(dialed.length).toBe(2);
    expect(dialed[0].host).not.toBe(dialed[1].host);
    expect(first).toContain(dialed[1].host);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe('testing a server from settings', () => {
  it('a refused certificate is reported as such, not as a server that is down', async () => {
    verdicts['node.example'] = ANDROID_SELF_SIGNED;
    await expect(BlueElectrum.testConnection('node.example', '', '50002')).rejects.toBeInstanceOf(BlueElectrum.ElectrumCertificateError);
    await expect(BlueElectrum.testConnection('node.example', '', '50002')).rejects.toMatchObject({ host: 'node.example', port: '50002' });
  });

  it('a server that is down is false, one that answers is true', async () => {
    verdicts['down.example'] = ANDROID_DOWN;
    verdicts['up.example'] = ANSWER;
    expect(await BlueElectrum.testConnection('down.example', '', '50002')).toBe(false);
    expect(await BlueElectrum.testConnection('up.example', '', '50002')).toBe(true);
    expect(dialed.every(d => d.rejectUnauthorized === true)).toBe(true);
  });
});

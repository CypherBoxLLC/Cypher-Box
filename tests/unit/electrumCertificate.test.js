/* global jest, describe, it, expect, beforeAll, afterAll */
/**
 * An Electrum TLS connection checks the server's certificate.
 *
 * electrum-client opens its TLS socket with `rejectUnauthorized: false` hardcoded, so until now whoever answered was
 * taken for the server: anyone on the network path could pose as it. GuardedElectrumClient turns the check on for every
 * socket it opens (blue_modules/GuardedElectrumClient.js), blue_modules/tls.js passes it on to the phone's socket, and
 * blue_modules/electrumCertificate.js tells a refused certificate from a server that is down, so the user can be told
 * what to do about it.
 *
 * The real electrum-client runs here against a TLS server on this machine with a self-signed certificate: the plain
 * client connects to it, the guarded one refuses it, and nothing is sent to a server that did not pass.
 */
const net = require('net');
const tls = require('tls');

// tests/setupAfterEnv.js keeps unit suites from building an Electrum client; this one reaches only this machine
jest.unmock('electrum-client');
// tests/setup.js stubs react-native-tcp-socket with a keychain look-alike; blue_modules/tls.js needs createConnection
jest.mock('react-native-tcp-socket', () => ({ createConnection: jest.fn(() => ({ on: () => {} })) }));

const ElectrumClient = require('electrum-client');
const GuardedElectrumClient = require('../../blue_modules/GuardedElectrumClient');
const { isCertificateError, ElectrumCertificateError } = require('../../blue_modules/electrumCertificate');
const TcpSocket = require('react-native-tcp-socket');
const rnTls = require('../../blue_modules/tls');

// A self-signed certificate for localhost / 127.0.0.1, made fresh for each run so that no key material sits in the
// repository: an EC key from node's crypto, and the X.509 structure built here from the few DER pieces it takes.
const crypto = require('crypto');

function der(tag, ...parts) {
  const content = Buffer.concat(parts.map(part => (Buffer.isBuffer(part) ? part : Buffer.from(part))));
  const length = content.length;
  const lengthBytes = length < 0x80 ? [length] : length < 0x100 ? [0x81, length] : [0x82, Math.floor(length / 256), length % 256];
  return Buffer.concat([Buffer.from([tag, ...lengthBytes]), content]);
}
const SEQUENCE = (...parts) => der(0x30, ...parts);
const SET = (...parts) => der(0x31, ...parts);
const INTEGER = small => der(0x02, Buffer.from([small]));
const OID = bytes => der(0x06, Buffer.from(bytes));
const UTF8_STRING = text => der(0x0c, text);
const UTC_TIME = text => der(0x17, text);
const OCTET_STRING = bytes => der(0x04, bytes);
const BIT_STRING = bytes => der(0x03, Buffer.concat([Buffer.from([0]), bytes]));
const EXPLICIT = (n, ...parts) => der(0xa0 + n, ...parts);
const IMPLICIT = (n, bytes) => der(0x80 + n, bytes);
const ECDSA_WITH_SHA256 = OID([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
const COMMON_NAME = OID([0x55, 0x04, 0x03]);
const SUBJECT_ALT_NAME = OID([0x55, 0x1d, 0x11]);

function selfSignedCertificate() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const name = SEQUENCE(SET(SEQUENCE(COMMON_NAME, UTF8_STRING('localhost'))));
  const tbsCertificate = SEQUENCE(
    EXPLICIT(0, INTEGER(2)), // v3
    INTEGER(1), // serial
    SEQUENCE(ECDSA_WITH_SHA256),
    name, // issuer
    SEQUENCE(UTC_TIME('200101000000Z'), UTC_TIME('491231235959Z')),
    name, // subject
    publicKey.export({ type: 'spki', format: 'der' }),
    EXPLICIT(
      3,
      SEQUENCE(SEQUENCE(SUBJECT_ALT_NAME, OCTET_STRING(SEQUENCE(IMPLICIT(2, 'localhost'), IMPLICIT(7, Buffer.from([127, 0, 0, 1])))))),
    ),
  );
  const signature = crypto.sign('sha256', tbsCertificate, { key: privateKey, dsaEncoding: 'der' });
  const certificate = SEQUENCE(tbsCertificate, SEQUENCE(ECDSA_WITH_SHA256), BIT_STRING(signature));
  const body = certificate
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n');
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`,
  };
}

describe('isCertificateError', () => {
  it.each([
    // Android: react-native-tcp-socket hands JS the native exception's text
    ['java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.'],
    ['Hostname bitcoin.lukechilds.co not verified:\n    certificate: sha256/abc=\n    DN: O=ElectrumX'],
    ['javax.net.ssl.SSLHandshakeException: Chain validation failed'],
    ['java.security.cert.CertificateException: No subjectAltNames on the certificate match'],
    // iOS: the NSError's description
    ['The operation couldn’t be completed. (kCFStreamErrorDomainSSL error -9807.)'],
    ['The operation couldn’t be completed. (OSStatus error -9843.)'],
    // node: an Error with a code
    [Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })],
    [Object.assign(new Error('self signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })],
    [Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' })],
    [
      Object.assign(new Error("Hostname/IP does not match certificate's altnames: Host: x. is not cert's CN: y"), {
        code: 'ERR_TLS_CERT_ALTNAME_INVALID',
      }),
    ],
    [Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })],
  ])('knows a refused certificate: %s', e => {
    expect(isCertificateError(e)).toBe(true);
  });

  it.each([
    [
      'java.net.ConnectException: failed to connect to electrum.example (port 50002) from /:: (port 0): connect failed: ECONNREFUSED (Connection refused)',
    ],
    ['java.net.SocketTimeoutException: failed to connect to electrum.example (port 50002) after 10000ms'],
    ['java.net.UnknownHostException: Unable to resolve host "electrum.example": No address associated with hostname'],
    ['Connection refused'],
    ['connect timeout'],
    [Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:50002'), { code: 'ECONNREFUSED' })],
    [Object.assign(new Error('getaddrinfo ENOTFOUND electrum.example'), { code: 'ENOTFOUND' })],
    [new Error('close connect')],
    [undefined],
    [null],
  ])('and a server that is simply down from one: %s', e => {
    expect(isCertificateError(e)).toBe(false);
  });

  it('ElectrumCertificateError names the server and keeps the cause', () => {
    const error = new ElectrumCertificateError('node.example', '50002', 'Trust anchor for certification path not found.');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ElectrumCertificateError');
    expect(error.host).toBe('node.example');
    expect(error.port).toBe('50002');
    expect(error.message).toContain('node.example:50002');
    expect(error.message).toContain('Trust anchor');
  });
});

describe("the phone's TLS socket (blue_modules/tls.js)", () => {
  it('checks the certificate unless told not to, as node does', () => {
    rnTls.connect({ host: 'electrum.example', port: 50002 }, () => {});
    rnTls.connect({ host: 'electrum.example', port: 50002, rejectUnauthorized: true }, () => {});
    rnTls.connect({ host: 'electrum.example', port: 50002, rejectUnauthorized: false }, () => {});
    const options = TcpSocket.createConnection.mock.calls.map(call => call[0]);
    expect(options.map(o => o.tlsCheckValidity)).toEqual([true, true, false]);
    expect(options.every(o => o.tls === true && o.host === 'electrum.example' && o.port === 50002)).toBe(true);
  });
});

describe('GuardedElectrumClient over TLS', () => {
  function fakeTls() {
    return {
      connect: jest.fn((config, onConnected) => {
        const socket = new (require('events').EventEmitter)();
        Object.assign(socket, {
          setTimeout() {},
          setEncoding() {},
          setKeepAlive() {},
          setNoDelay() {},
          end() {},
          destroy() {},
          write() {},
        });
        Promise.resolve().then(() => {
          socket.emit('connect');
          onConnected();
        });
        return socket;
      }),
    };
  }

  it('asks for the certificate to be checked, on every socket it opens', async () => {
    const fake = fakeTls();
    const client = new GuardedElectrumClient(net, fake, 50002, 'electrum.example', 'tls');
    client.onError = () => {};
    await client.connect();
    client.close();

    // what reconnect() does before dialing again
    client.initSocket();
    await client.connect();
    client.close();

    expect(fake.connect).toHaveBeenCalledTimes(2);
    for (const [config] of fake.connect.mock.calls) {
      expect(config).toMatchObject({ host: 'electrum.example', port: 50002, rejectUnauthorized: true });
    }
  });

  it('the plain client asks for no check, which is the hole', async () => {
    const fake = fakeTls();
    const client = new ElectrumClient(net, fake, 50002, 'electrum.example', 'tls');
    client.onError = () => {};
    await client.connect();
    client.conn.end = () => {};
    client.close();
    expect(fake.connect.mock.calls[0][0].rejectUnauthorized).toBe(false);
  });
});

describe('against a server with a self-signed certificate', () => {
  let server;
  let port;
  let served = 0;

  beforeAll(async () => {
    const { key, cert } = selfSignedCertificate();
    const parsed = new crypto.X509Certificate(cert);
    expect(parsed.subject).toBe('CN=localhost');
    expect(parsed.subjectAltName).toBe('DNS:localhost, IP Address:127.0.0.1');
    expect(parsed.checkIssued(parsed)).toBe(true);
    server = tls.createServer({ key, cert }, socket => {
      socket.on('error', () => {});
      socket.on('data', data => {
        served++;
        for (const line of String(data).split('\n')) {
          if (!line) continue;
          const { id } = JSON.parse(line);
          socket.write(JSON.stringify({ jsonrpc: '2.0', id, result: ['ElectrumX 1.16.0', '1.4'] }) + '\n');
        }
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(() => {
    server.close();
  });

  it('the plain electrum-client connects and talks to it, whoever it is', async () => {
    const plain = new ElectrumClient(net, tls, port, 'localhost', 'tls');
    plain.onError = () => {};
    await plain.connect();
    const version = await plain.server_version('test', '1.4');
    expect(version[0]).toBe('ElectrumX 1.16.0');
    plain.conn.end = () => {};
    plain.close();
    expect(served).toBeGreaterThan(0);
  });

  it('the guarded client refuses it, for its certificate, before anything is sent', async () => {
    served = 0;
    const client = new GuardedElectrumClient(net, tls, port, 'localhost', 'tls');
    const errors = [];
    client.onError = e => errors.push(e);

    let refused;
    try {
      await client.connect();
    } catch (e) {
      refused = e;
    }
    client.close();

    expect(refused).toBeDefined();
    expect(refused.code).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
    expect(isCertificateError(refused)).toBe(true);
    expect(errors.every(isCertificateError)).toBe(true);
    expect(served).toBe(0);
  });
});

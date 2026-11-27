/**
 * @fileOverview adapter for ReactNative TCP module
 * This module mimics the nodejs tls api and is intended to work in RN environment.
 * @see https://github.com/Rapsssito/react-native-tcp-socket
 */

import TcpSocket from 'react-native-tcp-socket';

/**
 * Constructor function. Mimicking nodejs/tls api
 *
 * @constructor
 */
function connect(config, callback) {
  const client = TcpSocket.createConnection(
    {
      port: config.port,
      host: config.host,
      tls: true,
      // checked unless the caller says not to, as node's tls.connect() does: the certificate must come from an authority
      // the phone trusts and name the host (on Android the name only with the patch in scripts/fix-compile-sdk.sh)
      tlsCheckValidity: config.rejectUnauthorized !== false,
    },
    callback,
  );

  // defaults:
  this._noDelay = true;

  // functions not supported by RN module, yet:
  client.setTimeout = () => {};
  client.setEncoding = () => {};
  client.setKeepAlive = () => {};

  // we will save `noDelay` and proxy it to socket object when its actually created and connected:
  const realSetNoDelay = client.setNoDelay; // reference to real setter
  client.setNoDelay = noDelay => {
    this._noDelay = noDelay;
  };

  client.on('connect', () => {
    realSetNoDelay.apply(client, [this._noDelay]);
  });

  return client;
}

module.exports.connect = connect;

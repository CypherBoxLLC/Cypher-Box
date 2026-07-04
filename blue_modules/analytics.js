import { getUniqueId } from 'react-native-device-info';
import Bugsnag from '@bugsnag/react-native';
const BlueApp = require('../BlueApp');

/**
 * in case Bugsnag was started, but user decided to opt out while using the app, we have this
 * flag `userHasOptedOut` and we forbid logging in `onError` handler
 * @type {boolean}
 */
let userHasOptedOut = false;

if (process.env.NODE_ENV !== 'development') {
  (async () => {
    const uniqueID = await getUniqueId();
    const doNotTrack = await BlueApp.isDoNotTrackEnabled();

    if (doNotTrack) {
      // dont start Bugsnag at all
      return;
    }

    Bugsnag.start({
      collectUserIp: false,
      // Don't record console.* as breadcrumbs (omit 'log'): the app logs
      // around auth and payment flows, and console breadcrumbs would ship
      // that context (including tokens) with any later crash report.
      enabledBreadcrumbTypes: ['navigation', 'request', 'process', 'user', 'state', 'error', 'manual'],
      // Default redactedKeys is only ['password']; widen it so secret-shaped
      // keys are scrubbed from metadata and breadcrumbs before upload.
      redactedKeys: [
        'password',
        /token/i,
        /secret/i,
        'accessToken',
        'refreshToken',
        'codeVerifier',
        'authorizationCode',
        'mnemonic',
        'seed',
        'privateKey',
        'xprv',
        'passphrase',
        'otp',
        'apiKey',
        'authorization',
      ],
      user: {
        id: uniqueID,
      },
      onError: function (event) {
        return !userHasOptedOut;
      },
    });
  })();
}

const A = async event => {};

A.ENUM = {
  INIT: 'INIT',
  GOT_NONZERO_BALANCE: 'GOT_NONZERO_BALANCE',
  GOT_ZERO_BALANCE: 'GOT_ZERO_BALANCE',
  CREATED_WALLET: 'CREATED_WALLET',
  CREATED_LIGHTNING_WALLET: 'CREATED_LIGHTNING_WALLET',
  APP_UNSUSPENDED: 'APP_UNSUSPENDED',
  NAVIGATED_TO_WALLETS_HODLHODL: 'NAVIGATED_TO_WALLETS_HODLHODL',
};

A.setOptOut = value => {
  if (value) userHasOptedOut = true;
};

A.logError = errorString => {
  console.error(errorString);
  Bugsnag.notify(new Error(String(errorString)));
};

module.exports = A;

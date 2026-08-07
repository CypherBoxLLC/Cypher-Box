// Simple GroundControl utility for vault push notifications
const AsyncStorage = require('@react-native-async-storage/async-storage').default;
const Frisbee = require('frisbee');
const constants = require('./constants');

const PUSH_TOKEN = 'PUSH_TOKEN';
const ONCHAIN_SUBSCRIPTIONS_ENABLED = 'ONCHAIN_SUBSCRIPTIONS_ENABLED';

console.log('[GroundControl] Module loading...');

const GroundControl = {
  getPushToken: async () => {
    try {
      let token = await AsyncStorage.getItem(PUSH_TOKEN);
      token = JSON.parse(token);
      return token;
    } catch (_) {}
    return false;
  },

  /**
   * Reads the same onchain-subscription consent flag as
   * blue_modules/notifications.js, which owns the key and its one-time
   * migration. Resolution is identical here (unset falls back to token
   * presence) so both entry points agree even if this one runs first.
   */
  isOnchainSubscriptionEnabled: async () => {
    try {
      const stored = await AsyncStorage.getItem(ONCHAIN_SUBSCRIPTIONS_ENABLED);
      if (stored !== null) return stored === '1';
      return !!(await GroundControl.getPushToken());
    } catch (_) {
      // Fail closed: on a storage error never upload wallet data.
      return false;
    }
  },

  majorTomToGroundControl: async function(addresses, hashes, txids) {
    if (!Array.isArray(addresses) || !Array.isArray(hashes) || !Array.isArray(txids))
      throw new Error('no addresses or hashes or txids provided');

    // Consent gate, mirroring notifications.js. Without this, minting a push
    // token for an unrelated feature would silently start uploading vault
    // addresses from the cold/hot vault screens.
    if (!(await GroundControl.isOnchainSubscriptionEnabled())) {
      console.log('[GroundControl] Onchain subscriptions off, skipping subscription');
      return;
    }

    const pushToken = await GroundControl.getPushToken();
    console.log('[GroundControl] Push token:', pushToken);
    if (!pushToken || !pushToken.token || !pushToken.os) {
      console.log('[GroundControl] No push token, skipping subscription');
      console.log('[GroundControl] This means push notifications are not enabled for this device');
      return;
    }

    const baseURI = constants.groundControlUri;
    const api = new Frisbee({ baseURI });

    try {
      const response = await api.post(
        '/majorTomToGroundControl',
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          },
          body: {
            addresses,
            hashes,
            txids,
            token: pushToken.token,
            os: pushToken.os,
          },
        },
      );
      console.log('[GroundControl] Subscription response:', response);
      return response;
    } catch (err) {
      console.error('[GroundControl] Subscription error:', err);
      throw err;
    }
  },
};

module.exports = GroundControl;

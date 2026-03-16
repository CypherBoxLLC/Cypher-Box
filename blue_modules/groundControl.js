// Simple GroundControl utility for vault push notifications
import AsyncStorage from '@react-native-async-storage/async-storage';
import Frisbee from 'frisbee';
import constants from './constants';

const PUSH_TOKEN = 'PUSH_TOKEN';

const GroundControl = {
  getPushToken: async () => {
    try {
      let token = await AsyncStorage.getItem(PUSH_TOKEN);
      token = JSON.parse(token);
      return token;
    } catch (_) {}
    return false;
  },

  majorTomToGroundControl: async function(addresses, hashes, txids) {
    if (!Array.isArray(addresses) || !Array.isArray(hashes) || !Array.isArray(txids))
      throw new Error('no addresses or hashes or txids provided');
    
    const pushToken = await GroundControl.getPushToken();
    if (!pushToken || !pushToken.token || !pushToken.os) {
      console.log('[GroundControl] No push token, skipping subscription');
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

export default GroundControl;

import PushNotificationIOS from '@react-native-community/push-notification-ios';
import { Alert, Platform } from 'react-native';
import Frisbee from 'frisbee';
import { getApplicationName, getVersion, getSystemName, getSystemVersion, hasGmsSync, hasHmsSync } from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';
import loc from '../loc';
import { requestNotifications } from 'react-native-permissions';

const PushNotification = require('react-native-push-notification');
const constants = require('./constants');
const PUSH_TOKEN = 'PUSH_TOKEN';
const GROUNDCONTROL_BASE_URI = 'GROUNDCONTROL_BASE_URI';
const NOTIFICATIONS_STORAGE = 'NOTIFICATIONS_STORAGE';
const NOTIFICATIONS_NO_AND_DONT_ASK_FLAG = 'NOTIFICATIONS_NO_AND_DONT_ASK_FLAG';
const ONCHAIN_SUBSCRIPTIONS_ENABLED = 'ONCHAIN_SUBSCRIPTIONS_ENABLED';
let alreadyConfigured = false;
let baseURI = constants.groundControlUri;

function Notifications(props) {
  async function _setPushToken(token) {
    token = JSON.stringify(token);
    return AsyncStorage.setItem(PUSH_TOKEN, token);
  }

  Notifications.getPushToken = async () => {
    try {
      let token = await AsyncStorage.getItem(PUSH_TOKEN);
      token = JSON.parse(token);
      return token;
    } catch (_) {}
    return false;
  };

  Notifications.isNotificationsCapable = hasGmsSync() || hasHmsSync() || Platform.OS !== 'android';
  /**
   * Calls `configure`, which tries to obtain push token, save it, and registers all associated with
   * notifications callbacks
   *
   * @returns {Promise<boolean>} TRUE if acquired token, FALSE if not
   */
  const configureNotifications = async function () {
    return new Promise(function (resolve) {
      requestNotifications(['alert', 'sound', 'badge']).then(({ status, _ }) => {
        if (status === 'granted') {
          PushNotification.configure({
            // (optional) Called when Token is generated (iOS and Android)
            onRegister: async function (token) {
              console.log('TOKEN:', token);
              alreadyConfigured = true;
              await _setPushToken(token);
              resolve(true);
            },

            // (required) Called when a remote is received or opened, or local notification is opened
            onNotification: async function (notification) {
              // SILENT MAINTENANCE PUSH (content-available, no alert):
              // GroundControl wakes the app a few hours before the earliest
              // capsule expiry so the wallet can hand due VTXOs to the ASP
              // for a delegated refresh, unattended. Detected by the
              // `arkMaintenance` marker in the payload. Must run BEFORE the
              // tap handler (this is not a tap) and must call finish() only
              // AFTER the maintenance completes — that's iOS's background
              // execution window contract (~30s budget; the delegated
              // submit returns in seconds once the ASP accepts).
              try {
                const maintData = Object.assign({}, notification.data, notification.data && notification.data.data);
                if (notification.arkMaintenance || (maintData && maintData.arkMaintenance)) {
                  // eslint-disable-next-line @typescript-eslint/no-var-requires
                  const bg = require('../src/services/ark/backgroundRefresh');
                  try {
                    await bg.runArkBackgroundMaintenance('push');
                    notification.finish(PushNotificationIOS.FetchResult.NewData);
                  } catch (maintErr) {
                    console.warn('ark background maintenance failed:', maintErr);
                    notification.finish(PushNotificationIOS.FetchResult.ResultFailed);
                  }
                  return;
                }
              } catch (detectErr) {
                console.warn('ark maintenance-push detection failed, continuing:', detectErr);
              }

              // This configure() REPLACES the boot-time one registered by
              // src/services/ark/notificationHandler.ts (the library only
              // honors the last caller). Route Ark capsule taps through the
              // same shared handler so expiry-warning / payment-received
              // taps keep deep-linking after GroundControl notifications
              // are enabled. Lazy require avoids a module cycle at boot.
              try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const arkHandler = require('../src/services/ark/notificationHandler');
                if (arkHandler.handleArkNotificationTap(notification)) {
                  notification.finish(PushNotificationIOS.FetchResult.NoData);
                  return;
                }
              } catch (arkErr) {
                console.warn('ark tap handler failed, continuing:', arkErr);
              }

              // since we do not know whether we:
              // 1) received notification while app is in background (and storage is not decrypted so wallets are not loaded)
              // 2) opening this notification right now but storage is still unencrypted
              // 3) any of the above but the storage is decrypted, and app wallets are loaded
              //
              // ...we save notification in internal notifications queue thats gona be processed later (on unsuspend with decrypted storage)

              const payload = Object.assign({}, notification, notification.data);
              if (notification.data && notification.data.data) Object.assign(payload, notification.data.data);
              delete payload.data;
              // ^^^ weird, but sometimes payload data is not in `data` but in root level
              console.log('got push notification', payload);

              await Notifications.addNotification(payload);

              // (required) Called when a remote is received or opened, or local notification is opened
              notification.finish(PushNotificationIOS.FetchResult.NoData);

              // Foreground transfers are otherwise invisible (the OS shows
              // no banner while the app is active) — surface them in-app.
              try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const arkHandler = require('../src/services/ark/notificationHandler');
                arkHandler.maybeShowForegroundTransferBanner(payload);
              } catch (bannerErr) {
                console.warn('foreground transfer banner failed:', bannerErr);
              }

              // if user is staring at the app when he receives the notification we process it instantly
              // so app refetches related wallet
              if (payload.foreground) props.onProcessNotifications();
            },

            // (optional) Called when Registered Action is pressed and invokeApp is false, if true onNotification will be called (Android)
            onAction: function (notification) {
              console.log('ACTION:', notification.action);
              console.log('NOTIFICATION:', notification);

              // process the action
            },

            // (optional) Called when the user fails to register for remote notifications. Typically occurs when APNS is having issues, or the device is a simulator. (iOS)
            onRegistrationError: function (err) {
              console.error(err.message, err);
              resolve(false);
            },

            // IOS ONLY (optional): default: all - Permissions to register.
            permissions: {
              alert: true,
              badge: true,
              sound: true,
            },

            // Should the initial notification be popped automatically
            // default: true
            popInitialNotification: true,

            /**
             * (optional) default: true
             * - Specified if permissions (ios) and token (android and ios) will requested or not,
             * - if not, you must call PushNotificationsHandler.requestPermissions() later
             * - if you are not using remote notification or do not have Firebase installed, use this:
             *     requestPermissions: Platform.OS === 'ios'
             */
            requestPermissions: true,
          });
        }
      });
    });
    // …
  };

  Notifications.cleanUserOptOutFlag = async function () {
    return AsyncStorage.removeItem(NOTIFICATIONS_NO_AND_DONT_ASK_FLAG);
  };

  /**
   * Whether this device may upload wallet data (onchain addresses, Lightning
   * payment hashes, txids) to GroundControl so the server can push payment
   * alerts. This is the onchain/Lightning notification consent.
   *
   * Deliberately separate from the Ark capsule-expiry registration
   * (`arkExpiryToGroundControl`), which sends only a push token and a
   * timestamp, carries no wallet-identifying data, and is governed by its own
   * preference.
   *
   * Why this exists: nothing used to gate `majorTomToGroundControl`. It runs
   * unconditionally from ~20 call sites (wallet load, home render, vault open,
   * receive, send, broadcast) and was held back only by the absence of a push
   * token. That made privacy an accident of the token being missing: minting a
   * token for any unrelated feature would have silently started uploading
   * every wallet address. This flag makes the upload an explicit choice.
   *
   * First read migrates so nobody's behaviour changes today: a device that
   * already holds a push token was already subscribing and keeps doing so; a
   * device without one resolves to off, which is the posture it already had.
   */
  async function _isOnchainSubscriptionEnabled() {
    try {
      const stored = await AsyncStorage.getItem(ONCHAIN_SUBSCRIPTIONS_ENABLED);
      if (stored !== null) return stored === '1';
      const hadToken = !!(await Notifications.getPushToken());
      await AsyncStorage.setItem(ONCHAIN_SUBSCRIPTIONS_ENABLED, hadToken ? '1' : '0');
      return hadToken;
    } catch (_) {
      // Fail closed: on a storage error never upload wallet data.
      return false;
    }
  }

  Notifications.isOnchainSubscriptionEnabled = _isOnchainSubscriptionEnabled;

  Notifications.setOnchainSubscriptionEnabled = async function (enabled) {
    return AsyncStorage.setItem(ONCHAIN_SUBSCRIPTIONS_ENABLED, enabled ? '1' : '0');
  };

  /**
   * Should be called when user is most interested in receiving push notifications.
   * If we dont have a token it will show alert asking whether
   * user wants to receive notifications, and if yes - will configure push notifications.
   * FYI, on Android permissions are acquired when app is installed, so basically we dont need to ask,
   * we can just call `configure`. On iOS its different, and calling `configure` triggers system's dialog box.
   *
   * @returns {Promise<boolean>} TRUE if permissions were obtained, FALSE otherwise
   */
  Notifications.tryToObtainPermissions = async function () {
    if (!Notifications.isNotificationsCapable) return false;
    if (await Notifications.getPushToken()) {
      // we already have a token, no sense asking again, just configure pushes to register callbacks and we are done
      if (!alreadyConfigured) configureNotifications(); // no await so it executes in background while we return TRUE and use token
      return true;
    }

    if (await AsyncStorage.getItem(NOTIFICATIONS_NO_AND_DONT_ASK_FLAG)) {
      // user doesn't want them
      return false;
    }

    return new Promise(function (resolve) {
      Alert.alert(
        loc.settings.notifications,
        loc.notifications.would_you_like_to_receive_notifications,
        [
          {
            text: loc.notifications.no_and_dont_ask,
            onPress: () => {
              AsyncStorage.setItem(NOTIFICATIONS_NO_AND_DONT_ASK_FLAG, '1');
              resolve(false);
            },
            style: 'cancel',
          },
          {
            text: loc.notifications.ask_me_later,
            onPress: () => {
              resolve(false);
            },
            style: 'cancel',
          },
          {
            text: loc._.ok,
            onPress: async () => {
              resolve(await configureNotifications());
            },
            style: 'default',
          },
        ],
        { cancelable: false },
      );
    });
  };

  function _getHeaders() {
    return {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    };
  }

  async function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Submits onchain bitcoin addresses and ln invoice preimage hashes to GroundControl server, so later we could
   * be notified if they were paid
   *
   * @param addresses {string[]}
   * @param hashes {string[]}
   * @param txids {string[]}
   * @returns {Promise<object>} Response object from API rest call
   */
  Notifications.majorTomToGroundControl = async function (addresses, hashes, txids) {
    if (!Array.isArray(addresses) || !Array.isArray(hashes) || !Array.isArray(txids))
      throw new Error('no addresses or hashes or txids provided');
    // Consent gate. Checked here rather than at the ~20 call sites so a new
    // caller cannot upload wallet data by forgetting to ask.
    if (!(await _isOnchainSubscriptionEnabled())) return;
    const pushToken = await Notifications.getPushToken();
    if (!pushToken || !pushToken.token || !pushToken.os) return;

    const api = new Frisbee({ baseURI });

    return await api.post(
      '/majorTomToGroundControl',
      Object.assign({}, _getHeaders(), {
        body: {
          addresses,
          hashes,
          txids,
          token: pushToken.token,
          os: pushToken.os,
        },
      }),
    );
  };

  /**
   * Registers (or re-registers) this device's earliest Ark capsule expiry
   * with GroundControl, so the server's scheduler can send a silent
   * content-available maintenance push (payload: { arkMaintenance: 1 })
   * a few hours before the deadline. Idempotent upsert keyed by token:
   * the server keeps ONE expiry per device; every call replaces it.
   *
   * Server contract (endpoint to be added on the GroundControl VPS):
   *   POST /arkExpiry  { token, os, expiryAtMs }
   *   expiryAtMs === 0 clears the subscription (no live capsules left).
   *
   * Fire-and-forget: the endpoint doesn't exist server-side yet, so all
   * failures are swallowed — the local reminder schedule is the fallback.
   *
   * @param expiryAtMs {number} epoch ms of the EARLIEST live capsule expiry
   * @returns {Promise<object|undefined>}
   */
  Notifications.arkExpiryToGroundControl = async function (expiryAtMs) {
    if (!Number.isFinite(expiryAtMs) || expiryAtMs < 0) return;
    const pushToken = await Notifications.getPushToken();
    if (!pushToken || !pushToken.token || !pushToken.os) return;

    const api = new Frisbee({ baseURI });
    try {
      return await api.post(
        '/arkExpiry',
        Object.assign({}, _getHeaders(), {
          body: {
            token: pushToken.token,
            os: pushToken.os,
            expiryAtMs,
          },
        }),
      );
    } catch (_) {
      // Server support lands separately; silent by design.
    }
  };

  /**
   * The opposite of `majorTomToGroundControl` call.
   *
   * @param addresses {string[]}
   * @param hashes {string[]}
   * @param txids {string[]}
   * @returns {Promise<object>} Response object from API rest call
   */
  Notifications.unsubscribe = async function (addresses, hashes, txids) {
    if (!Array.isArray(addresses) || !Array.isArray(hashes) || !Array.isArray(txids))
      throw new Error('no addresses or hashes or txids provided');
    const pushToken = await Notifications.getPushToken();
    if (!pushToken || !pushToken.token || !pushToken.os) return;

    const api = new Frisbee({ baseURI });
    const postCall = await api.post(
      '/unsubscribe',
      Object.assign({}, _getHeaders(), {
        body: {
          addresses,
          hashes,
          txids,
          token: pushToken.token,
          os: pushToken.os,
        },
      }),
    );
    Notifications.abandonPermissions();
    return postCall;
  };

  Notifications.isNotificationsEnabled = async function () {
    const levels = await getLevels();

    return !!(await Notifications.getPushToken()) && !!levels.level_all;
  };

  Notifications.getDefaultUri = function () {
    return constants.groundControlUri;
  };

  Notifications.saveUri = async function (uri) {
    baseURI = uri || constants.groundControlUri; // settign the url to use currently. if not set - use default
    return AsyncStorage.setItem(GROUNDCONTROL_BASE_URI, uri);
  };

  Notifications.getSavedUri = async function () {
    return AsyncStorage.getItem(GROUNDCONTROL_BASE_URI);
  };

  Notifications.isGroundControlUriValid = async uri => {
    const apiCall = new Frisbee({
      baseURI: uri,
    });
    let response;
    try {
      response = await Promise.race([apiCall.get('/ping', _getHeaders()), _sleep(2000)]);
    } catch (_) {}

    if (!response || !response.body) return false; // either sleep expired or apiCall threw an exception

    const json = response.body;
    if (json.description) return true;

    return false;
  };

  /**
   * Returns a permissions object:
   * alert: boolean
   * badge: boolean
   * sound: boolean
   *
   * @returns {Promise<Object>}
   */
  Notifications.checkPermissions = async function () {
    return new Promise(function (resolve) {
      PushNotification.checkPermissions(result => {
        resolve(result);
      });
    });
  };

  /**
   * Posts to groundcontrol info whether we want to opt in or out of specific notifications level
   *
   * @param levelAll {Boolean}
   * @returns {Promise<*>}
   */
  Notifications.setLevels = async function (levelAll) {
    const pushToken = await Notifications.getPushToken();
    if (!pushToken || !pushToken.token || !pushToken.os) return;

    const api = new Frisbee({ baseURI });

    try {
      await api.post(
        '/setTokenConfiguration',
        Object.assign({}, _getHeaders(), {
          body: {
            level_all: !!levelAll,
            token: pushToken.token,
            os: pushToken.os,
          },
        }),
      );
    } catch (_) {}
  };

  /**
   * Queries groundcontrol for token configuration, which contains subscriptions to notification levels
   *
   * @returns {Promise<{}|*>}
   */
  const getLevels = async function () {
    const pushToken = await Notifications.getPushToken();
    if (!pushToken || !pushToken.token || !pushToken.os) return;

    const api = new Frisbee({ baseURI });

    let response;
    try {
      response = await Promise.race([
        api.post('/getTokenConfiguration', Object.assign({}, _getHeaders(), { body: { token: pushToken.token, os: pushToken.os } })),
        _sleep(3000),
      ]);
    } catch (_) {}

    if (!response || !response.body) return {}; // either sleep expired or apiCall threw an exception

    return response.body;
  };

  Notifications.getStoredNotifications = async function () {
    let notifications = [];
    try {
      const stringified = await AsyncStorage.getItem(NOTIFICATIONS_STORAGE);
      notifications = JSON.parse(stringified);
      if (!Array.isArray(notifications)) notifications = [];
    } catch (_) {}

    return notifications;
  };

  Notifications.addNotification = async function (notification) {
    let notifications = [];
    try {
      const stringified = await AsyncStorage.getItem(NOTIFICATIONS_STORAGE);
      notifications = JSON.parse(stringified);
      if (!Array.isArray(notifications)) notifications = [];
    } catch (_) {}

    notifications.push(notification);
    await AsyncStorage.setItem(NOTIFICATIONS_STORAGE, JSON.stringify(notifications));
  };

  const postTokenConfig = async function () {
    const pushToken = await Notifications.getPushToken();
    if (!pushToken || !pushToken.token || !pushToken.os) return;

    const api = new Frisbee({ baseURI });

    try {
      const lang = (await AsyncStorage.getItem('lang')) || 'en';
      const appVersion = getSystemName() + ' ' + getSystemVersion() + ';' + getApplicationName() + ' ' + getVersion();

      await api.post(
        '/setTokenConfiguration',
        Object.assign({}, _getHeaders(), {
          body: {
            token: pushToken.token,
            os: pushToken.os,
            lang,
            app_version: appVersion,
          },
        }),
      );
    } catch (_) {}
  };

  Notifications.clearStoredNotifications = async function () {
    try {
      await AsyncStorage.setItem(NOTIFICATIONS_STORAGE, JSON.stringify([]));
    } catch (_) {}
  };

  Notifications.getDeliveredNotifications = () => {
    return new Promise(resolve => {
      PushNotification.getDeliveredNotifications(notifications => resolve(notifications));
    });
  };

  Notifications.removeDeliveredNotifications = (identifiers = []) => {
    PushNotification.removeDeliveredNotifications(identifiers);
  };

  Notifications.setApplicationIconBadgeNumber = function (badges) {
    PushNotification.setApplicationIconBadgeNumber(badges);
  };

  Notifications.removeAllDeliveredNotifications = () => {
    PushNotification.removeAllDeliveredNotifications();
  };

  // on app launch (load module):
  (async () => {
    // first, fetching to see if app uses custom GroundControl server, not the default one
    try {
      const baseUriStored = await AsyncStorage.getItem(GROUNDCONTROL_BASE_URI);
      if (baseUriStored) {
        baseURI = baseUriStored;
      }
    } catch (_) {}

    // every launch should clear badges:
    Notifications.setApplicationIconBadgeNumber(0);

    if (!(await Notifications.getPushToken())) return;
    // if we previously had token that means we already acquired permission from the user and it is safe to call
    // `configure` to register callbacks etc
    await configureNotifications();
    await postTokenConfig();
  })();

  // Initialize on module load
  (async () => {
    try {
      Notifications.setApplicationIconBadgeNumber(0);
      if (!(await Notifications.getPushToken())) return;
      await configureNotifications();
      await postTokenConfig();
    } catch (e) {
      console.warn('[Notifications] Init error:', e);
    }
  })();

  return null;
}

export default Notifications;

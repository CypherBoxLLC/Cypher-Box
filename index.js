import React, { useEffect } from 'react';
import './shim.js';
import { AppRegistry } from 'react-native';
import App from './App';
import { BlueStorageProvider } from './blue_modules/storage-context';
import { registerArkNotificationTapHandler } from './src/services/ark/notificationHandler';
import { refreshRegionSignals } from './src/services/featureFlags';
import { isSeedSignerLocked, noteLockForNativeStartUp } from './src/services/seedSignerLock';
import { watchStorefrontCountry } from './src/services/storefrontWatch';

const A = require('./blue_modules/analytics');
if (!Error.captureStackTrace) {
  // captureStackTrace is only available when debugging
  Error.captureStackTrace = () => { };
}

// Register the notification tap handler BEFORE the app component so a
// cold-start tap on an Ark expiry warning is routed once the JS bridge
// is ready.
registerArkNotificationTapHandler();

// Read the region signals early: the App Store storefront on iOS, the
// phone's language, SIM and network country on Android. The region gates
// read them synchronously at render time, and they can arrive a moment
// after launch. Fire and forget: the gates fail closed until a signal
// arrives. On Android this also re-reads whenever the app returns to the
// foreground.
// A seed-signer has no Lightning providers to gate, so it doesn't ask.
if (!isSeedSignerLocked()) refreshRegionSignals();
// and it makes sure native start-up knows to skip crash reporting next time
else noteLockForNativeStartUp();

// That read can come back empty (offline, a background launch from a silent
// push, StoreKit not ready yet), which would hide Strike for the whole run.
// So on iOS it is read again on every return to the foreground, and retried
// for a while until it answers. The lock is checked before each read, as the
// app can be turned into a seed-signer while it runs.
if (!isSeedSignerLocked()) watchStorefrontCountry(isSeedSignerLocked);

const BlueAppComponent = () => {
  useEffect(() => {
    A(A.ENUM.INIT);
  }, []);

  return (
    <BlueStorageProvider>
      <App />
    </BlueStorageProvider>
  );
};

AppRegistry.registerComponent('BlueWallet', () => BlueAppComponent);

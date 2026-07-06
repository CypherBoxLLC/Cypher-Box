import React, { useEffect } from 'react';
import './shim.js';
import { AppRegistry } from 'react-native';
import App from './App';
import { BlueStorageProvider } from './blue_modules/storage-context';
import { registerArkNotificationTapHandler } from './src/services/ark/notificationHandler';

const A = require('./blue_modules/analytics');
if (!Error.captureStackTrace) {
  // captureStackTrace is only available when debugging
  Error.captureStackTrace = () => { };
}

// Register the notification tap handler BEFORE the app component so a
// cold-start tap on an Ark expiry warning is routed once the JS bridge
// is ready.
registerArkNotificationTapHandler();

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

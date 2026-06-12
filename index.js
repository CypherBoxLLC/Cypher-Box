import React, { useEffect } from 'react';
import './shim.js';
import { AppRegistry } from 'react-native';
import App from './App';
import { BlueStorageProvider } from './blue_modules/storage-context';
import { registerArkBackgroundRefreshHandlers } from './src/services/ark/scheduler';

const A = require('./blue_modules/analytics');
if (!Error.captureStackTrace) {
  // captureStackTrace is only available when debugging
  Error.captureStackTrace = () => { };
}

// Register Ark background-refresh task handlers BEFORE the app component
// so Android's headless-task lookup and iOS's BGTask event listener are
// in place when the OS routes its first scheduled wake into our process.
// Cheap if the user never opts into the feature — the orchestrator is
// lazy-required inside the handlers.
registerArkBackgroundRefreshHandlers();

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

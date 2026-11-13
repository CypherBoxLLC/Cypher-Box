import React, { useContext, useEffect } from 'react';
import QuickActions from 'react-native-quick-actions';
import { DeviceEventEmitter, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlueStorageContext } from '../blue_modules/storage-context';
import DeeplinkSchemaMatch from './deeplink-schema-match';
import * as NavigationService from '../NavigationService';
import { CommonActions } from '@react-navigation/native';

const DeviceQuickActionsStorageKey = 'DeviceQuickActionsEnabled';

/**
 * Cypher Box puts no wallet shortcuts on the app icon. BlueWallet listed each wallet there, with its balance, and a
 * tap opened BlueWallet's own wallet screen. Every launch now clears them, which also removes the ones an earlier
 * version left on the phone, and a tap on one that is still there opens Cypher Box's home screen.
 *
 * Still mounted for the link the app was opened with: it is handled here once the wallets are loaded.
 */
function DeviceQuickActions(): JSX.Element | null {
  const { walletsInitialized } = useContext(BlueStorageContext);

  useEffect(() => {
    if (walletsInitialized) removeShortcuts();
  }, [walletsInitialized]);

  useEffect(() => {
    if (walletsInitialized) {
      DeviceEventEmitter.addListener('quickActionShortcut', walletQuickActions);
      popInitialShortcutAction().then(popInitialAction);
      return () => DeviceEventEmitter.removeAllListeners('quickActionShortcut');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsInitialized]);

  // @ts-ignore: Fix later
  DeviceQuickActions.setEnabled = async (enabled: boolean = true): Promise<void> => {
    await AsyncStorage.setItem(DeviceQuickActionsStorageKey, JSON.stringify(enabled));
    removeShortcuts();
  };

  const popInitialShortcutAction = async (): Promise<any> => {
    const data = await QuickActions.popInitialAction();
    return data;
  };

  // the shortcuts are never shown, whatever BlueWallet's privacy switch says
  // @ts-ignore: Fix later
  DeviceQuickActions.getEnabled = async (): Promise<boolean> => false;

  // the home screen, not the vault: the vault screen takes the fiat rate and more from the home screen that opens it
  const openHome = (): void => {
    NavigationService.dispatch(CommonActions.navigate({ name: 'HomeScreen' }));
  };

  // BlueWallet's "open this wallet on launch" setting is gone too: Cypher Box always starts on its home screen
  const popInitialAction = async (data: any): Promise<void> => {
    if (data) {
      openHome();
    } else {
      const url = await Linking.getInitialURL();
      if (url && DeeplinkSchemaMatch.hasSchema(url)) {
        handleOpenURL({ url });
      }
    }
  };

  const handleOpenURL = (event: { url: string }): void => {
    DeeplinkSchemaMatch.navigationRouteFor(event, (value: [string, any]) => NavigationService.navigate(...value));
  };

  // a shortcut an earlier version left on the icon, tapped while the app runs
  const walletQuickActions = (): void => openHome();

  const removeShortcuts = async (): Promise<void> => {
    if (Platform.OS === 'android') {
      QuickActions.clearShortcutItems();
    } else {
      // an empty list, not clearShortcutItems: on iOS only setShortcutItems runs on the main thread, as UIKit needs
      QuickActions.setShortcutItems([]);
    }
  };

  return <></>;
}

export default DeviceQuickActions;

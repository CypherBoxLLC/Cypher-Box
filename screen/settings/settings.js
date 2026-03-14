import React, { useCallback, useContext, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Platform, View, TouchableWithoutFeedback, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import navigationStyle from '../../components/navigationStyle';
import { BlueHeaderDefaultSub } from '../../BlueComponents';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import ListItem from '../../components/ListItem';
import { SafeAreaView } from 'react-native-safe-area-context';
import useAuthStore from '@Cypher/stores/authStore';
import { dispatchNavigate } from '@Cypher/helpers';
import triggerHapticFeedback from '../../blue_modules/hapticFeedback';
const prompt = require('../../helpers/prompt');

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

const Settings = ({ navigation }) => {
  const { navigate, popToTop } = useNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [storageIsEncryptedSwitchEnabled, setStorageIsEncryptedSwitchEnabled] = useState(false);
  const { isStorageEncrypted, encryptStorage, decryptStorage, saveToDisk } = useContext(BlueStorageContext);
  // By simply having it here, it'll re-render the UI if language is changed
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { language } = useContext(BlueStorageContext);
  const { isAuth, isStrikeAuth, clearAuth, clearStrikeAuth } = useAuthStore();

  const initialState = useCallback(async () => {
    const isStorageEncryptedSwitchEnabled = await isStorageEncrypted();
    setStorageIsEncryptedSwitchEnabled(isStorageEncryptedSwitchEnabled);
    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    initialState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    clearAuth();
    navigation.reset({
      index: 0,
      routes: [{ name: 'HomeScreen' }],
    });
  };

  const handleStrikeLogout = async () => {
    clearStrikeAuth();
    navigation.reset({
      index: 0,
      routes: [{ name: 'HomeScreen' }],
    });
  };

  const onEncryptStorageSwitch = async value => {
    setIsLoading(true);
    if (value === true) {
      let p1 = await prompt(loc.settings.password, loc.settings.password_explain).catch(() => {
        setIsLoading(false);
        p1 = undefined;
      });
      if (!p1) {
        setIsLoading(false);
        return;
      }
      const p2 = await prompt(loc.settings.password, loc.settings.retype_password).catch(() => {
        setIsLoading(false);
      });
      if (p1 === p2) {
        await encryptStorage(p1);
        setIsLoading(false);
        setStorageIsEncryptedSwitchEnabled(await isStorageEncrypted());
        saveToDisk();
      } else {
        setIsLoading(false);
        alert(loc.settings.passwords_do_not_match);
      }
    } else {
      Alert.alert(
        loc.settings.encrypt_decrypt,
        loc.settings.encrypt_decrypt_q,
        [
          {
            text: loc._.cancel,
            style: 'cancel',
            onPress: () => setIsLoading(false),
          },
          {
            text: loc._.ok,
            style: 'destructive',
            onPress: handleDecryptStorage,
          },
        ],
        { cancelable: false },
      );
    }
  };

  const handleDecryptStorage = async () => {
    const password = await prompt(loc.settings.password, loc._.storage_is_encrypted).catch(() => {
      setIsLoading(false);
    });
    try {
      await decryptStorage(password);
      await saveToDisk();
      popToTop();
    } catch (e) {
      if (password) {
        alert(loc._.bad_password);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
      }

      setIsLoading(false);
      setStorageIsEncryptedSwitchEnabled(await isStorageEncrypted());
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" automaticallyAdjustContentInsets>
        <View style={{ height: 45 }} />
        {Platform.OS === 'android' ? <BlueHeaderDefaultSub leftText={loc.settings.header} /> : <></>}
        {/* <ListItem title={loc.settings.general} onPress={() => navigate('GeneralSettings')} testID="GeneralSettings" chevron /> */}
        {/* <ListItem title={loc.settings.currency} onPress={() => navigate('Currency')} testID="Currency" chevron /> */}
        {/* <ListItem title={loc.settings.language} onPress={() => navigate('Language')} testID="Language" chevron /> */}
        {/* <ListItem title={loc.settings.encrypt_title} onPress={() => navigate('EncryptStorage')} testID="SecurityButton" chevron /> */}
        <ListItem 
          chevron 
          title={"Security"} 
          onPress={() => {
            dispatchNavigate('Security');
          }} 
        />
        <ListItem title={loc.settings.network} onPress={() => navigate('NetworkSettings')} testID="NetworkSettings" chevron />
        {/* <ListItem title="Push Notifications" onPress={() => navigate('NotificationSettings')} testID="NotificationSettings" chevron /> */}
        {isAuth && <ListItem title={"Set Recover Email (Coinos.io)"} onPress={() => navigate('ChangeUsername', { goBack: true })} testID="ChangeUsername" chevron /> }
        {/* <ListItem title={loc.settings.tools} onPress={() => navigate('Tools')} testID="Tools" chevron /> */}
        {/* <ListItem title={loc.settings.about} onPress={() => navigate('About')} testID="AboutButton" chevron /> */}
        <ListItem title={"Term of service & Privacy Policy"} onPress={() => navigate('TermOfService')} testID="TermOfServiceButton" chevron />
        {/* <ListItem
          testID="EncyptedAndPasswordProtected"
          hideChevron
          title={loc.settings.encrypt_enc_and_pass}
          Component={TouchableWithoutFeedback}
          switch={{ onValueChange: onEncryptStorageSwitch, value: storageIsEncryptedSwitchEnabled }}
        /> */}
        {isAuth && <ListItem title={"Logout from Coinos.io"} onPress={handleLogout} testID="LogoutButton" chevron />}
        {isStrikeAuth && <ListItem title={"Logout from Strike"} onPress={handleStrikeLogout} testID="LogoutButton" chevron />}
      </ScrollView>
    </SafeAreaView>
  );
};

export default Settings;
Settings.navigationOptions = navigationStyle({
  headerTransparent: true,
  headerTitle: Platform.select({ ios: loc.settings.header, default: '' }),
  headerLargeTitle: true,
});

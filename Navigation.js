import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Platform, useWindowDimensions, Dimensions, I18nManager } from 'react-native';

import Settings from './screen/settings/settings';
import Security from './screen/settings/security';
import About from './screen/settings/about';
import ReleaseNotes from './screen/settings/releasenotes';
import Licensing from './screen/settings/licensing';
import Selftest from './screen/selftest';
import Language from './screen/settings/language';
import Currency from './screen/settings/Currency';
import EncryptStorage from './screen/settings/encryptStorage';
import PlausibleDeniability from './screen/plausibledeniability';
import LightningSettings from './screen/settings/lightningSettings';
import ElectrumSettings from './screen/settings/electrumSettings';
import Tools from './screen/settings/tools';
import GeneralSettings from './screen/settings/GeneralSettings';
import NetworkSettings from './screen/settings/NetworkSettings';
import NotificationSettings from './screen/settings/notificationSettings';
import DefaultView from './screen/settings/defaultView';

import WalletsList from './screen/wallets/list';
import WalletTransactions from './screen/wallets/transactions';
import AddWallet from './screen/wallets/add';
import WalletsAddMultisig from './screen/wallets/addMultisig';
import WalletsAddMultisigStep2 from './screen/wallets/addMultisigStep2';
import WalletsAddMultisigHelp, { WalletAddMultisigHelpNavigationOptions } from './screen/wallets/addMultisigHelp';
import PleaseBackup from './screen/wallets/pleaseBackup';
import PleaseBackupLNDHub from './screen/wallets/pleaseBackupLNDHub';
import PleaseBackupLdk from './screen/wallets/pleaseBackupLdk';
import ImportWallet from './screen/wallets/import';
import ImportWalletDiscovery from './screen/wallets/importDiscovery';
import ImportCustomDerivationPath from './screen/wallets/importCustomDerivationPath';
import ImportSpeed from './screen/wallets/importSpeed';
import WalletDetails from './screen/wallets/details';
import WalletExport from './screen/wallets/export';
import ExportMultisigCoordinationSetup from './screen/wallets/exportMultisigCoordinationSetup';
import ViewEditMultisigCosigners from './screen/wallets/viewEditMultisigCosigners';
import WalletXpub from './screen/wallets/xpub';
import SignVerify from './screen/wallets/signVerify';
import WalletAddresses from './screen/wallets/addresses';
import ReorderWallets from './screen/wallets/reorderWallets';
import SelectWallet from './screen/wallets/selectWallet';
import ProvideEntropy from './screen/wallets/provideEntropy';
import GenerateWord from './screen/wallets/generateWord';

import TransactionDetails from './screen/transactions/details';
import TransactionStatus from './screen/transactions/transactionStatus';
import CPFP from './screen/transactions/CPFP';
import RBFBumpFee from './screen/transactions/RBFBumpFee';
import RBFCancel from './screen/transactions/RBFCancel';

import ReceiveDetails from './screen/receive/details';
import AztecoRedeem from './screen/receive/aztecoRedeem';

import SendDetails from './screen/send/details';
import ScanQRCode from './screen/send/ScanQRCode';
import SendCreate from './screen/send/create';
import Confirm from './screen/send/confirm';
import PsbtWithHardwareWallet from './screen/send/psbtWithHardwareWallet';
import PsbtMultisig from './screen/send/psbtMultisig';
import PsbtMultisigQRCode from './screen/send/psbtMultisigQRCode';
import Success from './screen/send/success';
import Broadcast from './screen/send/broadcast';
import IsItMyAddress from './screen/send/isItMyAddress';
import CoinControl from './screen/send/coinControl';

import ScanLndInvoice from './screen/lnd/scanLndInvoice';
import LappBrowser from './screen/lnd/browser';
import LNDCreateInvoice from './screen/lnd/lndCreateInvoice';
import LNDViewInvoice from './screen/lnd/lndViewInvoice';
import LdkOpenChannel from './screen/lnd/ldkOpenChannel';
import LdkInfo from './screen/lnd/ldkInfo';
import LNDViewAdditionalInvoiceInformation from './screen/lnd/lndViewAdditionalInvoiceInformation';
import LnurlPay from './screen/lnd/lnurlPay';
import LnurlPaySuccess from './screen/lnd/lnurlPaySuccess';
import LnurlAuth from './screen/lnd/lnurlAuth';
import UnlockWith from './UnlockWith';
import DrawerList from './screen/wallets/drawerList';
import { isDesktop, isTablet, isHandset } from './blue_modules/environment';
import SettingsPrivacy from './screen/settings/SettingsPrivacy';
import LNDViewAdditionalInvoicePreImage from './screen/lnd/lndViewAdditionalInvoicePreImage';
import LdkViewLogs from './screen/wallets/ldkViewLogs';
import PaymentCode from './screen/wallets/paymentCode';
import PaymentCodesList from './screen/wallets/paymentCodesList';
import loc from './loc';
import { useTheme } from './components/themes';
import { AccountStatus, AdjustHotThreshold, CheckAccount, CheckingAccount, ColdStorage, ConfirmTransction, CopyInvoice, CreateCoinOSScreen, CreateInvoice, CreateVault, DownloadBlink, EditAmount, FeeRate, GetAddressScreen, HomeScreen, HotStorageVault, InfoBlink, LoginBlink, LoginBlinkPhone, LoginCoinOSScreen, PurchaseVault, QrScreen, ReceivedMethodScreen, ReviewPayment, SavingVault, SavingVaultCreated, SavingVaultIntro, SavingVaultIntroNew, SendReceiveOnChain, SendReceiveSuccessScreen, SendScreen, SplashScreen, ThresholdAdjust, Transaction, TransactionBroadCast, TransactionBroadCastNew, VerifyPhone, WelcomeScreen, WithdrawThreshold, WithdrawToSavingsVault, ReviewWithdrawal, RecoverSavingVault, GetStartedScreen, TermOfService, ConnectColdStorage, CheckingAccountNew, BuyBitcoin, InvoiceNew, PaymentSuccess, SwapAmount, CapsuleCatalog } from './src/screens';
import { CardStyleInterpolators, createStackNavigator } from '@react-navigation/stack';
import Invoice from '@Cypher/screens/Invoice';
import ChangeUsername from '@Cypher/screens/Account/ChangeUsername';
import TransactionNew from '@Cypher/screens/TransactionNew';
import ForgetPassword from '@Cypher/screens/Account/ForgetPassword';
import HardwareWalletTransaction from '@Cypher/screens/HardwareWalletTransaction';
import HardwareWalletTransactionContinue from '@Cypher/screens/HardwareWalletTransactionContinue';
import ConfirmHardwareTransaction from '@Cypher/screens/ConfirmHardwareTransaction';
import ColdVaultIntro from '@Cypher/screens/ColdVaultIntro';
import ColdVaultIntro2 from '@Cypher/screens/ColdVaultIntro2';
import CheckingAccountIntro from '@Cypher/screens/CheckingAccountIntro';
import CheckingAccountLogin from '@Cypher/screens/CheckingAccountLogin';
import CheckingAccountCreated from '@Cypher/screens/CheckingAccountCreated';

const WalletsStack = createStackNavigator();

const WalletsRoot = () => {
  const theme = useTheme();

  const forFade = ({ current }) => ({
    cardStyle: {
      opacity: current.progress,
    },
  });

  const config = {
    animation: 'timing',
    config: {
      stiffness: 1000,
      damping: 500,
      mass: 3,
      overshootClamping: true,
      restDisplacementThreshold: 0.01,
      restSpeedThreshold: 0.01,
    },
  };

  return (
    <WalletsStack.Navigator screenOptions={{ headerShadowVisible: false, gestureEnabled: false }}>
      <WalletsStack.Screen name="HomeScreen" component={HomeScreen} options={{
        headerShown: false, translucent: false,
        cardStyleInterpolator: CardStyleInterpolators.forBottomSheetAndroid,
      }} />
      <WalletsStack.Screen name="TermOfService" component={TermOfService} options={{
        headerShown: false, translucent: false,
        cardStyleInterpolator: CardStyleInterpolators.forBottomSheetAndroid,
      }} />
      <WalletsStack.Screen name="CheckAccount" component={CheckAccount} options={{ headerShown: false }} />
      <WalletsStack.Screen name="InfoBlink" component={InfoBlink} options={{ headerShown: false }} />
      <WalletsStack.Screen name="DownloadBlink" component={DownloadBlink} options={{ headerShown: false }} />
      <WalletsStack.Screen name="LoginBlink" component={LoginBlink} options={{ headerShown: false }} />
      <WalletsStack.Screen name="RecoverSavingVault" component={RecoverSavingVault} options={{ headerShown: false }} />
      <WalletsStack.Screen name="CreateCoinOSScreen" component={CreateCoinOSScreen} options={{ headerShown: false }} />
      <WalletsStack.Screen name="ForgotCoinOSScreen" component={ForgetPassword} options={{ headerShown: false }} />
      <WalletsStack.Screen name="ChangeUsername" component={ChangeUsername} options={{ headerShown: false }} />
      <WalletsStack.Screen name="LoginCoinOSScreen" component={LoginCoinOSScreen} options={{ headerShown: false }} />
      <WalletsStack.Screen name="LoginBlinkPhone" component={LoginBlinkPhone} options={{ headerShown: false }} />
      <WalletsStack.Screen name="VerifyPhone" component={VerifyPhone} options={{ headerShown: false }} />
      <WalletsStack.Screen name="AccountStatus" component={AccountStatus} options={{ headerShown: false }} />
      <WalletsStack.Screen name="ReceivedMethodScreen" component={ReceivedMethodScreen} options={{ headerShown: false }} />
      <WalletsStack.Screen name="QrScreen" component={QrScreen} options={{ headerShown: false }} />
      <WalletsStack.Screen name="CopyInvoice" component={CopyInvoice} options={{ headerShown: false }} />
      <WalletsStack.Screen name="ReviewPayment" component={ReviewPayment} options={{
        headerShown: false,
        // transitionSpec: {
        //   open: config,
        //   close: config,
        // },
      }} />

      <WalletsStack.Screen name="WithdrawToSavingsVault" component={WithdrawToSavingsVault} options={{ headerShown: false }} />


      <WalletsStack.Screen name="ReviewWithdrawal" component={ReviewWithdrawal} options={{
        headerShown: false,
        // transitionSpec: {
        //   open: config,
        //   close: config,
        // },
      }} />
      
      <WalletsStack.Screen name="CheckingAccountIntro" component={CheckingAccountIntro} options={{ headerShown: false }} />
      <WalletsStack.Screen name="CheckingAccountLogin" component={CheckingAccountLogin} options={{ headerShown: false }} />
      <WalletsStack.Screen name="CheckingAccountCreated" component={CheckingAccountCreated} options={{ headerShown: false }} />
      <WalletsStack.Screen name="CheckingAccount" component={CheckingAccount} options={{ headerShown: false }} />
      <WalletsStack.Screen name="CheckingAccountNew" component={CheckingAccountNew} options={{ headerShown: false }} />
      <WalletsStack.Screen name="Invoice" component={Invoice} options={{ headerShown: false }} />
      <WalletsStack.Screen name="InvoiceNew" component={InvoiceNew} options={{ headerShown: false }} />
      <WalletsStack.Screen name="PaymentSuccess" component={PaymentSuccess} options={{ headerShown: false }} />
      <WalletsStack.Screen name="SwapAmount" component={SwapAmount} options={{ headerShown: false }} />
      <WalletsStack.Screen name="CapsuleCatalog" component={CapsuleCatalog} options={{ headerShown: false }} />
      <WalletsStack.Screen name="WithdrawThreshold" component={WithdrawThreshold} options={{ headerShown: false }} />
      <WalletsStack.Screen name="ThresholdAdjust" component={ThresholdAdjust} options={{ headerShown: false }} />
      <WalletsStack.Screen name="Transaction" component={Transaction} options={{
        headerShown: false,
        cardStyleInterpolator: CardStyleInterpolators.forFadeFromCenter,
      }} />
      <WalletsStack.Screen name="TransactionBroadCast" component={TransactionBroadCast} options={{
        headerShown: false,
        cardStyleInterpolator: forFade,
      }} />
      <WalletsStack.Screen name="CreateInvoice" component={CreateInvoice} options={{ headerShown: false }} />
      <WalletsStack.Screen name="SendReceiveSuccessScreen" component={SendReceiveSuccessScreen} options={{ headerShown: false }} />
      <WalletsStack.Screen name="GetAddressScreen" component={GetAddressScreen} options={{ headerShown: false }} />
      <WalletsStack.Screen name="SendScreen" component={SendScreen} options={{ headerShown: false }} />
      <WalletsStack.Screen name="BuyBitcoin" component={BuyBitcoin} options={{ headerShown: false }} />
      <WalletsStack.Screen name="SavingVaultIntro" component={SavingVaultIntro} options={{ headerShown: false }} />
      <WalletsStack.Screen name="ColdVaultIntro" component={ColdVaultIntro} options={{ headerShown: false }} />
      <WalletsStack.Screen name="ColdVaultIntro2" component={ColdVaultIntro2} options={{ headerShown: false }} />
      <WalletsStack.Screen name="SavingVaultIntroNew" component={SavingVaultIntroNew} options={{ headerShown: false }} />
      <WalletsStack.Screen name="SavingVault" component={SavingVault} options={{ headerShown: false }} />
      <WalletsStack.Screen name="SavingVaultCreated" component={SavingVaultCreated} options={{ headerShown: false }} />
      <WalletsStack.Screen name="HotStorageVault" component={HotStorageVault} options={{ headerShown: false }} />
      <WalletsStack.Screen name="CreateVault" component={CreateVault} options={{ headerShown: false }} />
      <WalletsStack.Screen name="AdjustHotThreshold" component={AdjustHotThreshold} options={{ headerShown: false }} />
      <WalletsStack.Screen name="SendReceiveOnChain" component={SendReceiveOnChain} options={{ headerShown: false }} />
      <WalletsStack.Screen name="ColdStorage" component={ColdStorage} options={{ headerShown: false }} />
      <WalletsStack.Screen name="ConnectColdStorage" component={ConnectColdStorage} options={{ headerShown: false }} />
      <WalletsStack.Screen name="EditAmount" component={EditAmount} options={{ headerShown: false }} />
      <WalletsStack.Screen name="FeeRate" component={FeeRate} options={{ headerShown: false }} />
      <WalletsStack.Screen name="ConfirmTransction" component={ConfirmTransction} options={{ headerShown: false }} />
      <WalletsStack.Screen name="HardwareWalletTransaction" component={HardwareWalletTransaction} options={{ headerShown: false }} />
      <WalletsStack.Screen name="HardwareWalletTransactionContinue" component={HardwareWalletTransactionContinue} options={{ headerShown: false }} />
      <WalletsStack.Screen name="ConfirmHardwareTransaction" component={ConfirmHardwareTransaction} options={{ headerShown: false }} />
      <WalletsStack.Screen name="TransactionBroadCastNew" component={TransactionBroadCastNew} options={{ headerShown: false }} />
      <WalletsStack.Screen name="PurchaseVault" component={PurchaseVault} options={{ headerShown: false }} />
      <WalletsStack.Screen name="TransactionNew" component={TransactionNew} options={{ headerShown: false }} />
      <WalletsStack.Screen name="WalletsList" component={WalletsList} options={WalletsList.navigationOptions(theme)} />
      <WalletsStack.Screen name="WalletTransactions" component={WalletTransactions} options={WalletTransactions.navigationOptions(theme)} />
      <WalletsStack.Screen name="LdkOpenChannel" component={LdkOpenChannel} options={LdkOpenChannel.navigationOptions(theme)} />
      <WalletsStack.Screen name="LdkInfo" component={LdkInfo} options={LdkInfo.navigationOptions(theme)} />
      <WalletsStack.Screen name="WalletDetails" component={WalletDetails} options={WalletDetails.navigationOptions(theme)} />
      <WalletsStack.Screen name="LdkViewLogs" component={LdkViewLogs} options={LdkViewLogs.navigationOptions(theme)} />
      <WalletsStack.Screen name="TransactionDetails" component={TransactionDetails} options={TransactionDetails.navigationOptions(theme)} />
      <WalletsStack.Screen name="TransactionStatus" component={TransactionStatus} options={TransactionStatus.navigationOptions(theme)} />
      <WalletsStack.Screen name="CPFP" component={CPFP} options={CPFP.navigationOptions(theme)} />
      <WalletsStack.Screen name="RBFBumpFee" component={RBFBumpFee} options={RBFBumpFee.navigationOptions(theme)} />
      <WalletsStack.Screen name="RBFCancel" component={RBFCancel} options={RBFCancel.navigationOptions(theme)} />
      <WalletsStack.Screen name="Settings" component={Settings} options={Settings.navigationOptions(theme)} />
      <WalletsStack.Screen name="Security" component={Security} options={Security.navigationOptions(theme)} />
      <WalletsStack.Screen name="SelectWallet" component={SelectWallet} options={SelectWallet.navigationOptions(theme)} />
      <WalletsStack.Screen name="Currency" component={Currency} options={Currency.navigationOptions(theme)} />
      <WalletsStack.Screen name="About" component={About} options={About.navigationOptions(theme)} />
      <WalletsStack.Screen name="ReleaseNotes" component={ReleaseNotes} options={ReleaseNotes.navigationOptions(theme)} />
      <WalletsStack.Screen name="Selftest" component={Selftest} options={Selftest.navigationOptions(theme)} />
      <WalletsStack.Screen name="Licensing" component={Licensing} options={Licensing.navigationOptions(theme)} />
      <WalletsStack.Screen name="DefaultView" component={DefaultView} options={DefaultView.navigationOptions(theme)} />
      <WalletsStack.Screen name="Language" component={Language} options={Language.navigationOptions(theme)} />
      <WalletsStack.Screen name="EncryptStorage" component={EncryptStorage} options={EncryptStorage.navigationOptions(theme)} />
      <WalletsStack.Screen name="GeneralSettings" component={GeneralSettings} options={GeneralSettings.navigationOptions(theme)} />
      <WalletsStack.Screen name="NetworkSettings" component={NetworkSettings} options={NetworkSettings.navigationOptions(theme)} />
      <WalletsStack.Screen
        name="NotificationSettings"
        component={NotificationSettings}
        options={NotificationSettings.navigationOptions(theme)}
      />
      <WalletsStack.Screen
        name="PlausibleDeniability"
        component={PlausibleDeniability}
        options={PlausibleDeniability.navigationOptions(theme)}
      />
      <WalletsStack.Screen name="LightningSettings" component={LightningSettings} options={LightningSettings.navigationOptions(theme)} />
      <WalletsStack.Screen name="ElectrumSettings" component={ElectrumSettings} options={ElectrumSettings.navigationOptions(theme)} />
      <WalletsStack.Screen name="SettingsPrivacy" component={SettingsPrivacy} options={SettingsPrivacy.navigationOptions(theme)} />
      <WalletsStack.Screen name="Tools" component={Tools} options={Tools.navigationOptions(theme)} />
      <WalletsStack.Screen name="LNDViewInvoice" component={LNDViewInvoice} options={LNDViewInvoice.navigationOptions(theme)} />
      <WalletsStack.Screen
        name="LNDViewAdditionalInvoiceInformation"
        component={LNDViewAdditionalInvoiceInformation}
        options={LNDViewAdditionalInvoiceInformation.navigationOptions(theme)}
      />
      <WalletsStack.Screen
        name="LNDViewAdditionalInvoicePreImage"
        component={LNDViewAdditionalInvoicePreImage}
        options={LNDViewAdditionalInvoicePreImage.navigationOptions(theme)}
      />
      <WalletsStack.Screen name="Broadcast" component={Broadcast} options={Broadcast.navigationOptions(theme)} />
      <WalletsStack.Screen name="IsItMyAddress" component={IsItMyAddress} options={IsItMyAddress.navigationOptions(theme)} />
      <WalletsStack.Screen name="GenerateWord" component={GenerateWord} options={GenerateWord.navigationOptions(theme)} />
      <WalletsStack.Screen name="LnurlPay" component={LnurlPay} options={LnurlPay.navigationOptions(theme)} />
      <WalletsStack.Screen name="LnurlPaySuccess" component={LnurlPaySuccess} options={LnurlPaySuccess.navigationOptions(theme)} />
      <WalletsStack.Screen name="LnurlAuth" component={LnurlAuth} options={LnurlAuth.navigationOptions(theme)} />
      <WalletsStack.Screen
        name="Success"
        component={Success}
        options={{
          headerShown: false,
          gestureEnabled: false,
        }}
      />
      <WalletsStack.Screen name="WalletAddresses" component={WalletAddresses} options={WalletAddresses.navigationOptions(theme)} />
    </WalletsStack.Navigator>
  );
};

const AddWalletStack = createStackNavigator();
const AddWalletRoot = () => {
  const theme = useTheme();

  return (
    <AddWalletStack.Navigator screenOptions={{ headerShadowVisible: false }}>
      <AddWalletStack.Screen name="AddWallet" component={AddWallet} options={AddWallet.navigationOptions(theme)} />
      <AddWalletStack.Screen name="ImportWallet" component={ImportWallet} options={ImportWallet.navigationOptions(theme)} />
      <AddWalletStack.Screen
        name="ImportWalletDiscovery"
        component={ImportWalletDiscovery}
        options={ImportWalletDiscovery.navigationOptions(theme)}
      />
      <AddWalletStack.Screen
        name="ImportCustomDerivationPath"
        component={ImportCustomDerivationPath}
        options={ImportCustomDerivationPath.navigationOptions(theme)}
      />
      <AddWalletStack.Screen name="ImportSpeed" component={ImportSpeed} options={ImportSpeed.navigationOptions(theme)} />
      <AddWalletStack.Screen name="PleaseBackup" component={PleaseBackup} options={PleaseBackup.navigationOptions(theme)} />
      <AddWalletStack.Screen
        name="PleaseBackupLNDHub"
        component={PleaseBackupLNDHub}
        options={PleaseBackupLNDHub.navigationOptions(theme)}
      />
      <AddWalletStack.Screen name="PleaseBackupLdk" component={PleaseBackupLdk} options={PleaseBackupLdk.navigationOptions(theme)} />
      <AddWalletStack.Screen name="ProvideEntropy" component={ProvideEntropy} options={ProvideEntropy.navigationOptions(theme)} />
      <AddWalletStack.Screen
        name="WalletsAddMultisig"
        component={WalletsAddMultisig}
        options={WalletsAddMultisig.navigationOptions(theme)}
        initialParams={WalletsAddMultisig.initialParams}
      />
      <AddWalletStack.Screen
        name="WalletsAddMultisigStep2"
        component={WalletsAddMultisigStep2}
        options={WalletsAddMultisigStep2.navigationOptions(theme)}
      />
      <AddWalletStack.Screen
        name="WalletsAddMultisigHelp"
        component={WalletsAddMultisigHelp}
        options={WalletAddMultisigHelpNavigationOptions}
      />
    </AddWalletStack.Navigator>
  );
};

// CreateTransactionStackNavigator === SendDetailsStack
const SendDetailsStack = createStackNavigator();
const SendDetailsRoot = () => {
  const theme = useTheme();

  return (
    <SendDetailsStack.Navigator screenOptions={{ headerShadowVisible: false }}>
      <SendDetailsStack.Screen
        name="SendDetails"
        component={SendDetails}
        options={SendDetails.navigationOptions(theme)}
        initialParams={SendDetails.initialParams}
      />
      <SendDetailsStack.Screen name="Confirm" component={Confirm} options={Confirm.navigationOptions(theme)} />
      <SendDetailsStack.Screen
        name="PsbtWithHardwareWallet"
        component={PsbtWithHardwareWallet}
        options={PsbtWithHardwareWallet.navigationOptions(theme)}
      />
      <SendDetailsStack.Screen name="CreateTransaction" component={SendCreate} options={SendCreate.navigationOptions(theme)} />
      <SendDetailsStack.Screen name="PsbtMultisig" component={PsbtMultisig} options={PsbtMultisig.navigationOptions(theme)} />
      <SendDetailsStack.Screen
        name="PsbtMultisigQRCode"
        component={PsbtMultisigQRCode}
        options={PsbtMultisigQRCode.navigationOptions(theme)}
      />
      <SendDetailsStack.Screen
        name="Success"
        component={Success}
        options={{
          headerShown: false,
          gestureEnabled: false,
        }}
      />
      <SendDetailsStack.Screen name="SelectWallet" component={SelectWallet} options={SelectWallet.navigationOptions(theme)} />
      <SendDetailsStack.Screen name="CoinControl" component={CoinControl} options={CoinControl.navigationOptions(theme)} />
    </SendDetailsStack.Navigator>
  );
};

const LNDCreateInvoiceStack = createStackNavigator();
const LNDCreateInvoiceRoot = () => {
  const theme = useTheme();

  return (
    <LNDCreateInvoiceStack.Navigator screenOptions={{ headerShadowVisible: false }}>
      <LNDCreateInvoiceStack.Screen
        name="LNDCreateInvoice"
        component={LNDCreateInvoice}
        options={LNDCreateInvoice.navigationOptions(theme)}
      />
      <LNDCreateInvoiceStack.Screen name="SelectWallet" component={SelectWallet} options={SelectWallet.navigationOptions(theme)} />
      <LNDCreateInvoiceStack.Screen name="LNDViewInvoice" component={LNDViewInvoice} options={LNDViewInvoice.navigationOptions(theme)} />
      <LNDCreateInvoiceStack.Screen
        name="LNDViewAdditionalInvoiceInformation"
        component={LNDViewAdditionalInvoiceInformation}
        options={LNDViewAdditionalInvoiceInformation.navigationOptions(theme)}
      />
      <LNDCreateInvoiceStack.Screen
        name="LNDViewAdditionalInvoicePreImage"
        component={LNDViewAdditionalInvoicePreImage}
        options={LNDViewAdditionalInvoicePreImage.navigationOptions(theme)}
      />
    </LNDCreateInvoiceStack.Navigator>
  );
};

// LightningScanInvoiceStackNavigator === ScanLndInvoiceStack
const ScanLndInvoiceStack = createStackNavigator();
const ScanLndInvoiceRoot = () => {
  const theme = useTheme();

  return (
    <ScanLndInvoiceStack.Navigator screenOptions={{ headerShadowVisible: false }}>
      <ScanLndInvoiceStack.Screen
        name="ScanLndInvoice"
        component={ScanLndInvoice}
        options={ScanLndInvoice.navigationOptions(theme)}
        initialParams={ScanLndInvoice.initialParams}
      />
      <ScanLndInvoiceStack.Screen name="SelectWallet" component={SelectWallet} options={SelectWallet.navigationOptions(theme)} />
      <ScanLndInvoiceStack.Screen name="Success" component={Success} options={{ headerShown: false, gestureEnabled: false }} />
      <ScanLndInvoiceStack.Screen name="LnurlPay" component={LnurlPay} options={LnurlPay.navigationOptions(theme)} />
      <ScanLndInvoiceStack.Screen name="LnurlPaySuccess" component={LnurlPaySuccess} options={LnurlPaySuccess.navigationOptions(theme)} />
    </ScanLndInvoiceStack.Navigator>
  );
};

const LDKOpenChannelStack = createStackNavigator();
const LDKOpenChannelRoot = () => {
  const theme = useTheme();

  return (
    <LDKOpenChannelStack.Navigator name="LDKOpenChannelRoot" screenOptions={{ headerShadowVisible: false }} initialRouteName="SelectWallet">
      <LDKOpenChannelStack.Screen name="SelectWallet" component={SelectWallet} options={SelectWallet.navigationOptions(theme)} />
      <LDKOpenChannelStack.Screen
        name="LDKOpenChannelSetAmount"
        component={LdkOpenChannel}
        options={LdkOpenChannel.navigationOptions(theme)}
      />
      <LDKOpenChannelStack.Screen name="Success" component={Success} options={{ headerShown: false, gestureEnabled: false }} />
    </LDKOpenChannelStack.Navigator>
  );
};

const AztecoRedeemStack = createStackNavigator();
const AztecoRedeemRoot = () => {
  const theme = useTheme();

  return (
    <AztecoRedeemStack.Navigator screenOptions={{ headerShadowVisible: false }}>
      <AztecoRedeemStack.Screen name="AztecoRedeem" component={AztecoRedeem} options={AztecoRedeem.navigationOptions(theme)} />
      <AztecoRedeemStack.Screen name="SelectWallet" component={SelectWallet} />
    </AztecoRedeemStack.Navigator>
  );
};

const ScanQRCodeStack = createStackNavigator();
const ScanQRCodeRoot = () => (
  <ScanQRCodeStack.Navigator
    initialRouteName="ScanQRCode"
    name="ScanQRCodeRoot"
    screenOptions={{ headerShown: false, presentation: 'fullScreenModal' }}
  >
    <ScanQRCodeStack.Screen name="ScanQRCode" component={ScanQRCode} initialParams={ScanQRCode.initialParams} />
  </ScanQRCodeStack.Navigator>
);

const UnlockWithScreenStack = createStackNavigator();
const UnlockWithScreenRoot = () => (
  <UnlockWithScreenStack.Navigator name="UnlockWithScreenRoot" screenOptions={{ headerShown: false, statusBarStyle: 'auto' }}>
    <UnlockWithScreenStack.Screen name="UnlockWithScreen" component={UnlockWith} initialParams={{ unlockOnComponentMount: true }} />
  </UnlockWithScreenStack.Navigator>
);

const ReorderWalletsStack = createStackNavigator();
const ReorderWalletsStackRoot = () => {
  const theme = useTheme();

  return (
    <ReorderWalletsStack.Navigator name="ReorderWalletsRoot" screenOptions={{ headerShadowVisible: false }}>
      <ReorderWalletsStack.Screen
        name="ReorderWalletsScreen"
        component={ReorderWallets}
        options={ReorderWallets.navigationOptions(theme)}
      />
    </ReorderWalletsStack.Navigator>
  );
};

const Drawer = createDrawerNavigator();
const DrawerRoot = () => {
  const dimensions = useWindowDimensions();
  const isLargeScreen = useMemo(() => {
    return Platform.OS === 'android' ? isTablet() : (dimensions.width >= Dimensions.get('screen').width / 2 && isTablet()) || isDesktop;
  }, [dimensions.width]);
  const drawerStyle = useMemo(
    () => ({
      drawerPosition: I18nManager.isRTL ? 'right' : 'left',
      drawerStyle: { width: isLargeScreen ? 320 : '0%' },
      drawerType: isLargeScreen ? 'permanent' : 'back',
    }),
    [isLargeScreen],
  );
  const drawerContent = useCallback(props => <DrawerList {...props} />, []);

  return (
    <Drawer.Navigator screenOptions={drawerStyle} drawerContent={drawerContent}>
      <Drawer.Screen name="Navigation" component={Navigation} options={{ headerShown: false, gestureEnabled: false }} />
    </Drawer.Navigator>
  );
};

const ReceiveDetailsStack = createStackNavigator();
const ReceiveDetailsStackRoot = () => {
  const theme = useTheme();

  return (
    <ReceiveDetailsStack.Navigator
      name="ReceiveDetailsRoot"
      screenOptions={{ headerShadowVisible: false }}
      initialRouteName="ReceiveDetails"
    >
      <ReceiveDetailsStack.Screen name="ReceiveDetails" component={ReceiveDetails} options={ReceiveDetails.navigationOptions(theme)} />
    </ReceiveDetailsStack.Navigator>
  );
};

const WalletXpubStack = createStackNavigator();
const WalletXpubStackRoot = () => {
  const theme = useTheme();

  return (
    <WalletXpubStack.Navigator
      name="WalletXpubRoot"
      screenOptions={{ headerShadowVisible: false, statusBarStyle: 'light' }}
      initialRouteName="WalletXpub"
    >
      <WalletXpubStack.Screen name="WalletXpub" component={WalletXpub} options={WalletXpub.navigationOptions(theme)} />
    </WalletXpubStack.Navigator>
  );
};

const SignVerifyStack = createStackNavigator();
const SignVerifyStackRoot = () => {
  const theme = useTheme();

  return (
    <SignVerifyStack.Navigator
      name="SignVerifyRoot"
      screenOptions={{ headerShadowVisible: false, statusBarStyle: 'light' }}
      initialRouteName="SignVerify"
    >
      <SignVerifyStack.Screen name="SignVerify" component={SignVerify} options={SignVerify.navigationOptions(theme)} />
    </SignVerifyStack.Navigator>
  );
};

const WalletExportStack = createStackNavigator();
const WalletExportStackRoot = () => {
  const theme = useTheme();

  return (
    <WalletExportStack.Navigator
      name="WalletExportRoot"
      screenOptions={{ headerShadowVisible: false, statusBarStyle: 'light' }}
      initialRouteName="WalletExport"
    >
      <WalletExportStack.Screen name="WalletExport" component={WalletExport} options={WalletExport.navigationOptions(theme)} />
    </WalletExportStack.Navigator>
  );
};

const LappBrowserStack = createStackNavigator();
const LappBrowserStackRoot = () => {
  const theme = useTheme();

  return (
    <LappBrowserStack.Navigator name="LappBrowserRoot" screenOptions={{ headerShadowVisible: false }} initialRouteName="LappBrowser">
      <LappBrowserStack.Screen name="LappBrowser" component={LappBrowser} options={LappBrowser.navigationOptions(theme)} />
    </LappBrowserStack.Navigator>
  );
};

const InitStack = createStackNavigator();
const InitRoot = () => {




  return (
    <InitStack.Navigator initialRouteName={'SplashScreen'} screenOptions={{
      cardStyleInterpolator: CardStyleInterpolators.forBottomSheetAndroid,
      gestureEnabled: false,
    }}>
      <InitStack.Screen name="TermOfService" component={TermOfService} options={{ headerShown: false, gestureEnabled: false, }} />
      <InitStack.Screen name="GetStartedScreen" component={GetStartedScreen} options={{ headerShown: false, gestureEnabled: false, }} />
      <InitStack.Screen name="SplashScreen" component={SplashScreen} options={{ headerShown: false, gestureEnabled: false }} />
      <InitStack.Screen name="WelcomeScreen" component={WelcomeScreen} options={{ headerShown: false, gestureEnabled: false }} />
      <InitStack.Screen name="UnlockWithScreenRoot" component={UnlockWithScreenRoot} options={{ headerShown: false }} />
      <InitStack.Screen
        name="ReorderWallets"
        component={ReorderWalletsStackRoot}
        options={{ headerShown: false, gestureEnabled: false, presentation: 'modal' }}
      />
      <InitStack.Screen
        name={isHandset ? 'Navigation' : 'DrawerRoot'}
        component={isHandset ? Navigation : DrawerRoot}
        options={{ headerShown: false, replaceAnimation: 'push' }}
      />
    </InitStack.Navigator>
  );
}

const ViewEditMultisigCosignersStack = createStackNavigator();
const ViewEditMultisigCosignersRoot = () => {
  const theme = useTheme();

  return (
    <ViewEditMultisigCosignersStack.Navigator
      name="ViewEditMultisigCosignersRoot"
      initialRouteName="ViewEditMultisigCosigners"
      screenOptions={{ headerShadowVisible: false, statusBarStyle: 'light' }}
    >
      <ViewEditMultisigCosignersStack.Screen
        name="ViewEditMultisigCosigners"
        component={ViewEditMultisigCosigners}
        options={ViewEditMultisigCosigners.navigationOptions(theme)}
      />
    </ViewEditMultisigCosignersStack.Navigator>
  );
};

const ExportMultisigCoordinationSetupStack = createStackNavigator();
const ExportMultisigCoordinationSetupRoot = () => {
  const theme = useTheme();

  return (
    <ExportMultisigCoordinationSetupStack.Navigator
      name="ExportMultisigCoordinationSetupRoot"
      initialRouteName="ExportMultisigCoordinationSetup"
      screenOptions={{ headerShadowVisible: false, statusBarStyle: 'light' }}
    >
      <ExportMultisigCoordinationSetupStack.Screen
        name="ExportMultisigCoordinationSetup"
        component={ExportMultisigCoordinationSetup}
        options={ExportMultisigCoordinationSetup.navigationOptions(theme)}
      />
    </ExportMultisigCoordinationSetupStack.Navigator>
  );
};

const PaymentCodeStack = createStackNavigator();
const PaymentCodeStackRoot = () => {
  return (
    <PaymentCodeStack.Navigator name="PaymentCodeRoot" screenOptions={{ headerShadowVisible: false }} initialRouteName="PaymentCode">
      <PaymentCodeStack.Screen name="PaymentCode" component={PaymentCode} options={{ headerTitle: loc.bip47.payment_code }} />
      <PaymentCodeStack.Screen
        name="PaymentCodesList"
        component={PaymentCodesList}
        options={{ headerTitle: loc.bip47.payment_codes_list }}
      />
    </PaymentCodeStack.Navigator>
  );
};

const RootStack = createStackNavigator();
const NavigationDefaultOptions = { headerShown: false, presentation: 'modal' };
const NavigationFormModalOptions = { headerShown: false, presentation: 'formSheet' };
const StatusBarLightOptions = { statusBarStyle: 'light' };
const Navigation = () => {
  return (
    <RootStack.Navigator initialRouteName="UnlockWithScreenRoot" screenOptions={{ headerHideShadow: true, statusBarStyle: 'auto' }}>
      {/* stacks */}
      <RootStack.Screen name="WalletsRoot" component={WalletsRoot} options={{ headerShown: false, translucent: false }} />
      <RootStack.Screen name="AddWalletRoot" component={AddWalletRoot} options={NavigationFormModalOptions} />
      <RootStack.Screen name="SendDetailsRoot" component={SendDetailsRoot} options={NavigationDefaultOptions} />
      <RootStack.Screen name="LNDCreateInvoiceRoot" component={LNDCreateInvoiceRoot} options={NavigationDefaultOptions} />
      <RootStack.Screen name="ScanLndInvoiceRoot" component={ScanLndInvoiceRoot} options={NavigationDefaultOptions} />
      <RootStack.Screen name="AztecoRedeemRoot" component={AztecoRedeemRoot} options={NavigationDefaultOptions} />
      {/* screens */}
      <RootStack.Screen
        name="WalletExportRoot"
        component={WalletExportStackRoot}
        options={{ ...NavigationDefaultOptions, ...StatusBarLightOptions }}
      />
      <RootStack.Screen
        name="ExportMultisigCoordinationSetupRoot"
        component={ExportMultisigCoordinationSetupRoot}
        options={NavigationDefaultOptions}
      />
      <RootStack.Screen
        name="ViewEditMultisigCosignersRoot"
        component={ViewEditMultisigCosignersRoot}
        options={{ ...NavigationDefaultOptions, ...StatusBarLightOptions }}
      />
      <RootStack.Screen
        name="WalletXpubRoot"
        component={WalletXpubStackRoot}
        options={{ ...NavigationDefaultOptions, ...StatusBarLightOptions }}
      />
      <RootStack.Screen
        name="SignVerifyRoot"
        component={SignVerifyStackRoot}
        options={{ ...NavigationDefaultOptions, ...StatusBarLightOptions }}
      />
      <RootStack.Screen name="SelectWallet" component={SelectWallet} />
      <RootStack.Screen name="ReceiveDetailsRoot" component={ReceiveDetailsStackRoot} options={NavigationDefaultOptions} />
      <RootStack.Screen name="LappBrowserRoot" component={LappBrowserStackRoot} options={NavigationDefaultOptions} />
      <RootStack.Screen name="LDKOpenChannelRoot" component={LDKOpenChannelRoot} options={NavigationDefaultOptions} />

      <RootStack.Screen
        name="ScanQRCodeRoot"
        component={ScanQRCodeRoot}
        options={{
          headerShown: false,
          presentation: 'fullScreenModal',
          statusBarHidden: true,
        }}
        initialParams={ScanQRCode.initialParams}
      />

      <RootStack.Screen name="PaymentCodeRoot" component={PaymentCodeStackRoot} options={NavigationDefaultOptions} />
    </RootStack.Navigator>
  );
};

export default InitRoot;

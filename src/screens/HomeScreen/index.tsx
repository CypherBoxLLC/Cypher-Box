import React, { useCallback, useContext, useEffect, useReducer, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, Linking, RefreshControl, StyleSheet, TouchableOpacity, useWindowDimensions, View } from "react-native";
import SimpleToast from "react-native-simple-toast";
import styles from "./styles";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import { TabView, SceneMap } from 'react-native-tab-view';
import { scanQrHelper } from "../../../helpers/scan-qr";
import DeeplinkSchemaMatch from "../../../class/deeplink-schema-match";
import triggerHapticFeedback, {
  HapticFeedbackTypes,
} from "../../../blue_modules/hapticFeedback";
import { CoinOSSmall, PlusNew } from "@Cypher/assets/images";
import {
  BlackBGView,
  CircularView,
  GradientButtonWithShadow,
  GradientCard,
  GradientCardWithShadow,
  GradientText,
  GradientView,
  SavingVault,
  StrikeDollarWallet,
} from "@Cypher/components";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate, isIOS } from "@Cypher/helpers";
import { Shadow } from "react-native-neomorph-shadows";
import { colors, heights, shadow } from "@Cypher/style-guide";
import RBSheet from 'react-native-raw-bottom-sheet';
import LinearGradient from "react-native-linear-gradient";
import ReceivedList from "./ReceivedList";
import useAuthStore from "@Cypher/stores/authStore";
import { useArkSync, useArkRestoreOnBoot } from "@Cypher/custom-hooks";
import { bitcoinRecommendedFee, createInvoice, getCurrencyRates, getInvoiceByLightening, getMe, getTransactionHistory, refreshCoinOSToken } from "@Cypher/api/coinOSApis";
import { btc, formatNumber, matchKeyAndValue, SATS } from "@Cypher/helpers/coinosHelper";
import { AbstractWallet, HDSegwitBech32Wallet, HDSegwitP2SHWallet } from "../../../class";
import loc, { formatBalance, formatBalanceWithoutSuffix } from '../../../loc';
import { initialState, walletReducer } from "../../../screen/wallets/add";
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { startsWithLn } from "../Send";
import screenHeight from "@Cypher/style-guide/screenHeight";
import { getFiatRate } from "../../../models/fiatUnit";
import Carousel from "react-native-snap-carousel";
import screenWidth from "@Cypher/style-guide/screenWidth";
import { convertFiatToUSD, fetchedRate, mostRecentFetchedRate } from "../../../blue_modules/currency";
import { authorize } from "react-native-app-auth";
import { getBalances, getStrikeRates } from "@Cypher/api/strikeAPIs";
import ReceivedListNew from "./ReceivedListNew";
import { connect as connectCoinosSocket, disconnect as disconnectCoinosSocket, setOnPaymentReceived, registerPushToken, setUsername as setCoinosUsername } from "@Cypher/services/coinosSocket";
import Header from "./Header";
import BalanceView from "./BalanceView";
import BottomBar from "./BottomBar";
const A = require('../../../blue_modules/analytics');
import CreateLightningAccount from "./CreateLightningAccount";
import WalletsView, { WalletsViewHandle } from "./WalletsView";
import SendListNew from "./SendListNew";
import TopupList from "./TopupList";
import WithdrawList from "./WithdrawList";
import SwapSheet from "./SwapSheet";
import { FiatUnit, FiatUnitType } from "models/fiatUnit";
import untypedFiatUnit from '../../../models/fiatUnits.json';

interface Props {
  route: any;
}

const config = {
  id: 'strike',
  name: 'Strike',
  type: 'oauth',
  issuer: "https://auth.strike.me", // Strike Identity Server URL
  clientId: "cypherbox",
  clientSecret: "", // DO NOT hardcode secrets in client-side code
  redirectUrl: "cypherbox://oauth/callback", // Must match the redirect URI in your Strike app settings
  scopes: ["offline_access", "partner.balances.read", "partner.currency-exchange-quote.read", "partner.account.profile.read", "profile", "openid", "partner.invoice.read", "partner.invoice.create", "partner.invoice.quote.generate", "partner.invoice.quote.read", "partner.rates.ticker"], // Specify necessary scopes
  //clientAuthMethod: "post",
  //wellKnown: `https://auth.strike.me/.well-known/openid-configuration`,
  // authorization: {
  //     params: {
  //         scope: 'partner.invoice.read offline_access',
  //         response_type: 'code',
  //     }
  // },
  idToken: false,
  checks: ['pkce', 'state'],
  // serviceConfiguration: {
  //   authorizationEndpoint: "https://auth.strike.me/oauth/authorize",
  //   tokenEndpoint: "https://auth.strike.me/oauth/token",
  //   revocationEndpoint: "https://auth.strike.me/oauth/revoke",
  // },
};

export const calculatePercentage = (withdrawThreshold: number, reserveAmount: number) => {
  const threshold = Number(withdrawThreshold);
  const reserve = Number(reserveAmount);

  const percentage = (threshold / (threshold + reserve)) * 100;
  return Math.min(percentage, 100);
};

export function calculateBalancePercentage(balance: number, withdrawThreshold: number, reserveAmount: number) {
  const total = withdrawThreshold + reserveAmount;

  if (total === 0) {
    return 0; // Prevent division by zero
  }

  const percentage = (balance / total) * 100;
  const resPercentage = percentage > 100 ? 100 : percentage;
  return parseFloat(resPercentage.toFixed(2)); // Return percentage rounded to 2 decimal places
}

function formatStrikeNumber(num: number) {
  const millions = num / 1000000;
  return `${millions.toFixed(1)}M`;
}

export default function HomeScreen({ route }: Props) {
  const { navigate } = useNavigation();
  const routeName = useRoute().name;
  const [state, dispatch] = useReducer(walletReducer, initialState);
  const label = state.label;
  const { addWallet, saveToDisk, isAdvancedModeEnabled, wallets, sleep, isElectrumDisabled, startAndDecrypt, setWalletsInitialized } = useContext(BlueStorageContext);
  const { isAuth, isStrikeAuth, isArkAuth, strikeToken, walletTab, allBTCWallets, setAllBTCWallets, withdrawStrikeThreshold, reserveStrikeAmount, strikeUser, strikeMe, strikeCurrency, setStrikeCurrency, setWalletTab, setStrikeUser, setStrikeToken, setStrikeAuth, clearStrikeAuth, walletID, coldStorageWalletID, token, user, withdrawThreshold, reserveAmount, vaultTab, setUser, setVaultTab, matchedRateStrike, setMatchedRateStrike, hasSeenCustodialWarning } = useAuthStore();
  // Ark boot restore: reopens the wallet from on-disk state (datadir +
  // Keychain mnemonic) once per mount, and reconciles zustand so the
  // carousel reflects reality. Handles Metro reload + zustand/disk drift.
  useArkRestoreOnBoot();
  // Ark sync: starts automatically when isArkAuth flips true. Runs an
  // initial fetch + 30s interval + foreground-kick for balance / vtxos /
  // chain tip. No-op when Ark isn't set up.
  const arkSync = useArkSync();
  // const [storage, setStorage] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [carouselPage, setCarouselPage] = useState(0);
  const [carouselTotal, setCarouselTotal] = useState(0);
  const [carouselKinds, setCarouselKinds] = useState<Array<'fiat' | 'lightning' | 'ark'>>([]);
  const walletsViewRef = useRef<WalletsViewHandle>(null);
  // Smooth entrance animation — fires every time HomeScreen gains focus,
  // not just on first mount. Without this, navigating back from another
  // screen pops the wallet/vault carousels in instantly which reads as
  // choppy. Opacity 0→1 + a small upward drift gives an iOS-style fade-in
  // that takes the edge off the layout settle.
  //
  // Uses native driver — opacity + transform are both supported on the
  // native side, so the animation runs off the JS thread and stays smooth
  // even while the snap-carousels mount their internal animated values.
  const enterAnim = useRef(new Animated.Value(0)).current;
  const enterTranslate = enterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0], // 12pt drift up — subtle, matches iOS push transition
  });

  useFocusEffect(
    useCallback(() => {
      enterAnim.setValue(0);
      Animated.timing(enterAnim, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }, [enterAnim])
  );
  const [balance, setBalance] = useState(0);
  const [strikeBalance, setStrikeBalance] = useState(0);
  const [currency, setCurrency] = useState('USD');
  const [convertedRate, setConvertedRate] = useState(0);
  const [convertedStrikeRate, setConvertedStrikeRate] = useState(0);
  const [matchedRate, setMatchedRate] = useState(0);
  const [matchedRateBTC, setMatchedRateBTC] = useState(0); // USD-per-BTC for vault screens
  const [refreshing, setRefreshing] = useState(false);
  const [payment, setPayments] = useState([])
  const [wt, setWt] = useState<number>();
  const [isWithdraw, setIsWithdraw] = useState<boolean>(true);
  const [isAllDone, setIsAllDone] = useState<boolean>(false);
  const [wallet, setWallet] = useState(undefined);
  const [balanceVault, setBalanceVault] = useState<string | false | undefined>("");
  const [balanceWithoutSuffix, setBalanceWithoutSuffix] = useState()
  const [coldStorageWallet, setColdStorageWallet] = useState(undefined);
  const [ColdStorageBalanceVault, setColdStorageBalanceVault] = useState<string | false | undefined>("");
  const [coldStorageBalanceWithoutSuffix, setColdStorageBalanceWithoutSuffix] = useState()
  const [recommendedFee, setRecommendedFee] = useState<any>();
  const [vaultAddress, setVaultAddress] = useState('')
  const [coldStorageAddress, setColdStorageAddress] = useState('')
  const [hasSavingVault, setHasSavingVault] = useState<boolean | null>()
  const [hasColdStorage, setHasColdStorage] = useState<boolean>(false);
  const [sendAddress, setSendAddress] = useState<any>()
  const [isWalletLoaded, setIsWalletLoaded] = useState(true);
  const [isColdWalletLoaded, setIsColdWalletLoaded] = useState(true);
  const [receiveType, setReceiveType] = useState(false);
  const [strikeConvertedBalance, setStrikeConvertedBalance] = useState(0);
  const refRBSheet = useRef<any>(null);
  const refSendRBSheet = useRef<any>(null);
  const reopenSendSheet = useRef(false);
  const refWithdrawRBSheet = useRef<any>(null);
  const refTopupRBSheet = useRef<any>(null);
  const refSwapRBSheet = useRef<any>(null);
  const [receivedListSecondTab, setReceivedListSecondTab] = useState(false);
  const [initialVaultType, setInitialVaultType] = useState<'hot' | 'cold' | null>(null);
  const carouselRef = useRef<Carousel<any>>(null);

  // Sync local currency state with store's strikeCurrency
  useEffect(() => {
    if (strikeCurrency) {
      setCurrency(strikeCurrency);
    }
  }, [strikeCurrency]);

  const getWalletID = async () => {
    try {
      return await AsyncStorage.getItem('wallet@ID');
    } catch (error) {
      console.error('Error getting auth token from AsyncStorage:', error);
      throw error;
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (route?.params?.isComplete) setIsAllDone(true);
      if (!coldStorageWalletID) setColdStorageWallet(undefined)
      if (!walletID) setWallet(undefined)

      // Handle address selected from WalletAddresses screen
      if (route?.params?.selectedVaultAddress) {
        const addr = route.params.selectedVaultAddress;
        const type = route.params.selectedVaultType as 'hot' | 'cold';
        if (type === 'cold') {
          setColdStorageAddress(addr);
        } else {
          setVaultAddress(addr);
        }
        setInitialVaultType(type);
        // Open the receive popup with the selected address
        setTimeout(() => {
          refRBSheet?.current?.open();
          // Clear after popup is open so it doesn't affect future opens
          setTimeout(() => setInitialVaultType(null), 500);
        }, 300);
        // Clear the param so it doesn't re-trigger
        if (route.params) {
          route.params.selectedVaultAddress = undefined;
          route.params.selectedVaultType = undefined;
        }
      }
    }, [wallet, coldStorageWalletID, walletID, route?.params?.selectedVaultAddress]),
  );

  useFocusEffect(
    useCallback(() => {
      if (reopenSendSheet.current) {
        reopenSendSheet.current = false;
        setTimeout(() => refSendRBSheet?.current?.open(), 300);
      }
    }, []),
  );

  const getWallet = async () => {
    try {
      if (!walletID) {
        setIsAllDone(false);
        return;
      }
      // const allWallets = wallets.concat(false);
      const walletTemp = wallets.find((w: AbstractWallet) => w.getID() === walletID);
      if (!walletTemp) {
        console.warn('Wallet not found for ID:', walletID);
        setIsAllDone(false);
        return;
      }

      // Subscribe vault addresses to GroundControl for push notifications
      try {
        const Notifications = require('../../../blue_modules/notifications');
        const pushTokenData = await Notifications.getPushToken();
        if (__DEV__) console.log('[GroundControl] Push token:', pushTokenData);
        
        if (!pushTokenData || !pushTokenData.token || !pushTokenData.os) {
          console.warn('[GroundControl] No push token - notifications not enabled');
          return;
        }
        
        const externalAddresses = typeof walletTemp.getAllExternalAddresses === 'function' ? walletTemp.getAllExternalAddresses() : [];
        const internalAddresses = typeof walletTemp.getAllInternalAddresses === 'function' ? walletTemp.getAllInternalAddresses() : [];
        const allAddresses = [...externalAddresses, ...internalAddresses];
        if (__DEV__) console.log('[GroundControl] Subscribing addresses:', allAddresses.length, allAddresses.slice(0, 2));
        if (allAddresses.length > 0) {
          await Notifications.majorTomToGroundControl(allAddresses, [], []);
          if (__DEV__) console.log('[GroundControl] Subscribed hot vault addresses:', allAddresses.length);
        }
      } catch (notifyErr) {
        console.warn('[GroundControl] Failed to subscribe addresses:', notifyErr);
      }
      const balanceTemp = !walletTemp?.hideBalance && formatBalance(walletTemp?.getBalance(), walletTemp?.getPreferredBalanceUnit(), true);
      const balanceWithoutSuffixTemp = !walletTemp?.hideBalance && formatBalanceWithoutSuffix(Number(walletTemp?.getBalance()), walletTemp?.getPreferredBalanceUnit(), true);
      await walletTemp.fetchBalance()
      setWallet(walletTemp);
      setBalanceWithoutSuffix(balanceWithoutSuffixTemp)
      setBalanceVault(balanceTemp)
      const hasVault = walletTemp.secret ? true : false;
      setHasSavingVault(hasVault)
      if (wallets && walletID) {
        setIsAllDone(!!walletTemp);
      } else {
        setIsAllDone(false)
      }  
    } catch (error) {
      console.error('Error getting wallet:', error);
    } finally {
      setIsWalletLoaded(false);
    }
  }

  const getColdStorageWallet = async () => {
    try {
      // const allWallets = wallets.concat(false);
      const walletTemp = wallets.find((w: AbstractWallet) => w.getID() === coldStorageWalletID);
      if (!walletTemp) {
        console.warn('Cold storage wallet not found for ID:', coldStorageWalletID);
        setIsAllDone(false);
        return;
      }

      // Subscribe cold storage addresses to GroundControl for push notifications
      try {
        const Notifications = require('../../../blue_modules/notifications');
        const pushTokenData = await Notifications.getPushToken();
        
        if (!pushTokenData || !pushTokenData.token || !pushTokenData.os) {
          console.warn('[GroundControl] No push token - notifications not enabled');
          return;
        }
        
        const externalAddresses = walletTemp.getAllExternalAddresses ? walletTemp.getAllExternalAddresses() : [];
        const internalAddresses = walletTemp.getAllInternalAddresses ? walletTemp.getAllInternalAddresses() : [];
        const allAddresses = [...externalAddresses, ...internalAddresses];
        if (__DEV__) console.log('[GroundControl] Subscribing cold storage addresses:', allAddresses.length);
        if (allAddresses.length > 0) {
          await Notifications.majorTomToGroundControl(allAddresses, [], []);
          if (__DEV__) console.log('[GroundControl] Subscribed cold storage addresses:', allAddresses.length);
        }
      } catch (notifyErr) {
        console.warn('[GroundControl] Failed to subscribe cold storage addresses:', notifyErr);
      }
      const balanceTemp = !walletTemp?.hideBalance && formatBalance(walletTemp?.getBalance(), walletTemp?.getPreferredBalanceUnit(), true);
      const balanceWithoutSuffixTemp = !walletTemp?.hideBalance && formatBalanceWithoutSuffix(Number(walletTemp?.getBalance()), walletTemp?.getPreferredBalanceUnit(), true);
      await walletTemp.fetchBalance()
      setColdStorageWallet(walletTemp);
      setColdStorageBalanceWithoutSuffix(balanceWithoutSuffixTemp)
      setColdStorageBalanceVault(balanceTemp)
      const hasVault = walletTemp.secret ? true : false;
      setHasColdStorage(hasVault)
      if (wallets && coldStorageWalletID) {
        setIsAllDone(!!walletTemp);
      } else {
        setIsAllDone(false)
      }  
    } catch (error) {
      console.error('Error getting wallet:', error);
    } finally {
      setIsColdWalletLoaded(false);
    }
  }

  // useEffect(() => {
  //   successfullyAuthenticated();
  // }, [])

  const loadStrikeData = async () => {
      if (__DEV__) console.log('[Strike] loadStrikeData START', Date.now());
      try {
          const balances = await getBalances();
          if (__DEV__) console.log('[Strike] getBalances DONE', Date.now());
          if (balances.data?.status === 401) {
              SimpleToast.show("Authorization expired. Please login again to strike account", SimpleToast.SHORT);
              clearStrikeAuth();
          } else if (balances) {
              if (__DEV__) console.log('balances (post-login): ', balances);
              // Normalize: index 0 = BTC, index 1 = fiat (API order is not guaranteed)
              const btcBalance = balances?.find((b: any) => b.currency === 'BTC');
              const fiatBalance = balances?.find((b: any) => b.currency !== 'BTC');
              const normalizedBalances = [btcBalance || balances?.[0], fiatBalance || balances?.[1]];
              if (__DEV__) console.log('Normalized balances — BTC:', btcBalance, 'Fiat:', fiatBalance);
              setStrikeUser(normalizedBalances);
              if (__DEV__) console.log('Setting strikeBalance:', normalizedBalances?.[0]?.available * SATS);
              setStrikeBalance((normalizedBalances?.[0]?.available * SATS) || 0);
              const userCurrency = normalizedBalances?.[1]?.currency || 'USD';
              if (__DEV__) console.log('Strike currency from balances:', userCurrency);
              setStrikeCurrency(userCurrency); // Store user's currency in auth
              
              // Fetch rates from Strike API (not external sources)
              if (__DEV__) console.log('[Strike] fetching rates from Strike API START', Date.now());
              const strikeRates = await getStrikeRates();
              if (__DEV__) console.log('[Strike] getStrikeRates DONE', Date.now(), strikeRates);
              
              // Find the rate for user's currency (e.g., USD, EUR) - look at sourceCurrency for BTC rate
              // Strike API returns array directly, not wrapped in .data
              if (__DEV__) console.log('[Strike] looking for BTC ->', userCurrency);
              const ratesArray = strikeRates?.data || strikeRates;
              if (__DEV__) console.log('[Strike] ratesArray:', JSON.stringify(ratesArray));
              const currencyRate = ratesArray?.find((r: any) => r.sourceCurrency === 'BTC' && r.targetCurrency === userCurrency);
              if (__DEV__) console.log('[Strike] matched rate:', currencyRate);
              const numericAmount = currencyRate ? Number(currencyRate?.amount || 0) : 0;
              if (__DEV__) console.log('[Strike] rate for', userCurrency + ':', numericAmount);
              setMatchedRateStrike(numericAmount);
              
              try {
                  // Strike returns BTC amount (e.g., 0.00004814), not sats
                  // Just multiply directly by exchange rate to get USD
                  const availableBalance = Number(normalizedBalances?.[0]?.available || 0);
                  if (__DEV__) console.log('[Strike] availableBalance (BTC):', availableBalance, 'numericAmount:', numericAmount);
                  const rate = Number(availableBalance * (numericAmount || 0));
                  if (__DEV__) console.log('[Strike] strikeConverted (rate):', rate);
                  setStrikeConvertedBalance(rate);
              } catch (e) {
                  console.warn('Failed to calculate strike converted balance:', e);
                  const availableBalance = Number(normalizedBalances?.[0]?.available || 0);
                  const directRate = Number(availableBalance * (numericAmount || 0));
                  setStrikeConvertedBalance(directRate);
              }
          }
      } catch (error) {
          console.error('Error loading Strike data:', error);
      }
  };

  const handleStrikeLogin = async () => {
      try {
          const result = await authorize(config);
          setStrikeToken(result.accessToken);
          setStrikeAuth(true);
          // Immediately load Strike data after login instead of waiting for focus/effect
          await loadStrikeData();
      } catch (error) {
          console.error("OAuth error", error);
      } finally {
        setIsLoading(false)
      }
  };

  const tokenRefreshedRef = useRef(false);

  useEffect(() => {
    async function handleToken() {
      if (isAuth && token) {
        // Refresh token once on first load to avoid 401 race
        if (!tokenRefreshedRef.current) {
          tokenRefreshedRef.current = true;
          try {
            const newToken = await refreshCoinOSToken();
            if (newToken && newToken !== token) {
              const { setToken } = useAuthStore.getState();
              setToken(newToken);
              return; // token change will re-trigger this effect with fresh token
            }
          } catch (_) {}
        }
        handleUser();
        loadPayments();
      } else {
        // Not logged into Coinos - use BlueWallet's native rate for vaults
        // Convert from USD-per-BTC to USD-per-sat (matchedRate format used by keyboard)
        try {
          const blueWalletRate = await getFiatRate('USD');
          setMatchedRate(blueWalletRate ? blueWalletRate * btc(1) : 0);
          setMatchedRateBTC(blueWalletRate || 0);
        } catch (err) {
          if (__DEV__) console.log('BlueWallet rate error:', err);
        }
        setIsLoading(false)
      }
    }

    // async function getWithdrawal() {
    //   const wt = await AsyncStorage.getItem('withdrawThreshold');
    //   if(wt){
    //     setWt(Number(wt));
    //   }
    // }
    // getWithdrawal();
    // if(!walletID){
    //   setIsWalletLoaded(false)
    // }
    // if(!coldStorageWalletID){
    //   setIsColdWalletLoaded(false)
    // }
    // TEMPORARY: timing telemetry for the cold-load freeze. Bam reported a
    // 20–30s blank/spinner state on every reload + rebuild. These logs
    // attribute the wait time to specific awaits in the on-mount chain so
    // we know which one to optimize (Electrum fetchBalance, GroundControl
    // subscribe, CoinOS token refresh, etc.). Remove once the slow path
    // is identified and addressed.
    if (__DEV__) console.log('[HomeMount] effect fire', Date.now(), { isAuth: !!isAuth, hasToken: !!token, hasWallet: !!walletID, hasCold: !!coldStorageWalletID });
    const _t0 = Date.now();
    Promise.resolve(getWallet()).finally(() => __DEV__ && console.log('[HomeMount] getWallet done +', Date.now() - _t0, 'ms'));
    if (coldStorageWalletID) {
      Promise.resolve(getColdStorageWallet()).finally(() => __DEV__ && console.log('[HomeMount] getColdStorageWallet done +', Date.now() - _t0, 'ms'));
    } else {
      setIsColdWalletLoaded(false);
    }
    Promise.resolve(handleToken()).finally(() => __DEV__ && console.log('[HomeMount] handleToken done +', Date.now() - _t0, 'ms'));
  }, [isAuth, token, wallets, walletID, coldStorageWalletID]);

  // CoinOS WebSocket for real-time payment notifications
  useEffect(() => {
    if (isAuth && token) {
      if (__DEV__) console.log('[CoinOS WS] Auth detected, connecting...');
      setCoinosUsername(user?.username || user);
      setOnPaymentReceived((data) => {
        if (__DEV__) console.log('[CoinOS WS] Payment callback, refreshing balance...');
        handleUser();
        loadPayments();
      });

      // Connect WS and register push — token already refreshed in handleToken
      const initCoinosConnection = async () => {
        connectCoinosSocket();

        // Register push token for background notifications (with fresh token)
        try {
          const Notifications = require('../../../blue_modules/notifications');
          const pushTokenData = await Notifications.default.getPushToken();
          if (pushTokenData?.token && user) {
            registerPushToken(user?.username || user, pushTokenData.token);
          }
        } catch (error) {
          console.warn('[Push Token] Registration failed:', error);
        }
      };

      initCoinosConnection();
    } else {
      disconnectCoinosSocket();
      setOnPaymentReceived(null);
    }
    return () => {
      disconnectCoinosSocket();
      setOnPaymentReceived(null);
    };
  }, [isAuth, token]);

  useEffect(() => {
    if (isAuth && token && ((!vaultAddress.startsWith('ln') && !vaultAddress.includes('@')) || (!coldStorageAddress.startsWith('ln') && !coldStorageAddress.includes('@'))) && !recommendedFee) {
      const init = async () => {
        const res = await bitcoinRecommendedFee();
        setRecommendedFee(res);
      }
      init();
    }
  }, [vaultAddress, coldStorageAddress])

  useEffect(() => {
    if(sendAddress && isAuth && token){
      if(startsWithLn(sendAddress)){
        handleLighteningInvoice()
      } else {
        dispatchNavigate('SendScreen', { currency, matchedRate, destination: sendAddress.toLowerCase() });
      }
    }
  }, [sendAddress, isAuth, token])

  // useEffect(()  => {
  useFocusEffect(
    useCallback(() => {
      // Refresh CoinOS balance on focus
      if (isAuth && token) {
        handleUser();
      }
      if (strikeToken) {
        loadStrikeData();
      }
    }, [strikeToken])
  )

  // console.log('strikeToken: ', strikeToken)
  const successfullyAuthenticated = async () => {
    // const hasAcceptedTerms = await AsyncStorage.getItem('hasAcceptedTermsOfService')
    await startAndDecrypt()
    setWalletsInitialized(true);

    // if (await startAndDecrypt()) {
    //     setWalletsInitialized(true);
    //     if (hasAcceptedTerms === 'true') {
    //         dispatch(StackActions.replace(isHandset ? 'Navigation' : 'DrawerRoot'));
    //     } else {
    //         dispatch(StackActions.replace('GetStartedScreen'));
    //     }
    // }
    // else {
    //     dispatchNavigate('WelcomeScreen')
    // }
    // setIsLoading(false);
  };
  const handleLighteningInvoice = async () => {
    try {
      const response = await getInvoiceByLightening(sendAddress);
      const dollarAmount = (response.amount_msat / 1000) * matchedRate * btc(1);
      if(dollarAmount){
        dispatchNavigate('ReviewPayment', {
          value: response.amount_msat / 1000,
          converted: dollarAmount,
          isSats: true,
          to: sendAddress,
          fees: 0,
          type: 'lightening',
          description: response?.description,
          matchedRate: matchedRate,
          currency: currency,
          recommendedFee: recommendedFee || 0
        });
      } else {
        dispatchNavigate('SendScreen', { currency, matchedRate, destination: sendAddress.toLowerCase() });
      }
    } catch (error) {
        console.error('Error handleLighteningInvoice:', error);
        SimpleToast.show('Failed to generate lightening. Please try again.', SimpleToast.SHORT);
    }
}
  const obtainWalletAddress = async () => {
    let newAddress;
    try {
      if (!isElectrumDisabled && wallet) newAddress = await Promise.race([wallet?.getAddressAsync(), sleep(1000)]);
    } catch (_) { }
    if (newAddress === undefined && wallet) {
      // either sleep expired or getAddressAsync threw an exception
      console.warn('either sleep expired or getAddressAsync threw an exception');
      newAddress = wallet._getExternalAddressByIndex(wallet.getNextFreeAddressIndex());
    } else {
      saveToDisk(); // caching whatever getAddressAsync() generated internally
    }
    setVaultAddress(newAddress);
  }

  const obtainColdWalletAddress = async () => {
    let newAddress;
    try {
      if (!isElectrumDisabled && coldStorageWallet) newAddress = await Promise.race([coldStorageWallet?.getAddressAsync(), sleep(1000)]);
    } catch (_) { }
    if (newAddress === undefined && coldStorageWallet) {
      // either sleep expired or getAddressAsync threw an exception
      console.warn('either sleep expired or getAddressAsync threw an exception');
      newAddress = coldStorageWallet._getExternalAddressByIndex(coldStorageWallet.getNextFreeAddressIndex());
    } else {
      saveToDisk(); // caching whatever getAddressAsync() generated internally
    }
    setColdStorageAddress(newAddress);
  }

  useFocusEffect(
    useCallback(() => {
      setSendAddress(null)
      if (wallet) {
        obtainWalletAddress();
        (async () => {
          try {
            await Promise.race([wallet?.fetchUtxo(), sleep(10000)]);
          } catch (e) {
            if (__DEV__) console.log('coincontrol wallet.fetchUtxo() failed'); // either sleep expired or fetchUtxo threw an exception
          }
        })();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet, sleep]),
  );

  useFocusEffect(
    useCallback(() => {
      if (coldStorageWallet) {
        obtainColdWalletAddress();
        (async () => {
          try {
            await Promise.race([coldStorageWallet?.fetchUtxo(), sleep(10000)]);
          } catch (e) {
            if (__DEV__) console.log('coincontrol coldStorageWallet.fetchUtxo() failed'); // either sleep expired or fetchUtxo threw an exception
          }
        })();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [coldStorageWallet, sleep]),
  );

  const handleUser = async () => {
    // Ark-only users (no CoinOS auth) were hitting `getMe()` on every
    // pull-to-refresh and tripping the catch block → "Failed to load
    // balance" toast. The CoinOS-specific work (/user fetch, currency
    // rates, balance/user state) is now gated behind `isAuth && token`;
    // the BlueWallet fiat rate still runs for everyone because vault
    // screens and the Ark card depend on it.
    const coinosAuthed = !!(isAuth && token);
    let coinosCallFailed = false;
    try {
      let coinosRate = 0;
      let blueWalletRate = 0;
      let blueWalletRateRaw = 0; // USD-per-BTC (for vaults)

      let response: any = null;
      if (coinosAuthed) {
        try {
          response = await getMe();
          if (response) {
            // Get Coinos rate for Coinos balance display (PRIMARY source)
            try {
              const responsetest = await getCurrencyRates();
              const currency = btc(1);
              const matched = matchKeyAndValue(responsetest, 'USD');
              coinosRate = (matched || 0) * currency;
              if (__DEV__) console.log('[Coinos] rate from API:', coinosRate);
            } catch (rateError) {
              if (__DEV__) console.log('[Coinos] rate API failed, trying BlueWallet fallback');
            }
          }
        } catch (coinosErr) {
          // getMe() threw for a user we believe IS CoinOS-authed — surface
          // it. For not-authed users we never got here in the first place.
          console.error('CoinOS /user fetch failed:', coinosErr);
          coinosCallFailed = true;
        }
      }

      // Always-on: BlueWallet rate. Vaults / Ark card depend on this even
      // when CoinOS is absent.
      try {
        blueWalletRateRaw = await getFiatRate('USD') || 0;
        blueWalletRate = blueWalletRateRaw * btc(1); // Convert USD-per-BTC to USD-per-sat
      } catch (rateErr) {
        if (__DEV__) console.log('BlueWallet rate error:', rateErr);
      }

      const finalRate = coinosRate || blueWalletRate;
      setMatchedRate(finalRate);
      setMatchedRateBTC(blueWalletRateRaw || (coinosRate ? coinosRate / btc(1) : 0));
      if (__DEV__) console.log('[Coinos] matchedRate set to:', finalRate, '(coinos:', coinosRate, ', bluewallet:', blueWalletRate, ')');

      if (response) {
        // Calculate converted rate using the same rate
        setConvertedRate(finalRate * response.balance);
        setCurrency("USD")
        setBalance(response?.balance ?? 0);
        setUser(response?.username);
      }

      if (coinosCallFailed) {
        // Only toast when the user actually has a CoinOS balance we failed
        // to load. Silent for Ark-only users (who have no CoinOS balance
        // to speak of).
        SimpleToast.show("Failed to load CoinOS balance. Pull to refresh.", SimpleToast.SHORT);
      }
    } catch (error) {
      console.error('handleUser unexpected error:', error);
      // Absolute fallback — still try to get a rate so the UI isn't
      // completely fiat-blind.
      try {
        const blueWalletRate = await getFiatRate('USD');
        setMatchedRate(blueWalletRate ? blueWalletRate * btc(1) : 0);
        setMatchedRateBTC(blueWalletRate || 0);
      } catch (bwError) {
        console.error('BlueWallet rate failed:', bwError);
        setMatchedRate(0);
        setMatchedRateBTC(0);
      }
      if (coinosAuthed) {
        SimpleToast.show("Failed to load balance. Pull to refresh.", SimpleToast.SHORT);
      }
    } finally {
      setIsLoading(false)
      setRefreshing(false);
    }
  }

  const loadPayments = async (append = true) => {
    try {
      const paymentList = await getTransactionHistory(0, 5);
      setPayments(paymentList.payments);
    } catch (error) {
      console.error('Error loading payments:', error);
      SimpleToast.show("Failed to load payments. Pull to refresh.", SimpleToast.SHORT);
    }
  };

  const loginClickHandler = () => {
    if (hasSeenCustodialWarning) {
      dispatchNavigate('CheckingAccountLogin');
    } else {
      dispatchNavigate('CheckingAccountIntro');
    }
  };

  const onBarScanned = (value: any) => {
    if (!value) return;
    setSendAddress(value);
    // DeeplinkSchemaMatch.navigationRouteFor(
    //   { url: value },
    //   (completionValue) => {
    //     triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
    //     navigate(...completionValue);
    //   }
    // );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (wallet) {
      await wallet?.fetchBalance();
    }
    if(coldStorageWallet){
      await coldStorageWallet?.fetchBalance();
    }
    handleUser();
    // Refresh Strike balance
    if (strikeToken) {
      try {
        const balances = await getBalances();
        if (balances && !balances.data?.status) {
          const btcBal = balances?.find((b: any) => b.currency === 'BTC');
          const fiatBal = balances?.find((b: any) => b.currency !== 'BTC');
          const normalized = [btcBal || balances?.[0], fiatBal || balances?.[1]];
          setStrikeUser(normalized);
          setStrikeBalance((normalized?.[0]?.available * SATS) || 0);
          const userCurrency = normalized?.[1]?.currency || 'USD';
          setStrikeCurrency(userCurrency); // Store user's currency in auth
        }
      } catch (e) {
        if (__DEV__) console.log('Error refreshing Strike balance:', e);
        SimpleToast.show("Failed to refresh Strike balance.", SimpleToast.SHORT);
      }
    }
    // Pull-to-refresh also kicks an immediate Ark sync. Cheap (SQLite
    // reads + one esplora call) and in-flight-guarded so repeated pulls
    // don't stack.
    if (isArkAuth) {
      await arkSync.refresh();
    }
  };


  const createWallet = async () => {
    setIsLoading(true);

    let w: HDSegwitBech32Wallet;
    // btc was selected
    // index 2 radio - hd bip84
    w = new HDSegwitBech32Wallet();
    w.setLabel(label || loc.wallets.details_title);

    await w.generate();
    addWallet(w);
    await saveToDisk();
    A(A.ENUM.CREATED_WALLET);
    triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
    if (w.type === HDSegwitP2SHWallet.type || w.type === HDSegwitBech32Wallet.type) {
      // @ts-ignore: Return later to update
      dispatchNavigate('SavingVaultIntro', {
        walletID: w.getID(),
      });
    }
  };

  const exchangeRecentRate = async () => {
    const rates = await mostRecentFetchedRate();
    return rates
  }

  const exchangeRate = async (fiatUnit: FiatUnitType) => {
    const rates = await fetchedRate(fiatUnit);
    return rates
  }

  // const renderScene = ({ route }: { route: any }) => {
  //   switch (route.key) {
  //     case "hot":
  //       return <HotStorageTab />;
  //     case "cold":
  //       return <ColdStorageTab />;
  //     default:
  //       return null;
  //   }
  // };
  // const renderScene = SceneMap({
  //   hot: HotStorageTab,
  //   cold: ColdStorageTab,
  // });

  // Single contextual message for the homepage — priority ordered
  const getHomeMessage = (): string | null => {
    const coinosBalance = Number(balance) || 0;
    const strikeBal = Math.round(Number(strikeUser?.[0]?.available || 0) * SATS);
    const coinosTotal = Number(withdrawThreshold) + Number(reserveAmount);
    const strikeTotal = Number(withdrawStrikeThreshold) + Number(reserveStrikeAmount);
    const coinosThresholdMet = isAuth && coinosBalance >= coinosTotal;
    const strikeThresholdMet = isStrikeAuth && strikeBal >= strikeTotal;
    const anyThresholdMet = coinosThresholdMet || strikeThresholdMet;
    const hasVault = !!(walletID || coldStorageWalletID);

    // Priority 1: Threshold met
    if (anyThresholdMet && hasVault) {
      return "Your balance is large enough to withdraw to self-custody!";
    }
    if (anyThresholdMet && !hasVault) {
      return "Threshold met! Create a vault to withdraw to self-custody.";
    }

    // Priority 2: UTXO management
    const hotUtxos = wallet?.getUtxo?.() || [];
    const coldUtxos = coldStorageWallet?.getUtxo?.() || [];
    const allUtxos = [...hotUtxos, ...coldUtxos];
    const smallUtxos = allUtxos.filter((u: any) => u.value < 100000);
    const fee = recommendedFee?.halfHourFee || recommendedFee?.hourFee || 0;
    const feesAreLow = fee > 0 && fee <= 15;

    if (wallet && !coldStorageWallet && hotUtxos.length > 5) {
      return "You have more than 5 UTXOs. Consider upgrading to Cold Storage to consolidate and improve security.";
    }

    if (smallUtxos.length > 5 && feesAreLow) {
      return "Fees are low — good time to consolidate your small UTXOs to save on future transaction costs.";
    }

    return null;
  };

  const homeMessage = getHomeMessage();

  return (
    <ScreenLayout
      
      RefreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="white"
        />
      }
      disableScroll={false}>
        <View style={styles.container}>
          {isLoading ? (
            <ActivityIndicator size="large" color="#ffffff" />
          )
          :
          (
            <>
              <View style={{ height: 40 }} />
              {/*
                Header now hosts the "Scan with" picker — left-side scan
                icon → modal → camera → routes to the chosen wallet's send
                screen with the scanned destination pre-filled. The legacy
                `onBarScanned` prop is kept as a fallback for the default
                branch in handleWalletPicked.
              */}
              <Header
                onBarScanned={onBarScanned}
                matchedRate={matchedRate}
                matchedRateBTC={matchedRateBTC}
                currency={currency}
                wallet={wallet}
                coldStorageWallet={coldStorageWallet}
              />
              <Animated.View style={{ opacity: enterAnim, transform: [{ translateY: (!isAuth && !isLoading && !isStrikeAuth && !isArkAuth) ? -23 : (!isLoading && isStrikeAuth && isArkAuth && !isAuth) ? -28 : -48 }, { translateY: enterTranslate }] }}>
                <BalanceView
                  // balance={`${(btc(1) * (Number(balance) || 0)) + (Number(ColdStorageBalanceVault?.split(' ')[0]) || 0) + (Number(balanceVault?.split(' ')[0]) || 0)} BTC`}
                  balance={`${((btc(1) * (Number(balance) || 0)) + Number(strikeUser?.[0]?.available || 0) + (Number(ColdStorageBalanceVault?.split(' ')[0]) || 0) + (Number(balanceVault?.split(' ')[0]) || 0)).toFixed(8)} BTC`}
                  convertedRate={`$${((strikeConvertedBalance || 0) + Number(convertedRate || 0) + ((Number(coldStorageBalanceWithoutSuffix || 0) * Number(matchedRateBTC || 0)) + (Number(balanceWithoutSuffix || 0) * Number(matchedRateBTC || 0)))).toFixed(2)}`}
                  // Show "+ Add Account" until the user has all three
                  // distinct rails connected. The previous `length < 2`
                  // gate hid the button as soon as any two were added,
                  // which meant a user who connected CoinOS + Ark
                  // couldn't reach the Lightning-account menu to add
                  // Strike. We gate per-rail instead of by raw count
                  // because the same wallet shouldn't be addable twice.
                  showAddAccount={(!isAuth || !isStrikeAuth || !isArkAuth) && !isLoading}
                  onAddAccount={() => hasSeenCustodialWarning ? dispatchNavigate('CheckingAccountLogin') : dispatchNavigate('CheckingAccountIntro')}
                  carouselPage={carouselPage}
                  carouselTotal={carouselTotal}
                  carouselKinds={carouselKinds}
                  onDotPress={(i) => walletsViewRef.current?.snapTo(i)}
                />
              </Animated.View>
            </>
          )}

          {/* */}

                    {/* Add Account button moved into BalanceView */}
          {/* Lightning Accounts title moved into WalletsView carousel */}

          <Animated.View style={{ opacity: enterAnim, transform: [{ translateY: (!isAuth && !isLoading && !isStrikeAuth && !isArkAuth) ? -18 : (!isLoading && isArkAuth && !isStrikeAuth && !isAuth) ? -30 : (!isLoading && isAuth && !isStrikeAuth && !isArkAuth) ? -43 : (!isLoading && isStrikeAuth && isArkAuth) ? -20 : (!isLoading && isStrikeAuth && !isAuth && !isArkAuth) ? -33 : -58 }, { translateY: enterTranslate }] }}>
            {/*
              Carousel-vs-CTA gate. Falls through to CreateLightningAccount only
              when NO Lightning provider (CoinOS / Strike / Ark) is connected.
              Adding isArkAuth here is what makes a freshly-created Ark wallet
              actually appear in the carousel — without it, an Ark-only user
              still sees the "Create Lightning Account" CTA on Home.
              translateY is -80 for Ark-only (vs -58 for custodial wallets)
              because the BalanceView's showAddAccount button (~40pt) adds more
              top-weight to the black box than the page-indicator rows (~17pt)
              that show when multiple wallet tabs exist, causing snap-carousel
              to measure a slightly different Y for the active item. The extra
              22pt compensates for that centroid shift.
            */}
            {!isAuth && !isLoading && !isStrikeAuth && !isArkAuth ? (
              <>
                <CreateLightningAccount onPress={loginClickHandler} />
                {(hasSavingVault || hasColdStorage) && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 20 }}>
                    <GradientView
                      onPress={() => { setReceiveType(true); refRBSheet.current.open(); }}
                      topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowRadius: 2, shadowOpacity: 2, shadowColor: '#555555', borderRadius: 25, width: (screenWidth / 2) - 60, height: 47, justifyContent: 'center', alignItems: 'center' }}
                      bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 0.64, shadowColor: '#333333', borderRadius: 25, width: (screenWidth / 2) - 60, height: 47, justifyContent: 'center', position: 'absolute' }}
                      style={{ shadowColor: '#040404CC', shadowOffset: { width: 8, height: 8 }, shadowOpacity: 0.80, shadowRadius: 16, elevation: 8 }}
                      linearGradientStyle={{ shadowColor: '#27272C7A', shadowOffset: { width: -8, height: -8 }, shadowOpacity: 0.48, shadowRadius: 12, elevation: 8 }}
                    >
                      <Text h3 style={{ ...shadow.text25 }}>Receive</Text>
                    </GradientView>
                    <GradientView
                      onPress={() => { refSendRBSheet.current.open(); }}
                      topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowRadius: 2, shadowOpacity: 2, shadowColor: '#555555', borderRadius: 25, width: (screenWidth / 2) - 60, height: 47, justifyContent: 'center', alignItems: 'center' }}
                      bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 0.64, shadowColor: '#333333', borderRadius: 25, width: (screenWidth / 2) - 60, height: 47, justifyContent: 'center', position: 'absolute' }}
                      style={{ shadowColor: '#040404CC', shadowOffset: { width: 8, height: 8 }, shadowOpacity: 0.80, shadowRadius: 16, elevation: 8 }}
                      linearGradientStyle={{ shadowColor: '#27272C7A', shadowOffset: { width: -8, height: -8 }, shadowOpacity: 0.48, shadowRadius: 12, elevation: 8 }}
                    >
                      <Text h3 style={{ ...shadow.text25 }}>Send</Text>
                    </GradientView>
                  </View>
                )}
              </>
            ) : !isLoading && (
              <WalletsView
                ref={walletsViewRef}
                balance={balance}
                convertedRate={convertedRate}
                currency={currency}
                isLoading={isLoading}
                matchedRate={matchedRate}
                refRBSheet={refRBSheet}
                refSendRBSheet={refSendRBSheet}
                refSwapRBSheet={refSwapRBSheet}
                setReceiveType={setReceiveType}
                strikeBalance={strikeBalance}
                wallet={wallet}
                coldStorageWallet={coldStorageWallet}
                matchedRateStrike={Number(matchedRateStrike || 0)}
                strikeConvertedBalance={Number(strikeConvertedBalance || 0)}
                currencyStrike={strikeUser?.[1]?.currency || 'USD'}
                homeMessage={homeMessage}
                onPageChange={(index, total, kinds) => {
                  setCarouselPage(index);
                  setCarouselTotal(total);
                  setCarouselKinds(kinds);
                }}
              />
            )}
          </Animated.View>

          {/* */}

          {!isLoading && (isWalletLoaded || isColdWalletLoaded) &&
            <Animated.View style={{height: 205, marginTop: 5, marginBottom: 0, justifyContent: 'center', alignItems: 'center', opacity: enterAnim, transform: [{ translateY: (isAuth || isStrikeAuth || isArkAuth) ? -20 : -60 }, { translateY: enterTranslate }]}}>
              <ActivityIndicator size="small" color="#23C47F" />
            </Animated.View>
          }
          {!isLoading && !isWalletLoaded && !isColdWalletLoaded &&
            <Animated.View style={{height: 205, marginBottom: 20, opacity: enterAnim, transform: [{ translateY: (isAuth || isStrikeAuth || isArkAuth) ? -20 : -60 }, { translateY: enterTranslate }]}}>
              <BottomBar
                balance={balance}
                balanceVault={balanceVault}
                refWithdrawRBSheet={refWithdrawRBSheet}
                balanceWithoutSuffix={balanceWithoutSuffix}
                coldStorageAddress={coldStorageAddress}
                coldStorageBalanceVault={ColdStorageBalanceVault}
                coldStorageBalanceWithoutSuffix={coldStorageBalanceWithoutSuffix}
                coldStorageWallet={coldStorageWallet}
                currency={currency}
                currencyStrike={strikeUser?.[1]?.currency || 'USD'}
                matchedRateStrike={Number(matchedRateStrike || 0)}
                strikeConvertedBalance={Number(strikeConvertedBalance || 0)}
                hasColdStorage={hasColdStorage}
                hasSavingVault={hasSavingVault}
                matchedRate={matchedRate}
                matchedRateBTC={matchedRateBTC}
                recommendedFee={recommendedFee}
                vaultAddress={vaultAddress}
                wallet={wallet}
                refTopupRBSheet={refTopupRBSheet}
              />
            </Animated.View>
          }
        </View>
      <RBSheet
        ref={refRBSheet}
        height={heights / 2 + 20}
        openDuration={350}
        closeDuration={250}
        draggable
        dragOnContent
        closeOnPressBack
        customStyles={{
          wrapper: {
            backgroundColor: 'rgba(0,0,0,0.5)',
          },
          draggableIcon: {
            backgroundColor: '#555',
            width: 40,
          },
          container: {
            backgroundColor: 'transparent',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
          }
        }}
        customModalProps={{
          animationType: 'fade',
          statusBarTranslucent: true,
        }}
        customAvoidingViewProps={{
          enabled: false,
        }}
      >
        {/* <ReceivedList refRBSheet={refRBSheet} receiveType={receiveType} matchedRate={matchedRate} currency={currency} /> */}
        <ReceivedListNew
          setReceivedListSecondTab={setReceivedListSecondTab}
          refRBSheet={refRBSheet}
          receiveType={receiveType}
          matchedRate={matchedRateStrike}
          currency={strikeUser?.[1]?.currency || 'USD'}
          wallet={wallet}
          coldStorageWallet={coldStorageWallet}
          vaultAddress={vaultAddress}
          coldStorageAddress={coldStorageAddress}
          initialVaultType={initialVaultType}
        />
      </RBSheet>

      <RBSheet
        ref={refSendRBSheet}
        height={heights / 2 + 20}
        openDuration={350}
        closeDuration={250}
        draggable
        dragOnContent
        closeOnPressBack
        customStyles={{
          wrapper: {
            backgroundColor: 'rgba(0,0,0,0.5)',
          },
          draggableIcon: {
            backgroundColor: '#555',
            width: 40,
          },
          container: {
            backgroundColor: 'transparent',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
          }
        }}
        customModalProps={{
          animationType: 'fade',
          statusBarTranslucent: true,
        }}
        customAvoidingViewProps={{
          enabled: false,
        }}
      >
        <SendListNew refRBSheet={refSendRBSheet} reopenSendSheet={reopenSendSheet} receiveType={receiveType} matchedRate={matchedRateStrike || matchedRate} matchedRateBTC={matchedRateBTC} currency={strikeUser?.[1]?.currency || 'USD'} wallet={wallet} coldStorageWallet={coldStorageWallet} />
      </RBSheet>

      <RBSheet
        ref={refWithdrawRBSheet}
        height={heights / 2 + 20}
        openDuration={350}
        closeDuration={250}
        draggable
        dragOnContent
        closeOnPressBack
        customStyles={{
          wrapper: {
            backgroundColor: 'rgba(0,0,0,0.5)',
          },
          draggableIcon: {
            backgroundColor: '#555',
            width: 40,
          },
          container: {
            backgroundColor: 'transparent',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
          }
        }}
        customModalProps={{
          animationType: 'fade',
          statusBarTranslucent: true,
        }}
        customAvoidingViewProps={{
          enabled: false,
        }}
      >
        <WithdrawList 
          balance={balance}
          refRBSheet={refWithdrawRBSheet} 
          receiveType={receiveType} 
          matchedRate={matchedRate} 
          currency={currency} 
          wallet={wallet} 
          currencyStrike={strikeUser?.[1]?.currency || 'USD'}
          matchedRateStrike={Number(matchedRateStrike || 0)}
                strikeConvertedBalance={Number(strikeConvertedBalance || 0)}
          recommendedFee={recommendedFee}
          coldStorageAddress={coldStorageAddress}
          vaultAddress={vaultAddress}
          coldStorageWallet={coldStorageWallet} 
        />
      </RBSheet>

      <RBSheet
        ref={refTopupRBSheet}
        height={heights / 2 + 20}
        openDuration={350}
        closeDuration={250}
        draggable
        dragOnContent
        closeOnPressBack
        customStyles={{
          wrapper: {
            backgroundColor: 'rgba(0,0,0,0.5)',
          },
          draggableIcon: {
            backgroundColor: '#555',
            width: 40,
          },
          container: {
            backgroundColor: 'transparent',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
          }
        }}
        customModalProps={{
          animationType: 'fade',
          statusBarTranslucent: true,
        }}
        customAvoidingViewProps={{
          enabled: false,
        }}
      >
        <TopupList
          refRBSheet={refTopupRBSheet}
          matchedRateBTC={matchedRateBTC}
          currency={strikeUser?.[1]?.currency || 'USD'}
          wallet={wallet}
          coldStorageWallet={coldStorageWallet}
        />
      </RBSheet>

      <RBSheet
        ref={refSwapRBSheet}
        height={420}
        openDuration={350}
        closeDuration={250}
        draggable
        dragOnContent
        closeOnPressBack
        customStyles={{
          wrapper: {
            backgroundColor: 'rgba(0,0,0,0.5)',
          },
          draggableIcon: {
            backgroundColor: '#555',
            width: 40,
          },
          container: {
            backgroundColor: 'transparent',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
          }
        }}
        customModalProps={{
          animationType: 'fade',
          statusBarTranslucent: true,
        }}
        customAvoidingViewProps={{
          enabled: false,
        }}
      >
        <SwapSheet
          refSwapRBSheet={refSwapRBSheet}
          user={user}
          strikeMe={strikeMe}
          // Per-rail balances (sats) — keyed by lightningSwap provider id.
          // SwapSheet forwards the source-rail's value as `sourceBalance`
          // to SwapAmount so the keyboard's max-button works regardless
          // of which provider is selected. Reads `arkBalance` directly
          // from zustand via getState() since it's not a HomeScreen
          // useState-owned value like coinos/strike are.
          balanceByProvider={{
            coinos: Number(balance) || 0,
            strike: Number(strikeBalance) || 0,
            ark: Number(useAuthStore.getState().arkBalance || 0),
          }}
        />
      </RBSheet>
      
    </ScreenLayout>
  );
}
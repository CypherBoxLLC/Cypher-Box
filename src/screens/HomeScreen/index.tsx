import React, { useCallback, useContext, useEffect, useReducer, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, RefreshControl, StyleSheet, TouchableOpacity, useWindowDimensions, View } from "react-native";
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
import { bitcoinRecommendedFee, createInvoice, getCurrencyRates, getInvoiceByLightening, getMe, getTransactionHistory } from "@Cypher/api/coinOSApis";
import { btc, formatNumber, matchKeyAndValue, SATS } from "@Cypher/helpers/coinosHelper";
import { AbstractWallet, HDSegwitBech32Wallet, HDSegwitP2SHWallet } from "../../../class";
import loc, { formatBalance, formatBalanceWithoutSuffix } from '../../../loc';
import { initialState, walletReducer } from "../../../screen/wallets/add";
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { startsWithLn } from "../Send";
import screenHeight from "@Cypher/style-guide/screenHeight";
import Carousel from "react-native-snap-carousel";
import screenWidth from "@Cypher/style-guide/screenWidth";
import { convertFiatToUSD, fetchedRate, mostRecentFetchedRate } from "../../../blue_modules/currency";
import { authorize } from "react-native-app-auth";
import { getBalances } from "@Cypher/api/strikeAPIs";
import ReceivedListNew from "./ReceivedListNew";
import Header from "./Header";
import BalanceView from "./BalanceView";
import BottomBar from "./BottomBar";
import CreateLightningAccount from "./CreateLightningAccount";
import WalletsView from "./WalletsView";
import SendListNew from "./SendListNew";
import WithdrawList from "./WithdrawList";
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
  clientSecret: "SbYmuewpZGS8XDktirso8ficpChSGu7dEaYuMrLx+3k=", // If needed (but avoid hardcoding secrets in client-side code)
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
  const { isAuth, isStrikeAuth, strikeToken, walletTab, allBTCWallets, setAllBTCWallets, withdrawStrikeThreshold, reserveStrikeAmount, strikeUser, setWalletTab, setStrikeUser, setStrikeToken, setStrikeAuth, clearStrikeAuth, walletID, coldStorageWalletID, token, user, withdrawThreshold, reserveAmount, vaultTab, setUser, setVaultTab, matchedRateStrike, setMatchedRateStrike } = useAuthStore();
  const A = require('../../../blue_modules/analytics');
  // const [storage, setStorage] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [balance, setBalance] = useState(0);
  console.log("🚀 ~ balanceMAIN:", balance)
  const [strikeBalance, setStrikeBalance] = useState(0);
  const [currency, setCurrency] = useState('USD');
  const [convertedRate, setConvertedRate] = useState(0);
  console.log("🚀 ~ convertedRate:", convertedRate)
  const [convertedStrikeRate, setConvertedStrikeRate] = useState(0);
  const [matchedRate, setMatchedRate] = useState(0);
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
  const refWithdrawRBSheet = useRef<any>(null);
  const [receivedListSecondTab, setReceivedListSecondTab] = useState(false);
  const carouselRef = useRef<Carousel<any>>(null);

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

      // if(!walletID && coldStorageWalletID) {
      //   setVaultTab(true);
      // } else if(walletID && !coldStorageWalletID) {
      //   setVaultTab(false);
      // }
    }, [wallet, coldStorageWalletID, walletID]),
  );


  const getWallet = async () => {
    try {
      const allWallets = wallets.concat(false);
      const walletTemp = allWallets.find((w: AbstractWallet) => w.getID() === walletID);
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
      const allWallets = wallets.concat(false);
      const walletTemp = allWallets.find((w: AbstractWallet) => w.getID() === coldStorageWalletID);
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

  const handleStrikeLogin = async () => {
      try {
          const result = await authorize(config);
          setStrikeToken(result.accessToken);
          setStrikeAuth(true);
      } catch (error) {
          console.error("OAuth error", error);
      } finally {
        setIsLoading(false)
      }
  };

  useEffect(() => {
    async function handleToken() {
      if (isAuth && token) {
        handleUser();
        loadPayments();
      } else {
        const rates = await exchangeRecentRate();
        if (rates && rates?.Rate) {
          const numericAmount = Number(rates.Rate.replace(/[^0-9\.]/g, ''));
          setMatchedRate(numericAmount);
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
    getWallet();
    coldStorageWalletID ? getColdStorageWallet() : setIsColdWalletLoaded(false);
    handleToken();
  }, [isAuth, token, wallets, walletID, coldStorageWalletID]);

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
      const getInit = async () => {
        if(strikeToken){
          setTimeout(async () => {
            const balances = await getBalances();
            if(balances.data?.status === 401){
              SimpleToast.show("Authorization expired. Please login again to strike account", SimpleToast.SHORT)
              clearStrikeAuth();
            } else if (balances) {
              console.log('balances: ', balances)
              setStrikeUser(balances);
              setStrikeBalance((balances?.[0]?.available * SATS) || 0);
              const matchedCurrency = untypedFiatUnit?.[balances?.[1]?.currency];
              console.log('matchedCurrency: ', matchedCurrency, balances)
              const rates = await exchangeRate(matchedCurrency);
              console.log('rates: ', rates)
              let numericAmount = 0
              if (rates && rates?.Rate) {
                numericAmount = Number(rates.Rate.replace(/[^0-9\.]/g, ''));
                setMatchedRateStrike(numericAmount);
              }
              const strikeAmount = async () => {
                const rate = await convertFiatToUSD(Number((balances?.[0]?.available || 0) * SATS * (numericAmount || 0) * btc(1)), balances?.[1]?.currency || 'USD') || 0
                console.log('raterate strikeAmount: ', rate, rates)
                return rate
              }

              
              strikeAmount().then((result) => {
                setStrikeConvertedBalance(result);
              })

            }
          }, 1000);
        }
      }

      getInit();
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
            console.log('coincontrol wallet.fetchUtxo() failed'); // either sleep expired or fetchUtxo threw an exception
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
            console.log('coincontrol coldStorageWallet.fetchUtxo() failed'); // either sleep expired or fetchUtxo threw an exception
          }
        })();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [coldStorageWallet, sleep]),
  );

  const handleUser = async () => {
    try {
      const response = await getMe();
      const responsetest = await getCurrencyRates();
      const currency = btc(1);
      const matched = matchKeyAndValue(responsetest, 'USD')
      setMatchedRate(matched || 0)
      setConvertedRate((matched || 0) * currency * response.balance)
      setCurrency("USD")
      if (response?.balance) {
        setBalance(response?.balance || 0);
      }
      setUser(response?.username);
    } catch (error) {
      console.error('error: ', error);
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
    }
  };

  const loginClickHandler = () => {
    // dispatchNavigate('LoginCoinOSScreen');
    dispatchNavigate('CheckingAccountIntro');
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
    handleUser()
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

  return (
    <ScreenLayout
      
      RefreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="white"
        />
      }
      disableScroll={isAuth ? false : true}>
      <View style={styles.container}>
        <View>
          {isLoading ? (
            <ActivityIndicator size="large" color="#ffffff" />
          )
          :
          (
            <>
              <Header onBarScanned={onBarScanned} />
              <BalanceView 
                // balance={`${(btc(1) * (Number(balance) || 0)) + (Number(ColdStorageBalanceVault?.split(' ')[0]) || 0) + (Number(balanceVault?.split(' ')[0]) || 0)} BTC`}
                balance={`${((btc(1) * (Number(balance) || 0)) + Number(strikeUser?.[0]?.available || 0) + (Number(ColdStorageBalanceVault?.split(' ')[0]) || 0) + (Number(balanceVault?.split(' ')[0]) || 0)).toFixed(8)} BTC`}
                convertedRate={`$${((strikeConvertedBalance || 0) + Number(convertedRate || 0) + ((Number(coldStorageBalanceWithoutSuffix || 0) * Number(matchedRate || 0)) + (Number(balanceWithoutSuffix || 0) * Number(matchedRate || 0)))).toFixed(2)}`}
              />
            </>
          )}

          {/* */}

          {(allBTCWallets.length > 0 && allBTCWallets.length < 2) && !isLoading &&
            <View style={styles.checkingaccContainer}>

            

              
              <TouchableOpacity
                onPress={() => dispatchNavigate('CheckingAccountIntro')}
                style={{ flex: 1, alignItems: 'flex-end', flexDirection: 'row', alignSelf:'center', justifyContent:'flex-end' }}>
                {/* <BlackBGView
                  linearFirstStyle={styles.linearFirstStyle}
                  linearSecondStyle={styles.linearSecondStyle}
                  linearFirstColors={[colors.pink.gradient2, colors.pink.gradient1]}
                  linearSecondColors={[colors.primary, colors.primary]}
                > */}
                  {/* <Image source={PlusNew} style={styles.plusImage} resizeMode="contain" /> */}
                  <Text h4 bold style={{color: colors.pink.dark, fontSize: 20}}>+</Text>
                  <Text h4 semibold style={{ marginStart: 5, color: colors.pink.dark }}>Add Account</Text>
                {/* </BlackBGView> */}
              </TouchableOpacity>
            </View>
          }
          {(allBTCWallets.length > 1 && !isLoading) &&
            <Text bold h2 style={{ height: 32, marginTop: 10 }}>Lightning Accounts</Text>
            } 

          <View>
            {!isAuth && !isLoading && !isStrikeAuth ?
              <CreateLightningAccount onPress={loginClickHandler} />
            : !isLoading &&
              <WalletsView
                balance={balance}
                convertedRate={convertedRate}
                currency={currency}
                isLoading={isLoading}
                matchedRate={matchedRate}
                refRBSheet={refRBSheet}
                refSendRBSheet={refSendRBSheet}
                setReceiveType={setReceiveType}
                strikeBalance={strikeBalance}
                wallet={wallet}
                coldStorageWallet={coldStorageWallet}
                matchedRateStrike={Number(matchedRateStrike || 0)}
                currencyStrike={strikeUser?.[1]?.currency || 'USD'}
              />
            }
          </View>
          
          {/* */}

          {!isLoading && !isWalletLoaded && !isColdWalletLoaded &&
            <View style={{height: 205,marginVertical: 15}}>
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
                hasColdStorage={hasColdStorage}
                hasSavingVault={hasSavingVault}
                matchedRate={matchedRate}
                recommendedFee={recommendedFee}
                vaultAddress={vaultAddress}
                wallet={wallet}
              />
            </View>
          }
        </View>
      </View>
      <RBSheet
        ref={refRBSheet}
        customStyles={{
          wrapper: {
            backgroundColor: 'transparent',
          },
          draggableIcon: {
            backgroundColor: 'red',
          },
          container: {
            // ...receivedListSecondTab ? { height: heights / 2 + 20 } : { maxHeight: heights / 2 + 20 },
            height: heights / 2 + 20,
            backgroundColor: 'transparent',
          }
        }}
        customModalProps={{
          animationType: 'slide',
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
        />
      </RBSheet>

      <RBSheet
        ref={refSendRBSheet}
        customStyles={{
          wrapper: {
            backgroundColor: 'transparent',
          },
          draggableIcon: {
            backgroundColor: 'red',
          },
          container: {
            height: heights / 2 + 20,
            backgroundColor: 'transparent',
          }
        }}
        customModalProps={{
          animationType: 'slide',
          statusBarTranslucent: true,
        }}
        customAvoidingViewProps={{
          enabled: false,
        }}
      >
        <SendListNew refRBSheet={refSendRBSheet} receiveType={receiveType} matchedRate={matchedRateStrike} currency={strikeUser?.[1]?.currency || 'USD'} wallet={wallet} coldStorageWallet={coldStorageWallet} />
      </RBSheet>

      <RBSheet
        ref={refWithdrawRBSheet}
        customStyles={{
          wrapper: {
            backgroundColor: 'transparent',
          },
          draggableIcon: {
            backgroundColor: 'red',
          },
          container: {
            height: heights / 2 + 20,
            backgroundColor: 'transparent',
          }
        }}
        customModalProps={{
          animationType: 'slide',
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
          recommendedFee={recommendedFee}
          coldStorageAddress={coldStorageAddress}
          vaultAddress={vaultAddress}
          coldStorageWallet={coldStorageWallet} 
        />
      </RBSheet>
      
    </ScreenLayout>
  );
}
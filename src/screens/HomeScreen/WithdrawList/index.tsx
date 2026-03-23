import { Text } from "@Cypher/component-library";
import { CustomTabView, GradientCard, GradientView } from "@Cypher/components";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, Image, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import SimpleToast from "react-native-simple-toast";

import {
  Back,
  Barcode,
  Bitcoin,
  CoinOS,
  Cold1,
  Copy,
  Electrik,
  Hot,
  Socked,
  Strike,
  StrikeFull,
} from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import styles from "./styles";
import { createInvoice } from "@Cypher/api/coinOSApis";
import { createInvoice as createInvoiceStrike } from "@Cypher/api/strikeAPIs";
import { btc, SATS } from "@Cypher/helpers/coinosHelper";

const SCREEN_WIDTH = Dimensions.get("window").width;

interface Props {
  balance: any;
  refRBSheet: any;
  matchedRate: any;
  currency: any;
  wallet: any;
  coldStorageAddress: any;
  vaultAddress: any;
  recommendedFee: any;
  coldStorageWallet: any;
  receiveType: boolean;
  currencyStrike: any
  matchedRateStrike: any
}

export default function WithdrawList({ refRBSheet, balance, recommendedFee, coldStorageAddress, vaultAddress, receiveType, wallet, coldStorageWallet, matchedRate, currency, currencyStrike, matchedRateStrike }: Props) {
  const { user, strikeMe, vaultTab, isAuth, isStrikeAuth, walletID, coldStorageWalletID, withdrawThreshold, withdrawStrikeThreshold, strikeUser } = useAuthStore();
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<number | null>(null);
  console.log("🚀 ~ WithdrawList ~ selectedItem:", selectedItem);
  const [data, setData] = useState([
    ...(isStrikeAuth ? [{
      id: 1,
      name: "Strike",
      type: 0,
      icon: StrikeFull,
      description: user + "@coinos.io",
      // navigation: {},
      navigation: {
        screen: "SendScreen",
        params: {
          matchedRate: matchedRateStrike,
          currency: currencyStrike,
          receiveType: false
        },
      },
    }] : []),
    ...(isAuth ? [{
      id: 2,
      name: "CoinOS",
      type: 0,
      icon: CoinOS,
      description:
        "Receive from wallets and exchanges that support the Lightning Network",
      navigation: {
        screen: "SendScreen",
        params: {
          matchedRate,
          currency,
          receiveType: true
        },
      },
    }] : [])
  ]);

  const [wallets, setWallets] = useState([    
    ...(walletID ? [{
      id: 3,
      name: "Hot Vault",
      type: 1,
      icon: Hot,
      description:
        "Receive from wallets and exchanges that support the Liquid Federation",
      navigation: {
        screen: "QrScreen",
        params: {
          isBitcoinQr: true,
          type: "liquid",
        },
      },
    }] : []),
    ...(coldStorageWalletID ? [{
      id: 4,
      name: "Cold Vault",
      type: 2,
      icon: Cold1,
      description:
        "To deposit sizable amounts of bitcoin from the main network",
      navigation: {
        screen: "QrScreen",
        params: {
          isBitcoinQr: true,
          type: "bitcoin",
        },
      },
    }] : [])
  ]);

  const [tab, setTab] = useState(0);
  const [showSecondView, setShowSecondView] = useState(false);
  const [hashLiquid, setHashLiquid] = useState('');
  const [hashBitcoin, setHashBitcoin] = useState('');
  const qrCode = useRef();
  const base64QrCodeRef = useRef('');


  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (tab == 1) {
      handleCreateInvoice('bitcoin');
    } else if (tab == 2) {
      handleCreateInvoice('liquid');
    }
  }, [tab, selectedItem])

  const handleCreateInvoice = async (type: string) => {
    setIsLoading(true);
    try {
      const response = selectedItem == 2 ? await createInvoice({
        type: type,
      }) : await createInvoiceStrike({
        onchain: {
        },
        targetCurrency: strikeUser?.[1]?.currency || "USD"
      });
      const hash = selectedItem == 2 ? response.hash : response.onchain?.address
      if (type == 'bitcoin') {
        setHashBitcoin(hash);
      } else {
        setHashLiquid(hash);
      }
    } catch (error) {
      console.error('Error generating bitcoin address handleCreateInvoice 3:', error);
      SimpleToast.show(`Failed to generating ${type == 'bitcoin' ? "bitcoin" : "liquid"} address. Please try again.`, SimpleToast.SHORT);
    } finally {
      setIsLoading(false);
    }
  };

  const translateX1 = useSharedValue(0);
  const translateX2 = useSharedValue(SCREEN_WIDTH);

  const animateToSecondView = () => {
    translateX1.value = withTiming(-SCREEN_WIDTH, { duration: 300 });
    translateX2.value = withTiming(0, { duration: 300 }, () => {
      runOnJS(setShowSecondView)(true);
    });
  };

  const animateToFirstView = () => {
    translateX1.value = withTiming(0, { duration: 300 });
    translateX2.value = withTiming(SCREEN_WIDTH, { duration: 300 }, () => {
      runOnJS(setShowSecondView)(false);
    });
  };

  const view1Style = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX1.value }],
  }));

  const view2Style = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX2.value }],
  }));

  const onPress = (item: any) => {
    // if (item?.id == 1 || item?.id == 2) {
      // setSelectedItem(item.id);
      // setTab(0);
      // animateToSecondView();
      // refRBSheet?.current?.close();
      // setTimeout(() => {
      //   dispatchNavigate(item?.navigation?.screen, item?.navigation?.params);
      // }, 150);
      setSelectedItem(item.id);
    // } else if(item?.id == 3 || item?.id == 4){
    //   refRBSheet?.current?.close();
    //   setTimeout(() => {
    //     dispatchNavigate('HotStorageVault', { wallet: item?.id == 3 ? wallet : coldStorageWallet, matchedRate });
    //   }, 150);
    // }
  };

  const onPressWallet = (item: any) => {
    setSelectedWallet(item.id);
  }

  const backClickHandler = () => {
    animateToFirstView();
  };

  const bitcoinLightning = {
    id: 2,
    name: "Lightning invoice",
    type: 0,
    description:
      "To receive from wallets and exchanges that support the Lightning Network",
    navigation: {
      screen: "SendScreen",
      params: {
        matchedRate,
        currency,
        receiveType: selectedItem === 2 ? true : false
      },
    },
  };

  const onPressNew = (item: any) => {
    refRBSheet?.current?.close();

    // if (item?.id == 1) {
    //   Clipboard.setString(selectedItem === 2 ? user + '@coinos.io' : strikeMe?.username + '@strike.me');
    //   SimpleToast.show('Copied to clipboard', SimpleToast.SHORT);

    // }
    console.log('item?.navigation?.params: ', item?.navigation?.params)
    item?.navigation?.screen &&
      setTimeout(() => {
        dispatchNavigate(item?.navigation?.screen, item?.navigation?.params);
      }, 150);
  }

  const getTabs = () => {
    if (selectedItem === 1) {
      return [
        {
          id: 0,
          name: "Lightning",
          icon: Electrik,
        },
        {
          id: 1,
          name: "Bitcoin",
          icon: Bitcoin,
        },
      ];
    } else if (selectedItem === 2) {
      return [
        {
          id: 0,
          name: "Lightning",
          icon: Electrik,
        },
        {
          id: 1,
          name: "Bitcoin",
          icon: Bitcoin,
        },
        {
          id: 2,
          name: "Liquid",
          icon: Socked,
        },
      ];
    }
    return [];
  };

  const onNext = () => {
    refRBSheet?.current?.close();
    setTimeout(() => {
      const strikeBalance = Math.round(Number(strikeUser?.[0]?.available || 0) * SATS);
      const amount = selectedItem === 1 ? withdrawStrikeThreshold > strikeBalance ? strikeBalance : withdrawStrikeThreshold : withdrawThreshold > balance ? balance : withdrawThreshold;
      console.log('amount: ', amount)
      dispatchNavigate('ReviewPayment', {
          value: amount,
          converted: ((Number(selectedItem === 2 ? matchedRate : matchedRateStrike) || 0) * btc(1) * Number(amount)).toFixed(2),
          isSats: true,
          to: selectedWallet === 4 ? coldStorageAddress : vaultAddress,
          fees: 0,
          total: btc(Number(amount)),
          matchedRate: selectedItem === 2 ? matchedRate : matchedRateStrike,
          currency: selectedItem === 2 ? currency : currencyStrike,
          type: 'bitcoin',
          feeForBamskki: 0,
          recommendedFee,
          vaultTab: selectedWallet === 4 ? true : false,
          receiveType: selectedItem === 2 ? true : false,
          wallet: selectedWallet === 4 ? coldStorageWallet : wallet,
          isWithdrawal: true,
      });
      // dispatchNavigate('SendScreen', { matchedRate, currency, receiveType: selectedItem === 2 ? true : false });      
    }, 500)
  }

  return (
    <>
      <LinearGradient
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 1 }}
        colors={[colors.pink.gradient1, colors.pink.gradient2]}
        style={styles.gradientLine}
      >
        <LinearGradient
          start={{ x: 1, y: 0 }}
          end={{ x: 1, y: 1 }}
          colors={[colors.black.gradientTop2, colors.black.default]}
          style={styles.containerGradientView}
        >
          <Animated.View style={[{}, view1Style]}>
            <Text h2 bold style={styles.receiveToLabel}>
              WITHDRAW FROM
            </Text>
            
            <View style={[styles.cardListContainer, data?.length == 1 && { justifyContent: 'center' }]}>
              {data?.map((item) => (
                <GradientView
                  onPress={() => onPress(item)}
                  style={styles.cardGradientStyle}
                  linearGradientStyle={styles.cardOuterShadow}
                  topShadowStyle={[
                    styles.cardTopShadow,
                    (selectedItem == null || selectedItem != item?.id) && { shadowColor : colors.gray.disable }
                  ]}
                  bottomShadowStyle={[
                    styles.cardInnerShadow,
                    (selectedItem == null || selectedItem != item?.id) && { shadowColor : colors.gray.disable }
                  ]}
                  linearGradientStyleMain={styles.cardGradientMainStyle}
                  gradiantColors={[colors.black.bg, colors.black.bg]}
                >
                  <View
                    style={{
                      flexDirection: item?.type !== 0 ? "column" : "row",
                      justifyContent:
                        item?.type !== 0 ? "center" : "center",
                      alignItems: item?.type !== 0 ? "center" : "center",
                    }}
                  >
                    {item?.type !== 0 && (
                      <Image
                        source={item?.icon}
                        style={
                          item?.id == 3
                            ? styles.coldVaultIconImage
                            : styles.vaultIconImage
                        }
                        resizeMode="contain"
                      />
                    )}
                    {item?.type === 0 ? (
                      <Image
                        source={item?.icon}
                        style={styles.logoImage}
                        resizeMode="contain"
                      />
                    ) : (
                      <Text h2 bold>
                        {item?.name}
                      </Text>
                    )}
                  </View>
                </GradientView>
              ))}
            </View>
            <Text h2 bold style={[styles.receiveToLabel, { marginTop: 30 }]}>
              SEND TO
            </Text>
            <View style={[styles.cardListContainer, wallets?.length == 1 && { justifyContent: 'center' }]}>
              {wallets?.map((item) => (
                <GradientView
                  onPress={() => onPressWallet(item)}
                  style={styles.cardGradientStyle}
                  linearGradientStyle={styles.cardOuterShadow}
                  topShadowStyle={[
                    styles.cardTopShadow,
                    item?.id == 4
                      ? { shadowColor: colors.blueText }
                      : item?.id == 3 && { shadowColor: colors.greenShadow },
                    (selectedWallet == null || selectedWallet != item?.id) && { shadowColor : colors.gray.disable }
                  ]}
                  bottomShadowStyle={[
                    styles.cardInnerShadow,
                    item?.id == 4
                      ? { shadowColor: colors.blueText }
                      : item?.id == 3 && { shadowColor: colors.greenShadow },
                    (selectedWallet == null || selectedWallet != item?.id) && { shadowColor : colors.gray.disable }
                  ]}
                  linearGradientStyleMain={styles.cardGradientMainStyle}
                  gradiantColors={[colors.black.bg, colors.black.bg]}
                >
                  <View
                    style={{
                      flexDirection: item?.type !== 0 ? "row" : "column",
                      justifyContent:
                        item?.type !== 0 ? "center" : "flex-start",
                      alignItems: item?.type !== 0 ? "center" : "flex-start",
                    }}
                  >
                    {item?.type !== 0 && (
                      <Image
                        source={item?.icon}
                        style={
                          item?.id == 3
                            ? styles.coldVaultIconImage
                            : styles.vaultIconImage
                        }
                        resizeMode="contain"
                      />
                    )}
                    {item?.type === 0 ? (
                      <Image
                        source={item?.icon}
                        style={styles.logoImage}
                        resizeMode="contain"
                      />
                    ) : (
                      <Text h2 bold>
                        {item?.name}
                      </Text>
                    )}
                  </View>
                </GradientView>
              ))}
            </View>
          </Animated.View>
          <TouchableOpacity onPress={onNext} disabled={selectedItem === null || selectedWallet === null} style={[styles.nextBtn, (selectedItem == null || selectedWallet == null) && {backgroundColor: colors.gray.disable}]}>
              <Text h3>Next</Text>
          </TouchableOpacity>
        </LinearGradient>
      </LinearGradient>
    </>
  );
}

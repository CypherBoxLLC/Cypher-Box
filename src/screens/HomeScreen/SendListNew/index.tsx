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
import Clipboard from "@react-native-clipboard/clipboard";
import styles from "./styles";
import { createInvoice } from "@Cypher/api/coinOSApis";
import { createInvoice as createInvoiceStrike } from "@Cypher/api/strikeAPIs";
import 'text-encoding';
import QRCode from 'react-native-qrcode-svg';

const SCREEN_WIDTH = Dimensions.get("window").width;

interface Props {
  refRBSheet: any;
  matchedRate: any;
  currency: any;
  wallet: any;
  coldStorageWallet: any;
  receiveType: boolean;
}

export default function SendListNew({ refRBSheet, receiveType, wallet, coldStorageWallet, matchedRate, currency }: Props) {
  const { user, strikeMe, vaultTab, setVaultTab, isAuth, isStrikeAuth, walletID, coldStorageWalletID, strikeUser } = useAuthStore();
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  console.log("🚀 ~ SendListNew ~ selectedItem:", selectedItem);
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
          matchedRate,
          currency,
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
    }] : []),
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
    }] : []),
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
      console.error('Error generating bitcoin address handleCreateInvoice 2:', error);
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
    if (item?.id == 1 || item?.id == 2) {
      // setSelectedItem(item.id);
      // setTab(0);
      // animateToSecondView();
      refRBSheet?.current?.close();
      setTimeout(() => {
        dispatchNavigate(item?.navigation?.screen, item?.navigation?.params);
      }, 150);

    } else if(item?.id == 3 || item?.id == 4){
      refRBSheet?.current?.close();
      setTimeout(() => {  
        setVaultTab(item?.id == 3 ? false : true);
        dispatchNavigate('HotStorageVault', { to: true, wallet: item?.id == 3 ? wallet : coldStorageWallet, matchedRate });
      }, 150);
    }
  };

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

  const tabs = getTabs();

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
            <View style={styles.cardListContainer}>
              {data?.map((item) => (
                <GradientView
                  onPress={() => onPress(item)}
                  style={styles.cardGradientStyle}
                  linearGradientStyle={styles.cardOuterShadow}
                  topShadowStyle={[
                    styles.cardTopShadow,
                    item?.id == 4
                      ? { shadowColor: colors.blueText }
                      : item?.id == 3 && { shadowColor: colors.greenShadow },
                  ]}
                  bottomShadowStyle={[
                    styles.cardInnerShadow,
                    item?.id == 4
                      ? { shadowColor: colors.blueText }
                      : item?.id == 3 && { shadowColor: colors.greenShadow },
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
            <Text h2 bold style={styles.receiveToLabel}>
              SEND FROM
            </Text>
          </Animated.View>
          <Animated.View
            style={[{ flex: 1, position: "absolute" }, view2Style]}
          >
            {tabs.length > 0 && (
              <CustomTabView
                tabs={tabs}
                selectedTab={tab}
                onTabChange={setTab}
              />
            )}
            {tab === 0 ? (
              <View style={styles.lightningTabContent}>
                <View style={styles.addressRow}>
                  <Text bold h2 style={styles.addressText} numberOfLines={1}>
                    {selectedItem === 2
                      ? user + "@coinos.io"
                      : strikeMe?.username + "@strike.me"}
                  </Text>
                  <TouchableOpacity onPress={() => onPressNew(data[0])}>
                    <Image source={Copy} style={styles.copyIconImage} />
                  </TouchableOpacity>
                </View>
                {/* {selectedItem === 2 && ( */}
                <GradientCard
                  colors_={[colors.gray.light, colors.white]}
                  style={styles.invoiceCardContainer}
                  linearStyle={styles.invoiceCardHeight}
                  onPress={() => onPressNew(bitcoinLightning)}
                >
                  <View style={styles.invoiceCardBackground}>
                    <View style={styles.invoiceCardContentRow}>
                      <View style={styles.invoiceCardTextContainer}>
                        <Text subHeader bold style={styles.invoiceCardTitle}>
                          {bitcoinLightning.name}
                        </Text>
                        <Text h4 bold style={styles.invoiceCardDescription}>
                          {bitcoinLightning.description}
                        </Text>
                      </View>
                      <View style={styles.socketIconContainer}>
                        <Image
                          source={Electrik}
                          style={styles.vaultIconImage}
                          resizeMode="contain"
                        />
                      </View>
                    </View>
                  </View>
                </GradientCard>
                {/* )} */}
              </View>
            ) : tab === 1 ? (
              <View style={styles.bitcoinTabContent}>
                <Text h2 bold>
                  Bitcoin Network Address
                </Text>
                {isLoading ? <ActivityIndicator size="large" color="#ffffff" />
                  :
                  <>
                    <Text semibold style={styles.bitcoinAddressText}>
                      {hashBitcoin}
                    </Text>
                    {hashBitcoin &&
                      <View style={{ marginTop: 10, padding: 2, backgroundColor: 'white', borderRadius: 2 }}>
                        <QRCode
                          getRef={c => {
                            if (!c?.toDataURL) return;
                            c?.toDataURL((base64Image: string) => {
                              base64QrCodeRef.current = base64Image?.replace(/(\r\n|\n|\r)/gm, '');
                            });
                          }}
                          value={hashBitcoin}
                          size={50}
                          color="black"
                          backgroundColor="white"
                        />
                      </View>
                    }
                  </>
                }
              </View>
            ) : (
              <View style={styles.liquidTabContent}>
                <Text h2 bold>
                  Liquid Federation Address
                </Text>
                {isLoading ? <ActivityIndicator size="large" color="#ffffff" />
                  :
                  <>
                    <Text semibold style={styles.bitcoinAddressText}>
                      {hashLiquid}
                    </Text>
                    {hashLiquid &&
                      <View style={{ marginTop: 10, padding: 2, backgroundColor: 'white', borderRadius: 2 }}>
                        <QRCode
                          getRef={c => {
                            if (!c?.toDataURL) return;
                            c?.toDataURL((base64Image: string) => {
                              base64QrCodeRef.current = base64Image?.replace(/(\r\n|\n|\r)/gm, '');
                            });
                          }}
                          value={hashLiquid}
                          size={50}
                          color="black"
                          backgroundColor="white"
                        />
                      </View>
                    }
                  </>
                }
                <Text semibold style={styles.bitcoinAddressText}>
                  Receive from wallets and exchanges that support the Liquid Federation
                </Text>
              </View>
            )}
            <View style={styles.bottomActionRow}>
              <TouchableOpacity onPress={backClickHandler}>
                <Image
                  source={Back}
                  style={styles.backButtonImage}
                  resizeMode="contain"
                />
              </TouchableOpacity>
              <Image
                source={selectedItem === 1 ? StrikeFull : CoinOS}
                style={styles.strikeLogoImage}
                resizeMode="contain"
              />
            </View>
          </Animated.View>
        </LinearGradient>
      </LinearGradient>
    </>
  );
}

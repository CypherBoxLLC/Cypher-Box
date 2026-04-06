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
import { shortenAddress } from "@Cypher/screens/ColdStorage";

const SCREEN_WIDTH = Dimensions.get("window").width;

interface Props {
  refRBSheet: any;
  matchedRate: any;
  currency: any;
  wallet: any;
  coldStorageWallet: any;
  receiveType: boolean;
  setReceivedListSecondTab: (val: boolean) => void;
  vaultAddress?: string;
  coldStorageAddress?: string;
}


export default function ReceivedListNew({ setReceivedListSecondTab, refRBSheet, receiveType, wallet, coldStorageWallet, matchedRate, currency, vaultAddress = '', coldStorageAddress = '' }: Props) {
  const { user, strikeMe, strikeUser, vaultTab, setVaultTab, isAuth, isStrikeAuth, walletID, coldStorageWalletID, allBTCWallets } = useAuthStore();
  const [selectedItem, setSelectedItem] = useState<number | null>(allBTCWallets.length == 1 && (!coldStorageWalletID && !walletID) && allBTCWallets[0] == "STRIKE" ? 1 : allBTCWallets.length == 1 && !coldStorageWalletID && !walletID && allBTCWallets[0] == "COINOS" ? 2 : null);
  console.log("🚀 ~ ReceivedListNew ~ selectedItem:", selectedItem);

  const [tab, setTab] = useState(0);
  const [showSecondView, setShowSecondView] = useState(allBTCWallets.length == 1 ? true : false);
  const [hashLiquid, setHashLiquid] = useState('');
  const [hashBitcoin, setHashBitcoin] = useState('');
  const qrCode = useRef();
  const base64QrCodeRef = useRef('');

  const [isLoading, setIsLoading] = useState(false);

  const hasLightning = isStrikeAuth || isAuth;
  const hasHotVault = !!walletID;
  const hasColdVault = !!coldStorageWalletID;

  useEffect(() => {
    if (tab == 1) {
      handleCreateInvoice('bitcoin');
    } else if (tab == 2) {
      handleCreateInvoice('liquid');
    }
  }, [tab, selectedItem])

  useEffect(() => {
    if(allBTCWallets.length == 1 && !coldStorageWalletID && !walletID) {
      animateToSecondView();
    }
  }, [allBTCWallets.length, coldStorageWalletID, walletID])

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
      console.error('Error generating bitcoin address handleCreateInvoice:', error);
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
    if (item?.id == 1 || item?.id == 2 || item?.id == 3 || item?.id == 4) {
      setSelectedItem(item.id);
      setTab(0);
      animateToSecondView();
      setReceivedListSecondTab(true);
    }
  };

  const backClickHandler = () => {
    animateToFirstView();
    setReceivedListSecondTab(false);
  };

  const bitcoinLightning = {
    id: 2,
    name: "Lightning invoice",
    type: 0,
    description:
      "To receive from wallets and exchanges that support the Lightning Network",
    navigation: {
      screen: "CreateInvoice",
      params: {
        matchedRate,
        currency,
        receiveType: selectedItem === 2 ? true : false
      },
    },
  };

  console.log('matchedRate: ', matchedRate, currency)
  const onPressNew = (item: any) => {
    refRBSheet?.current?.close();
    setReceivedListSecondTab(false);
    if (item?.id == 1) {
      Clipboard.setString(selectedItem === 2 ? user + '@coinos.io' : strikeMe?.username + '@strike.me');
      SimpleToast.show('Copied to clipboard', SimpleToast.SHORT);

    }
    console.log('item?.navigation?.params: ', item?.navigation?.params)
    item?.navigation?.screen &&
      setTimeout(() => {
        dispatchNavigate(item?.navigation?.screen, item?.navigation?.params);
      }, 150);
  }

  const getTabs = () => {
    if (selectedItem === 3 || selectedItem === 4) {
      return [
        {
          id: 0,
          name: "Address",
          icon: Barcode,
        },
      ];
    }
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

  const showBackButton = allBTCWallets.length > 1 ||
  (allBTCWallets.length == 1 && coldStorageWalletID) ||
  (allBTCWallets.length == 1 && walletID) ||
  (coldStorageWalletID && walletID);

  // --- 2x2 Grid Tile Component ---
  const renderGridTile = (
    id: number,
    label: string,
    subtitle: string,
    icon: any,
    iconStyle: any,
    isEnabled: boolean,
    accentColor: string,
    shadowColor: string,
  ) => {
    const isLogo = id === 1 || id === 2; // Strike/CoinOS use logo images
    return (
      <View style={{ width: '48%', opacity: isEnabled ? 1 : 0.3 }} pointerEvents={isEnabled ? 'auto' : 'none'}>
        <GradientView
          onPress={() => isEnabled && onPress({ id })}
          style={{
            shadowColor: "#040404",
            shadowOffset: { width: 6, height: 6 },
            shadowOpacity: 0.7,
            shadowRadius: 12,
            elevation: 6,
            height: 100,
            width: '100%',
          }}
          linearGradientStyle={{
            shadowColor: "#27272C",
            shadowOffset: { width: -6, height: -6 },
            shadowOpacity: 0.4,
            shadowRadius: 10,
            elevation: 6,
            flex: 1,
          }}
          topShadowStyle={{
            shadowOffset: { width: 2, height: 2 },
            shadowColor: shadowColor,
            shadowRadius: 3,
            borderRadius: 20,
            width: '100%',
            height: 100,
            justifyContent: "center",
          }}
          bottomShadowStyle={{
            shadowOffset: { width: -2, height: -2 },
            shadowRadius: 2,
            shadowOpacity: 0.5,
            shadowColor: shadowColor,
            borderRadius: 20,
            width: '100%',
            height: 100,
            justifyContent: "center",
            position: "absolute",
          }}
          linearGradientStyleMain={{
            borderRadius: 20,
            height: 100,
            justifyContent: "center",
            alignItems: "center",
            width: '100%',
          }}
          gradiantColors={[colors.black.bg, colors.black.bg]}
        >
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
            {isLogo ? (
              <Image
                source={icon}
                style={{ width: 90, height: 32, marginBottom: 6 }}
                resizeMode="contain"
              />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Image source={icon} style={iconStyle} resizeMode="contain" />
                <Text bold style={{ fontSize: 16, marginLeft: 6 }}>{label}</Text>
              </View>
            )}
            <Text style={{ fontSize: 11, color: '#888', textAlign: 'center' }} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
        </GradientView>
      </View>
    );
  };

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
          {/* ======= FIRST VIEW: 2x2 Grid ======= */}
          <Animated.View style={[{}, view1Style]}>
            <View style={{ paddingHorizontal: 24, marginTop: 20 }}>
              <Text h2 bold style={{ alignSelf: 'center', marginBottom: 16 }}>
                RECEIVE TO
              </Text>

              {/* Top row: Lightning custodians */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                {renderGridTile(
                  1,
                  'Strike',
                  'Small–medium amounts',
                  StrikeFull,
                  {},
                  isStrikeAuth,
                  '#FF65D4',
                  colors.pink.shadowTopNew,
                )}
                {renderGridTile(
                  2,
                  'CoinOS',
                  'Small–medium amounts',
                  CoinOS,
                  {},
                  isAuth,
                  '#FF65D4',
                  colors.pink.shadowTopNew,
                )}
              </View>

              {/* Bottom row: Vaults */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                {renderGridTile(
                  3,
                  'Hot Vault',
                  'Medium–large amounts',
                  Hot,
                  { width: 22, height: 30, marginEnd: 2 },
                  hasHotVault,
                  colors.green,
                  colors.greenShadow,
                )}
                {renderGridTile(
                  4,
                  'Cold Vault',
                  'Medium–large amounts',
                  Cold1,
                  { width: 30, height: 22, marginEnd: 2 },
                  hasColdVault,
                  colors.coldGreen,
                  colors.blueText,
                )}
              </View>
            </View>
          </Animated.View>

          {/* ======= SECOND VIEW: Sub-menus ======= */}
          <Animated.View
            style={[{ flex: 1, position: "absolute", width: '100%' }, view2Style]}
          >
            {/* Back button + title header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
              {showBackButton && (
                <TouchableOpacity onPress={backClickHandler} style={{ padding: 4 }}>
                  <Image
                    source={Back}
                    style={{ width: 26, height: 24 }}
                    resizeMode="contain"
                  />
                </TouchableOpacity>
              )}
              <View style={{ flex: 1, alignItems: 'center', marginRight: showBackButton ? 30 : 0 }}>
                <Image
                  source={
                    selectedItem === 1 ? StrikeFull
                    : selectedItem === 2 ? CoinOS
                    : selectedItem === 3 ? Hot
                    : Cold1
                  }
                  style={
                    (selectedItem === 1 || selectedItem === 2)
                      ? { width: 100, height: 32 }
                      : { width: 28, height: 28 }
                  }
                  resizeMode="contain"
                />
                {(selectedItem === 3 || selectedItem === 4) && (
                  <Text bold style={{ fontSize: 14, marginTop: 2 }}>
                    {selectedItem === 3 ? 'Hot Vault' : 'Cold Vault'}
                  </Text>
                )}
              </View>
            </View>

            {/* Tabs */}
            {tabs.length > 0 && (
              <CustomTabView
                tabs={tabs}
                selectedTab={tab}
                onTabChange={setTab}
              />
            )}

            {/* ---- Vault Sub-menu (Hot/Cold) ---- */}
            {(selectedItem === 3 || selectedItem === 4) && tab === 0 && (
              <View style={{ paddingHorizontal: 20, alignItems: 'center' }}>
                {/* QR Code */}
                {(selectedItem === 3 ? vaultAddress : coldStorageAddress) ? (
                  <View style={{ backgroundColor: 'white', padding: 10, borderRadius: 8, marginTop: 12 }}>
                    <QRCode
                      value={selectedItem === 3 ? vaultAddress : coldStorageAddress}
                      size={150}
                      color="black"
                      backgroundColor="white"
                    />
                  </View>
                ) : (
                  <ActivityIndicator size="large" color="#ffffff" style={{ marginTop: 30 }} />
                )}

                {/* Address + Copy */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingHorizontal: 10 }}>
                  <Text style={{ fontSize: 13, color: '#CCC', flex: 1, textAlign: 'center' }} numberOfLines={2}>
                    {selectedItem === 3 ? vaultAddress : coldStorageAddress}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      const addr = selectedItem === 3 ? vaultAddress : coldStorageAddress;
                      Clipboard.setString(addr);
                      SimpleToast.show('Address copied', SimpleToast.SHORT);
                    }}
                    style={{ marginLeft: 8 }}
                  >
                    <Image source={Copy} style={{ width: 28, height: 20 }} />
                  </TouchableOpacity>
                </View>

                {/* View All Addresses button */}
                <TouchableOpacity
                  onPress={() => {
                    refRBSheet?.current?.close();
                    setReceivedListSecondTab(false);
                    setTimeout(() => {
                      setVaultTab(selectedItem === 4);
                      dispatchNavigate('HotStorageVault', {
                        wallet: selectedItem === 3 ? wallet : coldStorageWallet,
                        matchedRate,
                        initialTab: 0,
                      });
                    }, 150);
                  }}
                  style={{
                    marginTop: 16,
                    paddingVertical: 10,
                    paddingHorizontal: 24,
                    borderRadius: 12,
                    borderWidth: 1.5,
                    borderColor: selectedItem === 3 ? colors.green : colors.coldGreen,
                  }}
                >
                  <Text style={{ fontSize: 14, color: selectedItem === 3 ? colors.green : colors.coldGreen, textAlign: 'center' }}>
                    View All Vault Addresses
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ---- Strike/CoinOS Lightning Tab ---- */}
            {selectedItem !== 3 && selectedItem !== 4 && tab === 0 ? (
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
              </View>
            ) : selectedItem !== 3 && selectedItem !== 4 && tab === 1 ? (
              <View style={styles.bitcoinTabContent}>
                <Text h2 bold>
                  Bitcoin Network Address
                </Text>
                {isLoading ? <ActivityIndicator size="large" color="#ffffff" />
                  :
                  <>
                    <View style={styles.addressRow}>
                      <Text semibold style={styles.bitcoinAddressText}>
                        {hashBitcoin}
                      </Text>
                      <TouchableOpacity onPress={() =>{
                        Clipboard.setString(hashBitcoin);
                        SimpleToast.show('Copied to clipboard', SimpleToast.SHORT)
                      }}>
                        <Image source={Copy} style={styles.copyIconImage} />
                      </TouchableOpacity>
                    </View>
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
            ) : selectedItem !== 3 && selectedItem !== 4 && (
              <View style={styles.liquidTabContent}>
                <Text h2 bold>
                  Liquid Federation Address
                </Text>
                {isLoading ? <ActivityIndicator size="large" color="#ffffff" />
                  :
                  <>
                    <View style={styles.addressRow}>
                      <Text semibold style={styles.bitcoinAddressText}>
                        {shortenAddress(hashLiquid)}
                      </Text>
                      <TouchableOpacity onPress={() =>{
                        Clipboard.setString(hashLiquid);
                        SimpleToast.show('Copied to clipboard', SimpleToast.SHORT)
                      }}>
                        <Image source={Copy} style={styles.copyIconImage} />
                      </TouchableOpacity>
                    </View>

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
          </Animated.View>
        </LinearGradient>
      </LinearGradient>
    </>
  );
}

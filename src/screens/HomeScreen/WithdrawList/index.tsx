import { Text } from "@Cypher/component-library";
import { CustomTabView, GradientCard, GradientView } from "@Cypher/components";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, Image, Platform, ScrollView, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import Ionicons from "react-native-vector-icons/Ionicons";
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
  Second,
  Socked,
  Strike,
  StrikeFull,
} from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { isCoinosAllowed } from "@Cypher/services/featureFlags";
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
  const {
    user,
    strikeMe,
    vaultTab,
    isAuth,
    isStrikeAuth,
    isArkAuth,
    walletID,
    coldStorageWalletID,
    withdrawThreshold,
    withdrawStrikeThreshold,
    withdrawArkThreshold,
    reserveArkAmount,
    arkBalance,
    strikeUser,
  } = useAuthStore();
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<number | null>(null);
  if (__DEV__) console.log("🚀 ~ WithdrawList ~ selectedItem:", selectedItem);
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
    // CoinOS visibility is gated by both auth state AND the feature flag
    // (region/platform check via isCoinosAllowed). Production iOS in the
    // EU drops this entry; dev builds and all other regions see it as
    // before. Same gate is applied across SendListNew, TopupList,
    // ColdStorage, and HotStorageVault Capsules to keep the surface
    // consistent.
    ...(isAuth && isCoinosAllowed() ? [{
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
    // Ark source — picked id=5 to leave headroom under the existing 1/2
    // (Strike/CoinOS) and 3/4 (Hot/Cold vault) IDs in this popup. The
    // navigation params are placeholder until ArkWithdrawReviewScreen
    // (Phase 3) lands; for now `onNext` recognises selectedItem === 5
    // and routes to the new review screen with hot/cold pre-picked from
    // the chosen destination tile.
    ...(isArkAuth ? [{
      id: 5,
      name: "Bark Vault",
      type: 0,
      icon: Second,
      description:
        "Withdraw from your non-custodial Bark vault to a hot or cold vault",
      navigation: {
        screen: "ArkWithdrawReviewScreen",
        params: {
          matchedRate,
          currency,
        },
      },
    }] : []),
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
        targetCurrency: "BTC" // Cypher Box: receive as Bitcoin, no auto-convert to fiat
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
    if (__DEV__) console.log('item?.navigation?.params: ', item?.navigation?.params)
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
      // Ark source has its own review screen — non-custodial, the
      // destination address is whichever vault the user picked in this
      // popup, and the source-side state (Lightning routing fee + Ark
      // service fee) doesn't fit ReviewPayment's Strike/CoinOS shape.
      if (selectedItem === 5) {
        // Auto-amount logic:
        //   - If balance > reserve: spendable = balance − reserve.
        //     The reserve is a floor we keep on Ark for everyday Lightning
        //     sends; withdrawals shouldn't dip below it.
        //   - If balance ≤ reserve: spendable = full balance. The reserve
        //     concept only applies once you have enough to maintain it; a
        //     user with 10K sats balance and 100K reserve isn't bound by
        //     the reserve, they just have less than they aspire to keep.
        // Then cap the prefill at the threshold (so we don't auto-suggest
        // withdrawing 5M sats when the user set their threshold to 500K).
        const arkBalSats = Number(arkBalance) || 0;
        const reserveSats = Number(reserveArkAmount) || 0;
        const thresholdSats = Number(withdrawArkThreshold) || 0;
        const spendable =
            arkBalSats > reserveSats ? arkBalSats - reserveSats : arkBalSats;
        const prefillSats =
            thresholdSats > 0 && spendable > thresholdSats
                ? thresholdSats
                : spendable;
        dispatchNavigate('ArkWithdrawReviewScreen', {
            // Destination tile id=4 → cold vault, otherwise hot vault.
            destinationKind: selectedWallet === 4 ? 'cold' : 'hot',
            destinationAddress:
                selectedWallet === 4 ? coldStorageAddress : vaultAddress,
            wallet: selectedWallet === 4 ? coldStorageWallet : wallet,
            prefillSats,
            arkBalanceSats: arkBalSats,
            reserveSats,
            thresholdSats,
            matchedRate,
            currency,
        });
        return;
      }
      const strikeBalance = Math.round(Number(strikeUser?.[0]?.available || 0) * SATS);
      const amount = selectedItem === 1 ? withdrawStrikeThreshold > strikeBalance ? strikeBalance : withdrawStrikeThreshold : withdrawThreshold > balance ? balance : withdrawThreshold;
      if (__DEV__) console.log('amount: ', amount)
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
          {/* Close button */}
          <TouchableOpacity
            onPress={() => refRBSheet?.current?.close()}
            style={{ position: 'absolute', top: 14, right: 16, zIndex: 10, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 18, color: '#888' }}>✕</Text>
          </TouchableOpacity>

          <Animated.View style={[{}, view1Style]}>
            <Text h2 bold style={styles.receiveToLabel}>
              WITHDRAW FROM
            </Text>
            
            {/* Lightning sources (`data`) — 2-col × 2-row grid (max 4
                tiles per page). When more than 4 are connected, the
                container becomes a horizontal pager so additional
                Lightning rails slide in from the right. Vaults below
                stay as one row (capped at 2). */}
            {(() => {
              // Per-wallet selection outline. RN 0.76 dropped the
              // native ART module, so the shadow-based "glow" used by
              // GradientView is now a no-op on Android (and very subtle
              // on iOS via the neomorph-shadows shim). A real
              // borderWidth/borderColor on the inner LinearGradient
              // gives a visible outline on both platforms.
              const outlineColor = (id: number): string => {
                if (id === 1 || id === 2) return colors.pink.shadowTopNew; // Strike / CoinOS
                if (id === 5) return colors.ark.shadowTopNew;              // Ark
                if (id === 3) return colors.green;                          // Hot Vault
                if (id === 4) return colors.blueText;                       // Cold Vault
                return 'transparent';
              };
              const renderTile = (item: any) => (
                <GradientView
                  key={item?.id}
                  onPress={() => onPress(item)}
                  style={styles.cardGradientStyle}
                  linearGradientStyle={styles.cardOuterShadow}
                  topShadowStyle={[
                    styles.cardTopShadow,
                    item?.id === 5 && { shadowColor: colors.ark.shadowTopNew },
                    (selectedItem == null || selectedItem != item?.id) && { shadowColor : colors.gray.disable }
                  ]}
                  bottomShadowStyle={[
                    styles.cardInnerShadow,
                    item?.id === 5 && { shadowColor: colors.ark.shadowBottom },
                    (selectedItem == null || selectedItem != item?.id) && { shadowColor : colors.gray.disable }
                  ]}
                  linearGradientStyleMain={[
                    styles.cardGradientMainStyle,
                    // Border is the selection cue on BOTH platforms — the
                    // iOS neomorph rim is a no-op under Fabric's useArt
                    // fallback, so without this iOS shows no highlight.
                    selectedItem === item?.id && {
                      borderWidth: 2,
                      borderColor: outlineColor(item?.id),
                    },
                  ]}
                  gradiantColors={[colors.black.bg, colors.black.bg]}
                >
                  <View
                    style={{
                      flexDirection: item?.type !== 0 ? "column" : "row",
                      justifyContent: "center",
                      alignItems: "center",
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
                    {item?.id === 5 ? (
                      // Bark tile uses the boat-outline + "Bark Vault"
                      // text pattern (matches the Receive/Send sheets,
                      // homescreen wallet card, Vault tab, and Create
                      // Bark login row) instead of the Second wordmark.
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons
                          name="boat-outline"
                          size={20}
                          color="#FFFFFF"
                          style={{ marginRight: 6 }}
                        />
                        <Text bold style={{ fontSize: 16, color: '#FFFFFF' }}>
                          Bark Vault
                        </Text>
                      </View>
                    ) : item?.type === 0 ? (
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
              );

              const PAGE_SIZE = 4; // 2 cols × 2 rows
              const pages: any[][] = [];
              for (let i = 0; i < (data?.length || 0); i += PAGE_SIZE) {
                pages.push(data.slice(i, i + PAGE_SIZE));
              }
              const isPageable = pages.length > 1;
              const renderPage = (page: any[], pageIdx: number) => (
                <View
                  key={pageIdx}
                  style={{
                    width: SCREEN_WIDTH,
                    paddingHorizontal: 30,
                    flexDirection: "row",
                    flexWrap: "wrap",
                    justifyContent:
                      page.length === 1 ? "center" : "space-between",
                    alignItems: "center",
                  }}
                >
                  {page.map(renderTile)}
                </View>
              );

              if (!isPageable) {
                // Single page (1–4 wallets). Use the same wrapping grid
                // so 3 wallets lay out as 2 + 1 instead of squeezing
                // into a single row. cardListContainer is replaced with
                // an inline equivalent that supports flexWrap.
                // marginTop: 0 (was 20) — Bam asked for the lightning
                // rows lifted up 20pt below the WITHDRAW FROM label.
                return (
                  <View
                    style={{
                      paddingHorizontal: 30,
                      marginTop: 0,
                      flexDirection: "row",
                      flexWrap: "wrap",
                      justifyContent:
                        (data?.length || 0) === 1 ? "center" : "space-between",
                      alignItems: "center",
                    }}
                  >
                    {data?.map(renderTile)}
                  </View>
                );
              }

              return (
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: 0 }}
                  contentContainerStyle={{ alignItems: "center" }}
                >
                  {pages.map(renderPage)}
                </ScrollView>
              );
            })()}
            <Text h2 bold style={[styles.receiveToLabel, { marginTop: 10 }]}>
              SEND TO
            </Text>
            {/* Vault row lifted 20pt up from the SEND TO label by
                overriding cardListContainer's marginTop (20 → 0). */}
            <View style={[styles.cardListContainer, { marginTop: 0 }, wallets?.length == 1 && { justifyContent: 'center' }]}>
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
                  linearGradientStyleMain={[
                    styles.cardGradientMainStyle,
                    // Both platforms — see HOT/COLD card above.
                    selectedWallet === item?.id && {
                      borderWidth: 2,
                      borderColor: item?.id === 3 ? colors.green
                                 : item?.id === 4 ? colors.blueText
                                 : 'transparent',
                    },
                  ]}
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
          {/* Next button matches the chosen source: pink for Strike/CoinOS
              (the nextBtn default), white for Bark (id 5, the Bark palette).
              Disabled grey wins last. Dark text on the white Bark button. */}
          <TouchableOpacity activeOpacity={0.7} onPress={onNext} disabled={selectedItem === null || selectedWallet === null} style={[styles.nextBtn, { marginTop: 20 }, selectedItem === 5 && { backgroundColor: colors.ark.light }, (selectedItem == null || selectedWallet == null) && {backgroundColor: colors.gray.disable}]}>
              <Text h3 style={selectedItem === 5 && selectedWallet !== null ? { color: '#202832' } : undefined}>Next</Text>
          </TouchableOpacity>
        </LinearGradient>
      </LinearGradient>
    </>
  );
}

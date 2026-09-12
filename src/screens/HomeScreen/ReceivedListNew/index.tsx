import { Text } from "@Cypher/component-library";
import { CustomTabView, GradientCard, GradientView } from "@Cypher/components";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, Image, TouchableOpacity, View } from "react-native";
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
  Electricity,
  Electrik,
  Hot,
  Socked,
  Second,
  Strike,
  StrikeFull,
} from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { FEATURE_ARK_ENABLED, fetchArkMinBoardSats, getArkAddress, getArkOnchainAddress } from "@Cypher/services/ark";
import useAuthStore from "@Cypher/stores/authStore";
import { describeArkFailure } from "@Cypher/services/ark/networkFault";
import { ARK_SERVER_URL, ESPLORA_URLS } from "@Cypher/services/ark";
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
  initialVaultType?: 'hot' | 'cold' | null;
}



/**
 * Address fetch failed, say so instead of spinning.
 *
 * The retry is deliberate and deliberately plain. Some causes clear by
 * themselves (a quota window rolling over), some need the user to act (switch
 * networks, open the vault), and `message` already carries which. The button
 * only re-runs the fetch; it does not claim the retry will work.
 */
function AddressFetchFailed({ message, onRetry }: { message: string; onRetry(): void }) {
    return (
        <View style={{ paddingHorizontal: 24, alignItems: 'center' }}>
            <Text center style={{ fontSize: 13, lineHeight: 18, color: '#FFD54F' }}>
                {message}
            </Text>
            <TouchableOpacity
                onPress={onRetry}
                accessibilityRole="button"
                hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}
                style={{ marginTop: 12 }}
            >
                <Text bold style={{ fontSize: 14, color: '#FFFFFF', textDecorationLine: 'underline' }}>
                    Try again
                </Text>
            </TouchableOpacity>
        </View>
    );
}

export default function ReceivedListNew({ setReceivedListSecondTab, refRBSheet, receiveType, wallet, coldStorageWallet, matchedRate, currency, vaultAddress = '', coldStorageAddress = '', initialVaultType = null }: Props) {
  const { user, strikeMe, strikeUser, vaultTab, setVaultTab, isAuth, isStrikeAuth, isArkAuth, walletID, coldStorageWalletID, allBTCWallets } = useAuthStore();

  const getInitialSelectedItem = () => {
    if (initialVaultType === 'hot') return 3;
    if (initialVaultType === 'cold') return 4;
    if (allBTCWallets.length == 1 && (!coldStorageWalletID && !walletID) && allBTCWallets[0] == "STRIKE") return 1;
    if (allBTCWallets.length == 1 && !coldStorageWalletID && !walletID && allBTCWallets[0] == "COINOS") return 2;
    // Ark-only case: jump straight to the Ark sub-menu (onchain / lightning
    // / Ark address tabs) instead of falling through to the Strike-default
    // create-invoice path, which tries Strike's API and fails for
    // unauthenticated users (loss of UX path: ark-only users were taken to
    // an invoice screen that errored on the create call). selectedItem === 5
    // is the Ark tile in the wallet picker; setting it here makes the
    // single-wallet auto-show pick the right submenu.
    if (allBTCWallets.length == 1 && !coldStorageWalletID && !walletID && allBTCWallets[0] == "ARK") return 5;
    return null;
  };

  const [selectedItem, setSelectedItem] = useState<number | null>(getInitialSelectedItem());
  if (__DEV__) console.log("🚀 ~ ReceivedListNew ~ selectedItem:", selectedItem);

  const [tab, setTab] = useState(0);

  // Whether the Bark address is shown in full. Collapsed by default: the

  // short form is what a returning user needs, and the full string is 60+

  // characters of opaque hex that would dominate the sheet.

  const [arkAddressExpanded, setArkAddressExpanded] = useState(false);
  /**
   * Why the address could not be fetched, or null.
   *
   * Exists because a rejected fetch used to leave the panel on its spinner
   * forever: the address state stayed empty, nothing rendered the failure, and
   * the only signal was a toast that had already gone. A hard failure looked
   * exactly like "still loading", which is the reading that costs the most time
   * (observed 2026-09-09: two separate sessions spent chasing a spinner that
   * was a network refusal).
   */
  const [arkAddressError, setArkAddressError] = useState<string | null>(null);
  const [arkOnchainAddressError, setArkOnchainAddressError] = useState<string | null>(null);
  /** Bumped by "Try again" so the fetch effect re-runs. */
  const [addressReloadTick, setAddressReloadTick] = useState(0);
  const [showSecondView, setShowSecondView] = useState(initialVaultType !== null || allBTCWallets.length == 1 ? true : false);
  const [hashLiquid, setHashLiquid] = useState('');
  const [hashBitcoin, setHashBitcoin] = useState('');
  // Ark sub-menu addresses. Generated when the Ark tile is opened
  // (selectedItem === 5) so they're ready for the corresponding tab
  // without an extra round-trip when the user switches tabs. Both come
  // from the local Bark wallet handle — instant, no network.
  const [arkAddress, setArkAddress] = useState('');
  const [arkOnchainAddress, setArkOnchainAddress] = useState('');
  // Live server minimum board amount for the on-chain receive warning (Ark
  // tab 1). A deposit below this confirms on-chain but never boards into a
  // VTXO. 50k sats fallback when the bark handle isn't open.
  const [minBoardSats, setMinBoardSats] = useState(50000);
  useEffect(() => {
    let cancelled = false;
    fetchArkMinBoardSats().then((min) => {
      if (!cancelled && typeof min === 'number' && min > 0) setMinBoardSats(min);
    });
    return () => { cancelled = true; };
  }, []);
  const qrCode = useRef();
  const base64QrCodeRef = useRef('');

  const [isLoading, setIsLoading] = useState(false);

  const hasLightning = isStrikeAuth || isAuth;
  const hasHotVault = !!walletID;
  const hasColdVault = !!coldStorageWalletID;

  useEffect(() => {
    // Ark uses the local Bark wallet handle — fetch Ark + on-chain
    // addresses up front so both the Bitcoin and Ark-address tabs
    // render instantly when the user switches. CoinOS / Strike still
    // hit the network per-tab below; Ark is local-only so no need to
    // gate by tab.
    //
    // Mounted-ref guard: the Bark SDK calls below complete on the
    // native thread and bounce back to JS to set state. Under Fabric
    // (RN 0.76 New Arch), a `setState` that lands after the surface
    // is torn down triggers `react_native_assert(uiManager.get() !=
    // nil)` on the JS thread → SIGABRT. The cleanup flag below is
    // flipped synchronously when the effect re-runs or the component
    // unmounts, so trailing setState calls become no-ops.
    if (selectedItem === 5) {
      let mounted = true;
      void (async () => {
        // allSettled, NOT all. These are independent: the Ark address needs
        // the Ark wallet, the on-chain address is a local BDK call. Promise.all
        // discarded BOTH when either failed, so a locked wallet threw away a
        // perfectly good on-chain address and left the sheet spinning on null
        // state. That is how funding an exit became impossible: the on-chain
        // address is the ASP-independent way in, and it was collateral damage
        // from the Ark address failing.
        const [arkRes, onchainRes] = await Promise.allSettled([
          getArkAddress(),
          getArkOnchainAddress(),
        ]);
        if (!mounted) return;
        if (arkRes.status === 'fulfilled') {
          setArkAddress(arkRes.value);
          setArkAddressError(null);
        }
        if (onchainRes.status === 'fulfilled') {
          setArkOnchainAddress(onchainRes.value);
          setArkOnchainAddressError(null);
        }

        // Each rail records its OWN failure. They fail independently (the Ark
        // address needs an open wallet and a reachable chain source, the
        // on-chain one is a local BDK call), so a shared error would blame one
        // for the other's problem.
        //
        // describeArkFailure rather than a hand-written line: it already knows
        // the difference between a provider that is unreachable and one that is
        // refusing us on quota, and those need opposite advice. The old copy
        // said "Pull to retry" for both, which is precisely wrong for a quota
        // rejection, where retrying is what keeps it refused.
        const endpoints = { chainUrls: ESPLORA_URLS, arkUrl: ARK_SERVER_URL };
        if (arkRes.status === 'rejected') {
          console.warn('[Receive] Ark address fetch failed:', arkRes.reason);
          setArkAddressError(
            describeArkFailure(arkRes.reason, "Couldn't get a Bark address", endpoints),
          );
        }
        if (onchainRes.status === 'rejected') {
          console.warn('[Receive] on-chain address fetch failed:', onchainRes.reason);
          setArkOnchainAddressError(
            describeArkFailure(onchainRes.reason, "Couldn't get an on-chain address", endpoints),
          );
        }
      })();
      return () => {
        mounted = false;
      };
    }
    if (tab == 1) {
      handleCreateInvoice('bitcoin');
    } else if (tab == 2) {
      handleCreateInvoice('liquid');
    }
  }, [tab, selectedItem, addressReloadTick])

  useEffect(() => {
    if(initialVaultType !== null || (allBTCWallets.length == 1 && !coldStorageWalletID && !walletID)) {
      animateToSecondView();
      setReceivedListSecondTab(true);
    }
  }, [allBTCWallets.length, coldStorageWalletID, walletID, initialVaultType])

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
      console.error('Error generating bitcoin address handleCreateInvoice:', error);
      SimpleToast.show(`Failed to generating ${type == 'bitcoin' ? "bitcoin" : "liquid"} address. Please try again.`, SimpleToast.SHORT);
    } finally {
      setIsLoading(false);
    }
  };

  const translateX1 = useSharedValue(initialVaultType !== null ? -SCREEN_WIDTH : 0);
  const translateX2 = useSharedValue(initialVaultType !== null ? 0 : SCREEN_WIDTH);

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
    // All wallet tiles (Strike, CoinOS, Hot Vault, Cold Vault, Ark)
    // now route to the in-sheet second view. Ark used to break out
    // to its own ArkReceiveScreen, but the three options it exposed
    // (Lightning / Bitcoin / Ark address) map cleanly onto a tabbed
    // sub-menu — same shape CoinOS uses for Lightning/Bitcoin/Liquid —
    // so the cross-rail receive UX stays consistent and the user
    // never leaves the sheet.
    if (item?.id == 1 || item?.id == 2 || item?.id == 3 || item?.id == 4 || item?.id == 5) {
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

  if (__DEV__) console.log('matchedRate: ', matchedRate, currency)
  const onPressNew = (item: any) => {
    refRBSheet?.current?.close();
    setReceivedListSecondTab(false);
    if (item?.id == 1) {
      Clipboard.setString(selectedItem === 2 ? user + '@coinos.io' : strikeMe?.username + '@strike.me');
      SimpleToast.show('Copied to clipboard', SimpleToast.SHORT);

    }
    if (__DEV__) console.log('item?.navigation?.params: ', item?.navigation?.params)
    item?.navigation?.screen &&
      setTimeout(() => {
        dispatchNavigate(item?.navigation?.screen, item?.navigation?.params);
      }, 150);
  }

  const getTabs = () => {
    // Vaults only have one address view — no tab bar needed
    if (selectedItem === 3 || selectedItem === 4) {
      return [];
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
    } else if (selectedItem === 5) {
      // Ark: same three-tab shape as CoinOS, with the Liquid slot
      // replaced by "Ark" (the user's VTXO recipient address). Order
      // matches CoinOS — Lightning / Bitcoin / specialist-rail — so
      // muscle memory carries between the two cards. The Ark tab
      // uses an Ionicons boat glyph rather than a PNG asset because
      // the project ships no ark/ship icon today; a vector icon is
      // crisper, scales freely with tab size, and avoids adding a
      // new image asset for a single use site.
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
          name: "Bark",
          iconElement: (
            <Ionicons
              name="boat-outline"
              size={20}
              color="#FFFFFF"
              style={{ marginRight: 6 }}
            />
          ),
        },
      ];
    }
    return [];
  };

  const tabs = getTabs();

  const showBackButton = allBTCWallets.length > 1 ||
  (allBTCWallets.length == 1 && coldStorageWalletID) ||
  (allBTCWallets.length == 1 && walletID) ||
  (coldStorageWalletID && walletID) ||
  (allBTCWallets.length == 0 && (walletID || coldStorageWalletID));

  // --- 2x2 Grid Tile Component ---
  // Shadow/ART requires absolute pixel dimensions — percentage strings produce NaN
  const TILE_WIDTH = Math.floor((SCREEN_WIDTH - 48) * 0.48);

  const renderGridTile = (
    id: number,
    label: string,
    subtitle: string,
    icon: any,
    iconStyle: any,
    isEnabled: boolean,
    accentColor: string,
    shadowColor: string,
    textLabel?: string, // For providers without a logo asset (e.g. Ark) — shown inline
  ) => {
    const isLogo = id === 1 || id === 2; // Strike/CoinOS use logo images
    // Hide tiles for wallets that aren't created / aren't logged in.
    // Render an invisible spacer of the same width so the surviving tile
    // in the row keeps its grid position (justifyContent: space-between
    // would otherwise pull a single visible tile to flex-start).
    if (!isEnabled) {
      return <View style={{ width: TILE_WIDTH }} />;
    }
    return (
      <View style={{ width: TILE_WIDTH }} pointerEvents={'auto'}>
        <GradientView
          onPress={() => isEnabled && onPress({ id })}
          style={{
            shadowColor: "#040404",
            shadowOffset: { width: 6, height: 6 },
            shadowOpacity: 0.7,
            shadowRadius: 12,
            elevation: 6,
            height: 100,
            width: TILE_WIDTH,
          }}
          linearGradientStyle={{
            shadowColor: "#27272C",
            shadowOffset: { width: -6, height: -6 },
            shadowOpacity: 0.4,
            shadowRadius: 10,
            elevation: 6,
            height: 100,
            width: TILE_WIDTH,
          }}
          topShadowStyle={{
            shadowOffset: { width: 2, height: 2 },
            shadowColor: shadowColor,
            shadowRadius: 3,
            borderRadius: 20,
            width: TILE_WIDTH,
            height: 100,
            justifyContent: "center",
          }}
          bottomShadowStyle={{
            shadowOffset: { width: -2, height: -2 },
            shadowRadius: 2,
            shadowOpacity: 0.5,
            shadowColor: shadowColor,
            borderRadius: 20,
            width: TILE_WIDTH,
            height: 100,
            justifyContent: "center",
            position: "absolute",
          }}
          linearGradientStyleMain={{
            borderRadius: 20,
            height: 100,
            justifyContent: "center",
            alignItems: "center",
            width: TILE_WIDTH,
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
            ) : textLabel ? (
              // White at 16pt — matches the other tile labels' visual
              // weight. Was 22pt + accentColor (yellow for Ark) which read
              // as a brand wordmark instead of a label. The lightning bolt
              // (white) sits to the left so the row mirrors the icon+label
              // layout of the Vault tiles below.
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Image
                  source={Electricity}
                  style={{ width: 14, height: 18, marginRight: 6, tintColor: '#FFFFFF' }}
                  resizeMode="contain"
                />
                <Text bold style={{ fontSize: 16, color: '#FFFFFF' }}>{textLabel}</Text>
              </View>
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
        // Neutral rim, not pink: `gradientLine`'s paddingTop shows this outer
        // gradient as a strip on the sheet's top edge only.
        colors={[colors.black.gradientTop, colors.black.gradientBottom]}
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
            activeOpacity={0.6}
            style={{ position: 'absolute', top: 14, right: 16, zIndex: 10, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 18, color: '#888' }}>&#x2715;</Text>
          </TouchableOpacity>

          {/* ======= FIRST VIEW: 2x2 Grid ======= */}
          <Animated.View style={[{}, view1Style]}>
            <View style={{ paddingHorizontal: 24, marginTop: 20 }}>
              <Text h2 bold style={{ alignSelf: 'center', marginBottom: 16 }}>
                RECEIVE TO
              </Text>

              {/* Modular 2-column adaptive grid. Only tiles for connected
                  wallets render; the grid wraps so empty slots aren't
                  reserved. Order is Strike → CoinOS → Ark → Hot Vault →
                  Cold Vault — e.g. Strike+Ark+Hot Vault flows as
                  [Strike, Ark] / [Hot Vault]; all five flows as
                  [Strike, CoinOS] / [Ark, Hot] / [Cold]. The previous
                  fixed row grouping (Lightning row / Vault row / Ark row)
                  left greyed gaps for missing rails. */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                {(() => {
                  type TileDef = {
                    id: number;
                    label: string;
                    subtitle: string;
                    icon: any;
                    iconStyle: any;
                    isEnabled: boolean;
                    accent: string;
                    shadowColor: string;
                    textLabel?: string;
                  };
                  const tiles: TileDef[] = [];
                  if (isStrikeAuth) tiles.push({
                    id: 1, label: 'Strike', subtitle: 'Small–medium amounts',
                    icon: StrikeFull, iconStyle: {}, isEnabled: true,
                    accent: '#FF65D4', shadowColor: colors.pink.shadowTopNew,
                  });
                  if (!!isAuth) tiles.push({
                    id: 2, label: 'CoinOS', subtitle: 'Small–medium amounts',
                    icon: CoinOS, iconStyle: {}, isEnabled: true,
                    accent: '#FF65D4', shadowColor: colors.pink.shadowTopNew,
                  });
                  if (FEATURE_ARK_ENABLED && isArkAuth) tiles.push({
                    id: 5, label: 'Ark', subtitle: 'Small–medium amounts',
                    icon: null, iconStyle: {}, isEnabled: true,
                    accent: colors.ark.light, shadowColor: colors.ark.shadowTopNew,
                    textLabel: 'Bark Vault',
                  });
                  if (hasHotVault) tiles.push({
                    id: 3, label: 'Hot Vault', subtitle: 'Medium–large amounts',
                    icon: Hot, iconStyle: { width: 22, height: 30, marginEnd: 2 },
                    isEnabled: true, accent: colors.green, shadowColor: colors.greenShadow,
                  });
                  if (hasColdVault) tiles.push({
                    id: 4, label: 'Cold Vault', subtitle: 'Medium–large amounts',
                    icon: Cold1, iconStyle: { width: 30, height: 22, marginEnd: 2 },
                    isEnabled: true, accent: colors.coldGreen, shadowColor: colors.blueText,
                  });

                  // Render each tile wrapped in a 12pt-bottom-margin View so
                  // wrapped rows have consistent vertical gap. Trailing odd
                  // tile in a row pins to the left via space-between's
                  // single-child behavior — matches Bam's spec.
                  return tiles.map(t => (
                    <View key={t.id} style={{ marginBottom: 12 }}>
                      {renderGridTile(t.id, t.label, t.subtitle, t.icon, t.iconStyle, t.isEnabled, t.accent, t.shadowColor, t.textLabel)}
                    </View>
                  ));
                })()}
              </View>
            </View>
          </Animated.View>

          {/* ======= SECOND VIEW: Sub-menus ======= */}
          <Animated.View
            style={[{ position: "absolute", width: '100%', height: '100%' }, view2Style]}
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
                {selectedItem === 5 ? (
                  // Second.tech ASP identifier — rendered as Text
                  // rather than an Image because the bundled
                  // `second.png` is an 8-bit colormap PNG without
                  // a clean alpha channel; tintColor whitening
                  // didn't take effect across iOS's image loader.
                  // A text label is the more reliable cross-platform
                  // path, and is always white regardless of how the
                  // sheet's dark gradient background is rendered.
                  <Text
                    bold
                    style={{
                      fontSize: 22,
                      // Explicit lineHeight: without one, iOS lays a bold 22pt
                      // face out in a box shorter than its ascenders and clips
                      // the tops of the capitals. Only shows up on this label
                      // because it is the largest text in the header row.
                      lineHeight: 28,
                      color: '#FFFFFF',
                      letterSpacing: 0.5,
                    }}
                  >
                    Bark Vault
                  </Text>
                ) : (
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
                )}
                {(selectedItem === 3 || selectedItem === 4) && (
                  <Text bold style={{ fontSize: 14, marginTop: 2 }}>
                    {selectedItem === 3 ? 'Hot Vault' : 'Cold Vault'}
                  </Text>
                )}
              </View>
            </View>

            {/* Bark-address specific, so it is gated to that tab: "this address"
                only means something while the Bark address is on screen.
                The point is that expiry reminders are LOCAL alarms scheduled by
                the app when it SEES the capsule, so a payment made to a shared
                address while the app is closed has no reminder attached to it at
                all. Sits with the tip above rather than under the QR so the
                advice reads as one block. COPY: Bam finalizes. */}
            {/* Tabs */}
            {tabs.length > 0 && (
              <CustomTabView
                tabs={tabs}
                selectedTab={tab}
                onTabChange={setTab}
              />
            )}

            {/* Below the tabs, not above: it describes the Bark tab's
                address, so it read as a caption for the tab row itself
                when it sat on top of it. */}
            {selectedItem === 5 && tab === 2 && (
              <Text
                center
                style={{ marginHorizontal: 24, marginTop: 2, fontSize: 12, color: '#FFD54F', opacity: 0.95, lineHeight: 17 }}
              >
                To receive 700-sat or above capsule from another Bark user. Need to be present with the app being open when you receive to this address.
              </Text>
            )}


            {/* ---- Vault Sub-menu (Hot/Cold) ---- */}
            {(selectedItem === 3 || selectedItem === 4) && tab === 0 && (
              <View style={{ paddingHorizontal: 24, alignItems: 'center', flex: 1, justifyContent: 'space-evenly', paddingBottom: 12 }}>
                {/* QR Code */}
                {(selectedItem === 3 ? vaultAddress : coldStorageAddress) ? (
                  <View style={{ backgroundColor: 'white', padding: 10, borderRadius: 10 }}>
                    <QRCode
                      value={selectedItem === 3 ? vaultAddress : coldStorageAddress}
                      size={150}
                      color="black"
                      backgroundColor="white"
                    />
                  </View>
                ) : (
                  <ActivityIndicator size="large" color="#ffffff" style={{ marginTop: 20 }} />
                )}

                {/* Address + Copy row */}
                <TouchableOpacity
                  onPress={() => {
                    const addr = selectedItem === 3 ? vaultAddress : coldStorageAddress;
                    if (addr) {
                      Clipboard.setString(addr);
                      SimpleToast.show('Address copied', SimpleToast.SHORT);
                    }
                  }}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    borderRadius: 10,
                    width: '100%',
                  }}
                >
                  <Text style={{ fontSize: 12, color: '#CCC', flex: 1, fontFamily: 'monospace' }} numberOfLines={1}>
                    {selectedItem === 3 ? vaultAddress : coldStorageAddress}
                  </Text>
                  <Image source={Copy} style={{ width: 20, height: 16, marginLeft: 8, tintColor: '#aaa' }} resizeMode="contain" />
                </TouchableOpacity>

                {/* View All Vault Addresses button */}
                <TouchableOpacity
                  onPress={() => {
                    refRBSheet?.current?.close();
                    setReceivedListSecondTab(false);
                    const targetWallet = selectedItem === 3 ? wallet : coldStorageWallet;
                    setVaultTab(selectedItem === 4);
                    setTimeout(() => {
                      dispatchNavigate('WalletAddresses', {
                        walletID: targetWallet?.getID?.(),
                        isTouchable: true,
                        selectForReceive: true,
                      });
                    }, 150);
                  }}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 24,
                    borderRadius: 10,
                    backgroundColor: selectedItem === 3 ? 'rgba(76,175,80,0.15)' : 'rgba(135,206,235,0.15)',
                    borderWidth: 1.5,
                    borderColor: selectedItem === 3 ? colors.green : colors.coldGreen,
                  }}
                >
                  <Text bold style={{ fontSize: 13, color: selectedItem === 3 ? colors.green : colors.coldGreen, textAlign: 'center' }}>
                    View All Vault Addresses
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ---- Strike/CoinOS Lightning Tab ---- */}
            {selectedItem !== 3 && selectedItem !== 4 && selectedItem !== 5 && tab === 0 ? (
              <View style={styles.lightningTabContent}>
                <View style={styles.addressRow}>
                  <Text bold h2 style={styles.addressText} numberOfLines={1}>
                    {selectedItem === 2
                      ? user + "@coinos.io"
                      : strikeMe?.username + "@strike.me"}
                  </Text>
                  <TouchableOpacity onPress={() => onPressNew({ id: 1 })}>
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
            ) : selectedItem !== 3 && selectedItem !== 4 && selectedItem !== 5 && tab === 1 ? (
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
            ) : selectedItem !== 3 && selectedItem !== 4 && selectedItem !== 5 && (
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

            {/* ---- Ark sub-menu (Lightning / Bitcoin / Ark address) ----
                Mirrors CoinOS's three-tab shape so muscle memory carries
                between the two custodial-Lightning-ish cards. The
                differences from CoinOS:
                  - Lightning → no static @-address (Ark has no Lightning
                    address concept), just a card-button into
                    ArkInvoiceScreen for amount entry
                  - Bitcoin → on-chain board address (deposit funds that
                    later board into Ark via the next round)
                  - Ark    → user's VTXO recipient identifier; for
                    instant off-chain transfers from another Ark user
                Lives inline so the user never leaves the receive
                bottom sheet — used to navigate to ArkReceiveScreen,
                which broke the consistent in-sheet UX. */}
            {selectedItem === 5 && tab === 0 && (
              <View style={styles.lightningTabContent}>
                <GradientCard
                  colors_={[colors.gray.light, colors.white]}
                  style={styles.invoiceCardContainer}
                  linearStyle={styles.invoiceCardHeight}
                  onPress={() => {
                    refRBSheet?.current?.close();
                    setReceivedListSecondTab(false);
                    setTimeout(() => {
                      dispatchNavigate('ArkInvoiceScreen', {
                        matchedRate,
                        currency,
                      });
                    }, 150);
                  }}
                >
                  <View style={styles.invoiceCardBackground}>
                    <View style={styles.invoiceCardContentRow}>
                      <View style={styles.invoiceCardTextContainer}>
                        <Text subHeader bold style={styles.invoiceCardTitle}>
                          Lightning invoice
                        </Text>
                        <Text h4 bold style={styles.invoiceCardDescription}>
                          Receive Lightning payments into Ark, paid out as a VTXO once the next round commits.
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
            )}

            {selectedItem === 5 && tab === 1 && (
              // Lift the Bitcoin-tab content (header text, address +
              // QR, footer caption) up 10pt via a paint-only
              // translateY. Bam's call: the tab body sat too low
              // relative to the sibling Lightning / Ark tabs after
              // the sub-menu was inlined — a small upward nudge
              // visually centers the QR within the sheet. Using
              // transform (not marginTop) so the layout flow
              // beneath isn't shifted with it.
              <View style={[styles.bitcoinTabContent, { transform: [{ translateY: -10 }] }]}>
                <Text semibold style={{ color: '#FFD54F', textAlign: 'center', fontSize: 13, paddingHorizontal: 16 }}>
                  ⚠️ Do not receive less than {minBoardSats.toLocaleString('en-US')} sats to this on-chain address
                </Text>
                {arkOnchainAddressError ? (
                  <AddressFetchFailed
                    message={arkOnchainAddressError}
                    onRetry={() => {
                      setArkOnchainAddressError(null);
                      setAddressReloadTick((n) => n + 1);
                    }}
                  />
                ) : !arkOnchainAddress ? (
                  <ActivityIndicator size="large" color="#ffffff" />
                ) : (
                  <>
                    <View style={[styles.addressRow, { marginTop: 12 }]}>
                      <Text semibold style={[styles.bitcoinAddressText, { fontSize: 13 }]}>
                        {arkOnchainAddress}
                      </Text>
                      <TouchableOpacity onPress={() => {
                        Clipboard.setString(arkOnchainAddress);
                        SimpleToast.show('Copied to clipboard', SimpleToast.SHORT);
                      }}>
                        <Image source={Copy} style={styles.copyIconImage} />
                      </TouchableOpacity>
                    </View>
                    <View style={{ marginTop: 10, padding: 6, backgroundColor: 'white', borderRadius: 4 }}>
                      <QRCode
                        value={arkOnchainAddress}
                        size={100}
                        color="black"
                        backgroundColor="white"
                      />
                    </View>
                  </>
                )}
              </View>
            )}

            {selectedItem === 5 && tab === 2 && (
              // Lift the whole Bark tab body (address row, expanded address,
              // QR, caption) up 40pt. Same paint-only translateY the Bitcoin
              // tab above uses, and for the same reason: a transform moves what
              // is drawn without shifting the layout flow beneath it, so the
              // sheet's own height and the content under it stay put.
              // Landed by eye on device: 50 rode too high, 40 still high, 25 sits
              // right.
              <View style={[styles.liquidTabContent, { transform: [{ translateY: -25 }] }]}>
                {arkAddressError ? (
                  <AddressFetchFailed
                    message={arkAddressError}
                    onRetry={() => {
                      setArkAddressError(null);
                      setAddressReloadTick((n) => n + 1);
                    }}
                  />
                ) : !arkAddress ? (
                  <ActivityIndicator size="large" color="#ffffff" />
                ) : (
                  <>
                    {/* Label and address share one line. As two stacked blocks
                        the heading took a full row to say something the address
                        underneath already implied, and pushed the QR down. */}
                    <View style={styles.addressRow}>
                      <Text semibold style={styles.addressLabel}>
                        Bark Address
                      </Text>
                      {/* Ark addresses are long opaque pubkey hex and do not
                          fit this row, so the row shows first 6 + last 6.
                          Tapping expands the full string below rather than
                          truncating it out of reach: the short form is fine for
                          recognising an address you already have, and useless
                          for reading one out. Copy still ships the full
                          address, unchanged. */}
                      <TouchableOpacity
                        onPress={() => setArkAddressExpanded((v) => !v)}
                        accessibilityRole="button"
                        accessibilityLabel={
                          arkAddressExpanded
                            ? 'Hide the full Bark address'
                            : 'Show the full Bark address'
                        }
                        style={styles.addressValueTap}
                      >
                        <Text semibold style={styles.bitcoinAddressText}>
                          {arkAddress.length > 13
                            ? `${arkAddress.slice(0, 6)}…${arkAddress.slice(-6)}`
                            : arkAddress}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => {
                        Clipboard.setString(arkAddress);
                        SimpleToast.show('Copied to clipboard', SimpleToast.SHORT);
                      }}>
                        <Image source={Copy} style={styles.copyIconImage} />
                      </TouchableOpacity>
                    </View>

                    {/* Expanded form. Wrapped rather than side-scrolled: the
                        whole point is seeing the address at once, and a
                        horizontal scroller hides how much is left. */}
                    {arkAddressExpanded && (
                      <View style={styles.fullAddressBox}>
                        <Text style={styles.fullAddressText}>
                          {arkAddress}
                        </Text>
                      </View>
                    )}
                    {/* 100, matching the Bitcoin tab in this same sheet. It
                        was 50, which was unscannable because an Ark address
                        packs more modules into the square than an on-chain one
                        and each fell under a pixel. 150 and 120 were both too
                        large for the panel. 100 is the floor I would not go
                        below: the white quiet zone around it matters to a
                        decoder as much as the size, hence the padding. */}
                    <View style={{ marginTop: 12, padding: 8, backgroundColor: 'white', borderRadius: 8 }}>
                      <QRCode
                        value={arkAddress}
                        size={100}
                        color="black"
                        backgroundColor="white"
                      />
                    </View>
                    {/* Its own style rather than the address one it used to
                        borrow: at the address's 18pt this caption wrapped onto
                        a second line and pushed the panel taller for no reason.
                        It is a caption, so it is sized like one. */}
                    <Text semibold style={styles.addressCaption} numberOfLines={1}>
                      Receive 0% fee payments from another Bark user
                    </Text>
                  </>
                )}
              </View>
            )}
          </Animated.View>
        </LinearGradient>
      </LinearGradient>
    </>
  );
}

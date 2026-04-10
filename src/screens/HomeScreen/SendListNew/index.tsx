import { Text } from "@Cypher/component-library";
import { GradientView } from "@Cypher/components";
import React, { useContext, useMemo, useState } from "react";
import { ActivityIndicator, Dimensions, Image, ScrollView, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import SimpleToast from "react-native-simple-toast";

import {
  Back,
  CoinOS,
  Cold1,
  Hot,
  StrikeFull,
} from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { colors, widths } from "@Cypher/style-guide";
import styles from "./styles";
import Capsule from "../../HotStorageVault/Capsule";
import { btc as btcHandle } from "@Cypher/helpers/coinosHelper";
import { BlueStorageContext } from "../../../../blue_modules/storage-context";

const SCREEN_WIDTH = Dimensions.get("window").width;
const TILE_WIDTH = Math.floor((SCREEN_WIDTH - 48) * 0.48);

interface Props {
  refRBSheet: any;
  reopenSendSheet: any;
  matchedRate: any;
  matchedRateBTC?: number;
  currency: any;
  wallet: any;
  coldStorageWallet: any;
  receiveType: boolean;
}

export default function SendListNew({ refRBSheet, reopenSendSheet, receiveType, wallet, coldStorageWallet, matchedRate, matchedRateBTC = 0, currency }: Props) {
  const { user, strikeMe, vaultTab, setVaultTab, isAuth, isStrikeAuth, walletID, coldStorageWalletID, strikeUser } = useAuthStore();
  const { sleep } = useContext(BlueStorageContext);
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [utxoList, setUtxoList] = useState<any[]>([]);
  const [loadingUtxos, setLoadingUtxos] = useState(false);
  const [activeVaultWallet, setActiveVaultWallet] = useState<any>(null);

  const hasHotVault = !!walletID;
  const hasColdVault = !!coldStorageWalletID;

  // Animation
  const translateX1 = useSharedValue(0);
  const translateX2 = useSharedValue(SCREEN_WIDTH);

  const animateToSecondView = () => {
    translateX1.value = withTiming(-SCREEN_WIDTH, { duration: 300 });
    translateX2.value = withTiming(0, { duration: 300 });
  };

  const animateToFirstView = () => {
    translateX1.value = withTiming(0, { duration: 300 });
    translateX2.value = withTiming(SCREEN_WIDTH, { duration: 300 });
    setSelectedIds([]);
    setUtxoList([]);
    setActiveVaultWallet(null);
  };

  const view1Style = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX1.value }],
  }));

  const view2Style = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX2.value }],
  }));

  // Load UTXOs when vault is selected
  const loadUtxos = async (vaultWallet: any) => {
    if (!vaultWallet) return;
    setLoadingUtxos(true);
    setActiveVaultWallet(vaultWallet);
    try {
      await Promise.race([vaultWallet.fetchUtxo(), sleep(10000)]);
    } catch (e) {
      console.log('SendListNew: fetchUtxo failed');
    }
    const freshUtxo = vaultWallet.getUtxo(true).sort(
      (a: any, b: any) => a.height - b.height || a.txid.localeCompare(b.txid) || a.vout - b.vout
    );
    setUtxoList(freshUtxo);
    setLoadingUtxos(false);
  };

  const onTilePress = (id: number) => {
    if (id === 1 || id === 2) {
      refRBSheet?.current?.close();
      const params = id === 1
        ? { matchedRate, currency, receiveType: false }
        : { matchedRate, currency, receiveType: true };
      setTimeout(() => {
        dispatchNavigate('SendScreen', params);
      }, 150);
    } else if (id === 3 || id === 4) {
      setSelectedItem(id);
      setSelectedIds([]);
      const vaultWallet = id === 3 ? wallet : coldStorageWallet;
      loadUtxos(vaultWallet);
      animateToSecondView();
    }
  };

  const backClickHandler = () => {
    setSelectedItem(null);
    animateToFirstView();
  };

  const toggleCapsule = (utxoId: string) => {
    setSelectedIds(prev =>
      prev.includes(utxoId) ? prev.filter(id => id !== utxoId) : [...prev, utxoId]
    );
  };

  const { totalBTC, totalUSD } = useMemo(() => {
    let total = 0;
    selectedIds.forEach(id => {
      const found = utxoList.find((u: any) => `${u.txid}:${u.vout}` === id);
      if (found) total += found.value;
    });
    const btcAmount = btcHandle(total);
    const usd = Number(btcAmount) * Number(matchedRateBTC);
    return { totalBTC: btcAmount, totalUSD: usd };
  }, [selectedIds, utxoList, matchedRateBTC]);

  const handleSend = () => {
    if (selectedIds.length === 0) {
      SimpleToast.show("Select capsules to send", SimpleToast.SHORT);
      return;
    }
    const isVault = selectedItem === 4;
    const vaultWallet = selectedItem === 3 ? wallet : coldStorageWallet;
    const capsulesData = utxoList
      .filter((u: any) => selectedIds.includes(`${u.txid}:${u.vout}`))
      .map((u: any) => ({ id: `${u.txid}:${u.vout}`, value: u.value, address: u.address }));
    const capsuleTotal = capsulesData.reduce((acc: number, c: any) => acc + (c.value || 0), 0);

    refRBSheet?.current?.close();
    setTimeout(() => {
      setVaultTab(isVault);
      dispatchNavigate('EditAmount', {
        isEdit: false,
        currency,
        vaultTab: isVault,
        wallet: vaultWallet,
        utxo: utxoList,
        ids: selectedIds,
        maxUSD: totalBTC,
        inUSD: totalUSD.toFixed(2),
        total: totalBTC,
        matchedRate: matchedRateBTC,
        capsulesData,
        capsuleTotal,
      });
    }, 150);
  };

  // Grid tile
  const renderGridTile = (
    id: number, label: string, subtitle: string, icon: any, iconStyle: any,
    isEnabled: boolean, accentColor: string, shadowColor: string,
  ) => {
    const isLogo = id === 1 || id === 2;
    return (
      <View style={{ width: TILE_WIDTH, opacity: isEnabled ? 1 : 0.3 }} pointerEvents={isEnabled ? 'auto' : 'none'}>
        <GradientView
          onPress={() => isEnabled && onTilePress(id)}
          style={{ shadowColor: "#040404", shadowOffset: { width: 6, height: 6 }, shadowOpacity: 0.7, shadowRadius: 12, elevation: 6, height: 100, width: TILE_WIDTH }}
          linearGradientStyle={{ shadowColor: "#27272C", shadowOffset: { width: -6, height: -6 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6, height: 100, width: TILE_WIDTH }}
          topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowColor, shadowRadius: 3, borderRadius: 20, width: TILE_WIDTH, height: 100, justifyContent: "center" }}
          bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 0.5, shadowColor, borderRadius: 20, width: TILE_WIDTH, height: 100, justifyContent: "center", position: "absolute" }}
          linearGradientStyleMain={{ borderRadius: 20, height: 100, justifyContent: "center", alignItems: "center", width: TILE_WIDTH }}
          gradiantColors={[colors.black.bg, colors.black.bg]}
        >
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
            {isLogo ? (
              <Image source={icon} style={{ width: 90, height: 32, marginBottom: 6 }} resizeMode="contain" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Image source={icon} style={iconStyle} resizeMode="contain" />
                <Text bold style={{ fontSize: 16, marginLeft: 6 }}>{label}</Text>
              </View>
            )}
            <Text style={{ fontSize: 11, color: '#888', textAlign: 'center' }} numberOfLines={2}>{subtitle}</Text>
          </View>
        </GradientView>
      </View>
    );
  };

  const isVaultCold = selectedItem === 4;
  const primaryColor = isVaultCold ? colors.coldGreen : colors.green;

  // Get memo/label for a UTXO
  const getMemo = (item: any): string | null => {
    if (!activeVaultWallet?.getUTXOMetadata) return null;
    try {
      const { memo } = activeVaultWallet.getUTXOMetadata(item.txid, item.vout);
      return memo && memo !== "" ? memo : null;
    } catch { return null; }
  };

  // Capsule mini tile
  const renderCapsuleTile = (item: any) => {
    const utxoId = `${item.txid}:${item.vout}`;
    const isSelected = selectedIds.includes(utxoId);
    const memo = getMemo(item);
    return (
      <TouchableOpacity
        key={utxoId}
        activeOpacity={0.7}
        onPress={() => toggleCapsule(utxoId)}
        style={{
          width: (SCREEN_WIDTH - 48) / 3,
          height: 58,
          marginBottom: 8,
          marginHorizontal: 2,
          borderRadius: 10,
          borderWidth: isSelected ? 1.6 : 1,
          borderColor: isSelected ? primaryColor : '#444',
          backgroundColor: '#1a1a1a',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 6,
          paddingVertical: 4,
          shadowColor: isSelected ? primaryColor : '#000',
          shadowOffset: { width: 0, height: isSelected ? 0 : 2 },
          shadowOpacity: isSelected ? 0.6 : 0.4,
          shadowRadius: isSelected ? 8 : 4,
          elevation: isSelected ? 8 : 3,
        }}
      >
        <View style={{ width: '100%', height: 14, marginBottom: 2, marginLeft: 34 }}>
          <Capsule item={item} wallet={null} onPress={() => {}} handleChoose={() => {}} ids={[]} vaultTab={isVaultCold} />
        </View>
        <Text numberOfLines={1} style={{ fontSize: 10, color: isVaultCold ? colors.coldGreen : colors.green, fontStyle: memo ? 'normal' : 'italic', marginTop: 6 }}>
          {memo || '(not labeled)'}
        </Text>
      </TouchableOpacity>
    );
  };

  // Send button width to match vault capsule screen
  const SEND_BTN_W = (widths / 2) - 30;

  return (
    <>
      <LinearGradient
        start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }}
        colors={[colors.pink.gradient1, colors.pink.gradient2]}
        style={styles.gradientLine}
      >
        <LinearGradient
          start={{ x: 1, y: 0 }} end={{ x: 1, y: 1 }}
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

          {/* ======= FIRST VIEW: 2x2 Grid ======= */}
          <Animated.View style={[{}, view1Style]}>
            <View style={{ paddingHorizontal: 24, marginTop: 20 }}>
              <Text h2 bold style={{ alignSelf: 'center', marginBottom: 16 }}>SEND FROM</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                {renderGridTile(1, 'Strike', 'Lightning Network', StrikeFull, {}, isStrikeAuth, '#FF65D4', colors.pink.shadowTopNew)}
                {renderGridTile(2, 'CoinOS', 'Lightning Network', CoinOS, {}, isAuth, '#FF65D4', colors.pink.shadowTopNew)}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                {renderGridTile(3, 'Hot Vault', 'On-chain capsules', Hot, { width: 22, height: 30, marginEnd: 2 }, hasHotVault, colors.green, colors.greenShadow)}
                {renderGridTile(4, 'Cold Vault', 'On-chain capsules', Cold1, { width: 30, height: 22, marginEnd: 2 }, hasColdVault, colors.coldGreen, colors.blueText)}
              </View>
            </View>
          </Animated.View>

          {/* ======= SECOND VIEW: Capsule Submenu ======= */}
          <Animated.View style={[{ position: "absolute", width: '100%', height: '100%' }, view2Style]}>
            <View style={{ flex: 1, paddingHorizontal: 12, paddingTop: 12 }}>
              {/* Header — centered */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 10, position: 'relative' }}>
                <TouchableOpacity onPress={backClickHandler} style={{ position: 'absolute', left: 0 }}>
                  <Image source={Back} style={{ width: 24, height: 22 }} resizeMode="contain" />
                </TouchableOpacity>
                <Image
                  source={selectedItem === 3 ? Hot : Cold1}
                  style={{ width: 20, height: 20, marginRight: 6 }}
                  resizeMode="contain"
                />
                <Text bold style={{ fontSize: 16 }}>
                  {selectedItem === 3 ? 'Hot Vault' : 'Cold Vault'}
                </Text>
              </View>

              {/* Instruction text + cheatsheet link */}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, marginBottom: 2 }}>
                <Text style={{ fontSize: 13, color: '#999', flex: 1, marginLeft: 40 }}>
                  Select the utxo capsules you want to spend from:
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    reopenSendSheet.current = true;
                    refRBSheet?.current?.close();
                    setTimeout(() => dispatchNavigate('CapsuleCatalog'), 200);
                  }}
                  style={{
                    marginRight: 20,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    borderWidth: 1.5,
                    borderColor: primaryColor,
                    backgroundColor: 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text bold style={{ color: primaryColor, fontSize: 13 }}>?</Text>
                </TouchableOpacity>
              </View>

              {/* Capsule grid — full width, scrollable */}
              {loadingUtxos ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator size="large" color={primaryColor} />
                </View>
              ) : utxoList.length === 0 ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#888' }}>No capsules in this vault</Text>
                </View>
              ) : (
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    justifyContent: 'flex-start',
                    paddingHorizontal: 4,
                    paddingBottom: 6,
                  }}
                  style={{ maxHeight: Dimensions.get('window').height * 0.30, marginTop: 10 }}
                >
                  {utxoList.map((item: any) => renderCapsuleTile(item))}
                </ScrollView>
              )}

              {/* Bottom: BTC box + USD + Send — one line */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingBottom: 14, paddingTop: 8, paddingLeft: 10 }}>
                <View style={{
                  backgroundColor: '#111',
                  borderRadius: 21,
                  borderWidth: 1,
                  borderColor: selectedIds.length > 0 ? primaryColor : '#555',
                  width: 115,
                  height: 42,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Text bold style={{ fontSize: 13, color: '#fff' }} numberOfLines={1}>
                    {totalBTC} BTC
                  </Text>
                </View>
                <Text bold style={{ fontSize: 13, color: '#aaa', marginHorizontal: 6 }} numberOfLines={1}>
                  ~${totalUSD.toFixed(2)}
                </Text>
                <GradientView
                    onPress={handleSend}
                    style={{
                      shadowColor: '#040404',
                      shadowOffset: { width: 4, height: 4 },
                      shadowOpacity: 0.80,
                      shadowRadius: 8,
                      elevation: 6,
                    }}
                    linearGradientStyle={{
                      shadowColor: '#27272C',
                      shadowOffset: { width: -4, height: -4 },
                      shadowOpacity: 0.48,
                      shadowRadius: 6,
                      elevation: 6,
                      flex: 1,
                    }}
                    topShadowStyle={{
                      shadowOffset: { width: 2, height: 2 },
                      shadowRadius: 2,
                      shadowOpacity: 2,
                      shadowColor: isVaultCold ? colors.coldGreen : colors.greenShadow,
                      borderRadius: 22,
                      width: 135,
                      height: 44,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                    bottomShadowStyle={{
                      shadowOffset: { width: -2, height: -2 },
                      shadowRadius: 2,
                      shadowOpacity: 0.64,
                      shadowColor: isVaultCold ? colors.coldGreen : colors.greenShadowLight,
                      borderRadius: 22,
                      width: 135,
                      height: 44,
                      justifyContent: 'center',
                      position: 'absolute',
                    }}
                    linearGradientStyleMain={{
                      borderRadius: 22,
                      height: 44,
                      justifyContent: 'center',
                      width: 135,
                    }}
                  >
                    <Text bold center style={{ fontSize: 15 }}>Send</Text>
                  </GradientView>
              </View>
            </View>
          </Animated.View>
        </LinearGradient>
      </LinearGradient>
    </>
  );
}

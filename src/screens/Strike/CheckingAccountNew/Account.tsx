import React, { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { Card, GradientView, StrikeView } from "@Cypher/components";
import { Text } from "@Cypher/component-library";
import { colors, widths } from "@Cypher/style-guide";
import styles from "./styles";
import useAuthStore from "@Cypher/stores/authStore";
import { ArkSettingsBody } from "./Settings";

import { btc } from "@Cypher/helpers/coinosHelper";
import { blocksToDays } from "@Cypher/services/ark";
import { getCapsuleColorBand } from "@Cypher/helpers/arkCapsuleColor";

interface AccountProps {
  matchedRate: string;
  currency: any;
  receiveType: boolean;
  balance: any;
  converted: any;
  reserveAmount: any;
  withdrawThreshold: any;
  isArk?: boolean;
}

export default function Account({ matchedRate, currency, receiveType, balance, converted, reserveAmount, withdrawThreshold, isArk = false }: AccountProps) {
  const {
    clearAuth,
    withdrawArkThreshold,
    reserveArkAmount,
  } = useAuthStore();
  const arkVtxos = useAuthStore((s) => s.arkVtxos);
  const navigation = useNavigation();

  // Mirror ArkWallet's pendingRound derivation so the in-tab Ark Card
  // surfaces the same "Refreshing N capsules · X sats" pulsing line the
  // homescreen card does (see Card's `refreshingInfo` prop). Without
  // this, the Vault menu's Ark Card would display "0 sats ~ $0.00"
  // whenever the homescreen card was correctly showing a refresh in
  // flight, contradicting the home view.
  const pendingRoundSats = useMemo(
    () => arkVtxos.reduce(
      (sum, v) => (v.state.toLowerCase() === 'locked' ? sum + v.sats : sum),
      0,
    ),
    [arkVtxos],
  );
  const pendingRoundCount = useMemo(
    () => arkVtxos.reduce(
      (n, v) => (v.state.toLowerCase() === 'locked' ? n + 1 : n),
      0,
    ),
    [arkVtxos],
  );

  // Same per-VTXO capsule-slot data as the homescreen ArkWallet card —
  // see ArkWallet/index.tsx for the rationale. Kept in sync visually so
  // the Vault tab's Card shows identical pills to the home card.
  const arkChainTipHeight = useAuthStore((s) => s.arkChainTipHeight);
  const arkCapsuleSlots = useMemo(() => {
    if (arkChainTipHeight === null) return undefined;
    return arkVtxos
      .filter((v) => v.state.toLowerCase() !== 'spent')
      .map((v) => {
        const daysLeft = v.expiryHeight > 0
          ? Math.max(0, blocksToDays(v.expiryHeight - arkChainTipHeight))
          : 30;
        return {
          color: getCapsuleColorBand(daysLeft).color,
          refreshing: v.state.toLowerCase() === 'locked',
          daysLeft,
        };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .map(({ color, refreshing }) => ({ color, refreshing }));
  }, [arkVtxos, arkChainTipHeight]);

  const handleCoinosLogout = () => {
    clearAuth();
    setTimeout(() => {
      navigation.goBack();
    }, 500);
  };

  console.log('balance: ', balance, 'converted: ', converted, 'currency: ', currency);

  // Ark branch — non-custodial, no fiat sub-balance, no Strike box. Just the
  // Ark-branded Card + a yellow logout CTA. (We deliberately route the same
  // CheckingAccountNew screen for layout/parity with Strike+CoinOS, so users
  // get a familiar tabs-and-card shape regardless of provider.)
  if (isArk) {
    // Ark Card: no threshold/reserve UI. Ark is self-custodial — the
    // custodial-balance "withdraw above X" nudge that Strike/CoinOS use
    // to manage counterparty-risk exposure has no analogue here. The
    // ArkThreshold dual-picker also lived on this tab but is gone for
    // the same reason. We still pass the threshold/reserve props to
    // Card so the threshold-met glow logic doesn't trip on undefined,
    // but Card itself short-circuits the threshold bar render for
    // wallet === 'ARK' (see Card/index.tsx).
    const arkThresholdSats = Number(withdrawArkThreshold) || 500_000;
    const arkReserveSats = Number(reserveArkAmount) || 100_000;
    return (
      <View style={{ flex: 1 }}>
        {/* Card sits in a centered row above the scrolling actions
            panel — mirrors the original Strike/CoinOS isArk layout's
            `styles.container2` centering (alignItems: 'center') so
            the Card holds the same horizontal position as before the
            Settings → Vault move. Centering on this wrapper only —
            ArkSettingsBody below manages its own layout. */}
        <View style={{ marginTop: 20, alignItems: 'center' }}>
          <Card
            wallet="ARK"
            title="Ark Vault"
            balance={Number(balance)}
            currency={currency}
            matchedRate={Number(matchedRate)}
            convertedRate={Number(converted)}
            reserveAmount={arkReserveSats}
            withdrawThreshold={arkThresholdSats}
            receiveType={receiveType}
            refreshingInfo={pendingRoundCount > 0
              ? { count: pendingRoundCount, sats: pendingRoundSats }
              : null}
            arkCapsuleSlots={arkCapsuleSlots}
          />
        </View>
        {/* Day-to-day vault management — auto-refresh toggle, Emergency
            Exit flow, Delete Ark vault. ArkSettingsBody owns its own
            ScrollView, so it scrolls below the (fixed) balance card. */}
        <ArkSettingsBody view="actions" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container2}>
      <View style={{ marginTop: 20 }}>
        <Card
          balance={Number(balance)}
          currency={currency}
          matchedRate={Number(matchedRate)}
          convertedRate={Number(converted)}
          reserveAmount={Number(reserveAmount)}
          withdrawThreshold={Number(withdrawThreshold)}
          receiveType={receiveType}
          wallet={receiveType ? 'COINOS' : 'STRIKE'}
        />
      </View>
      {!receiveType &&
        <View style={{ marginTop: 20 }}>
          <StrikeView currency={currency} matchedRateStrike={Number(matchedRate)} isShowButtons />
        </View>
      }
      {receiveType &&
        <GradientView
          style={{ marginTop: 60, alignSelf: 'center', height: 38, width: widths * 0.26, shadowColor: '#040404', shadowOffset: { width: 8, height: 8 }, shadowOpacity: 0.8, shadowRadius: 16, elevation: 8 }}
          linearGradientStyle={{ shadowColor: '#27272C', shadowOffset: { width: -8, height: -8 }, shadowOpacity: 0.48, shadowRadius: 12, elevation: 8 }}
          topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowRadius: 2, shadowColor: '#E85C5A', borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', alignItems: 'center' }}
          bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 1, shadowColor: '#030303', borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', position: 'absolute' }}
          linearGradientStyleMain={{ borderRadius: 24, height: 38, width: widths * 0.26, justifyContent: 'center', alignItems: 'center' }}
          onPress={handleCoinosLogout}
        >
          <Text h3 bold center>Logout</Text>
        </GradientView>
      }
    </ScrollView>
  );
}

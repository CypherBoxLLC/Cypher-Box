import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { Card, GradientView, StrikeView } from "@Cypher/components";
import { Text } from "@Cypher/component-library";
import { colors, widths } from "@Cypher/style-guide";
import styles from "./styles";
import useAuthStore from "@Cypher/stores/authStore";
import ArkThreshold from "./ArkThreshold";

import { btc } from "@Cypher/helpers/coinosHelper";

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
  const navigation = useNavigation();

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
    // Ark Card mirrors the Strike one for layout parity, but its threshold
    // and reserve come from dedicated Ark slots in the auth store rather
    // than the shared withdrawThreshold/reserveAmount props passed in
    // (those are CoinOS-rail specific). The ArkThreshold component below
    // owns the dual-picker UI for editing both values.
    const arkThresholdSats = Number(withdrawArkThreshold) || 500_000;
    const arkReserveSats = Number(reserveArkAmount) || 100_000;
    return (
      <ScrollView contentContainerStyle={styles.container2}>
        <View style={{ marginTop: 20 }}>
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
          />
        </View>

        {/* Threshold + reserve picker UI. Strike-style chevron-down
            dropdowns for both, with a "Customize" link to the keypad
            screen for free entry. Wired to withdrawArkThreshold and
            reserveArkAmount in the store. */}
        <ArkThreshold matchedRate={matchedRate} currency={currency} />
      </ScrollView>
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

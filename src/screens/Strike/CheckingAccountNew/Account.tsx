import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { Card, GradientView, StrikeView } from "@Cypher/components";
import { Text } from "@Cypher/component-library";
import { widths } from "@Cypher/style-guide";
import styles from "./styles";
import useAuthStore from "@Cypher/stores/authStore";

import { btc } from "@Cypher/helpers/coinosHelper";

export default function Account({ matchedRate, currency, receiveType, balance, converted, reserveAmount, withdrawThreshold }: { matchedRate: string; currency: any; receiveType: boolean, balance: any, converted: any, reserveAmount: any, withdrawThreshold: any }) {
  const { clearAuth } = useAuthStore();
  const navigation = useNavigation();

  const handleCoinosLogout = () => {
    clearAuth();
    setTimeout(() => {
      navigation.goBack();
    }, 500);
  };

  console.log('balance: ', balance, 'converted: ', converted, 'currency: ', currency);
  return (
    <ScrollView contentContainerStyle={styles.container2}>
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
      {!receiveType &&
        <StrikeView currency={currency} matchedRate={Number(matchedRate)} isShowButtons />
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

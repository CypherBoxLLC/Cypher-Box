import React from "react";
import { ScrollView } from "react-native";

import { Card, StrikeView } from "@Cypher/components";
import styles from "./styles";

import { btc } from "@Cypher/helpers/coinosHelper";

export default function Account({ matchedRate, currency, receiveType, balance, converted, reserveAmount, withdrawThreshold }: { matchedRate: string; currency: any; receiveType: boolean, balance: any, converted: any, reserveAmount: any, withdrawThreshold: any }) {
  // const currency = btc(1);

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
      />
      {!receiveType &&
        <StrikeView currency={currency} matchedRate={Number(matchedRate)} isShowButtons />
      }
    </ScrollView>
  );
}

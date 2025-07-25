import React from "react";
import { ScrollView } from "react-native";

import { Card, StrikeView } from "@Cypher/components";
import styles from "./styles";

import { btc } from "@Cypher/helpers/coinosHelper";

export default function Account({ matchedRate, wallet, }: { matchedRate: string; wallet:string; }) {
  const currency = btc(1);

  return (
    <ScrollView contentContainerStyle={styles.container2}>
      <Card
        balance={0}
        convertedRate={0}
        reserveAmount={0}
        withdrawThreshold={0}
        wallet={wallet}
      />
      <StrikeView currency={currency} matchedRate={Number(matchedRate)} isShowButtons />
    </ScrollView>
  );
}

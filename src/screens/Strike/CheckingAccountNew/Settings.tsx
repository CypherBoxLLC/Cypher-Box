import { StrikeFull } from "@Cypher/assets/images";
import { GradientSwitch, Input, Text } from "@Cypher/component-library";
import React from "react";
import {
  Image,
  Animated as RNAnimated,
  ScrollView,
  View,
} from "react-native";
import styles from "./styles";

import { GradientCard } from "@Cypher/components";

export default function Settings() {

  return (
    <ScrollView style={styles.flex}>
        <RNAnimated.View style={styles.main}>
          <View style={styles.settingView}>
            <Text bold style={styles.text}>
              Lightning address: info@cypherbox.io
            </Text>
            <View style={styles.usernameContainer}>
              <Text
                bold
                style={{ marginStart: 5, marginEnd: 10, fontSize: 18 }}
              >
                Sat
              </Text>
              <GradientSwitch />
              <Text
                bold
                style={{ marginStart: 10, marginEnd: 5, fontSize: 18 }}
              >
                BTC
              </Text>
            </View>
            <View style={styles.usernameContainer}>
              <Text
                bold
                style={{ marginStart: 5, marginEnd: 30, fontSize: 18 }}
              >
                Face ID
              </Text>
              <GradientSwitch colors_={["#E8EAEA", "#B6B6B6"]} />
            </View>
            <View style={styles.usernameContainer}>
              <Text
                bold
                style={{ marginStart: 5, marginEnd: 10, fontSize: 18 }}
              >
                Username
              </Text>
              <GradientCard
                style={styles.usernameCard}
                linearStyle={styles.usernameCardLinear}
              >
                <Input
                  value="CypherBox LLC"
                  onChange={() => {}}
                  editable={false}
                  style={{ margin: 1 }}
                  textInputStyle={styles.usernameInput}
                />
              </GradientCard>
            </View>
            <Text h3 bold style={styles.bankDepositText}>
              Bank deposit
            </Text>
            <Text h3 bold style={styles.bankDepositText}>
              $15,000.00 remaining
            </Text>
            <Text h3 bold style={styles.bankDepositText}>
              $15,000.00 per week
            </Text>
            <Text h4 style={styles.supportText}>
              Are you experiencing any errors in your balance or other issues
              related to your Strike Account?
            </Text>
            <Text h4 style={styles.supportText}>
              1- Troubleshoot your account from Strike app
            </Text>
            <Text h4>
              2- Contact <Text style={styles.supportLink}>Strike support</Text>
            </Text>
            <Text h4 style={styles.supportText}>
              Issue with our API connection?{" "}
              <Text style={styles.supportLink}>Report here</Text>
            </Text>
          </View>
          <Image
            source={StrikeFull}
            style={styles.strikeImage}
            resizeMode="contain"
          />
        </RNAnimated.View>
    </ScrollView>
  );
}

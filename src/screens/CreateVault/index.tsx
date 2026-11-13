import React from "react";
import { Image, StyleSheet, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import LinearGradient from "react-native-linear-gradient";
import SavingVault from "../SavingVault";
import { Shadow } from "react-native-neomorph-shadows";
import { Back } from "@Cypher/assets/images";
import LinearGradientButton from "./LinearGradientButton";
import loc from "../../../loc";

export default function CreateVault() {

    const hotVaultClickHandler = () => { }

    const coldVaultClickHandler = () => { }

    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text bold subHeader style={styles.title}>{loc.cypherbox.vault.create_vault.title}</Text>
                    <LinearGradientButton warningText={loc.cypherbox.vault.create_vault.intermediate} text={loc.cypherbox.vault.create_vault.create_hot_vault} onPress={hotVaultClickHandler} />
                    <LinearGradientButton warningText={loc.cypherbox.vault.create_vault.advanced} text={loc.cypherbox.vault.create_vault.create_cold_vault} onPress={hotVaultClickHandler} />
                </View>
            </View>
        </ScreenLayout>
    )
}

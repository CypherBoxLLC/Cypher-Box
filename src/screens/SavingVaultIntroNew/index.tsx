import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import LinearGradient from "react-native-linear-gradient";
import loc from "../../../loc";

export default function SavingVaultIntroNew() {

    const riskClickHandler = () => {
        console.log('next click');
        dispatchNavigate('CreateVault');
    }

    const homeClickHandler = () => { }

    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text bold subHeader style={styles.title}>{loc.cypherbox.vault.saving_vault_intro_new.title}</Text>
                    <Text bold h3 style={styles.descption}>{loc.formatString(loc.cypherbox.vault.saving_vault_intro_new.warning, { careful: <Text bold h3 style={StyleSheet.flatten([styles.descption, { color: '#FFC92C' }])}>{loc.cypherbox.vault.saving_vault_intro_new.careful}</Text> })}</Text>
                    <Text bold h3 style={StyleSheet.flatten([styles.descption, { color: colors.green, marginTop: 0 }])}>
                        <Text bold h3 >
                            {loc.cypherbox.vault.saving_vault_intro_new.already_have_one}
                        </Text> {loc.cypherbox.vault.saving_vault_intro_new.recover}
                    </Text>
                </View>
                <Button text={loc.cypherbox.vault.saving_vault_intro_new.home} onPress={homeClickHandler} style={styles.button} textStyle={styles.btnText} />
                <TouchableOpacity onPress={riskClickHandler}>
                    <LinearGradient
                        colors={[colors.black.top, colors.black.bottom]}
                        start={{ x: 1, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        locations={[0.25, 1]}
                        style={styles.linearGradient}>
                        <Text h3 style={styles.buttonText}>
                            {loc.cypherbox.vault.saving_vault_intro_new.understand_risks}
                        </Text>
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </ScreenLayout>
    )
}

import React from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";

import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { colors } from "@Cypher/style-guide";

import styles from "./styles";

/**
 * What the user reads before the USDT card appears on Home.
 *
 * Follows SavingVaultIntroNew: the risks first, an acknowledgement second,
 * and no way to reach the feature that skips this screen. The difference is
 * that nothing is created at the end of it. The Tron account already exists,
 * derived from the Hot Vault seed, so this screen is the only thing standing
 * between the user and a live USDT balance, which is why the provider list
 * and the custody wording are here rather than in a help article.
 */
export default function UsdtSwapsIntro() {
    const understoodClickHandler = () => {
        dispatchNavigate('UsdtSwapsAddress');
    };

    const homeClickHandler = () => {
        dispatchReset('HomeScreen');
    };

    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text bold subHeader style={styles.title}>Bitcoin and USDT</Text>

                    <ScrollView showsVerticalScrollIndicator={false}>
                        <Text bold style={styles.description}>
                            <Text bold style={StyleSheet.flatten([styles.description, styles.caution])}>Careful: </Text>
                            this feature moves your money through other companies and across another
                            blockchain. Read this before you turn it on.
                        </Text>

                        <Text bold style={styles.sectionTitle}>What it does</Text>
                        <Text bold style={styles.description}>
                            It gives you a Tron address that holds USDT, a dollar token issued by Tether.
                            You can receive USDT to it and swap that USDT into bitcoin, which lands in your
                            own wallet. USDT is not bitcoin, and while you hold it you are holding a
                            company's promise of a dollar rather than bitcoin.
                        </Text>

                        <Text bold style={styles.sectionTitle}>Who is involved</Text>
                        <Text bold style={styles.description}>
                            Tether issues USDT and can freeze any USDT balance, including yours.
                            The Tron network carries it. Flashnet performs the swap and uses Relay to
                            collect your deposit. Cypher Box pays the Tron network fee on your deposit
                            through its own server, which is why a swap needs a connection to us.
                            None of them hold your bitcoin, and none of them can move your USDT without
                            your signature, but a swap in flight depends on all of them.
                        </Text>

                        <Text bold style={styles.sectionTitle}>Your keys</Text>
                        <Text bold style={styles.description}>
                            Your USDT address comes from your Hot Vault recovery phrase. There is no second
                            phrase to write down: the words you already backed up restore your dollars as
                            well as your bitcoin, in this app or in any other wallet that supports Tron.
                            The reverse is also true. If you lose that phrase you lose both, and nobody,
                            including us, can recover either.
                        </Text>

                        <Text bold style={styles.sectionTitle}>What it costs and what can go wrong</Text>
                        <Text bold style={styles.description}>
                            Every swap pays a fixed network cost regardless of size, so small swaps lose a
                            large share of themselves. There is a minimum for that reason, shown on the next
                            screens. A swap is not instant and cannot be reversed once it starts. If one
                            fails, Flashnet refunds the USDT to the address it came from, which is yours.
                        </Text>
                    </ScrollView>
                </View>

                <Button text="Not now" onPress={homeClickHandler} style={styles.button} textStyle={styles.btnText} />
                <TouchableOpacity onPress={understoodClickHandler}>
                    <LinearGradient
                        colors={[colors.black.top, colors.black.bottom]}
                        start={{ x: 1, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        locations={[0.25, 1]}
                        style={styles.linearGradient}>
                        <Text h3 style={styles.buttonText}>
                            I understand the risks
                        </Text>
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </ScreenLayout>
    )
}

import React from "react";
import { ScrollView, View } from "react-native";

import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { UsdtWallet } from "@Cypher/components";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { HOT_VAULT_FLOW_STEPS } from "@Cypher/services/tron/config";
import { colors } from "@Cypher/style-guide";

import styles from "./styles";

/**
 * The last step of Hot Vault creation, shown after "Hot Vault created!".
 *
 * USDT comes with the Hot Vault: the Tron account is derived from the phrase
 * the user just wrote down. So this is not a separate sign-up, it is the point
 * in the vault flow where the user first sees what they got. The card is a
 * preview (a sample balance, buttons as shapes only), since there is nothing
 * to do with it yet; the working card is on Home.
 *
 * The copy leads with the recovery phrase because that is the one thing the
 * user must not get wrong: it is the same phrase as the vault's, so the backup
 * they just made covers this too.
 *
 * Home is reached from here with isComplete, the flag SavingVaultCreated used
 * to send directly. Dropping it would silently lose Home's post-creation state
 * now that this screen sits between the two.
 */
export default function UsdtSwapsCreated() {
    const homeClickHandler = () => {
        dispatchReset('HomeScreen', { isComplete: true });
    };

    return (
        <ScreenLayout
            disableScroll
            showToolbar
            progress={HOT_VAULT_FLOW_STEPS - 1}
            progressSteps={HOT_VAULT_FLOW_STEPS}
            color={[colors.usdt.light, colors.usdt.main]}
            isBackButton={false}
            isClose
            onBackPress={homeClickHandler}
        >
            <View style={styles.container}>
                <Text style={styles.title} center>Bitcoin-USDT swaps ready</Text>

                <View style={styles.inner}>
                    <UsdtWallet preview />

                    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                        <Text bold style={styles.sectionTitle}>Your recovery phrase</Text>
                        <Text bold style={styles.description}>
                            Your USDT uses the same recovery phrase as the Hot Vault you just created. There is
                            nothing new to write down: that one phrase restores your bitcoin and your dollars
                            together.
                        </Text>

                        <Text bold style={styles.sectionTitle}>Receiving USDT</Text>
                        <Text bold style={styles.description}>
                            Your address accepts USDT on Tron and nothing else. Whoever sends it pays the
                            Tron network fee, so receiving costs you nothing.
                        </Text>

                        <Text bold style={styles.sectionTitle}>Sending USDT out</Text>
                        <Text bold style={styles.description}>
                            Sending USDT on Tron costs the network a fee. Cypher Box pays it for you on
                            swaps, which is why a swap needs a connection to us.
                        </Text>
                    </ScrollView>
                </View>
            </View>
            <Button
                text="Home"
                onPress={homeClickHandler}
                style={styles.button}
                textStyle={styles.btnText}
            />
        </ScreenLayout>
    )
}

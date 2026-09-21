import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { UsdtWallet } from "@Cypher/components";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { getTronConversionTerms, type TronConversionTerms } from "@Cypher/api/flashnetAPIs";
import { colors } from "@Cypher/style-guide";

import styles from "./styles";

/** A fee fraction as a percentage string, for copy rather than for arithmetic. */
function asPercent(fraction: string): string {
    const value = Number(fraction);
    if (!Number.isFinite(value)) return '';
    return `${(value * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

/** A USDT figure rounded for reading, not for quoting. */
function asDollars(amount: string): string {
    const value = Number(amount);
    if (!Number.isFinite(value)) return '';
    return `$${value.toFixed(2)}`;
}

/**
 * The last step of Hot Vault creation, shown after "Hot Vault Created!".
 *
 * USDT comes with the Hot Vault: the Tron account is derived from the phrase
 * the user just wrote down. So this is not a separate sign-up, it is the point
 * in the vault flow where the user first sees what they got, with the card
 * above and what a swap costs below.
 *
 * Home is reached from here with isComplete, the flag SavingVaultCreated used
 * to send directly. Dropping it would silently lose Home's post-creation state
 * now that this screen sits between the two.
 *
 * The figures come from the backend, through the same call the amount screen
 * will price a real conversion with, so this screen cannot drift from what a
 * swap actually charges. When the backend cannot answer, that call falls back
 * to measured figures rather than throwing, and the copy says "about" for
 * exactly that reason.
 */
export default function UsdtSwapsCreated() {
    const [terms, setTerms] = useState<TronConversionTerms | null>(null);

    useEffect(() => {
        let alive = true;
        // Never throws: it answers with measured fallbacks when our backend is
        // asleep, so there is no error state to render here.
        void getTronConversionTerms().then(next => {
            if (alive) setTerms(next);
        });
        return () => {
            alive = false;
        };
    }, []);

    const homeClickHandler = () => {
        dispatchReset('HomeScreen', { isComplete: true });
    };

    return (
        <ScreenLayout disableScroll showToolbar progress={2} color={[colors.usdt.light, colors.usdt.main]} isBackButton={false} isClose onBackPress={homeClickHandler}>
            <View style={styles.container}>
                <Text style={styles.title} center>Bitcoin-USDT swaps ready</Text>

                <View style={styles.inner}>
                    <UsdtWallet />

                    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                        <Text bold style={styles.sectionTitle}>Receiving USDT</Text>
                        <Text bold style={styles.description}>
                            Your address accepts USDT on Tron and nothing else. Whoever sends it pays the
                            Tron network fee, so receiving costs you nothing.
                        </Text>

                        <Text bold style={styles.sectionTitle}>Swapping USDT for bitcoin</Text>
                        <View style={styles.row}>
                            <Text bold style={styles.rowLabel}>Smallest swap</Text>
                            <Text bold style={styles.rowValue}>
                                {terms ? `${terms.minimum} USDT` : '...'}
                            </Text>
                        </View>
                        <View style={styles.row}>
                            <Text bold style={styles.rowLabel}>Moving your deposit, fixed per swap</Text>
                            <Text bold style={styles.rowValue}>
                                {terms ? `about ${asDollars(terms.charge)}` : '...'}
                            </Text>
                        </View>
                        <View style={styles.row}>
                            <Text bold style={styles.rowLabel}>Our fee</Text>
                            <Text bold style={styles.rowValue}>
                                {terms ? `${asPercent(terms.rateFee)} plus ${asDollars(terms.flatFee)}` : '...'}
                            </Text>
                        </View>
                        <Text bold style={styles.description}>
                            The fixed parts cost the same on a small swap as on a large one, which is why
                            there is a minimum. Swapping the minimum loses a much larger share of itself
                            than swapping several times that.
                        </Text>
                        <Text style={styles.note}>
                            You always see the exact amount of bitcoin you will receive before you confirm,
                            and that figure is what the swap pays. These are what to expect, not a quote.
                        </Text>

                        <Text bold style={styles.sectionTitle}>Sending USDT out</Text>
                        <Text bold style={styles.description}>
                            Sending USDT on Tron costs the network a fee. Cypher Box pays it for you on
                            swaps, which is why a swap needs a connection to us.
                        </Text>

                        <Text bold style={styles.sectionTitle}>Your backup</Text>
                        <Text bold style={styles.description}>
                            Your Hot Vault recovery phrase restores this address too. There is nothing extra
                            to write down and nothing extra to lose.
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

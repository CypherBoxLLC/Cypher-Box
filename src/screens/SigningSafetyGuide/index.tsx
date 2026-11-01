import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { getBuildNumber, getVersion } from "react-native-device-info";

import { Button, ScreenLayout } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import { Body, Row, Section } from "../VerifyTransactionGuide";

/**
 * "Signing safely": what a tampered signer can leak through its signatures, and how to keep a phone that signs for a
 * Cold Vault trustworthy. Reached from the line on the Cold Vault's "Transaction signing" export screen, from the
 * Hot Vault's signed-transaction screen, and once before a phone's first Hot Vault "Sign a transaction", when
 * `onContinue` carries on to the scanner.
 *
 * The phone checklist is for one setup only: a Hot Vault on an offline phone signing for a watch-only wallet on an
 * online phone, which may be a Cypher Box Cold Vault or another app. Everyday Hot Vault users and hardware-wallet users can reach the guide too (the export screen line
 * is shown to every Cold Vault), so it opens by telling each of them whether it applies.
 */
export default function SigningSafetyGuide({ route, navigation }: { route: any; navigation: any }) {
    const onContinue = route?.params?.onContinue;

    const carryOn = () => {
        navigation.goBack();
        onContinue();
    };

    return (
        // disableScroll: the guide scrolls itself, so the button below stays on screen instead of scrolling away
        <ScreenLayout showToolbar isBackButton disableScroll title="Signing safely">
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                {/* who it is for comes first: most readers use the Hot Vault day to day or sign with a hardware
                    wallet, and the phone checklist below is not for them */}
                <Section title="Is this for you?">
                    <Row
                        title="Hot Vault as your everyday wallet"
                        body="You send and receive with the Hot Vault on this phone. Nothing to do here."
                    />
                    <Row
                        title="Cold Vault signed by a hardware wallet"
                        body="A device like a Coldcard or Jade signs, not a phone. The phone checklist below isn't for you. Just install the device's firmware only from its maker, through their own app or website."
                    />
                    <Row
                        title="Signing on an offline phone with Cypher Box"
                        body="This is for you. Example: an old phone, kept offline, runs Cypher Box in Offline Seed-Signer mode as your signing device: the seed lives on your SeedQR backups and is scanned in to sign. Your everyday phone holds a watch & broadcast only wallet made from the seed's public key: a Cypher Box Cold Vault, or another app such as Sparrow. It shows your balance, prepares transactions and broadcasts them once signed, but can't sign them."
                    />
                </Section>

                <Section title="Why it matters">
                    <Body>
                        A signature becomes public once the transaction is sent. A tampered signing app can hide pieces of
                        your recovery phrase inside its signatures, and someone watching the blockchain can put them back
                        together, sometimes from a single transaction. Keeping the signing phone offline doesn't stop this:
                        the signature itself carries the leak.
                    </Body>
                </Section>

                <Section title="Checklist for the signing wallet's phone">
                    <Row title="Use a dedicated phone" body="Factory-reset it and install nothing else on it." />
                    <Row title="Keep it offline" body="Wi-Fi, mobile data and Bluetooth off, for good." />
                    <Row
                        title="Keep automatic updates off"
                        body="Update Cypher Box here only on purpose, to a version that has been out for a few weeks."
                    />
                    <Row
                        title="Same Cypher Box version on both phones"
                        body={`If your other phone runs Cypher Box too. This phone runs Cypher Box ${getVersion()} (build ${getBuildNumber()}); the other phone shows its version under Settings > Info in either vault.`}
                    />
                    <Row
                        title="Official source only"
                        body="Install from the App Store or Google Play, never from a link someone sends you."
                    />
                </Section>
            </ScrollView>
            {onContinue ? (
                <View style={styles.footer}>
                    <Button text="Got it, continue" onPress={carryOn} style={styles.button} />
                </View>
            ) : null}
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    scroll: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 24,
        paddingTop: 12,
        paddingBottom: 40,
    },
    footer: {
        paddingHorizontal: 24,
        paddingBottom: 24,
    },
    button: {
        backgroundColor: colors.blueText,
    },
});

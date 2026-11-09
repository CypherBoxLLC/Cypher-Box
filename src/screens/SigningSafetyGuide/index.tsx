import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { getBuildNumber, getVersion } from "react-native-device-info";

import { Button, ScreenLayout } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import { Body, Row, Section } from "../VerifyTransactionGuide";
import loc from "../../../loc";

/**
 * "Signing safely": what a tampered signer can leak through its signatures, and how to keep a phone that signs for a
 * Cold Vault trustworthy. Reached from the line on the Cold Vault's "Transaction signing" export screen, from the
 * Hot Vault's signed-transaction screen, and once before a phone's first Hot Vault "Sign a transaction", when
 * `onContinue` carries on to the scanner.
 *
 * The phone checklist is for one setup only: a Hot Vault on an offline phone signing for a watch-only wallet on an
 * online phone, which may be a Cypher Box Cold Vault or another app. Everyday Hot Vault users and hardware-wallet users can reach the guide too (the export screen line
 * is shown to every Cold Vault), so it opens by telling each of them whether it applies. It ends with using the
 * Offline Seed-Signer as one key of a multisig made in Nunchuk, Sparrow or BlueWallet.
 */
export default function SigningSafetyGuide({ route, navigation }: { route: any; navigation: any }) {
    const onContinue = route?.params?.onContinue;

    const carryOn = () => {
        navigation.goBack();
        onContinue();
    };

    return (
        // disableScroll: the guide scrolls itself, so the button below stays on screen instead of scrolling away
        <ScreenLayout showToolbar isBackButton disableScroll title={loc.cypherbox.signing_safety.title}>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                {/* who it is for comes first: most readers use the Hot Vault day to day or sign with a hardware
                    wallet, and the phone checklist below is not for them */}
                <Section title={loc.cypherbox.signing_safety.for_you_title}>
                    <Row
                        title={loc.cypherbox.signing_safety.everyday_title}
                        body={loc.cypherbox.signing_safety.everyday_body}
                    />
                    <Row
                        title={loc.cypherbox.signing_safety.hardware_title}
                        body={loc.cypherbox.signing_safety.hardware_body}
                    />
                    <Row
                        title={loc.cypherbox.signing_safety.offline_phone_title}
                        body={loc.cypherbox.signing_safety.offline_phone_body}
                    />
                </Section>

                <Section title={loc.cypherbox.signing_safety.why_title}>
                    <Body>
                        {loc.cypherbox.signing_safety.why_body}
                    </Body>
                </Section>

                <Section title={loc.cypherbox.signing_safety.checklist_title}>
                    <Row title={loc.cypherbox.signing_safety.dedicated_title} body={loc.cypherbox.signing_safety.dedicated_body} />
                    <Row title={loc.cypherbox.signing_safety.offline_title} body={loc.cypherbox.signing_safety.offline_body} />
                    <Row
                        title={loc.cypherbox.signing_safety.updates_title}
                        body={loc.cypherbox.signing_safety.updates_body}
                    />
                    <Row
                        title={loc.cypherbox.signing_safety.same_version_title}
                        body={String(loc.formatString(loc.cypherbox.signing_safety.same_version_body, { version: `${getVersion()} (build ${getBuildNumber()})` }))}
                    />
                    <Row
                        title={loc.cypherbox.signing_safety.official_title}
                        body={loc.cypherbox.signing_safety.official_body}
                    />
                </Section>

                {/* Offline Seed-Signer as one key of a multisig made in Nunchuk, Sparrow or BlueWallet: the steps in
                    the order they're done, then a check with independent code */}
                <Section title={loc.cypherbox.signing_safety.multisig_title}>
                    <Row
                        title={loc.cypherbox.signing_safety.multisig_coordinator_title}
                        body={loc.cypherbox.signing_safety.multisig_coordinator_body}
                    />
                    <Row title={loc.cypherbox.signing_safety.multisig_add_title} body={loc.cypherbox.signing_safety.multisig_add_body} />
                    <Row
                        title={loc.cypherbox.signing_safety.multisig_register_title}
                        body={loc.cypherbox.signing_safety.multisig_register_body}
                    />
                    <Row title={loc.cypherbox.signing_safety.multisig_test_title} body={loc.cypherbox.signing_safety.multisig_test_body} />
                    <Row title={loc.cypherbox.signing_safety.multisig_check_title} body={loc.cypherbox.signing_safety.multisig_check_body} />
                    <Row
                        title={loc.cypherbox.signing_safety.multisig_crosscheck_title}
                        body={loc.cypherbox.signing_safety.multisig_crosscheck_body}
                    />
                </Section>
            </ScrollView>
            {onContinue ? (
                <View style={styles.footer}>
                    <Button text={loc.cypherbox.signing_safety.got_it} onPress={carryOn} style={styles.button} />
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

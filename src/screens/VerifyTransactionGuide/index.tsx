import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import loc from "../../../loc";

/**
 * "How to check this transaction yourself", reached from the "?" next to the copy button on
 * ConfirmHardwareTransaction and on PsbtWithHardwareWallet. Pure educational content, no actions.
 *
 * In a send, the app refuses a signed transaction that differs from the reviewed PSBT, so this is an optional
 * second opinion. With `imported` (a finished transaction opened from a file, with no reviewed PSBT) the app had
 * nothing to compare it with, and the copy says so. The one rule the copy must never soften: decode
 * offline, never on a live website, because a signed transaction carries the user's coins, addresses and
 * amounts, and anyone holding it can broadcast it.
 *
 * Menu paths were checked on 2026-10-28 against Electrum's docs, Sparrow's issue tracker and guides,
 * Coinbin's README (which confirms offline decoding), and EntropyLab's README and SECURITY.md (its PSBT
 * Inspector accepts a signed raw transaction; the page ships with connect-src 'none'). Re-check them if a
 * tool changes its menus.
 */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={styles.section}>
            <Text bold style={styles.sectionTitle}>
                {title}
            </Text>
            {children}
        </View>
    );
}

export function Body({ children }: { children: React.ReactNode }) {
    return <Text style={styles.body}>{children}</Text>;
}

export function Row({ title, body }: { title: string; body: string }) {
    return (
        <View style={styles.row}>
            <Text bold style={styles.rowTitle}>
                {title}
            </Text>
            <Text style={styles.rowBody}>{body}</Text>
        </View>
    );
}

export default function VerifyTransactionGuide({ route }: { route: any }) {
    const imported = !!route?.params?.imported;
    const copyLabel = imported ? loc.send.create_copy : 'Copy transaction';

    return (
        <ScreenLayout showToolbar isBackButton title="Check your transaction yourself">
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                <Section title="Do you need this?">
                    {imported ? (
                        <Body>
                            It's worth it here. You opened a finished transaction, so Cypher Box has no record of what
                            you meant to send and nothing to compare it with. It shows you every amount and address, but
                            only you can tell whether they are right.
                        </Body>
                    ) : (
                        <Body>
                            Usually not. Before you can swipe to send, Cypher Box checks that the signed transaction is
                            exactly the one you approved, and shows you every amount and address in it.
                        </Body>
                    )}
                    <Body>
                        Your signing device's screen is the most important check: confirm the address and amount
                        there. This guide is for a second opinion from a tool you control.
                    </Body>
                </Section>

                <Section title="Never paste it into a website while online">
                    <Body>
                        A signed transaction shows which coins you own, who you are paying, how much, and where your
                        change goes. A website you paste it into gets all of that, plus your IP address. Anyone holding
                        a signed transaction can also broadcast it, until you spend those coins some other way.
                    </Body>
                    <Body>
                        Checking a transaction never needs your seed phrase. Never type your seed into any tool for
                        this.
                    </Body>
                </Section>

                <Section title="Step 1: Copy the transaction">
                    <Body>
                        Tap {copyLabel} on the screen you came from. It only copies; nothing is sent. Other apps can
                        read your clipboard, so when you are done, copy something else to replace it.
                    </Body>
                </Section>

                <Section title="Step 2: Decode it with a tool you control">
                    <Row
                        title="Sparrow Wallet (computer)"
                        body="File → Open Transaction → From Text, then paste. It decodes without an internet connection."
                    />
                    <Row
                        title="Electrum (computer)"
                        body="Turn off Wi-Fi first. Then Tools → Load transaction → From text, and paste."
                    />
                    <Row
                        title="Your own Bitcoin node"
                        body="Run decoderawtransaction followed by the transaction, in a terminal with bitcoin-cli or in Bitcoin Core's Window → Console. Nothing leaves your machine."
                    />
                    <Row
                        title="EntropyLab (offline file)"
                        body="Download entropylab.html from entropylab.online or its GitHub page (github.com/OogaBoogaX/entropylab), and check its SHA-256 matches the project's SHA256SUMS file. Turn off Wi-Fi, open the file in your browser, and paste the transaction into the PSBT Inspector under Transactions. Close the tab before you go back online."
                    />
                    <Row
                        title="Coinbin (offline file)"
                        body="Download Coinbin, the open-source tool behind coinb.in, from its official GitHub page (github.com/OutCast3k/coinbin). Turn off Wi-Fi, open its index.html file in your browser, and paste the transaction into the Verify tab. Close the tab before you go back online."
                    />
                </Section>

                <Section title="Step 3: What to check">
                    <Row
                        title="Every recipient address"
                        body="Compare the whole address with the one you meant to pay, not just the first and last few characters. Scammers make look-alike addresses that match at both ends."
                    />
                    <Row
                        title="Every amount"
                        body="The payment matches what you meant to send."
                    />
                    <Row
                        title="Your change"
                        body="Anything left over goes back to you: your own wallet, or the account you picked for change."
                    />
                    <Row
                        title="The fee"
                        body="The coins going in, minus everything going out. It should be close to the fee you chose."
                    />
                </Section>

                <Section title="If anything doesn't match">
                    <Body>
                        Don't send it. Go back and start the payment again. If a freshly signed transaction still
                        doesn't match, stop using that signing device until you know why.
                    </Body>
                </Section>
            </ScrollView>
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
    section: {
        marginTop: 20,
    },
    sectionTitle: {
        fontSize: 16,
        color: colors.blueText,
        marginBottom: 10,
    },
    body: {
        fontSize: 13,
        color: '#CCC',
        lineHeight: 19,
        marginBottom: 10,
    },
    row: {
        marginBottom: 10,
    },
    rowTitle: {
        fontSize: 13,
        color: '#FFF',
        lineHeight: 18,
    },
    rowBody: {
        fontSize: 12,
        color: '#AAA',
        lineHeight: 17,
        marginTop: 1,
    },
});

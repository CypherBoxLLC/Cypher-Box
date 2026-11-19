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
    const copyLabel = imported ? loc.send.create_copy : loc.cypherbox.payments.confirm_hardware_transaction.copy_tx;

    return (
        <ScreenLayout showToolbar isBackButton title={loc.cypherbox.verify_tx_guide.title}>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                <Section title={loc.cypherbox.verify_tx_guide.need_title}>
                    {imported ? (
                        <Body>
                            {loc.cypherbox.verify_tx_guide.need_imported}
                        </Body>
                    ) : (
                        <Body>
                            {loc.cypherbox.verify_tx_guide.need_usual}
                        </Body>
                    )}
                    <Body>
                        {loc.cypherbox.verify_tx_guide.device_screen}
                    </Body>
                </Section>

                <Section title={loc.cypherbox.verify_tx_guide.never_paste_title}>
                    <Body>
                        {loc.cypherbox.verify_tx_guide.never_paste_body}
                    </Body>
                    <Body>
                        {loc.cypherbox.verify_tx_guide.no_seed}
                    </Body>
                </Section>

                <Section title={loc.cypherbox.verify_tx_guide.step1_title}>
                    <Body>
                        {loc.formatString(loc.cypherbox.verify_tx_guide.step1_body, { label: copyLabel })}
                    </Body>
                </Section>

                <Section title={loc.cypherbox.verify_tx_guide.step2_title}>
                    <Row
                        title={loc.cypherbox.verify_tx_guide.sparrow_title}
                        body={loc.cypherbox.verify_tx_guide.sparrow_body}
                    />
                    <Row
                        title={loc.cypherbox.verify_tx_guide.electrum_title}
                        body={loc.cypherbox.verify_tx_guide.electrum_body}
                    />
                    <Row
                        title={loc.cypherbox.verify_tx_guide.node_title}
                        body={loc.cypherbox.verify_tx_guide.node_body}
                    />
                    <Row
                        title={loc.cypherbox.verify_tx_guide.entropylab_title}
                        body={loc.cypherbox.verify_tx_guide.entropylab_body}
                    />
                    <Row
                        title={loc.cypherbox.verify_tx_guide.coinbin_title}
                        body={loc.cypherbox.verify_tx_guide.coinbin_body}
                    />
                </Section>

                <Section title={loc.cypherbox.verify_tx_guide.step3_title}>
                    <Row
                        title={loc.cypherbox.verify_tx_guide.recipients_title}
                        body={loc.cypherbox.verify_tx_guide.recipients_body}
                    />
                    <Row
                        title={loc.cypherbox.verify_tx_guide.amounts_title}
                        body={loc.cypherbox.verify_tx_guide.amounts_body}
                    />
                    <Row
                        title={loc.cypherbox.verify_tx_guide.change_title}
                        body={loc.cypherbox.verify_tx_guide.change_body}
                    />
                    <Row
                        title={loc.cypherbox.verify_tx_guide.fee_title}
                        body={loc.cypherbox.verify_tx_guide.fee_body}
                    />
                </Section>

                <Section title={loc.cypherbox.verify_tx_guide.mismatch_title}>
                    <Body>
                        {loc.cypherbox.verify_tx_guide.mismatch_body}
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

import React from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import loc from "../../../../loc";

const SECOND_FEES_URL = "https://second.tech/pricing";

// Section and Body sit above the screen because it uses them dozens of times
// (the lint rule flags every use before the definition); the other rows stay
// below it.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={{ marginTop: 20 }}>
            <Text bold style={{ fontSize: 16, color: colors.ark?.light ?? colors.pink.default, marginBottom: 10 }}>
                {title}
            </Text>
            {children}
        </View>
    );
}

function Body({ children }: { children: React.ReactNode }) {
    return (
        <Text style={{ fontSize: 13, color: '#CCC', lineHeight: 19, marginBottom: 10 }}>
            {children}
        </Text>
    );
}

// Warning box for the before-you-fund note, so it reads as a caution rather
// than one more section. Same red border and tint as the seed screen's
// no-backup panel.
const calloutStyles = StyleSheet.create({
    box: {
        marginTop: 16,
        borderWidth: 1,
        borderColor: colors.redLight ?? "#FF6B6B",
        backgroundColor: "rgba(255, 80, 80, 0.06)",
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 2,
    },
    title: {
        fontSize: 15,
        color: colors.redLight ?? "#FF6B6B",
        marginBottom: 8,
    },
});

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={calloutStyles.box}>
            <Text bold style={calloutStyles.title}>
                {title}
            </Text>
            {children}
        </View>
    );
}

/**
 * Plain-language "what you need to know about your lightning capsules" surface.
 *
 * Reached from the circular "?" button on the Capsules tab, and from the Bark
 * Vault "Learn more" link on CheckingAccountLogin, which used to open
 * cypherbox.io/how-to-use-your-bark-vault. Pure educational content — no
 * actions, no state. Copy written for a normal user, not someone who knows the
 * protocol terms.
 *
 * The before-you-fund warning, refresh habit, stuck refresh, Emergency Exit,
 * funding and backup sections carry that article's guidance, corrected where
 * the app has moved on since it was written (2026-07-19): a refresh is
 * delegated, so the app can be closed once it is submitted; Lightning
 * receives refresh automatically; and the backup file is recommended, not
 * required, because the seed alone restores the wallet. Keep the article
 * and this screen in step when either changes.
 *
 * Fees in the bottom section are quoted from Second's published fee schedule
 * (SECOND_FEES_URL) so they stay honest rather than estimated. But Second
 * reserves the right to change that schedule at any time by posting a new
 * version, and nothing notifies us when they do. A stale number here reads to a
 * user as a fee *we* quoted, so the section carries an explicit last-checked
 * date and a link to the live schedule. When you re-verify these, bump the date
 * in the copy below.
 *
 * This already bit us once. The schedule used to be quoted from
 * second.tech/docs/learn/fees, which has since become a fee-philosophy page
 * with no numbers on it; the live schedule moved to second.tech/pricing (the
 * same URL Second's own ToS incorporates by reference). In the meantime the
 * refresh row here had the rule backwards: it said the fee tracked the
 * capsule's *age* and was free while the capsule was young. It actually tracks
 * time *remaining* before expiry and is free in the last two days.
 *
 * It bit us a second time. The rows below quoted 0.2/0.4/0.5% at under-2-days,
 * 2-to-7-days and 7-days-plus, which is every band shifted one step up and the
 * free tier dropped entirely, contradicting the paragraph directly above. The
 * live table, read 2026-09-12 straight off the ASP with
 * `bark dev ark-info https://ark.second.tech`, is base fee 0 plus a
 * ppm-by-blocks-remaining ladder: 0 ppm under 288 blocks (~2 days), 2000 ppm to
 * 1008 (~7 days), 4000 ppm to 2016 (~14 days), 5000 ppm above that. A fresh
 * capsule carries vtxo_expiry_delta 4032 blocks (~28 days), so refreshing one
 * on sight pays the top 0.5% band. Re-read the table the same way when you bump
 * the date, rather than trusting the pricing page's prose.
 */
export default function ArkCapsulesInfoScreen() {
    return (
        <ScreenLayout showToolbar isBackButton title={loc.cypherbox.ark.capsules_info.title}>
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40 }}
            >
                <Callout title={loc.cypherbox.ark.capsules_info.before_fund_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.before_fund_body_1}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.before_fund_body_2}</Body>
                </Callout>

                <Section title={loc.cypherbox.ark.capsules_info.why_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.why_body_1}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.why_body_2}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.why_body_3}</Body>
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.reminders_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.reminders_body_1}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.reminders_body_2}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.reminders_body_3}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.reminders_body_4}</Body>
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.spendable_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.spendable_body_1}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.spendable_body_2}</Body>
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.habit_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.habit_body_1}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.habit_body_2}</Body>
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.stuck_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.stuck_body_1}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.stuck_body_2}</Body>
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.exit_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.exit_body_1}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.exit_body_2}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.exit_body_3}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.exit_body_4}</Body>
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.colors_title}>
                    <ColorRow
                        color="#4ADE80"
                        label={loc.cypherbox.ark.capsules_info.color_green_label}
                        body={loc.cypherbox.ark.capsules_info.color_green_body}
                    />
                    <ColorRow
                        color={colors.ark?.light ?? "#F2C94C"}
                        label={loc.cypherbox.ark.capsules_info.color_yellow_label}
                        body={loc.cypherbox.ark.capsules_info.color_yellow_body}
                    />
                    <ColorRow
                        color="#FB923C"
                        label={loc.cypherbox.ark.capsules_info.color_orange_label}
                        body={loc.cypherbox.ark.capsules_info.color_orange_body}
                    />
                    <ColorRow
                        color={colors.redLight ?? "#FF6B6B"}
                        label={loc.cypherbox.ark.capsules_info.color_red_label}
                        body={loc.cypherbox.ark.capsules_info.color_red_body}
                    />
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.status_title}>
                    <StatusRow
                        title={loc.cypherbox.ark.capsules_info.status_backed_up_title}
                        body={loc.cypherbox.ark.capsules_info.status_backed_up_body}
                    />
                    <StatusRow
                        title={loc.cypherbox.ark.capsules_info.status_refreshing_title}
                        body={loc.cypherbox.ark.capsules_info.status_refreshing_body}
                    />
                    <StatusRow
                        title={loc.cypherbox.ark.capsules_info.status_in_flight_title}
                        body={loc.cypherbox.ark.capsules_info.status_in_flight_body}
                    />
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.fund_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.fund_body_1}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.fund_body_2}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.fund_body_3}</Body>
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.dust_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.dust_body_1}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.dust_body_2}</Body>
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.backup_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.backup_body_1}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.backup_body_2}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.backup_body_3}</Body>
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.fees_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.fees_body_1}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.fees_body_2}</Body>
                    <LinkRow label="second.tech/pricing" url={SECOND_FEES_URL} />
                    <FeeRow
                        title={loc.cypherbox.ark.capsules_info.fee_receive_ln_title}
                        body={loc.cypherbox.ark.capsules_info.fee_receive_ln_body}
                    />
                    <FeeRow
                        title={loc.cypherbox.ark.capsules_info.fee_send_bark_title}
                        body={loc.cypherbox.ark.capsules_info.fee_send_bark_body}
                    />
                    <FeeRow
                        title={loc.cypherbox.ark.capsules_info.fee_refresh_title}
                        body={loc.cypherbox.ark.capsules_info.fee_refresh_body}
                    />
                    <FeeRow
                        title={loc.cypherbox.ark.capsules_info.fee_send_ln_title}
                        body={loc.cypherbox.ark.capsules_info.fee_send_ln_body}
                    />
                    <FeeRow
                        title={loc.cypherbox.ark.capsules_info.fee_withdraw_title}
                        body={loc.cypherbox.ark.capsules_info.fee_withdraw_body}
                    />
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.tip_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.tip_body_1}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.tip_body_2}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.tip_body_3}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.tip_body_4}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.tip_body_5}</Body>
                    <Body>{loc.cypherbox.ark.capsules_info.tip_body_6}</Body>
                </Section>

                <Section title={loc.cypherbox.ark.capsules_info.example_title}>
                    <Body>{loc.cypherbox.ark.capsules_info.example_intro}</Body>
                    <StatusRow
                        title={loc.cypherbox.ark.capsules_info.example_receive_title}
                        body={loc.cypherbox.ark.capsules_info.example_receive_body}
                    />
                    <StatusRow
                        title={loc.cypherbox.ark.capsules_info.example_deposit_title}
                        body={loc.cypherbox.ark.capsules_info.example_deposit_body}
                    />
                    <StatusRow
                        title={loc.cypherbox.ark.capsules_info.example_keep_alive_title}
                        body={loc.cypherbox.ark.capsules_info.example_keep_alive_body}
                    />
                    <StatusRow
                        title={loc.cypherbox.ark.capsules_info.example_withdraw_title}
                        body={loc.cypherbox.ark.capsules_info.example_withdraw_body}
                    />
                    <StatusRow
                        title={loc.cypherbox.ark.capsules_info.example_total_title}
                        body={loc.cypherbox.ark.capsules_info.example_total_body}
                    />
                    <Body>{loc.cypherbox.ark.capsules_info.example_outro}</Body>
                </Section>
            </ScrollView>
        </ScreenLayout>
    );
}

function ColorRow({ color, label, body }: { color: string; label: string; body: string }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 }}>
            <View
                style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: color,
                    marginRight: 10,
                    marginTop: 3,
                }}
            />
            <View style={{ flex: 1 }}>
                <Text bold style={{ fontSize: 13, color: '#FFF', lineHeight: 18 }}>
                    {label}
                </Text>
                <Text style={{ fontSize: 12, color: '#AAA', lineHeight: 17, marginTop: 1 }}>
                    {body}
                </Text>
            </View>
        </View>
    );
}

function StatusRow({ title, body }: { title: string; body: string }) {
    return (
        <View style={{ marginBottom: 10 }}>
            <Text bold style={{ fontSize: 13, color: '#FFF', lineHeight: 18 }}>
                {title}
            </Text>
            <Text style={{ fontSize: 12, color: '#AAA', lineHeight: 17, marginTop: 1 }}>
                {body}
            </Text>
        </View>
    );
}

function LinkRow({ label, url }: { label: string; url: string }) {
    return (
        <Text
            onPress={() => Linking.openURL(url)}
            style={{
                fontSize: 13,
                color: colors.ark?.light ?? colors.pink.default,
                lineHeight: 19,
                marginBottom: 12,
                textDecorationLine: 'underline',
            }}
        >
            {label}
        </Text>
    );
}

function FeeRow({ title, body }: { title: string; body: string }) {
    return (
        <View style={{ marginBottom: 10 }}>
            <Text bold style={{ fontSize: 13, color: '#FFF', lineHeight: 18 }}>
                {title}
            </Text>
            <Text style={{ fontSize: 12, color: '#AAA', lineHeight: 17, marginTop: 1 }}>
                {body}
            </Text>
        </View>
    );
}

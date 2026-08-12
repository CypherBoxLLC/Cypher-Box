import React from "react";
import { Linking, ScrollView, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";

const SECOND_FEES_URL = "https://second.tech/pricing";

/**
 * Plain-language "what you need to know about your lightning capsules" surface.
 *
 * Reached from the circular "?" button on the Capsules tab. Pure educational
 * content — no actions, no state. Copy written for a normal user, not someone
 * who knows the protocol terms.
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
 * time *remaining* before expiry and is free in the last two days. Verified
 * against second.tech/pricing on 2026-08-12.
 */
export default function ArkCapsulesInfoScreen() {
    return (
        <ScreenLayout showToolbar isBackButton title="About your lightning capsules">
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40 }}
            >
                <Section title="Why your capsules need refreshing">
                    <Body>
                        Your Bark balance is held as a collection of small lightning capsules
                        (VTXOs). Each capsule has an expiry date. To keep your funds fully
                        self-custodial, meaning you can always recover them yourself without
                        needing the Second.tech server's permission, each capsule must be refreshed
                        before it expires.
                    </Body>
                    <Body>
                        If a capsule expires without being refreshed, the Second.tech server can
                        sweep the funds at any time. Recovery after expiry is not guaranteed, so
                        treat the expiry date as a hard deadline.
                    </Body>
                    <Body>
                        Keeping capsules refreshed also pays off if you ever run an Emergency
                        Exit: fresh capsules make the exit cheaper in fees, faster to settle,
                        and more private.
                    </Body>
                </Section>

                <Section title="How reminders keep your capsules safe">
                    <Body>
                        Cypher Box sends up to 5 reminder notifications before any lightning
                        capsule expires. The schedule is fixed: 4 days, 2 days, 24 hours, 12
                        hours, and 6 hours before expiry. Each one escalates in urgency.
                    </Body>
                    <Body>
                        Tap any reminder and Cypher Box opens directly on the Capsules tab
                        with the refresh already running. You do not need to find a button,
                        confirm an amount, or unlock anything beyond your usual biometric.
                    </Body>
                    <Body>
                        The Reminders toggle lives in two places: at the bottom of the Bark
                        Vault Created screen when you first create your wallet, and on the
                        Vault tab inside the Bark vault menu. Default is on. If you turn it
                        off, no reminders fire and you alone are responsible for opening the
                        app and refreshing your capsules before they expire.
                    </Body>
                    <Body>
                        The reminders are your safety net. Refreshing only works while the
                        app is open, so tapping a reminder is what keeps your capsules
                        alive.
                    </Body>
                </Section>

                <Section title="Your balance stays spendable while it refreshes">
                    <Body>
                        Refreshing no longer locks your funds. When a capsule is refreshing,
                        including the automatic step right after you receive over Lightning,
                        you can keep spending it the whole time. There is no waiting for the
                        refresh to finish before your balance is usable.
                    </Body>
                    <Body>
                        A refresh usually finishes within about an hour and gives the capsule
                        a fresh full life. Just leave the app running until it completes.
                    </Body>
                </Section>

                <Section title="What the capsule colors mean">
                    <ColorRow
                        color="#4ADE80"
                        label="Green: 21+ days left"
                        body="Fresh. Nothing to do."
                    />
                    <ColorRow
                        color={colors.ark?.light ?? "#F2C94C"}
                        label="Yellow: 14-20 days left"
                        body="Past the midpoint. Worth refreshing next time you're in the app."
                    />
                    <ColorRow
                        color="#FB923C"
                        label="Orange: 7-13 days left"
                        body="Within the refresh window. Refresh it now, before the reminders start."
                    />
                    <ColorRow
                        color={colors.redLight ?? "#FF6B6B"}
                        label="Red: less than 7 days left"
                        body="Needs refresh now. Reminders are firing, tap one to refresh. After it expires, the server can claim the capsule."
                    />
                </Section>

                <Section title="What capsule status means">
                    <StatusRow
                        title="Backed up"
                        body="Spendable, and fully under your control. You can always recover it on-chain yourself. This is the everyday state."
                    />
                    <StatusRow
                        title="Refreshing"
                        body="Being given a fresh full life. It stays spendable the whole time, usually under an hour, so you can keep using it while it refreshes."
                    />
                    <StatusRow
                        title="In-flight"
                        body="Being used in another operation: an outgoing send, withdrawal, or boarding. Briefly locked until that operation completes."
                    />
                </Section>

                <Section title="Tiny capsules (dust)">
                    <Body>
                        A capsule at or below 500 sats is too small to refresh on its own, so
                        the network will not let it renew alone. To keep dust alive, tap Dust
                        refresh on the capsule: it batches several tiny capsules together, so
                        their combined size clears the minimum, and consolidates them into one
                        healthy capsule.
                    </Body>
                    <Body>
                        Because the amounts are tiny, the fee for a dust batch can sometimes be
                        close to or more than the dust itself, so it is a judgment call. If it
                        is not worth it, just spend the dust as part of a normal payment before
                        it expires. Receiving at least about 700 sats at a time avoids dust in
                        the first place.
                    </Body>
                </Section>

                <Section title="Fees">
                    <Body>
                        These are the fees the Bark server charges. The refresh fee depends
                        on how much time is left before a capsule expires, not on how old
                        the capsule is. The closer to expiry, the cheaper the refresh.
                    </Body>
                    <Body>
                        Second.tech sets these fees, not Cypher Box, and can change them at
                        any time. The figures below were checked in August 2026. For the
                        current schedule, see:
                    </Body>
                    <LinkRow label="second.tech/pricing" url={SECOND_FEES_URL} />
                    <FeeRow
                        title="Receiving from Lightning"
                        body="0%, free."
                    />
                    <FeeRow
                        title="Sending Bark-to-Bark"
                        body="0%, free."
                    />
                    <FeeRow
                        title="Refreshing"
                        body="Free within 2 days of expiry. 0.2% with under 7 days left, 0.4% with under 14 days left, 0.5% at 14 days or more. The reminders fire inside the cheapest part of that range, so following them costs little or nothing."
                    />
                    <FeeRow
                        title="Sending over Lightning"
                        body="0.2% to 0.5% of the amount, with a 20-sat minimum."
                    />
                    <FeeRow
                        title="Withdrawing on-chain"
                        body="0.2% to 0.5% of the amount, plus standard Bitcoin network fees for the on-chain transaction."
                    />
                </Section>
            </ScrollView>
        </ScreenLayout>
    );
}

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

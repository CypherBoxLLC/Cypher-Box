import React from "react";
import { ScrollView, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";

/**
 * Plain-language "what you need to know about your Ark capsules" surface.
 *
 * Reached from the circular "?" button on the V-capsules tab. Pure
 * educational content — no actions, no state. Copy written for a normal
 * user, not someone who knows the protocol terms. Fees in the bottom
 * section are quoted directly from Second's published Ark fee schedule
 * (https://second.tech/docs/learn/fees) so they stay honest rather than
 * estimated.
 */
export default function ArkCapsulesInfoScreen() {
    return (
        <ScreenLayout showToolbar isBackButton title="About your Ark capsules">
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40 }}
            >
                <Section title="Why we refresh your balance">
                    <Body>
                        Your Ark balance is held as a collection of small "capsules". To keep
                        your funds fully self-custodial — meaning you can always recover them
                        yourself without needing the Ark server's permission — each capsule
                        needs to be refreshed before it ages out.
                    </Body>
                    <Body>
                        Cypher Box refreshes them in the background as long as the toggle in
                        Settings is on. If you turn it off, you're responsible for refreshing
                        them yourself before they expire.
                    </Body>
                    <Body>
                        The capsules tab shows when the next automatic refresh is due, so you
                        always know whether you need to do anything.
                    </Body>
                </Section>

                <Section title="If a capsule can't be refreshed in time">
                    <Body>
                        Refreshing needs the Ark server to be reachable. If it has trouble and
                        a capsule keeps failing to refresh as it nears its expiry, Cypher Box
                        escalates so your money is never lost.
                    </Body>
                    <Body>
                        You'll first get a reminder notification around 24 hours, and again
                        around 2 hours, before a capsule would expire, in case you want to act
                        yourself (refresh manually, or spend the balance).
                    </Body>
                    <StatusRow
                        title="Last-resort rescue to Strike or CoinOS"
                        body="If a capsule is within roughly 12 hours of expiring and still hasn't refreshed, Cypher Box automatically forwards those funds over Lightning to your connected Strike or CoinOS balance (Strike first, CoinOS as backup). Your money is safe there as a custodial balance, which is far better than letting the capsule expire and forcing a costly on-chain recovery. You can move it back into Ark whenever you like."
                    />
                    <Body>
                        This rescue only runs if you have Strike or CoinOS connected. If neither
                        is connected, Cypher Box notifies you instead, so you can refresh or
                        spend the funds yourself before the deadline.
                    </Body>
                </Section>

                <Section title="Some balance may briefly be unspendable">
                    <Body>
                        This is most noticeable after you receive over Lightning. Lightning
                        payments land in a form that needs one more step before they're fully
                        self-custodial, and Cypher Box converts them automatically. While
                        that's happening, the affected capsules show as Refreshing and you
                        won't be able to spend them.
                    </Body>
                    <Body>
                        Refreshing usually takes less than an hour. Your balance comes
                        right back the moment it finishes.
                    </Body>
                </Section>

                <Section title="What the capsule colors mean">
                    <ColorRow
                        color="#4ADE80"
                        label="Green — 21+ days left"
                        body="Fresh. Nothing to do."
                    />
                    <ColorRow
                        color={colors.ark?.light ?? "#F2C94C"}
                        label="Yellow — 14–20 days left"
                        body="Past the midpoint. We'll refresh it before it gets urgent."
                    />
                    <ColorRow
                        color="#FB923C"
                        label="Orange — 7–13 days left"
                        body="Within the refresh window. Cypher Box will roll it in on the next refresh."
                    />
                    <ColorRow
                        color={colors.redLight ?? "#FF6B6B"}
                        label="Red — less than 7 days left"
                        body="Needs refresh soon. After it expires, the server can claim the capsule."
                    />
                </Section>

                <Section title="What capsule status means">
                    <StatusRow
                        title="Backed up"
                        body="Spendable, and fully under your control. You can always recover it on-chain yourself. This is the everyday state."
                    />
                    <StatusRow
                        title="Refreshing"
                        body="Being converted into a fresh capsule. Temporarily unspendable until it finishes."
                    />
                    <StatusRow
                        title="In-flight"
                        body="Being used in another operation — an outgoing send, withdrawal, or boarding. Same kind of brief lock as Refreshing."
                    />
                </Section>

                <Section title="Fees">
                    <Body>
                        These are the fees the Ark server (operated by Second) charges. They
                        vary with how old the capsule is — younger capsules cost less.
                    </Body>
                    <FeeRow
                        title="Receiving from Lightning"
                        body="0% — free."
                    />
                    <FeeRow
                        title="Sending Ark-to-Ark"
                        body="0% — free."
                    />
                    <FeeRow
                        title="Refreshing"
                        body="0% to 0.5% of the amount, depending on the capsule's age. 0% if the capsule is less than 2 days old."
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

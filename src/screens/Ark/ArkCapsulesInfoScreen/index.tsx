import React from "react";
import { ScrollView, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";

/**
 * Read-only "what you need to know about your Ark capsules" surface.
 *
 * Reached from the circular "?" button on the V-capsules tab. Pure
 * educational content — no actions, no state. Covers the self-custody
 * trust model, why receives can briefly lock funds, the depletion-ring
 * color bands, capsule status meanings, and the fee model for the three
 * primary operations.
 *
 * Copy is kept honest about the trust window during LN receives — that
 * gap (arkoor → refresh) is the only non-self-custodial moment in the
 * normal flow and users deserve to know it exists. The project memory
 * `project_arkoor_lightning_trust_model` carries the underlying protocol
 * detail this screen surfaces.
 */
export default function ArkCapsulesInfoScreen() {
    return (
        <ScreenLayout showToolbar isBackButton title="About your Ark capsules">
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40 }}
            >
                <Section title="Self-custody and refresh">
                    <Body>
                        Your Ark balance lives as a set of virtual capsules (VTXOs) signed
                        between you and the Ark server. To stay fully self-custodial — meaning
                        you can sweep the funds on-chain without the server's cooperation — each
                        capsule must be refreshed before its lifetime ends.
                    </Body>
                    <Body>
                        Cypher Box handles refresh automatically when the Refresh Ark capsules
                        in background toggle is on (Settings tab). With it off, you stay on the
                        hook for refreshing each capsule yourself before expiry, or the server
                        can sweep it.
                    </Body>
                </Section>

                <Section title="Why a Lightning receive can briefly lock your balance">
                    <Body>
                        Lightning payments arrive as arkoor-style capsules: instant, but until
                        they're refreshed into a regular capsule, they sit under a temporary
                        server-trust window. Cypher Box's auto-refresh kicks in seconds after
                        a receive lands and bundles every short-expiry capsule into one round.
                    </Body>
                    <Body>
                        While the round is in flight, the included capsules show as Refreshing
                        and aren't spendable. On mainnet a round can take up to an hour to
                        commit; on signet it's typically a few minutes. Your balance returns
                        the moment the round commits.
                    </Body>
                </Section>

                <Section title="Capsule ring colors">
                    <ColorRow
                        color="#4ADE80"
                        label="Green (≥21 days left)"
                        body="Fresh. Nothing to do."
                    />
                    <ColorRow
                        color={colors.ark?.light ?? "#F2C94C"}
                        label="Yellow (14–20 days left)"
                        body="Past midlife. Auto-refresh hasn't included it yet, but it will when expiry gets closer."
                    />
                    <ColorRow
                        color="#FB923C"
                        label="Orange (7–13 days left)"
                        body="Within the refresh window. The next scheduled round or Lightning receive will sweep it in."
                    />
                    <ColorRow
                        color={colors.redLight ?? "#FF6B6B"}
                        label="Red (<7 days left)"
                        body="Refresh now or you risk losing the chain-enforced exit on this capsule."
                    />
                </Section>

                <Section title="Capsule status">
                    <StatusRow
                        title="Backed up"
                        body="Capsule is spendable and chain-enforced — you can unilaterally exit it on-chain without the server's cooperation. The everyday state."
                    />
                    <StatusRow
                        title="Refreshing"
                        body="Capsule is locked into an in-flight refresh round. Temporarily unspendable; spendability returns when the round commits server-side."
                    />
                    <StatusRow
                        title="In-flight"
                        body="Capsule is locked into a different operation — an outgoing send, an on-chain board, or an emergency exit. Same temporary-lock window as Refreshing."
                    />
                </Section>

                <Section title="Fees">
                    <FeeRow
                        title="Receiving"
                        body="Free for you. Lightning senders pay routing on their side; the Ark server doesn't charge you to receive a capsule."
                    />
                    <FeeRow
                        title="Refreshing"
                        body="A few sats per round on mainnet — the cost is shared across every wallet participating in that round, so it stays small even for tiny capsules. Auto-refresh skips rounds where the fee would exceed the value being preserved."
                    />
                    <FeeRow
                        title="Spending"
                        body="Lightning sends pay normal LN routing fees. Ark-to-Ark sends are off-round and effectively free. Boarding back on-chain pays a regular Bitcoin transaction fee at the current network rate."
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

import React, { useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text as SelectableText, TouchableOpacity, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { SignerWallet, policyAddress, policyDescriptor } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import SignerButton from "../SigningHome/SignerButton";
import { startSigning } from "../SignOnce/start";

/**
 * The multisig wallets the Offline Seed-Signer holds a key of (helpers/multisigPolicy): each with its quorum, its keys'
 * fingerprints, its first address and, on request, the whole descriptor, and a way to remove it. From here a wallet is
 * added (RegisterSignerWallet) and an address checked against them (CheckSignerAddress).
 */
export default function SignerWallets({ navigation }: { navigation: any }) {
    const { signerWallets, removeSignerWallet } = useAuthStore();
    const wallets: SignerWallet[] = Object.values(signerWallets ?? {}).sort((a, b) => a.addedAt - b.addedAt);
    const [open, setOpen] = useState<string | null>(null);

    const remove = (wallet: SignerWallet) =>
        Alert.alert(
            `Remove ${wallet.name}?`,
            "This signer won't sign its transactions until you add the wallet again. Your coins aren't affected: the wallet stays in your multisig app.",
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => removeSignerWallet(wallet.id) },
            ],
        );

    return (
        <ScreenLayout showToolbar isBackButton title="Multisig Wallets" disableScroll>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                <Text style={styles.lead}>
                    Multisig wallets this signer holds a key of. A multisig transaction is signed only if it spends from
                    one of these, and an amount is shown as change only if it goes back to the same wallet.
                </Text>
                {wallets.length === 0 ? (
                    <Text style={styles.empty}>No multisig wallets on this phone yet.</Text>
                ) : (
                    wallets.map(wallet => {
                        const expanded = open === wallet.id;
                        const descriptor = expanded ? policyDescriptor(wallet) : '';
                        return (
                            <View key={wallet.id} style={styles.card}>
                                <Text bold style={styles.name}>{wallet.name}</Text>
                                <Text style={styles.fact}>{`${wallet.m} of ${wallet.keys.length} multisig, native SegWit`}</Text>
                                <Text style={styles.fact}>
                                    {`Keys: ${wallet.keys.map(k => (k.fingerprint === wallet.ownFingerprint ? `${k.fingerprint} (this seed)` : k.fingerprint)).join(', ')}`}
                                </Text>
                                <Text style={styles.label}>First receive address</Text>
                                <SelectableText selectable style={styles.mono}>{policyAddress(wallet, 0, 0)}</SelectableText>
                                <TouchableOpacity onPress={() => setOpen(expanded ? null : wallet.id)} accessibilityRole="button">
                                    <Text style={styles.link}>{expanded ? 'Hide the descriptor' : 'Show the descriptor'}</Text>
                                </TouchableOpacity>
                                {expanded ? (
                                    <>
                                        <SelectableText selectable style={styles.mono}>{descriptor}</SelectableText>
                                        <TouchableOpacity
                                            onPress={() => {
                                                Clipboard.setString(descriptor);
                                                SimpleToast.show('Descriptor copied', SimpleToast.SHORT);
                                            }}
                                            accessibilityRole="button"
                                        >
                                            <Text style={styles.link}>Copy the descriptor</Text>
                                        </TouchableOpacity>
                                    </>
                                ) : null}
                                <TouchableOpacity onPress={() => remove(wallet)} accessibilityRole="button">
                                    <Text style={styles.remove}>Remove from this phone</Text>
                                </TouchableOpacity>
                            </View>
                        );
                    })
                )}
                <View style={styles.buttons}>
                    {/* the coordinator's transaction is signed in the same screen as from the home */}
                    {wallets.length ? <SignerButton label="Sign a Multisig Transaction" onPress={() => startSigning()} /> : null}
                    <SignerButton label="Add a Multisig Wallet" onPress={() => navigation.navigate('RegisterSignerWallet')} />
                    <SignerButton label="Receive - Check Address" onPress={() => navigation.navigate('CheckSignerAddress')} />
                </View>
            </ScrollView>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    scroll: {
        flex: 1,
    },
    content: {
        paddingTop: 20,
        paddingBottom: 40,
    },
    lead: {
        fontSize: 15,
        lineHeight: 22,
        color: '#CCC',
        marginHorizontal: 20,
        marginBottom: 16,
    },
    empty: {
        fontSize: 14,
        color: colors.gray.light,
        marginHorizontal: 20,
        marginBottom: 8,
    },
    card: {
        marginHorizontal: 20,
        marginBottom: 12,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#444',
    },
    name: {
        fontSize: 17,
        lineHeight: 22,
        marginBottom: 4,
    },
    fact: {
        fontSize: 14,
        lineHeight: 20,
        color: '#CCC',
    },
    label: {
        fontSize: 13,
        color: colors.gray.light,
        marginTop: 10,
    },
    mono: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.white,
        marginTop: 2,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    link: {
        fontSize: 14,
        color: colors.green,
        textDecorationLine: 'underline',
        marginTop: 10,
    },
    remove: {
        fontSize: 14,
        color: colors.red,
        marginTop: 14,
    },
    buttons: {
        marginTop: 16,
    },
});

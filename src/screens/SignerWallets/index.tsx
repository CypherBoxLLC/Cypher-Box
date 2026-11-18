import React, { useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text as SelectableText, TouchableOpacity, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { SignerWallet, policyAddress, policyDescriptor } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import loc from "../../../loc";
import { walletName } from "../RegisterSignerWallet/errorText";
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
    const w = loc.cypherbox.seed_signer.multisig.wallets;
    const format = (text: string, values: Record<string, string | number>) => String(loc.formatString(text, values));

    const remove = (wallet: SignerWallet) =>
        Alert.alert(format(w.remove_title, { name: walletName(wallet.name) }), w.remove_body, [
            { text: loc._.cancel, style: 'cancel' },
            { text: w.remove, style: 'destructive', onPress: () => removeSignerWallet(wallet.id) },
        ]);

    return (
        <ScreenLayout showToolbar isBackButton title={loc.cypherbox.seed_signer.multisig_wallets} disableScroll>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                <Text style={styles.lead}>{w.lead}</Text>
                {wallets.length === 0 ? (
                    <Text style={styles.empty}>{w.empty}</Text>
                ) : (
                    wallets.map(wallet => {
                        const expanded = open === wallet.id;
                        const descriptor = expanded ? policyDescriptor(wallet) : '';
                        return (
                            <View key={wallet.id} style={styles.card}>
                                <Text bold style={styles.name}>{walletName(wallet.name)}</Text>
                                <Text style={styles.fact}>{format(w.quorum, { m: wallet.m, n: wallet.keys.length })}</Text>
                                <Text style={styles.fact}>
                                    {format(w.key_list, {
                                        list: wallet.keys
                                            .map(k => (k.fingerprint === wallet.ownFingerprint ? format(w.this_seed, { fingerprint: k.fingerprint }) : k.fingerprint))
                                            .join(w.separator),
                                    })}
                                </Text>
                                <Text style={styles.label}>{loc.cypherbox.seed_signer.multisig.first_address}</Text>
                                <SelectableText selectable style={styles.mono}>{policyAddress(wallet, 0, 0)}</SelectableText>
                                <TouchableOpacity onPress={() => setOpen(expanded ? null : wallet.id)} accessibilityRole="button">
                                    <Text style={styles.link}>{expanded ? w.hide_descriptor : w.show_descriptor}</Text>
                                </TouchableOpacity>
                                {expanded ? (
                                    <>
                                        <SelectableText selectable style={styles.mono}>{descriptor}</SelectableText>
                                        <TouchableOpacity
                                            onPress={() => {
                                                Clipboard.setString(descriptor);
                                                SimpleToast.show(w.descriptor_copied, SimpleToast.SHORT);
                                            }}
                                            accessibilityRole="button"
                                        >
                                            <Text style={styles.link}>{w.copy_descriptor}</Text>
                                        </TouchableOpacity>
                                    </>
                                ) : null}
                                <TouchableOpacity onPress={() => remove(wallet)} accessibilityRole="button">
                                    <Text style={styles.remove}>{w.remove_link}</Text>
                                </TouchableOpacity>
                            </View>
                        );
                    })
                )}
                <View style={styles.buttons}>
                    {/* the coordinator's transaction is signed in the same screen as from the home */}
                    {wallets.length ? <SignerButton label={w.sign} onPress={() => startSigning()} /> : null}
                    <SignerButton
                        label={loc.cypherbox.seed_signer.multisig.register.title}
                        onPress={() => navigation.navigate('RegisterSignerWallet')}
                    />
                    <SignerButton label={loc.cypherbox.seed_signer.check_address} onPress={() => navigation.navigate('CheckSignerAddress')} />
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

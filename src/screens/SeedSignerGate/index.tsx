import React, { useContext, useState } from "react";
import { Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import loc from "../../../loc";
import useElectrumConnection from "../../custom-hooks/useElectrumConnection";

// typed as it is in every language, like a code
const CONFIRM_WORD = 'SEED-SIGNER';

/**
 * The one way into Offline Seed-Signer mode, and there's no way back out short of reinstalling. It opens only in an
 * empty app, so turning it on never deletes a wallet: whatever is here has to be moved or backed up, and the app
 * reinstalled, first. The phone has to be offline now, and the user types a word rather than tapping through.
 */
export default function SeedSignerGate() {
    const { wallets } = useContext(BlueStorageContext);
    const { walletID, coldStorageWalletID, isAuth, isStrikeAuth, isArkAuth, setSigningMode } = useAuthStore();
    const connection = useElectrumConnection(true, false);
    const [typed, setTyped] = useState('');

    const vaults = (wallets ?? []).length;
    const inApp = [
        vaults > 0 || walletID || coldStorageWalletID
            ? vaults === 1
                ? loc.cypherbox.seed_signer.gate.has_one_vault
                : vaults
                ? String(loc.formatString(loc.cypherbox.seed_signer.gate.has_vaults, { count: vaults }))
                : loc.cypherbox.seed_signer.gate.has_some_vaults
            : null,
        isAuth || isStrikeAuth ? loc.cypherbox.seed_signer.gate.has_account : null,
        isArkAuth ? loc.cypherbox.seed_signer.gate.has_bark_vault : null,
    ].filter(Boolean) as string[];
    const empty = inApp.length === 0;
    const offline = connection === 'no-answer';
    const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;

    const turnOn = () => {
        if (!empty || !offline || !confirmed) return;
        setSigningMode(true);
        dispatchReset('HomeScreen');
    };

    return (
        <ScreenLayout showToolbar isBackButton disableScroll>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={styles.title}>{loc.cypherbox.seed_signer.title}</Text>
                <Text style={styles.body}>{loc.cypherbox.seed_signer.gate.body}</Text>
                <Text style={styles.oneWay}>{loc.cypherbox.seed_signer.gate.one_way}</Text>

                <Text style={styles.heading}>{loc.cypherbox.seed_signer.gate.before_title}</Text>
                <Text style={styles.item}>{loc.cypherbox.seed_signer.gate.dedicated}</Text>
                <Text style={styles.item}>{loc.cypherbox.seed_signer.gate.update_first}</Text>
                <Text style={styles.item}>{loc.cypherbox.seed_signer.gate.stay_offline}</Text>
                <TouchableOpacity onPress={() => dispatchNavigate('SigningSafetyGuide')} accessibilityRole="button">
                    <Text style={styles.link}>{loc.cypherbox.signing_safety.title}</Text>
                </TouchableOpacity>

                {!empty ? (
                    <View style={styles.block}>
                        <Text style={styles.blockTitle}>{loc.cypherbox.seed_signer.gate.fresh_install_title}</Text>
                        <Text style={styles.blockBody}>
                            {String(loc.formatString(loc.cypherbox.seed_signer.gate.fresh_install_body, {
                                contents: inApp.join(loc.cypherbox.seed_signer.gate.list_separator),
                            }))}
                        </Text>
                        {/* Android deletes an app's data and Keystore keys with the app; an iPhone's Keychain stays */}
                        {Platform.OS === 'ios' ? (
                            <Text style={styles.blockBody}>{loc.cypherbox.seed_signer.gate.keychain_note_ios}</Text>
                        ) : null}
                    </View>
                ) : !offline ? (
                    <View style={styles.block}>
                        <Text style={styles.blockTitle}>
                            {connection === 'checking'
                                ? loc.cypherbox.sign_once.checking_offline
                                : loc.cypherbox.seed_signer.gate.online_title}
                        </Text>
                        <Text style={styles.blockBody}>{loc.cypherbox.seed_signer.gate.online_body}</Text>
                    </View>
                ) : (
                    <>
                        <Text style={styles.heading}>
                            {String(loc.formatString(loc.cypherbox.seed_signer.gate.type_word, { word: CONFIRM_WORD }))}
                        </Text>
                        <TextInput
                            style={styles.input}
                            value={typed}
                            onChangeText={setTyped}
                            placeholder={CONFIRM_WORD}
                            placeholderTextColor="#666"
                            autoCapitalize="characters"
                            autoCorrect={false}
                            spellCheck={false}
                            autoComplete="off"
                            importantForAutofill="no"
                            accessibilityLabel={String(loc.formatString(loc.cypherbox.seed_signer.gate.type_word_a11y, { word: CONFIRM_WORD }))}
                        />
                        <TouchableOpacity
                            style={[styles.button, !confirmed && styles.buttonOff]}
                            onPress={turnOn}
                            disabled={!confirmed}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !confirmed }}
                        >
                            <Text h3 style={styles.buttonText}>{loc.cypherbox.seed_signer.gate.turn_on}</Text>
                        </TouchableOpacity>
                    </>
                )}
            </ScrollView>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    content: {
        paddingHorizontal: 24,
        // clears the back arrow, which ScreenLayout draws over the top of the content
        paddingTop: 48,
        paddingBottom: 48,
    },
    title: {
        fontSize: 24,
        lineHeight: 32,
        fontFamily: 'Archivo-SemiBold',
        color: colors.green,
        marginBottom: 12,
    },
    body: {
        fontSize: 15,
        lineHeight: 22,
        color: '#CCC',
        marginBottom: 14,
    },
    oneWay: {
        fontSize: 15,
        lineHeight: 22,
        color: colors.redLight,
        marginBottom: 20,
    },
    heading: {
        fontSize: 16,
        lineHeight: 22,
        fontFamily: 'Archivo-SemiBold',
        marginTop: 8,
        marginBottom: 10,
    },
    item: {
        fontSize: 14,
        lineHeight: 21,
        color: '#CCC',
        marginBottom: 6,
    },
    link: {
        fontSize: 14,
        color: colors.green,
        textDecorationLine: 'underline',
        marginTop: 4,
        marginBottom: 20,
    },
    block: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#444',
        padding: 16,
        gap: 8,
    },
    blockTitle: {
        fontSize: 16,
        lineHeight: 22,
        fontFamily: 'Archivo-SemiBold',
    },
    blockBody: {
        fontSize: 14,
        lineHeight: 20,
        color: '#CCC',
    },
    input: {
        height: 50,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#444',
        paddingHorizontal: 16,
        color: colors.white,
        fontSize: 17,
        letterSpacing: 1,
        marginBottom: 14,
    },
    button: {
        height: 52,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.green,
    },
    buttonOff: {
        opacity: 0.35,
    },
    buttonText: {
        color: '#000',
    },
});

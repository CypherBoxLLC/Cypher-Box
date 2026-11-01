import React, { useContext, useState } from "react";
import { Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import useElectrumConnection from "../../custom-hooks/useElectrumConnection";
import { SEED_SIGNER, SEED_SIGNER_MODE } from "../SigningHome/seedSigner";

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
        vaults > 0 || walletID || coldStorageWalletID ? `${vaults === 1 ? 'a wallet or vault' : `${vaults || 'some'} wallets or vaults`}` : null,
        isAuth || isStrikeAuth ? 'a Strike or CoinOS account' : null,
        isArkAuth ? 'a Bark Vault' : null,
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
                <Text style={styles.title}>{SEED_SIGNER}</Text>
                <Text style={styles.body}>
                    Turns an isolated phone that stays offline (a Pixel is recommended) into a cold signing device for
                    a watch-only wallet. The seed doesn't stay on the phone: you back it up as a SeedQR and scan it in
                    to sign.
                </Text>
                <Text style={styles.oneWay}>
                    There's no way back. Once it's on, this app is a seed-signer and nothing else, every time it opens.
                    To use Cypher Box as a normal wallet again, you'll have to delete it and install it fresh.
                </Text>

                <Text style={styles.heading}>Before you turn it on</Text>
                <Text style={styles.item}>• Use a dedicated phone: factory-reset it and install nothing else.</Text>
                <Text style={styles.item}>• Update the phone and install Cypher Box first, then take it offline for good.</Text>
                <Text style={styles.item}>• Keep Wi-Fi, mobile data and Bluetooth off from now on.</Text>
                <TouchableOpacity onPress={() => dispatchNavigate('SigningSafetyGuide')} accessibilityRole="button">
                    <Text style={styles.link}>Signing safely</Text>
                </TouchableOpacity>

                {!empty ? (
                    <View style={styles.block}>
                        <Text style={styles.blockTitle}>This needs a fresh install</Text>
                        <Text style={styles.blockBody}>
                            This app already has {inApp.join(', ')}. {SEED_SIGNER_MODE} only turns on in an empty app,
                            so nothing is ever deleted by accident. Move or back up what's here, delete Cypher Box and
                            install it fresh.
                        </Text>
                        {Platform.OS === 'ios' ? (
                            <Text style={styles.blockBody}>
                                On iPhone, wallets saved in the Keychain can come back after reinstalling. Delete them
                                in the app before you delete it.
                            </Text>
                        ) : null}
                    </View>
                ) : !offline ? (
                    <View style={styles.block}>
                        <Text style={styles.blockTitle}>
                            {connection === 'checking' ? 'Checking this phone is offline…' : 'This phone is online'}
                        </Text>
                        <Text style={styles.blockBody}>
                            Turn on Airplane Mode and turn off Wi-Fi and Bluetooth. This screen moves on once the phone
                            is offline.
                        </Text>
                    </View>
                ) : (
                    <>
                        <Text style={styles.heading}>Type {CONFIRM_WORD} to turn it on</Text>
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
                            accessibilityLabel={`Type ${CONFIRM_WORD} to confirm`}
                        />
                        <TouchableOpacity
                            style={[styles.button, !confirmed && styles.buttonOff]}
                            onPress={turnOn}
                            disabled={!confirmed}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !confirmed }}
                        >
                            <Text h3 style={styles.buttonText}>Turn on for good</Text>
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
        color: colors.blueText,
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

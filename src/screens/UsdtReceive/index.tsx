import Clipboard from '@react-native-clipboard/clipboard';
import React, { useContext, useMemo } from "react";
import { ScrollView, TouchableOpacity, View } from "react-native";
import QRCode from 'react-native-qrcode-svg';
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { resolveHotVaultTronAccount } from "@Cypher/services/tron/account";
import useAuthStore from "@Cypher/stores/authStore";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import styles from "./styles";

/**
 * Receive USDT: the address as a QR and as text, and the one rule about it.
 *
 * Reached from Receive on the USDT card. Where the key comes from, and the
 * rest of how this works, is on the guide behind the card's "?", so this
 * screen stays about handing out an address.
 *
 * The address is derived from the Hot Vault phrase. Nothing here is secret,
 * so it needs no biometric prompt.
 */
export default function UsdtReceive() {
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    // Memoised: the derivation runs BIP39's PBKDF2 over 2048 rounds.
    const account = useMemo(
        () => resolveHotVaultTronAccount(wallets, walletID),
        [wallets, walletID],
    );

    const copyAddress = () => {
        if (!account) return;
        Clipboard.setString(account.address);
        SimpleToast.show("Address copied", SimpleToast.SHORT);
    };

    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text bold subHeader style={styles.title}>Receive USDT</Text>

                    {account ? (
                        <ScrollView showsVerticalScrollIndicator={false}>
                            <View style={styles.qrBox}>
                                <QRCode
                                    value={account.address}
                                    size={180}
                                    color="black"
                                    backgroundColor="white"
                                />
                            </View>

                            <TouchableOpacity style={styles.addressBox} onPress={copyAddress} activeOpacity={0.8}>
                                <Text bold style={styles.address}>{account.address}</Text>
                                <Text style={styles.copyHint}>Tap to copy</Text>
                            </TouchableOpacity>

                            <Text bold style={styles.label}>Send only USDT on Tron here</Text>
                            <Text bold style={styles.description}>
                                This address lives on the Tron network. Anything else sent to it, on Tron or on
                                another chain, is lost and cannot be recovered.
                            </Text>
                        </ScrollView>
                    ) : (
                        // Only reachable if the Hot Vault goes while this screen
                        // is open: the card that leads here needs one to exist.
                        <Text bold style={styles.description}>
                            Your USDT address comes from your Hot Vault, and this phone no longer has one.
                        </Text>
                    )}
                </View>
            </View>
        </ScreenLayout>
    )
}

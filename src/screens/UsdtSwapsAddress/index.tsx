import Clipboard from '@react-native-clipboard/clipboard';
import React, { useContext, useMemo } from "react";
import { ScrollView, TouchableOpacity, View } from "react-native";
import QRCode from 'react-native-qrcode-svg';
import SimpleToast from "react-native-simple-toast";

import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { resolveHotVaultTronAccount } from "@Cypher/services/tron/account";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import styles from "./styles";

/**
 * The user's USDT address, and where its key comes from.
 *
 * This is the screen that would have shown a "USDT seed" if there were one.
 * There is not: services/tron/keys derives the Tron account from the Hot Vault
 * mnemonic at m/44'/195'/0'/0/0, so the only thing a second phrase screen
 * would add is a second place the same words can be photographed. What the
 * user actually needs to see is which address they got and which phrase backs
 * it, so that is what this shows, with a way through to the phrase itself in
 * the Hot Vault rather than a copy of it here.
 *
 * Address, path and public key are all public. Nothing on this screen is
 * secret, which is why it needs no biometric prompt.
 */
export default function UsdtSwapsAddress() {
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    const hotVault = useMemo(
        () => (wallets || []).find((w: any) => typeof w?.getID === 'function' && w.getID() === walletID),
        [wallets, walletID],
    );
    const account = useMemo(
        () => resolveHotVaultTronAccount(wallets, walletID),
        [wallets, walletID],
    );

    const copyAddress = () => {
        if (!account) return;
        Clipboard.setString(account.address);
        SimpleToast.show("Address copied", SimpleToast.SHORT);
    };

    const openHotVault = () => {
        if (!hotVault) return;
        dispatchNavigate('HotStorageVault', { wallet: hotVault });
    };

    const nextClickHandler = () => {
        dispatchNavigate('UsdtSwapsCreated');
    };

    // A user with no Hot Vault has no seed of ours and so no address. The
    // card on Home does not render in that state, so this is only reachable
    // if a vault is deleted mid-flow.
    if (!account) {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.container}>
                    <View style={styles.innerView}>
                        <Text bold subHeader style={styles.title}>Your USDT address</Text>
                        <Text bold style={styles.description}>
                            This needs a Hot Vault, because your USDT address is derived from its recovery
                            phrase. Create a Hot Vault first, then come back.
                        </Text>
                    </View>
                    <Button
                        text="Home"
                        onPress={() => dispatchReset('HomeScreen')}
                        style={styles.button}
                        textStyle={styles.btnText}
                    />
                </View>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout showToolbar progress={1} color={[colors.usdt.light, colors.usdt.main]}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text bold subHeader style={styles.title}>Your USDT address</Text>

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

                        <Text bold style={styles.label}>Where this key comes from</Text>
                        <Text style={styles.path}>{account.path}</Text>
                        <Text bold style={styles.description}>
                            There is no separate USDT recovery phrase. This address is derived from your Hot
                            Vault phrase at the path above, which is the standard one, so the same words
                            restore this address in any wallet that supports Tron. Back up that phrase and
                            your dollars are backed up with your bitcoin. Lose it and you lose both.
                        </Text>
                        <TouchableOpacity onPress={openHotVault}>
                            <Text bold style={styles.link}>
                                Open your Hot Vault to see the phrase
                            </Text>
                        </TouchableOpacity>
                    </ScrollView>
                </View>

                <Button
                    text="Next"
                    onPress={nextClickHandler}
                    style={styles.button}
                    textStyle={styles.btnText}
                />
            </View>
        </ScreenLayout>
    )
}

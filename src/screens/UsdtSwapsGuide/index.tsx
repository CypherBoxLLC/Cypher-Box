import Clipboard from '@react-native-clipboard/clipboard';
import React, { useContext, useMemo } from "react";
import { ScrollView, TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { resolveHotVaultTronAccount } from "@Cypher/services/tron/account";
import useAuthStore from "@Cypher/stores/authStore";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import styles from "./styles";

/**
 * How Bitcoin-USDT swaps work, behind the "?" on the USDT card.
 *
 * This was two onboarding screens, an introduction and an address screen.
 * Onboarding is now the Hot Vault's own, since USDT comes with the vault, so
 * their content lives here as reference: what it is, who is involved, where
 * the key comes from, and the one rule about the address. The QR and the
 * address as something to hand out live on the Receive screen instead.
 *
 * Nothing on this screen is secret. The address, its path and the public key
 * behind them are all public, which is why it needs no biometric prompt.
 */
export default function UsdtSwapsGuide() {
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    const hotVault = useMemo(
        () => (wallets || []).find((w: any) => typeof w?.getID === 'function' && w.getID() === walletID),
        [wallets, walletID],
    );
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

    const openHotVault = () => {
        if (!hotVault) return;
        dispatchNavigate('HotStorageVault', { wallet: hotVault });
    };

    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text bold subHeader style={styles.title}>Bitcoin and USDT</Text>

                    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                        <Text bold style={styles.sectionTitle}>What it does</Text>
                        <Text bold style={styles.description}>
                            It gives you a Tron address that holds USDT, a dollar token issued by Tether.
                            You can receive USDT to it and swap that USDT into bitcoin, which lands in your
                            own wallet. USDT is not bitcoin, and while you hold it you are holding a
                            company's promise of a dollar rather than bitcoin.
                        </Text>

                        <Text bold style={styles.sectionTitle}>Who is involved</Text>
                        <Text bold style={styles.description}>
                            Tether issues USDT and can freeze any USDT balance, including yours.
                            The Tron network carries it. Flashnet performs the swap and uses Relay to
                            collect your deposit. Cypher Box pays the Tron network fee on your deposit
                            through its own server, which is why a swap needs a connection to us.
                            None of them hold your bitcoin, and none of them can move your USDT without
                            your signature, but a swap in flight depends on all of them.
                        </Text>

                        <Text bold style={styles.sectionTitle}>Your keys</Text>
                        <Text bold style={styles.description}>
                            Your USDT address comes from your Hot Vault recovery phrase. There is no second
                            phrase to write down: the words you already backed up restore your dollars as
                            well as your bitcoin, in this app or in any other wallet that supports Tron.
                            The reverse is also true. If you lose that phrase you lose both, and nobody,
                            including us, can recover either.
                        </Text>
                        {account && (
                            <>
                                <Text style={styles.path}>Derived at {account.path}, the standard Tron path.</Text>
                                <TouchableOpacity onPress={openHotVault}>
                                    <Text bold style={styles.link}>
                                        Open your Hot Vault to see the phrase
                                    </Text>
                                </TouchableOpacity>
                            </>
                        )}

                        {account && (
                            <>
                                <Text bold style={styles.sectionTitle}>Your address</Text>
                                <Text bold style={styles.description}>
                                    It lives on the Tron network. Send only USDT on Tron to it: anything else,
                                    on Tron or on another chain, is lost and cannot be recovered.
                                </Text>
                                <TouchableOpacity style={styles.addressBox} onPress={copyAddress} activeOpacity={0.8}>
                                    <Text bold style={styles.address}>{account.address}</Text>
                                    <Text style={styles.copyHint}>Tap to copy</Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </ScrollView>
                </View>
            </View>
        </ScreenLayout>
    )
}

import React, { useCallback, useContext, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { getBuildNumber, getVersion } from "react-native-device-info";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import useElectrumConnection from "../../custom-hooks/useElectrumConnection";
import Settings from "../HotStorageVault/Settings";
import { startSigning } from "../SignOnce/start";
import Signer from "./Signer";
import SignerActionCard from "./SignerActionCard";
import { SEED_SIGNER, takeSeedBackedUp } from "./seedSigner";
import SignerButton from "./SignerButton";

/**
 * The home screen in Offline Seed-Signer mode: an offline phone that signs transactions made by a watch-only wallet,
 * whether a Cypher Box Cold Vault, Sparrow or another app. The seed is meant to live on SeedQR backups, not here. With a Hot Vault it's one screen:
 * the signer, then the vault's settings, and no balance, capsules, history or receive address. Without one, the ways
 * to get one, and signing from a backup, which keeps nothing on the phone. Lightning,
 * the Cold Vault, send and receive are out of the way either way. "Connected" is only claimed when the app's Electrum
 * server answers; no answer proves nothing.
 *
 * Without a Hot Vault, making a seed comes first until this phone has shown a seed's public key or signed. After that
 * signing does: the seed is never kept, so a home that still led with making one would look as if it had been lost.
 */
export default function SigningHome() {
    const { walletID, vaultTab, setVaultTab, signedOnThisPhone, signerKeyShown } = useAuthStore();
    const { wallets, walletsInitialized } = useContext(BlueStorageContext);
    // the app's network switch doesn't count here: the probe itself is how a seed-signer knows it's offline
    const connection = useElectrumConnection(true, false);
    const wallet = wallets?.find((w: any) => w.getID() === walletID);
    const canSign = typeof wallet?.cosignPsbt === 'function' && !!wallet?.allowCosignPsbt?.();
    const signingFirst = !!(signedOnThisPhone || signerKeyShown);

    // a seed just made and backed up is mentioned once, when the home is next shown, and not again after the user moves on
    const [backedUp, setBackedUp] = useState<string | null>(null);
    useFocusEffect(
        useCallback(() => {
            const fingerprint = takeSeedBackedUp();
            if (fingerprint) setBackedUp(fingerprint);
            return () => setBackedUp(null);
        }, []),
    );

    // the vault's Settings tab reads hot or cold from vaultTab, and a signing phone only has the Hot Vault
    useEffect(() => {
        if (vaultTab) setVaultTab(false);
    }, [vaultTab, setVaultTab]);

    // not "no Hot Vault" until the wallets have loaded
    if (!walletsInitialized) {
        return (
            <ScreenLayout isBackButton={false} disableScroll>
                <View style={styles.loading}>
                    <ActivityIndicator color={colors.white} />
                </View>
            </ScreenLayout>
        );
    }

    if (canSign) {
        return (
            <ScreenLayout showToolbar isBackButton={false} title={SEED_SIGNER} disableScroll style={styles.vault}>
                <Settings wallet={wallet} header={<Signer wallet={wallet} connection={connection} />} />
            </ScreenLayout>
        );
    }

    // the same title and buttons as the signer with a Hot Vault, and it scrolls, as on a small phone they run past
    // the screen
    return (
        <ScreenLayout showToolbar isBackButton={false} title={SEED_SIGNER}>
            <View style={styles.container}>
                {connection === 'connected' ? (
                    <Text style={styles.alert}>
                        This phone is connected to the internet. A phone you sign with should stay offline.
                    </Text>
                ) : null}
                <Text style={styles.version}>
                    Cypher Box {getVersion()} (build {getBuildNumber()})
                </Text>
                {backedUp ? (
                    <View style={styles.backedUpRow}>
                        <MaterialCommunityIcons name="check-circle" size={18} color={colors.green} style={styles.backedUpIcon} />
                        <Text style={styles.backedUp}>{`Seed ${backedUp} was created and backed up.`}</Text>
                    </View>
                ) : null}
                <Text style={styles.lead}>
                    {signingFirst
                        ? "This phone doesn't keep your seed: it lives on your backup. You'll see what a transaction does before anything is signed."
                        : "Create a seed and back it up as a SeedQR: it's never saved on this phone. To sign, scan the SeedQR."}
                </Text>

                {/* a seed is made in memory and never saved (screens/CreateSignerSeed); there's no Recover, which saves one */}
                <View style={styles.card}>
                    {signingFirst ? (
                        <SignerActionCard
                            icon="file-sign"
                            title="Sign a Transaction (.PSBT)"
                            subtitle="Scan or open it, check it, then scan your SeedQR"
                            onPress={() => startSigning()}
                        />
                    ) : (
                        <SignerActionCard
                            icon="seed-outline"
                            title="Create a Seed"
                            subtitle="12 new words, backed up on paper and as a SeedQR"
                            onPress={() => dispatchNavigate('CreateSignerSeed')}
                        />
                    )}
                </View>
            </View>

            <View style={styles.buttons}>
                {signingFirst ? null : (
                    <SignerButton label="Sign a Transaction (.PSBT)" onPress={() => startSigning()} />
                )}
                <SignerButton label="Show a Seed's Public Key" onPress={() => dispatchNavigate('CreateSignerSeed', { mode: 'show' })} />
                {signingFirst ? (
                    <SignerButton label="Create Another Seed" onPress={() => dispatchNavigate('CreateSignerSeed')} />
                ) : null}
                <SignerButton label="Signing Safely" onPress={() => dispatchNavigate('SigningSafetyGuide')} />
                <SignerButton label="App Settings" onPress={() => dispatchNavigate('Settings')} />
            </View>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    loading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    vault: {
        paddingBottom: 20,
    },
    container: {
        // the Unlock Hot Vault card is the screen width less 40
        paddingHorizontal: 20,
        paddingTop: 28,
    },
    alert: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.redLight,
        marginBottom: 8,
    },
    version: {
        fontSize: 14,
        color: colors.gray.light,
    },
    backedUpRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 20,
    },
    backedUpIcon: {
        marginEnd: 8,
    },
    backedUp: {
        flex: 1,
        fontSize: 15,
        lineHeight: 22,
        color: colors.green,
    },
    lead: {
        fontSize: 15,
        lineHeight: 22,
        color: '#CCC',
        marginTop: 20,
    },
    card: {
        marginTop: 28,
    },
    buttons: {
        // the buttons bring their own 20 at the sides, like the signer's
        marginTop: 28,
        paddingBottom: 24,
    },
});

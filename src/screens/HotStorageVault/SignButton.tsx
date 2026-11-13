import React from "react";
import { Alert, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";

import { Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import { ElectrumConnection } from "../../custom-hooks/useElectrumConnection";
import styles from "./styles";
import useSignTransaction from "./useSignTransaction";
import loc from "../../../loc";

/**
 * The broadcast pill's twin on the Hot Vault: open a transaction to sign from a file, or scan it. Until the phone is
 * offline it's dimmed with a warning under it, and a tap says why instead of opening anything. Shown on the vault tab,
 * and on a signing phone's Offline Signer tab.
 */
export default function SignButton({ wallet, connection }: { wallet: any; connection: ElectrumConnection }) {
    const { signFromFile, signFromQr } = useSignTransaction(wallet);
    // dimmed and locked until the server stops answering, which is as close as the app gets to knowing the phone is
    // offline; it locks again within about ten seconds of the phone coming back online
    const signUnlocked = connection === 'no-answer';
    const explainSignLock = () =>
        Alert.alert(
            loc.cypherbox.vault.storage_vault.sign.offline_only_title,
            loc.cypherbox.vault.storage_vault.sign.offline_only_body,
            [
                { text: loc.cypherbox.vault.storage_vault.sign.signing_safely, onPress: () => dispatchNavigate('SigningSafetyGuide') },
                { text: loc._.ok, style: 'cancel' },
            ],
        );

    return (
        <>
            <View
                style={
                    signUnlocked
                        ? [styles.linearGradientStyle, styles.broadcastShadow]
                        : [styles.linearGradientStyle, styles.signShadow, styles.signLocked]
                }
            >
                <View style={styles.mainShadowStyle}>
                    <LinearGradient
                        start={{ x: 1, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        colors={[colors.black.gradientTop, colors.black.gradientBottom]}
                        style={styles.broadcastButton}
                    >
                        <TouchableOpacity
                            style={styles.broadcastImport}
                            onPress={signUnlocked ? signFromFile : explainSignLock}
                            accessibilityRole="button"
                            accessibilityLabel={loc.cypherbox.vault.storage_vault.sign.from_file_a11y}
                            accessibilityHint={signUnlocked ? undefined : loc.cypherbox.vault.storage_vault.sign.offline_hint}
                        >
                            <MaterialCommunityIcons name="file-sign" size={20} color={colors.green} />
                            <Text h4 numberOfLines={1} adjustsFontSizeToFit style={styles.broadcastLabel}>
                                {loc.cypherbox.vault.storage_vault.sign.button}
                            </Text>
                        </TouchableOpacity>
                        <View style={styles.broadcastDivider} />
                        <TouchableOpacity
                            style={styles.broadcastScan}
                            onPress={signUnlocked ? signFromQr : explainSignLock}
                            accessibilityRole="button"
                            accessibilityLabel={loc.cypherbox.vault.storage_vault.sign.scan_a11y}
                            accessibilityHint={signUnlocked ? undefined : loc.cypherbox.vault.storage_vault.sign.offline_hint}
                        >
                            <MaterialCommunityIcons name="qrcode-scan" size={20} color={colors.white} />
                        </TouchableOpacity>
                    </LinearGradient>
                </View>
            </View>
            {/* "online" only once the server has answered: right after opening, an offline phone hasn't missed twice yet */}
            {!signUnlocked &&
                <TouchableOpacity
                    onPress={() => dispatchNavigate('SigningSafetyGuide')}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    style={styles.signStatus}
                >
                    <Text style={styles.signStatusText}>
                        {connection === 'connected' ? loc.cypherbox.vault.storage_vault.sign.online : ''}
                        {loc.cypherbox.vault.storage_vault.sign.offline_device_only}{' '}
                        <Text style={styles.signStatusLink}>{loc.cypherbox.vault.storage_vault.sign.signing_safely}</Text>
                    </Text>
                </TouchableOpacity>
            }
        </>
    );
}

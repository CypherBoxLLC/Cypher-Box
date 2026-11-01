import React, { useEffect, useState } from "react";
import { ActivityIndicator, InteractionManager, StyleSheet, View } from "react-native";

import { Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import { ElectrumConnection } from "../../custom-hooks/useElectrumConnection";
import SignButton from "../HotStorageVault/SignButton";

/**
 * The top of a signing phone's home, above the Hot Vault's settings: the sign button and the key it signs with,
 * nothing about coins. A balance, capsules or history would only be what the phone last saw while online, and a
 * signer has no use for them: what a transaction spends shows in its review before signing.
 */
export default function Signer({ wallet, connection }: { wallet: any; connection: ElectrumConnection }) {
    // undefined while it's worked out, null if this wallet can't give one
    const [fingerprint, setFingerprint] = useState<string | null>();

    useEffect(() => {
        // worked out from the seed, which takes a moment, so once the screen is up
        const task = InteractionManager.runAfterInteractions(() => {
            try {
                setFingerprint(String(wallet.getMasterFingerprintHex()).toUpperCase());
            } catch (_) {
                setFingerprint(null);
            }
        });
        return () => task.cancel();
    }, [wallet]);

    return (
        <View style={styles.container}>
            <Text style={styles.lead}>
                Signs for a watch & broadcast only wallet that has this seed's public key: a Cypher Box Cold Vault, Sparrow or
                another app. You'll see what a transaction does before anything is signed.
            </Text>
            {/* to check against the watch-only wallet, which shows the same fingerprint for this key; its space is held
                while it's worked out, so the button under it doesn't jump */}
            {fingerprint !== null ? (
                <View style={styles.key}>
                    <Text style={styles.keyLabel}>Key fingerprint</Text>
                    {fingerprint ? (
                        <Text semibold style={styles.keyValue}>{fingerprint}</Text>
                    ) : (
                        <ActivityIndicator size="small" color={colors.white} />
                    )}
                </View>
            ) : null}
            <SignButton wallet={wallet} connection={connection} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingTop: 28,
        paddingBottom: 24,
    },
    lead: {
        fontSize: 15,
        lineHeight: 22,
        color: '#CCC',
        marginHorizontal: 28,
    },
    key: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginHorizontal: 20,
        marginTop: 20,
        marginBottom: 24,
        paddingVertical: 14,
        paddingHorizontal: 18,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#444',
    },
    keyLabel: {
        fontSize: 14,
        color: colors.gray.light,
    },
    keyValue: {
        fontSize: 16,
        lineHeight: 20,
        letterSpacing: 1,
    },
});

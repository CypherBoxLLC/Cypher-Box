import React, { useEffect, useState } from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { getBuildNumber, getVersion } from "react-native-device-info";

import { Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";

const BlueElectrum = require('../../../blue_modules/BlueElectrum');

/**
 * Status line under a Hot Vault's freshly signed transaction ("Sign a transaction": signing for a watch-only wallet,
 * a Cypher Box Cold Vault or another app, usually on another phone), styled like the Bark vault card's status line:
 * red when something needs attention.
 *
 * "Connected" is only claimed when the app's Electrum server actually answers. No answer proves nothing (the server
 * may be down or disabled), so then the line only gives the update advice and this phone's version, which the user
 * compares with the other phone's.
 */
export default function SigningPhoneStatus() {
    const navigation: any = useNavigation();
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        let cancelled = false;
        BlueElectrum.ping()
            .then((answered: boolean) => {
                if (!cancelled) setConnected(!!answered);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <TouchableOpacity
            onPress={() => navigation.navigate('SigningSafetyGuide')}
            activeOpacity={0.7}
            accessibilityRole="button"
            style={styles.container}
        >
            {connected ? (
                <Text h4 style={[styles.line, styles.alert]}>
                    This phone is connected to the internet. A phone you sign with should stay offline.
                </Text>
            ) : null}
            <Text h4 style={styles.line}>
                Keep this phone offline with automatic updates off. Update Cypher Box here only on purpose, to a version that
                has been out for a few weeks. If your other phone runs Cypher Box too, keep both on the same version.
            </Text>
            <Text h4 style={styles.version}>
                This phone: Cypher Box {getVersion()} (build {getBuildNumber()}) · <Text h4 style={styles.link}>Signing safely</Text>
            </Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        marginHorizontal: 20,
        marginTop: 12,
        marginBottom: 16,
    },
    line: {
        color: colors.gray.light,
        marginBottom: 8,
    },
    alert: {
        color: colors.redLight,
    },
    version: {
        color: colors.gray.light,
    },
    link: {
        color: colors.blueText,
        textDecorationLine: 'underline',
    },
});

import React, { useContext, useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import SeedQRGrid from "@Cypher/components/SeedQRGrid";
import { mnemonicToSeedQR, seedQRGrid } from "@Cypher/helpers";
import { colors, widths } from "@Cypher/style-guide";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import useProtectSecret from "../../custom-hooks/useProtectSecret";
import OfflineSeedWarning from "@Cypher/components/OfflineSeedWarning";
import useAuthStore from "@Cypher/stores/authStore";
import useSeedQRCheck from "../../custom-hooks/useSeedQRCheck";

type Step = 'intro' | 'grid' | 'check' | 'done';

/**
 * Make a SeedQR of the Hot Vault's recovery phrase: shown as a numbered grid to copy by hand onto a paper template
 * or a steel plate, then checked by scanning the copy. Nothing is printed, shared or saved: each of those would put
 * the phrase somewhere it can leak. The phrase is read from the wallet here, never passed through navigation.
 */
export default function SeedQRBackup({ route, navigation }: { route: any; navigation: any }) {
    const { wallets } = useContext(BlueStorageContext);
    const wallet = (wallets ?? []).find((w: any) => w.getID() === route?.params?.walletID);
    const [step, setStep] = useState<Step>('intro');
    const signingMode = useAuthStore(s => s.signingMode);

    useProtectSecret();

    const grid = useMemo(() => {
        try {
            return seedQRGrid(mnemonicToSeedQR(wallet?.getSecret?.() ?? ''));
        } catch (_) {
            return null;
        }
    }, [wallet]);
    const hasPassphrase = !!wallet?.getPassphrase?.();

    const check = useSeedQRCheck(wallet?.getSecret?.() ?? '');
    useEffect(() => {
        if (check.result === 'ok') setStep('done');
    }, [check.result]);

    if (!grid) {
        return (
            <ScreenLayout showToolbar isBackButton disableScroll>
                <View style={styles.content}>
                    <Text style={styles.title}>SeedQR backup</Text>
                    <Text style={styles.body}>
                        This vault's recovery phrase can't be turned into a SeedQR. SeedQR only works with standard
                        English 12 or 24-word phrases.
                    </Text>
                </View>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout showToolbar isBackButton disableScroll>
            <ScrollView contentContainerStyle={styles.content}>
                {step === 'intro' && (
                    <>
                        <Text style={styles.title}>SeedQR backup</Text>
                        <Text style={styles.body}>
                            A SeedQR is your recovery phrase drawn as a QR code. With it you can sign by scanning
                            instead of typing your words, and wallets like SeedSigner, Jade and Krux can read it too.
                        </Text>
                        <Text style={styles.body}>
                            You'll copy it by hand onto a {grid.size}×{grid.size} grid: a printed SeedQR template or a
                            steel plate. It takes about 20 minutes. Then you scan your copy to check it.
                        </Text>
                        <Text style={styles.warning}>
                            Anyone who scans your SeedQR can take your bitcoin. Never photograph it, screenshot it or
                            print it from a phone or computer.
                        </Text>
                        {hasPassphrase ? (
                            <Text style={styles.note}>
                                Your passphrase isn't in the SeedQR. Keep it on its own, as you do now.
                            </Text>
                        ) : null}
                        {signingMode ? <OfflineSeedWarning style={styles.seedWarning} /> : null}
                        <TouchableOpacity style={styles.primary} onPress={() => setStep('grid')} accessibilityRole="button">
                            <Text h3>Show my SeedQR</Text>
                        </TouchableOpacity>
                    </>
                )}

                {step === 'grid' && (
                    <>
                        <Text style={styles.title}>Copy each filled square</Text>
                        {Platform.OS === 'ios' ? (
                            <Text style={styles.warning}>Don't take a screenshot: it would save your SeedQR in Photos.</Text>
                        ) : null}
                        <SeedQRGrid grid={grid} width={widths - 48} />
                        <Text style={styles.note}>
                            Zoom into each quarter to copy it. The blue lines mark every 5 squares, as on the templates.
                        </Text>
                        {signingMode ? <OfflineSeedWarning style={styles.seedWarning} /> : null}
                        <TouchableOpacity style={styles.primary} onPress={() => setStep('check')} accessibilityRole="button">
                            <Text h3>I've copied it</Text>
                        </TouchableOpacity>
                    </>
                )}

                {step === 'check' && (
                    <>
                        <Text style={styles.title}>Check your copy</Text>
                        <Text style={styles.body}>
                            Scan the SeedQR you drew. A wrong square is easy to miss, and you want to find it now, not
                            when you need to sign.
                        </Text>
                        <TouchableOpacity style={styles.primary} onPress={check.scan} accessibilityRole="button">
                            <Text h3>Scan my copy</Text>
                        </TouchableOpacity>
                        {check.result === 'mismatch' ? (
                            <Text style={styles.error}>
                                This doesn't match your recovery phrase. Compare your copy with the grid square by square, fix it
                                and scan again.
                            </Text>
                        ) : null}
                        <TouchableOpacity style={styles.secondary} onPress={() => setStep('grid')} accessibilityRole="button">
                            <Text h3>Show the grid again</Text>
                        </TouchableOpacity>
                    </>
                )}

                {step === 'done' && (
                    <>
                        <Text style={styles.title}>Your SeedQR scans</Text>
                        <Text style={styles.success}>It scans back to your recovery phrase.</Text>
                        {/* scanners repair a few wrong squares without saying so: a copy that scans can still hold a
                            mistake, which leaves less room for wear later */}
                        <Text style={styles.body}>
                            A scanner quietly fixes a few wrong squares, so a copy can scan even with a small mistake.
                            Compare it with the grid once more, square by square.
                        </Text>
                        <Text style={styles.body}>
                            Store it as carefully as your {grid.size === 25 ? 12 : 24} words, and not in the same place
                            as your passphrase if you use one.
                        </Text>
                        <TouchableOpacity style={styles.primary} onPress={() => navigation.goBack()} accessibilityRole="button">
                            <Text h3>Done</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.secondary} onPress={() => setStep('grid')} accessibilityRole="button">
                            <Text h3>Compare with the grid</Text>
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
        paddingBottom: 40,
    },
    title: {
        fontSize: 18,
        lineHeight: 24,
        fontFamily: 'Archivo-SemiBold',
        marginBottom: 12,
    },
    body: {
        fontSize: 14,
        lineHeight: 20,
        color: '#CCC',
        marginBottom: 12,
    },
    warning: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.redLight,
        marginBottom: 12,
    },
    note: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.gray.light,
        marginTop: 12,
    },
    // the content already has its side padding
    seedWarning: {
        marginHorizontal: 0,
        marginBottom: 4,
    },
    error: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.redLight,
        marginTop: 12,
    },
    success: {
        fontSize: 15,
        lineHeight: 20,
        color: colors.green,
        marginBottom: 12,
    },
    primary: {
        height: 47,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 16,
        backgroundColor: colors.blueText,
    },
    secondary: {
        height: 47,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 14,
        borderWidth: 1,
        borderColor: colors.blueText,
    },
});

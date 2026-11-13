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
import loc from "../../../loc";

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
                    <Text style={styles.title}>{loc.cypherbox.seedqr_backup.title}</Text>
                    <Text style={styles.body}>
                        {loc.cypherbox.seedqr_backup.unsupported}
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
                        <Text style={styles.title}>{loc.cypherbox.seedqr_backup.title}</Text>
                        <Text style={styles.body}>
                            {loc.cypherbox.seedqr_backup.intro}
                        </Text>
                        <Text style={styles.body}>
                            {loc.formatString(loc.cypherbox.seedqr_backup.copy_by_hand, { size: grid.size })}
                        </Text>
                        <Text style={styles.warning}>
                            {loc.cypherbox.seedqr_backup.warning}
                        </Text>
                        {hasPassphrase ? (
                            <Text style={styles.note}>
                                {loc.cypherbox.seedqr_backup.passphrase_note}
                            </Text>
                        ) : null}
                        {signingMode ? <OfflineSeedWarning style={styles.seedWarning} /> : null}
                        <TouchableOpacity style={styles.primary} onPress={() => setStep('grid')} accessibilityRole="button">
                            <Text h3>{loc.cypherbox.seedqr_backup.show}</Text>
                        </TouchableOpacity>
                    </>
                )}

                {step === 'grid' && (
                    <>
                        <Text style={styles.title}>{loc.cypherbox.seedqr_backup.grid_title}</Text>
                        {Platform.OS === 'ios' ? (
                            <Text style={styles.warning}>{loc.cypherbox.seedqr_backup.no_screenshot}</Text>
                        ) : null}
                        <SeedQRGrid grid={grid} width={widths - 48} />
                        <Text style={styles.note}>
                            {loc.cypherbox.seedqr_backup.zoom_note}
                        </Text>
                        {signingMode ? <OfflineSeedWarning style={styles.seedWarning} /> : null}
                        <TouchableOpacity style={styles.primary} onPress={() => setStep('check')} accessibilityRole="button">
                            <Text h3>{loc.cypherbox.seedqr_backup.copied}</Text>
                        </TouchableOpacity>
                    </>
                )}

                {step === 'check' && (
                    <>
                        <Text style={styles.title}>{loc.cypherbox.seedqr_backup.check_title}</Text>
                        <Text style={styles.body}>
                            {loc.cypherbox.seedqr_backup.check_body}
                        </Text>
                        <TouchableOpacity style={styles.primary} onPress={check.scan} accessibilityRole="button">
                            <Text h3>{loc.cypherbox.seedqr_backup.scan_copy}</Text>
                        </TouchableOpacity>
                        {check.result === 'mismatch' ? (
                            <Text style={styles.error}>
                                {loc.cypherbox.seedqr_backup.mismatch}
                            </Text>
                        ) : null}
                        <TouchableOpacity style={styles.secondary} onPress={() => setStep('grid')} accessibilityRole="button">
                            <Text h3>{loc.cypherbox.seedqr_backup.show_grid_again}</Text>
                        </TouchableOpacity>
                    </>
                )}

                {step === 'done' && (
                    <>
                        <Text style={styles.title}>{loc.cypherbox.seedqr_backup.done_title}</Text>
                        <Text style={styles.success}>{loc.cypherbox.seedqr_backup.done_success}</Text>
                        {/* scanners repair a few wrong squares without saying so: a copy that scans can still hold a
                            mistake, which leaves less room for wear later */}
                        <Text style={styles.body}>
                            {loc.cypherbox.seedqr_backup.done_scanner_note}
                        </Text>
                        <Text style={styles.body}>
                            {loc.formatString(loc.cypherbox.seedqr_backup.store, { count: grid.size === 25 ? 12 : 24 })}
                        </Text>
                        <TouchableOpacity style={styles.primary} onPress={() => navigation.goBack()} accessibilityRole="button">
                            <Text h3>{loc.cypherbox.seedqr_backup.done}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.secondary} onPress={() => setStep('grid')} accessibilityRole="button">
                            <Text h3>{loc.cypherbox.seedqr_backup.compare}</Text>
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

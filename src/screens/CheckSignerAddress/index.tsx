import React, { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text as SelectableText, TextInput, TouchableOpacity, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import {
    ADDRESS_SEARCH_LIMIT,
    AddressMatch,
    SignerWallet,
    addressFromText,
    findAddress,
    isP2wshScript,
} from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";
import signStyles from "../SignOnce/styles";

type Result =
    | { kind: 'idle' }
    | { kind: 'searching'; address: string; checked: number }
    | { kind: 'found'; address: string; match: AddressMatch }
    | { kind: 'not-found'; address: string }
    | { kind: 'single-key'; address: string }
    | { kind: 'error'; message: string };

const formatCount = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * "Check an Address": before a receive address from the multisig app is used, this phone says whether it really is one
 * of the registered wallets' addresses, worked out here from their keys, and which one. Searches the first 1,000
 * receive and change addresses of each wallet, lowest first.
 */
export default function CheckSignerAddress({ navigation }: { navigation: any }) {
    const { signerWallets } = useAuthStore();
    const wallets: SignerWallet[] = Object.values(signerWallets ?? {});
    const [typed, setTyped] = useState('');
    const [result, setResult] = useState<Result>({ kind: 'idle' });
    // a newer check, or leaving the screen, stops the one running
    const run = useRef(0);

    useEffect(
        () => () => {
            run.current += 1;
        },
        [],
    );

    const check = async (text: string) => {
        const mine = ++run.current;
        let parsed: { address: string; script: Buffer };
        try {
            parsed = addressFromText(text);
        } catch (e: any) {
            setResult({ kind: 'error', message: e.message });
            return;
        }
        const { address, script } = parsed;
        if (!isP2wshScript(script)) {
            setResult({ kind: 'single-key', address });
            return;
        }
        setResult({ kind: 'searching', address, checked: 0 });
        const match = await findAddress(script, wallets, {
            onProgress: checked => {
                if (run.current === mine) setResult({ kind: 'searching', address, checked });
            },
            isCancelled: () => run.current !== mine,
        });
        if (run.current !== mine) return;
        setResult(match ? { kind: 'found', address, match } : { kind: 'not-found', address });
    };

    const scan = () => {
        requestCameraAuthorization().then(() => {
            let done = false;
            navigation.navigate('ScanQRCodeRoot', {
                screen: 'ScanQRCode',
                params: {
                    showFileImportButton: false,
                    onBarScanned: (ret: any) => {
                        if (done) return;
                        done = true;
                        // opened without launchedBy, the scanner does not close itself
                        navigation.getParent()?.pop();
                        const data = typeof ret === 'string' ? ret : ret?.data;
                        if (data) check(String(data));
                    },
                },
            });
        });
    };

    const renderResult = () => {
        switch (result.kind) {
            case 'idle':
                return null;
            case 'error':
                return <Text style={signStyles.error}>{result.message}</Text>;
            case 'searching':
                return (
                    <Text style={styles.progress}>
                        {`Looking… ${formatCount(result.checked)} of ${formatCount(ADDRESS_SEARCH_LIMIT)}`}
                    </Text>
                );
            case 'found': {
                const { wallet, branch, index } = result.match;
                return (
                    <View style={[styles.result, styles.found]}>
                        <Text bold style={styles.verdict}>
                            {`${branch === 0 ? 'Receive' : 'Change'} address #${index} in ${wallet.name}`}
                        </Text>
                        <Text style={styles.detail}>{`${wallet.m} of ${wallet.keys.length} multisig`}</Text>
                        <SelectableText selectable style={styles.mono}>{result.address}</SelectableText>
                    </View>
                );
            }
            case 'not-found':
                return (
                    <View style={[styles.result, styles.missing]}>
                        <Text bold style={styles.verdict}>
                            {`Not in the first ${formatCount(ADDRESS_SEARCH_LIMIT)} addresses of any wallet on this phone`}
                        </Text>
                        <Text style={styles.detail}>Don't use this address unless you know where it comes from.</Text>
                        <SelectableText selectable style={styles.mono}>{result.address}</SelectableText>
                    </View>
                );
            case 'single-key':
                return (
                    <View style={[styles.result, styles.missing]}>
                        <Text bold style={styles.verdict}>This isn't a multisig address</Text>
                        <Text style={styles.detail}>
                            It's a single-key address, so it isn't in any multisig wallet on this phone.
                        </Text>
                        <SelectableText selectable style={styles.mono}>{result.address}</SelectableText>
                    </View>
                );
        }
    };

    return (
        <ScreenLayout showToolbar isBackButton disableScroll>
            <ScrollView style={signStyles.scroll} contentContainerStyle={signStyles.content} keyboardShouldPersistTaps="handled">
                <Text style={signStyles.title}>Check an Address</Text>
                <Text style={signStyles.body}>
                    {`Before you use a receive address from your multisig app, scan it here. This phone works out each wallet's addresses from its keys and looks through the first ${formatCount(ADDRESS_SEARCH_LIMIT)} receive and change addresses.`}
                </Text>
                {wallets.length === 0 ? (
                    <Text style={signStyles.error}>There are no multisig wallets on this phone to check against.</Text>
                ) : (
                    <>
                        <TouchableOpacity style={signStyles.primary} onPress={scan} accessibilityRole="button">
                            <Text h3>Scan Address</Text>
                        </TouchableOpacity>
                        <TextInput
                            style={signStyles.input}
                            value={typed}
                            onChangeText={setTyped}
                            placeholder="Or type or paste the address"
                            placeholderTextColor="#777"
                            autoCapitalize="none"
                            autoCorrect={false}
                            spellCheck={false}
                        />
                        <TouchableOpacity style={signStyles.secondary} onPress={() => check(typed)} accessibilityRole="button">
                            <Text h3>Check</Text>
                        </TouchableOpacity>
                        {renderResult()}
                    </>
                )}
            </ScrollView>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    progress: {
        fontSize: 14,
        color: colors.gray.light,
        marginTop: 16,
    },
    result: {
        marginTop: 16,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
    },
    found: {
        borderColor: colors.green,
    },
    missing: {
        borderColor: colors.redLight,
    },
    verdict: {
        fontSize: 16,
        lineHeight: 22,
    },
    detail: {
        fontSize: 14,
        lineHeight: 20,
        color: '#CCC',
        marginTop: 4,
    },
    mono: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.white,
        marginTop: 8,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
});

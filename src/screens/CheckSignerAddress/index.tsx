import React, { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    Text as SelectableText,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import OfflineSeedWarning from "@Cypher/components/OfflineSeedWarning";
import {
    ADDRESS_SEARCH_LIMIT,
    AddressMatch,
    SignerAccount,
    SignerWallet,
    SingleKeyMatch,
    addressFromText,
    findAddress,
    findSingleKeyAddressIn,
    signerAccountFromRoot,
    isP2wpkhScript,
    isP2wshScript,
    nextFrame,
    rootFromBackupAsync,
} from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import useProtectSecret from "../../custom-hooks/useProtectSecret";
import useElectrumConnection from "../../custom-hooks/useElectrumConnection";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";
import signStyles from "../SignOnce/styles";

type Result =
    | { kind: 'idle' }
    | { kind: 'searching'; address: string; checked: number }
    | { kind: 'found'; address: string; match: AddressMatch }
    | { kind: 'not-found'; address: string }
    | { kind: 'no-wallets'; address: string }
    | { kind: 'needs-seed'; address: string }
    // `remembered`: checked against a public key kept on this phone; `kept`: the seed's key is now kept, after its SeedQR
    | { kind: 'found-single'; address: string; match: SingleKeyMatch; remembered: boolean; kept?: boolean }
    | { kind: 'not-found-single'; address: string; fingerprint: string; kept: boolean }
    | { kind: 'not-in-remembered'; address: string }
    | { kind: 'unsupported'; address: string }
    | { kind: 'error'; message: string };

const ONLINE = "This phone is online. A seed is only loaded once it's offline: Airplane Mode on, Wi-Fi and Bluetooth off.";
const CHECKING = 'Checking this phone is offline…';

const formatCount = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// after a SeedQR check: whether the next check of this seed will need it again
const keptNote = (kept?: boolean) =>
    kept
        ? " Its public key is now remembered on this phone, so the next check won't need the SeedQR."
        : " Its public key isn't remembered, because of the passphrase.";

/**
 * "Receive - Check Address": before an address from the watch-only wallet or the multisig app is used to receive,
 * this phone says whether it really is one of its addresses, worked out here, and which one. A multisig address is
 * looked for in the registered wallets, from their public keys. A single-key address is looked for in the public keys
 * remembered on this phone (signerAccounts, kept by default from each seed's key screen); for a seed whose key isn't
 * there, its SeedQR (or words) is loaded only for the check, its public key is remembered for next time (not with a
 * passphrase), and the seed is dropped. Either way the first 1,000 receive and change addresses are searched, lowest
 * first. Remembered keys are listed here, to forget.
 */
export default function CheckSignerAddress({ navigation }: { navigation: any }) {
    const { signerWallets, signerAccounts, addSignerAccount, removeSignerAccount } = useAuthStore();
    const wallets: SignerWallet[] = Object.values(signerWallets ?? {});
    const accounts: SignerAccount[] = Object.values(signerAccounts ?? {}).sort((a, b) => a.addedAt - b.addedAt);
    const [typed, setTyped] = useState('');
    const [result, setResult] = useState<Result>({ kind: 'idle' });
    // the single-key address waiting for its seed, and that seed's words and passphrase while they're typed
    const pending = useRef<{ address: string; script: Buffer } | null>(null);
    const [words, setWords] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [working, setWorking] = useState(false);
    const [seedError, setSeedError] = useState<string | null>(null);
    const connection = useElectrumConnection(true, false);
    const offline = connection === 'no-answer';
    const onlineNote = connection === 'checking' ? CHECKING : ONLINE;
    // a newer check, or leaving the screen, stops the one running
    const run = useRef(0);

    // a recovery phrase can be typed here: hide it from the app switcher, block screenshots
    useProtectSecret();

    useEffect(
        () => () => {
            run.current += 1;
            pending.current = null;
        },
        [],
    );

    const check = async (text: string) => {
        const mine = ++run.current;
        pending.current = null;
        setSeedError(null);
        let parsed: { address: string; script: Buffer };
        try {
            parsed = addressFromText(text);
        } catch (e: any) {
            setResult({ kind: 'error', message: e.message });
            return;
        }
        const { address, script } = parsed;
        if (isP2wpkhScript(script)) {
            pending.current = { address, script };
            if (!accounts.length) {
                setResult({ kind: 'needs-seed', address });
                return;
            }
            setResult({ kind: 'searching', address, checked: 0 });
            const remembered = await findSingleKeyAddressIn(accounts, script, {
                onProgress: checked => {
                    if (run.current === mine) setResult({ kind: 'searching', address, checked });
                },
                isCancelled: () => run.current !== mine,
            });
            if (run.current !== mine) return;
            if (remembered) {
                pending.current = null;
                setResult({ kind: 'found-single', address, match: remembered, remembered: true });
            } else {
                setResult({ kind: 'not-in-remembered', address });
            }
            return;
        }
        if (!isP2wshScript(script)) {
            setResult({ kind: 'unsupported', address });
            return;
        }
        if (!wallets.length) {
            setResult({ kind: 'no-wallets', address });
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

    const checkWithSeed = async (backup: string) => {
        setSeedError(null);
        const target = pending.current;
        if (!target || working) return;
        if (!offline) {
            setSeedError(onlineNote);
            return;
        }
        const mine = ++run.current;
        // a key that comes with a passphrase isn't remembered: keeping it would show this phone holds a passphrase wallet
        const kept = !passphrase;
        setWorking(true);
        let found: SingleKeyMatch | null = null;
        let fingerprint = '';
        try {
            // the spinner goes up before the seed is made
            await nextFrame();
            const account = signerAccountFromRoot(await rootFromBackupAsync(backup, passphrase));
            fingerprint = account.fingerprint.toUpperCase();
            // the words have done their job: only the account's public key is used from here
            setWords('');
            setPassphrase('');
            setResult({ kind: 'searching', address: target.address, checked: 0 });
            found = await findSingleKeyAddressIn([account], target.script, {
                onProgress: checked => {
                    if (run.current === mine) setResult({ kind: 'searching', address: target.address, checked });
                },
                isCancelled: () => run.current !== mine,
            });
            if (kept) addSignerAccount(account);
        } catch (e: any) {
            setSeedError(e?.message ?? "That isn't a recovery phrase or a SeedQR.");
            return;
        } finally {
            setWorking(false);
        }
        if (run.current !== mine) return;
        pending.current = null;
        setResult(
            found
                ? { kind: 'found-single', address: target.address, match: found, remembered: false, kept }
                : { kind: 'not-found-single', address: target.address, fingerprint, kept },
        );
    };

    const forgetAccount = (account: SignerAccount) =>
        Alert.alert(
            'Forget this public key?',
            "Checking a new receive address of this seed will need its SeedQR again. The SeedQR is security sensitive: anyone who sees it can take the coins.",
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Forget', style: 'destructive', onPress: () => removeSignerAccount(account.fingerprint) },
            ],
        );

    const scan = (onData: (data: string) => void) => {
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
                        if (data) onData(String(data));
                    },
                },
            });
        });
    };

    // green once it's this phone's address, red when it isn't, grey while the seed is still to come
    const box = (tone: 'good' | 'bad' | 'waiting', verdict: string, detail: string, address: string) => (
        <View style={[styles.result, tone === 'good' ? styles.found : tone === 'bad' ? styles.missing : styles.waiting]}>
            <Text bold style={styles.verdict}>{verdict}</Text>
            <Text style={styles.detail}>{detail}</Text>
            <SelectableText selectable style={[styles.mono, tone === 'good' && styles.monoGood]}>{address}</SelectableText>
        </View>
    );

    const renderSeed = () => (
        <>
            {box(
                'waiting',
                'Single-key address',
                "Scan the SeedQR of the seed this address should belong to, or type its words. The seed is only used for this check and is never saved; its public key is remembered for next time, unless you type a passphrase.",
                result.kind === 'needs-seed' ? result.address : '',
            )}
            {!offline ? <Text style={signStyles.online}>{onlineNote}</Text> : null}
            <OfflineSeedWarning style={signStyles.seedWarning} />
            <TextInput
                style={signStyles.input}
                value={passphrase}
                onChangeText={setPassphrase}
                placeholder="Passphrase (only if you use one)"
                placeholderTextColor="#777"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
            />
            {working ? <ActivityIndicator size="large" color={colors.green} style={signStyles.working} /> : null}
            <TouchableOpacity
                style={signStyles.primary}
                disabled={working}
                onPress={() => (offline ? scan(checkWithSeed) : setSeedError(onlineNote))}
                accessibilityRole="button"
            >
                <Text h3 style={signStyles.primaryText}>Scan SeedQR</Text>
            </TouchableOpacity>
            <TextInput
                style={[signStyles.input, signStyles.words]}
                value={words}
                onChangeText={setWords}
                placeholder="Or type your 12 or 24 words"
                placeholderTextColor="#777"
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                // Android: keeps the keyboard from learning the words
                keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
            />
            <TouchableOpacity style={signStyles.secondary} disabled={working} onPress={() => checkWithSeed(words)} accessibilityRole="button">
                <Text h3>Check with These Words</Text>
            </TouchableOpacity>
            {seedError ? <Text style={signStyles.error}>{seedError}</Text> : null}
        </>
    );

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
                return box(
                    'good',
                    `${branch === 0 ? 'Receive' : 'Change'} address #${index} in ${wallet.name}`,
                    `${wallet.m} of ${wallet.keys.length} multisig`,
                    result.address,
                );
            }
            case 'not-found':
                return box(
                    'bad',
                    `Not in the first ${formatCount(ADDRESS_SEARCH_LIMIT)} addresses of any wallet on this phone`,
                    "Don't use this address unless you know where it comes from.",
                    result.address,
                );
            case 'no-wallets':
                return box(
                    'bad',
                    "There's no multisig wallet on this phone to check it against",
                    'It\'s a multisig address. Add its wallet under Multisig Wallets first.',
                    result.address,
                );
            case 'needs-seed':
                return renderSeed();
            case 'found-single': {
                const { fingerprint, branch, index } = result.match;
                const how = result.remembered
                    ? ' Checked against its public key remembered on this phone.'
                    : keptNote(result.kept);
                return box(
                    'good',
                    `${branch === 0 ? 'Receive' : 'Change'} address #${index} of this seed`,
                    `Seed fingerprint ${fingerprint}. Single key, native SegWit (m/84'/0'/0').${how}`,
                    result.address,
                );
            }
            case 'not-found-single':
                return box(
                    'bad',
                    `Not in the first ${formatCount(ADDRESS_SEARCH_LIMIT)} receive and change addresses of this seed`,
                    `Seed fingerprint ${result.fingerprint}. If the seed has a passphrase, check it was typed the same. Don't receive to this address unless you know where it comes from.${keptNote(result.kept)}`,
                    result.address,
                );
            case 'not-in-remembered':
                return (
                    <>
                        {box(
                            'bad',
                            `Not in the first ${formatCount(ADDRESS_SEARCH_LIMIT)} receive and change addresses of the keys remembered on this phone`,
                            "If it should belong to another seed, check it with that seed's SeedQR. Otherwise don't receive to it.",
                            result.address,
                        )}
                        <TouchableOpacity
                            style={signStyles.secondary}
                            onPress={() => setResult({ kind: 'needs-seed', address: result.address })}
                            accessibilityRole="button"
                        >
                            <Text h3>Check with a SeedQR</Text>
                        </TouchableOpacity>
                    </>
                );
            case 'unsupported':
                return box(
                    'bad',
                    "This signer doesn't sign for this kind of address",
                    'It signs for native SegWit addresses only: bc1q…, for a single key or a multisig wallet.',
                    result.address,
                );
        }
    };

    return (
        <ScreenLayout showToolbar isBackButton disableScroll>
            <ScrollView style={signStyles.scroll} contentContainerStyle={signStyles.content} keyboardShouldPersistTaps="handled">
                <Text style={signStyles.title}>Check a Receive Address</Text>
                <Text style={signStyles.body}>
                    {`Before you receive to an address your watch-only wallet or multisig app shows, scan it here. This phone works it out from the public keys it holds: a multisig wallet's, or a single-key seed's that it remembers. For a seed it doesn't remember, you scan the seed's SeedQR. The first ${formatCount(ADDRESS_SEARCH_LIMIT)} receive and change addresses are searched.`}
                </Text>
                <TouchableOpacity style={signStyles.primary} onPress={() => scan(check)} accessibilityRole="button">
                    <Text h3 style={signStyles.primaryText}>Scan Address</Text>
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
                {accounts.length ? (
                    <View style={styles.remembered}>
                        <Text bold style={styles.rememberedTitle}>Public keys remembered on this phone</Text>
                        <Text style={styles.detail}>
                            Single-key addresses of these seeds are checked without their SeedQR. Forget one, and checking
                            a new receive address of that seed will need its SeedQR, which is security sensitive.
                        </Text>
                        {accounts.map(account => (
                            <View key={account.fingerprint} style={styles.rememberedRow}>
                                <Text style={styles.rememberedKey}>{`Single key · fingerprint ${account.fingerprint.toUpperCase()}`}</Text>
                                <TouchableOpacity onPress={() => forgetAccount(account)} accessibilityRole="button">
                                    <Text style={signStyles.linkText}>Forget</Text>
                                </TouchableOpacity>
                            </View>
                        ))}
                    </View>
                ) : null}
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
    waiting: {
        borderColor: '#444',
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
    // an address that checked out, in the Cold Vault's blue
    monoGood: {
        color: colors.coldGreen,
    },
    remembered: {
        marginTop: 28,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#2A2A2A',
    },
    rememberedTitle: {
        fontSize: 15,
        lineHeight: 21,
    },
    rememberedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 12,
    },
    rememberedKey: {
        fontSize: 14,
        color: colors.white,
    },
});

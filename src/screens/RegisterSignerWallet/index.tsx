import React, { useRef, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text as SelectableText, TextInput, TouchableOpacity, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import OfflineSeedWarning from "@Cypher/components/OfflineSeedWarning";
import {
    MultisigPolicy,
    PolicyKey,
    confirmOwnKey,
    nextFrame,
    parseWalletFile,
    policyAddress,
    rootFromBackupAsync,
    shortXpub,
} from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import useProtectSecret from "../../custom-hooks/useProtectSecret";
import useElectrumConnection from "../../custom-hooks/useElectrumConnection";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";
import signStyles from "../SignOnce/styles";

const fs = require('../../../blue_modules/fs');

type Step = 'source' | 'review' | 'confirm' | 'saved';

const ONLINE = "This phone is online. A seed is only loaded once it's offline: Airplane Mode on, Wi-Fi and Bluetooth off.";
const CHECKING = 'Checking this phone is offline…';

/**
 * Adds a multisig wallet to the Offline Seed-Signer, so it can sign that wallet's transactions (helpers/multisigPolicy).
 * The wallet lives in a coordinator such as Nunchuk, Sparrow or BlueWallet; this reads the wallet file or QR it
 * exports for signing devices, shows its quorum, every key's fingerprint and its first address to check against the
 * other devices and the coordinator, and then wants the SeedQR of this signer's seed: its key at the path the file
 * lists for its fingerprint has to be the key the file lists, or nothing is saved. The seed is dropped as soon as it
 * has been checked, and only public keys are kept.
 *
 * One screen for every step, like the signing screen: navigation params would keep the words in history.
 */
export default function RegisterSignerWallet({ navigation }: { navigation: any }) {
    const { signerWallets, addSignerWallet } = useAuthStore();
    const [step, setStep] = useState<Step>('source');
    const [policy, setPolicy] = useState<MultisigPolicy | null>(null);
    const [ownKey, setOwnKey] = useState<PolicyKey | null>(null);
    const [words, setWords] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [error, setError] = useState<string | null>(null);
    // making the seed from the SeedQR takes a moment: its spinner, and no second check meanwhile
    const [working, setWorking] = useState(false);
    const workingRef = useRef(false);
    const connection = useElectrumConnection(true, false);
    const offline = connection === 'no-answer';
    const onlineNote = connection === 'checking' ? CHECKING : ONLINE;

    // a recovery phrase can be typed here: hide it from the app switcher, block screenshots
    useProtectSecret();

    const existing = policy ? signerWallets?.[policy.id] : undefined;

    const read = (text: string) => {
        setError(null);
        try {
            setPolicy(parseWalletFile(text));
            setStep('review');
        } catch (e: any) {
            setStep('source');
            setError(e.message);
        }
    };

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

    const openFile = async () => {
        setError(null);
        try {
            const text = await fs.openWalletFile();
            if (text) read(text);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const confirm = async (backup: string) => {
        setError(null);
        if (!offline) {
            setError(onlineNote);
            return;
        }
        if (!policy || workingRef.current) return;
        workingRef.current = true;
        setWorking(true);
        try {
            // the spinner goes up before the seed is made
            await nextFrame();
            // checked and dropped here: only the wallet's public keys are kept
            const key = confirmOwnKey(policy, await rootFromBackupAsync(backup, passphrase));
            addSignerWallet({ ...policy, ownFingerprint: key.fingerprint, addedAt: Date.now() });
            setOwnKey(key);
            setWords('');
            setPassphrase('');
            setStep('saved');
        } catch (e: any) {
            setError(e.message);
        } finally {
            workingRef.current = false;
            setWorking(false);
        }
    };

    const cancel = () => {
        setWords('');
        setPassphrase('');
        navigation.goBack();
    };

    const renderError = () => (error ? <Text style={signStyles.error}>{error}</Text> : null);

    const renderSource = () => (
        <>
            <Text style={signStyles.title}>Add a Multisig Wallet</Text>
            <Text style={signStyles.body}>
                Once your multisig app (Nunchuk, Sparrow, BlueWallet or another) has made the wallet, export it for a
                signing device: its wallet file, BSMS file or output descriptor. Then scan its QR or open the file here.
            </Text>
            <Text style={signStyles.body}>
                The signer works with native SegWit multisig (P2WSH, sortedmulti) of up to 15 keys, one of them this
                seed's multisig key.
            </Text>
            <TouchableOpacity style={signStyles.primary} onPress={() => scan(read)} accessibilityRole="button">
                <Text h3 style={signStyles.primaryText}>Scan QR</Text>
            </TouchableOpacity>
            <TouchableOpacity style={signStyles.secondary} onPress={openFile} accessibilityRole="button">
                <Text h3>Open File</Text>
            </TouchableOpacity>
            {renderError()}
        </>
    );

    const renderKeys = (p: MultisigPolicy, own?: PolicyKey | null) =>
        p.keys.map((k, i) => (
            <View key={k.xpub} style={styles.key}>
                <Text style={styles.keyLabel}>
                    {own && own.xpub === k.xpub ? `Key ${i + 1} · this seed` : `Key ${i + 1}`}
                </Text>
                <Text semibold style={styles.fingerprint}>{k.fingerprint}</Text>
                <Text style={styles.mono}>{k.path}</Text>
                <Text style={styles.mono}>{shortXpub(k.xpub)}</Text>
            </View>
        ));

    const renderReview = (p: MultisigPolicy) => (
        <>
            <Text style={signStyles.title}>Check this wallet</Text>
            <Text bold style={styles.name}>{p.name}</Text>
            <Text style={signStyles.body}>{`${p.m} of ${p.keys.length} multisig, native SegWit (P2WSH)`}</Text>
            {renderKeys(p)}
            <View style={signStyles.row}>
                <Text style={signStyles.rowLabel}>First receive address</Text>
                <SelectableText selectable style={[signStyles.rowAddress, styles.mono]}>{policyAddress(p, 0, 0)}</SelectableText>
            </View>
            <Text style={signStyles.note}>
                Check each fingerprint against the device or app that holds that key, and the first address against
                your multisig app. If anything is different, don't add this wallet.
            </Text>
            {existing ? (
                <Text style={signStyles.error}>{`This wallet is already on this phone, as ${existing.name}.`}</Text>
            ) : (
                <TouchableOpacity style={signStyles.primary} onPress={() => { setError(null); setStep('confirm'); }} accessibilityRole="button">
                    <Text h3 style={signStyles.primaryText}>Confirm with your SeedQR</Text>
                </TouchableOpacity>
            )}
            <TouchableOpacity style={signStyles.secondary} onPress={cancel} accessibilityRole="button">
                <Text h3>Cancel</Text>
            </TouchableOpacity>
            {renderError()}
        </>
    );

    const renderConfirm = () => (
        <>
            <Text style={signStyles.title}>Scan your SeedQR</Text>
            {!offline ? <Text style={signStyles.online}>{onlineNote}</Text> : null}
            <Text style={signStyles.body}>
                Scan the SeedQR of the seed whose key is in this wallet, or type its words. It's only used to check
                that the wallet's key is really this seed's, and isn't saved.
            </Text>
            <OfflineSeedWarning style={signStyles.seedWarning} />
            {working ? <ActivityIndicator size="large" color={colors.green} style={signStyles.working} /> : null}
            <TouchableOpacity style={signStyles.primary} disabled={working} onPress={() => (offline ? scan(confirm) : setError(onlineNote))} accessibilityRole="button">
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
                // Android: keeps the keyboard from learning the words (iOS has no such keyboard; autocorrect is off)
                keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
            />
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
            <TouchableOpacity style={signStyles.secondary} disabled={working} onPress={() => confirm(words)} accessibilityRole="button">
                <Text h3>Continue</Text>
            </TouchableOpacity>
            <TouchableOpacity style={signStyles.secondary} onPress={cancel} accessibilityRole="button">
                <Text h3>Cancel</Text>
            </TouchableOpacity>
            {renderError()}
        </>
    );

    const renderSaved = (p: MultisigPolicy) => (
        <>
            <Text style={signStyles.title}>Wallet added</Text>
            <Text bold style={styles.name}>{p.name}</Text>
            <Text style={signStyles.body}>
                {`This signer now signs this ${p.m} of ${p.keys.length} wallet's transactions, after showing you what each one does. It refuses multisig transactions from wallets it doesn't have.`}
            </Text>
            {renderKeys(p, ownKey)}
            <Text style={signStyles.success}>Your recovery phrase wasn't saved on this phone.</Text>
            <TouchableOpacity style={signStyles.primary} onPress={() => navigation.goBack()} accessibilityRole="button">
                <Text h3 style={signStyles.primaryText}>Done</Text>
            </TouchableOpacity>
        </>
    );

    return (
        <ScreenLayout showToolbar isBackButton disableScroll onBackPress={cancel}>
            <ScrollView style={signStyles.scroll} contentContainerStyle={signStyles.content} keyboardShouldPersistTaps="handled">
                {step === 'source' && renderSource()}
                {step === 'review' && policy && renderReview(policy)}
                {step === 'confirm' && policy && renderConfirm()}
                {step === 'saved' && policy && renderSaved(policy)}
            </ScrollView>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    name: {
        fontSize: 17,
        lineHeight: 24,
        marginBottom: 4,
    },
    key: {
        borderTopWidth: 1,
        borderTopColor: '#2A2A2A',
        paddingVertical: 10,
    },
    keyLabel: {
        fontSize: 13,
        color: colors.gray.light,
    },
    fingerprint: {
        fontSize: 16,
        lineHeight: 22,
        letterSpacing: 1,
        marginTop: 2,
    },
    mono: {
        fontSize: 13,
        lineHeight: 18,
        color: '#CCC',
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
});

import React, { useContext, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, TextInput, TouchableOpacity, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import SimpleToast from "react-native-simple-toast";
import type { BIP32Interface } from "bip32";
import type * as bitcoin from "bitcoinjs-lib";

import { ScreenLayout, Text } from "@Cypher/component-library";
import SigningPhoneStatus from "@Cypher/components/SigningPhoneStatus";
import {
    SIGN_NO_KEY_INFO,
    SIGN_NOTHING_SIGNED,
    SIGN_VAULT_MISMATCH,
    TransactionReview,
    assertBackupMatches,
    assertKeyMatches,
    formatSignSats,
    inputFingerprints,
    parseUnsignedPsbt,
    reviewWithRoot,
    reviewWithWallet,
    rootFromBackup,
    signWithRoot,
} from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import useProtectSecret from "../../custom-hooks/useProtectSecret";
import useElectrumConnection from "../../custom-hooks/useElectrumConnection";
import { DynamicQRCode } from "../../../components/DynamicQRCode";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";
import OfflineSeedWarning from "@Cypher/components/OfflineSeedWarning";
import { SEED_SIGNER_MODE, openSeedSignerGate } from "../SigningHome/seedSigner";
import styles from "./styles";

const bitcoinjs = require('bitcoinjs-lib');
const fs = require('../../../blue_modules/fs');

type Step = 'scan' | 'choose' | 'backup' | 'review' | 'signed';
type Mode = 'vault' | 'backup';

/**
 * Sign a transaction made by a watch-only wallet (a Cypher Box Cold Vault, Sparrow or any other app), in one screen:
 * scan it, choose the key, check what it does, sign, show the result.
 *
 * The key is either the Hot Vault on this phone or a backup (12 or 24 words, or a SeedQR) loaded just for this
 * signature. A backup is never saved: it lives in this screen's state, is dropped as soon as it has been checked
 * against the transaction, and the key made from it is dropped once the transaction is signed or the screen closes.
 * Keeping every step in one screen is what makes that true; navigation params would keep it in history.
 *
 * Params: `psbt` to start from a transaction already scanned, `mode: 'vault'` to sign with the Hot Vault straight away.
 */
export default function SignOnce({ route, navigation }: { route: any; navigation: any }) {
    const { wallets } = useContext(BlueStorageContext);
    const { walletID: hotVaultID, signingMode, setSignedOnThisPhone } = useAuthStore();
    const hotVault = (wallets ?? []).find(
        (w: any) => w.getID() === hotVaultID && typeof w.cosignPsbt === 'function' && w.allowCosignPsbt?.(),
    );

    const [step, setStep] = useState<Step>('scan');
    const [mode, setMode] = useState<Mode>('backup');
    const [psbt, setPsbt] = useState<bitcoin.Psbt | null>(null);
    const [words, setWords] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [review, setReview] = useState<TransactionReview | null>(null);
    // a recovery phrase is only loaded, and a transaction only signed, while no server answers: the same lock as the
    // Hot Vault's sign button, here for signing from a backup too, which used to work on a phone that was online
    const connection = useElectrumConnection(true, false);
    const offline = connection === 'no-answer';
    const onlineNote = connection === 'checking'
        ? 'Checking this phone is offline…'
        : "This phone is online. Signing unlocks once it's offline: Airplane Mode on, Wi-Fi and Bluetooth off.";
    const [signed, setSigned] = useState<bitcoin.Psbt | null>(null);
    const rootRef = useRef<BIP32Interface | null>(null);

    // a recovery phrase or a key made from one can be on this screen: hide it from the app switcher, block screenshots
    useProtectSecret();

    useEffect(() => {
        if (route?.params?.psbt) accept(route.params.psbt);
        return () => {
            rootRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const hotVaultFingerprint = (): string | null => {
        try {
            // the wallet reports it in capitals, transactions in lower case
            return hotVault?.getMasterFingerprintHex?.()?.toLowerCase() ?? null;
        } catch (_) {
            return null;
        }
    };

    const reviewWithHotVault = (tx: bitcoin.Psbt) => {
        const fingerprint = hotVaultFingerprint();
        if (!fingerprint) throw new Error("There's no Hot Vault on this phone to sign with.");
        assertKeyMatches(tx, fingerprint, SIGN_VAULT_MISMATCH);
        setReview(reviewWithWallet(tx, (address: string) => !!hotVault.weOwnAddress(address), fingerprint));
        setMode('vault');
        setStep('review');
    };

    const accept = (data: string) => {
        setError(null);
        try {
            const tx = parseUnsignedPsbt(data);
            if (!inputFingerprints(tx).length) throw new Error(SIGN_NO_KEY_INFO);
            setPsbt(tx);
            const fingerprint = hotVaultFingerprint();
            if (route?.params?.mode === 'vault') {
                reviewWithHotVault(tx);
            } else if (fingerprint && inputFingerprints(tx).includes(fingerprint)) {
                setStep('choose');
            } else {
                setMode('backup');
                setStep('backup');
            }
        } catch (e: any) {
            setStep('scan');
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
        const data = await fs.openSignedTransaction();
        if (data) accept(data);
    };

    const loadBackup = (backup: string) => {
        setError(null);
        if (!offline) {
            setError(onlineNote);
            return;
        }
        try {
            const root = rootFromBackup(backup, passphrase);
            assertBackupMatches(psbt as bitcoin.Psbt, root);
            setReview(reviewWithRoot(psbt as bitcoin.Psbt, root));
            rootRef.current = root;
            // the phrase has done its job: only the key made from it stays, until signing
            setWords('');
            setPassphrase('');
            setStep('review');
        } catch (e: any) {
            setError(e.message);
        }
    };

    const sign = () => {
        setError(null);
        if (!offline) {
            setError(onlineNote);
            return;
        }
        try {
            if (mode === 'backup') {
                if (!rootRef.current) throw new Error(SIGN_NOTHING_SIGNED);
                setSigned(signWithRoot(psbt as bitcoin.Psbt, rootRef.current).psbt);
                rootRef.current = null;
            } else {
                const copy = bitcoinjs.Psbt.fromBase64((psbt as bitcoin.Psbt).toBase64());
                const count = (p: bitcoin.Psbt) =>
                    p.data.inputs.filter(i => (i.partialSig?.length ?? 0) > 0 || !!i.finalScriptWitness || !!i.finalScriptSig).length;
                const before = count(copy);
                hotVault.cosignPsbt(copy);
                if (count(copy) <= before) throw new Error(SIGN_NOTHING_SIGNED);
                setSigned(copy);
            }
            setReview(null);
            setSignedOnThisPhone(true);
            setStep('signed');
        } catch (e: any) {
            setError(e.message);
        }
    };

    const cancel = () => {
        rootRef.current = null;
        navigation.goBack();
    };

    const useForSigningOnly = () => openSeedSignerGate();

    const renderError = () => (error ? <Text style={styles.error}>{error}</Text> : null);

    const renderScan = () => (
        <>
            <Text style={styles.title}>Sign a transaction</Text>
            <Text style={styles.body}>
                Scan the unsigned transaction (PSBT) from your watch & broadcast only wallet: a Cypher Box Cold Vault, Sparrow or
                another app.
            </Text>
            <TouchableOpacity style={styles.primary} onPress={() => scan(accept)} accessibilityRole="button">
                <Text h3>Scan QR</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={openFile} accessibilityRole="button">
                <Text h3>Open file</Text>
            </TouchableOpacity>
            {renderError()}
        </>
    );

    const renderChoose = () => (
        <>
            <Text style={styles.title}>How do you want to sign?</Text>
            <Text style={styles.body}>This transaction belongs to the Hot Vault on this phone.</Text>
            <TouchableOpacity style={styles.primary} onPress={() => {
                try {
                    reviewWithHotVault(psbt as bitcoin.Psbt);
                } catch (e: any) {
                    setError(e.message);
                }
            }} accessibilityRole="button">
                <Text h3>{signingMode ? 'Sign with the seed on this phone' : 'Sign with your Hot Vault'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => { setMode('backup'); setStep('backup'); }} accessibilityRole="button">
                <Text h3>Sign from a backup instead</Text>
            </TouchableOpacity>
            {signingMode ? (
                <Text style={styles.note}>
                    On a signing phone, signing from a backup is safer: then the phone needn't keep the recovery phrase
                    at all.
                </Text>
            ) : null}
            {renderError()}
        </>
    );

    const renderBackup = () => (
        <>
            <Text style={styles.title}>Load your backup</Text>
            {!offline ? <Text style={styles.online}>{onlineNote}</Text> : null}
            <Text style={styles.body}>
                Your recovery phrase is only held while you sign, and is never saved on this phone.
            </Text>
            {signingMode ? <OfflineSeedWarning style={styles.seedWarning} /> : null}
            <TouchableOpacity style={styles.primary} onPress={() => (offline ? scan(loadBackup) : setError(onlineNote))} accessibilityRole="button">
                <Text h3>Scan SeedQR</Text>
            </TouchableOpacity>
            <TextInput
                style={[styles.input, styles.words]}
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
                style={styles.input}
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
            <TouchableOpacity style={styles.secondary} onPress={() => loadBackup(words)} accessibilityRole="button">
                <Text h3>Continue</Text>
            </TouchableOpacity>
            {renderError()}
        </>
    );

    const renderReview = () => (
        <>
            <Text style={styles.title}>You're about to sign</Text>
            {!offline ? <Text style={styles.online}>{onlineNote}</Text> : null}
            {review?.outputs.map((output, i) => (
                <View key={i} style={styles.row}>
                    <Text style={styles.rowLabel}>{output.change ? 'Back to your wallet' : 'To'}</Text>
                    <Text style={styles.rowAddress}>{output.address ?? 'Unknown output script'}</Text>
                    <Text bold style={styles.rowValue}>{formatSignSats(output.value)}</Text>
                </View>
            ))}
            {review?.fee != null ? (
                <View style={styles.row}>
                    <Text style={styles.rowLabel}>Network fee</Text>
                    <Text style={styles.rowValue}>{formatSignSats(review.fee)}</Text>
                </View>
            ) : null}
            {review && review.ownInputs < review.inputCount ? (
                <Text style={styles.note}>
                    This key signs {review.ownInputs} of {review.inputCount} inputs. The others need another signer.
                </Text>
            ) : null}
            <TouchableOpacity style={styles.primary} onPress={sign} accessibilityRole="button">
                <Text h3>Sign</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={cancel} accessibilityRole="button">
                <Text h3>Cancel</Text>
            </TouchableOpacity>
            {renderError()}
        </>
    );

    const renderSigned = () => (
        <>
            <Text style={styles.title}>Signed</Text>
            <View style={styles.qr}>
                <DynamicQRCode value={(signed as bitcoin.Psbt).toHex()} />
            </View>
            <Text style={styles.body}>Scan this with the wallet that made the transaction, to broadcast it.</Text>
            {mode === 'backup' ? <Text style={styles.success}>Your recovery phrase wasn't saved on this phone.</Text> : null}
            <TouchableOpacity
                style={styles.secondary}
                onPress={() => {
                    Clipboard.setString((signed as bitcoin.Psbt).toBase64());
                    SimpleToast.show('Signed transaction copied', SimpleToast.SHORT);
                }}
                accessibilityRole="button"
            >
                <Text h3>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity
                style={styles.secondary}
                onPress={() => fs.writeFileAndExport(`signed-${Date.now()}.psbt`, (signed as bitcoin.Psbt).toBase64())}
                accessibilityRole="button"
            >
                <Text h3>Save file</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={() => navigation.goBack()} accessibilityRole="button">
                <Text h3>Done</Text>
            </TouchableOpacity>
            <SigningPhoneStatus />
            {mode === 'backup' && !signingMode ? (
                <TouchableOpacity style={styles.link} onPress={useForSigningOnly} accessibilityRole="button">
                    <Text style={styles.linkText}>Turn on {SEED_SIGNER_MODE}</Text>
                </TouchableOpacity>
            ) : null}
        </>
    );

    return (
        <ScreenLayout showToolbar isBackButton disableScroll onBackPress={cancel}>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                {step === 'scan' && renderScan()}
                {step === 'choose' && renderChoose()}
                {step === 'backup' && renderBackup()}
                {step === 'review' && renderReview()}
                {step === 'signed' && signed && renderSigned()}
            </ScrollView>
        </ScreenLayout>
    );
}

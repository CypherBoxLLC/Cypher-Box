import React, { useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, TextInput, TouchableOpacity, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import SimpleToast from "react-native-simple-toast";
import type { BIP32Interface } from "bip32";
import type * as bitcoin from "bitcoinjs-lib";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import SigningPhoneStatus from "@Cypher/components/SigningPhoneStatus";
import {
    SIGN_NO_KEY_INFO,
    SIGN_NOTHING_SIGNED,
    SIGN_ON_SIGNING_DEVICE,
    SIGN_VAULT_MISMATCH,
    SigningKey,
    TransactionReview,
    assertBackupMatches,
    assertKeyOwns,
    formatSignSats,
    inputFingerprints,
    isForKey,
    nextFrame,
    parseUnsignedPsbt,
    reviewWithRoot,
    reviewWithWallet,
    rootFromBackupAsync,
    signWithRoot,
    signingKeyForWallet,
} from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import useProtectSecret from "../../custom-hooks/useProtectSecret";
import useElectrumConnection from "../../custom-hooks/useElectrumConnection";
import { DynamicQRCode } from "../../../components/DynamicQRCode";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";
import OfflineSeedWarning from "@Cypher/components/OfflineSeedWarning";
import { openSeedSignerGate } from "../SigningHome/seedSigner";
import styles from "./styles";
import signErrorText from "./errorText";
import loc from "../../../loc";

const bitcoinjs = require('bitcoinjs-lib');
const fs = require('../../../blue_modules/fs');

type Step = 'scan' | 'choose' | 'backup' | 'review' | 'signed';
type Mode = 'vault' | 'backup';

/**
 * Sign a transaction made by a watch-only wallet (a Cypher Box Cold Vault, Sparrow or any other app), in one screen:
 * scan it, choose the key, check what it does, sign, show the result.
 *
 * The key is either the Hot Vault on this phone or, in Offline Seed-Signer mode only, a backup (12 or 24 words, or a
 * SeedQR) loaded just for this signature. A backup is never saved: it lives in this screen's state, is dropped as soon as it has been checked
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
    // the seed from a backup takes a moment: its spinner, and no second load meanwhile
    const [working, setWorking] = useState(false);
    const workingRef = useRef(false);
    const [review, setReview] = useState<TransactionReview | null>(null);
    // a recovery phrase is only loaded, and a transaction only signed, while no server answers: the same lock as the
    // Hot Vault's sign button, here for signing from a backup too, which used to work on a phone that was online
    const connection = useElectrumConnection(true, false);
    const offline = connection === 'no-answer';
    const onlineNote = connection === 'checking'
        ? loc.cypherbox.sign_once.checking_offline
        : loc.cypherbox.sign_once.online_note;
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

    // what a transaction is checked against: the Hot Vault's fingerprint and its account's public keys, so a Cold Vault
    // set up from its bare xpub, which writes 00000000 for the fingerprint, is still recognised, as cosigning always did
    const hotVaultKey = (): SigningKey | null => {
        try {
            return hotVault ? signingKeyForWallet(hotVault) : null;
        } catch (_) {
            return null;
        }
    };

    const reviewWithHotVault = (tx: bitcoin.Psbt) => {
        const key = hotVaultKey();
        if (!key) throw new Error(loc.cypherbox.sign_once.no_hot_vault);
        assertKeyOwns(tx, key, SIGN_VAULT_MISMATCH);
        setReview(reviewWithWallet(tx, (address: string) => !!hotVault.weOwnAddress(address), key));
        setMode('vault');
        setStep('review');
    };

    const accept = (data: string) => {
        setError(null);
        try {
            const tx = parseUnsignedPsbt(data);
            if (!inputFingerprints(tx).length) throw new Error(SIGN_NO_KEY_INFO);
            setPsbt(tx);
            const key = hotVaultKey();
            const forHotVault = !!key && isForKey(tx, key);
            if (route?.params?.mode === 'vault') {
                reviewWithHotVault(tx);
            } else if (!signingMode) {
                // A recovery phrase is only loaded in Offline Seed-Signer mode. An everyday phone goes back online after
                // signing, so here it signs with the Hot Vault it already holds, or not at all.
                if (!forHotVault) throw new Error(SIGN_ON_SIGNING_DEVICE);
                reviewWithHotVault(tx);
            } else if (forHotVault) {
                setStep('choose');
            } else {
                setMode('backup');
                setStep('backup');
            }
        } catch (e: any) {
            setStep('scan');
            setError(signErrorText(e.message));
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

    const loadBackup = async (backup: string) => {
        setError(null);
        if (!offline) {
            setError(onlineNote);
            return;
        }
        if (workingRef.current) return;
        workingRef.current = true;
        setWorking(true);
        try {
            // the spinner goes up before the seed is made
            await nextFrame();
            const root = await rootFromBackupAsync(backup, passphrase);
            assertBackupMatches(psbt as bitcoin.Psbt, root);
            setReview(reviewWithRoot(psbt as bitcoin.Psbt, root));
            rootRef.current = root;
            // the phrase has done its job: only the key made from it stays, until signing
            setWords('');
            setPassphrase('');
            setStep('review');
        } catch (e: any) {
            setError(signErrorText(e.message));
        } finally {
            workingRef.current = false;
            setWorking(false);
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
            setError(signErrorText(e.message));
        }
    };

    const cancel = () => {
        rootRef.current = null;
        navigation.goBack();
    };

    const useForSigningOnly = () => openSeedSignerGate();

    const renderError = () => (error ? <Text style={styles.error}>{error}</Text> : null);

    // A seed-signer without a Hot Vault always goes the same way: the transaction, the SeedQR, then the check and the
    // signature. Numbered there; other phones choose a key, so their steps aren't fixed.
    const numbered = signingMode && !hotVault;
    const stepLabel = (n: number) =>
        numbered ? <Text style={styles.step}>{String(loc.formatString(loc.cypherbox.sign_once.step, { n, total: 3 }))}</Text> : null;

    const renderScan = () => (
        <>
            {stepLabel(1)}
            <Text style={styles.title}>{loc.cypherbox.sign_once.scan_title}</Text>
            <Text style={styles.body}>
                {loc.cypherbox.sign_once.scan_body}
            </Text>
            <TouchableOpacity style={styles.primary} onPress={() => scan(accept)} accessibilityRole="button">
                <Text h3 style={styles.primaryText}>{loc.cypherbox.sign_once.scan_qr}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={openFile} accessibilityRole="button">
                <Text h3>{loc.cypherbox.sign_once.open_file}</Text>
            </TouchableOpacity>
            {renderError()}
        </>
    );

    const renderChoose = () => (
        <>
            <Text style={styles.title}>{loc.cypherbox.sign_once.choose_title}</Text>
            <Text style={styles.body}>{loc.cypherbox.sign_once.choose_body}</Text>
            <TouchableOpacity style={styles.primary} onPress={() => {
                try {
                    reviewWithHotVault(psbt as bitcoin.Psbt);
                } catch (e: any) {
                    setError(signErrorText(e.message));
                }
            }} accessibilityRole="button">
                <Text h3 style={styles.primaryText}>{signingMode ? loc.cypherbox.sign_once.sign_with_seed : loc.cypherbox.sign_once.sign_with_hot_vault}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => { setMode('backup'); setStep('backup'); }} accessibilityRole="button">
                <Text h3>{loc.cypherbox.sign_once.sign_from_backup}</Text>
            </TouchableOpacity>
            {signingMode ? (
                <Text style={styles.note}>
                    {loc.cypherbox.sign_once.backup_safer}
                </Text>
            ) : null}
            {renderError()}
        </>
    );

    const renderBackup = () => (
        <>
            {stepLabel(2)}
            <Text style={styles.title}>{loc.cypherbox.sign_once.backup_title}</Text>
            {!offline ? <Text style={styles.online}>{onlineNote}</Text> : null}
            <Text style={styles.body}>
                {loc.cypherbox.sign_once.backup_body}
            </Text>
            {signingMode ? <OfflineSeedWarning style={styles.seedWarning} /> : null}
            {working ? <ActivityIndicator size="large" color={colors.green} style={styles.working} /> : null}
            <TouchableOpacity style={styles.primary} disabled={working} onPress={() => (offline ? scan(loadBackup) : setError(onlineNote))} accessibilityRole="button">
                <Text h3 style={styles.primaryText}>{loc.cypherbox.sign_once.scan_seedqr}</Text>
            </TouchableOpacity>
            <TextInput
                style={[styles.input, styles.words]}
                value={words}
                onChangeText={setWords}
                placeholder={loc.cypherbox.sign_once.words_placeholder}
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
                placeholder={loc.cypherbox.sign_once.passphrase_placeholder}
                placeholderTextColor="#777"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
            />
            <TouchableOpacity style={styles.secondary} disabled={working} onPress={() => loadBackup(words)} accessibilityRole="button">
                <Text h3>{loc._.continue}</Text>
            </TouchableOpacity>
            {renderError()}
        </>
    );

    const renderReview = () => (
        <>
            {mode === 'backup' ? stepLabel(3) : null}
            <Text style={styles.title}>{loc.cypherbox.sign_once.review_title}</Text>
            {!offline ? <Text style={styles.online}>{onlineNote}</Text> : null}
            {review?.outputs.map((output, i) => (
                <View key={i} style={styles.row}>
                    <Text style={styles.rowLabel}>{output.change ? loc.cypherbox.sign_once.back_to_wallet : loc.cypherbox.sign_once.to}</Text>
                    <Text style={styles.rowAddress}>{output.address ?? loc.cypherbox.sign_once.unknown_script}</Text>
                    <Text bold style={styles.rowValue}>{formatSignSats(output.value)}</Text>
                </View>
            ))}
            {review?.fee != null ? (
                <View style={styles.row}>
                    <Text style={styles.rowLabel}>{loc.cypherbox.sign_once.network_fee}</Text>
                    <Text style={styles.rowValue}>{formatSignSats(review.fee)}</Text>
                </View>
            ) : null}
            {review && review.ownInputs < review.inputCount ? (
                <Text style={styles.note}>
                    {loc.formatString(loc.cypherbox.sign_once.partial, { own: review.ownInputs, total: review.inputCount })}
                </Text>
            ) : null}
            <TouchableOpacity style={styles.primary} onPress={sign} accessibilityRole="button">
                <Text h3 style={styles.primaryText}>{loc.cypherbox.sign_once.sign}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={cancel} accessibilityRole="button">
                <Text h3>{loc._.cancel}</Text>
            </TouchableOpacity>
            {renderError()}
        </>
    );

    const renderSigned = () => (
        <>
            <Text style={styles.title}>{loc.cypherbox.sign_once.signed_title}</Text>
            <View style={styles.qr}>
                {/* a white margin around it: a laptop webcam (Sparrow) doesn't find the code against the dark screen without one */}
                <DynamicQRCode value={(signed as bitcoin.Psbt).toHex()} quietZone={24} />
            </View>
            <Text style={styles.body}>{loc.cypherbox.sign_once.signed_body}</Text>
            {mode === 'backup' ? <Text style={styles.success}>{loc.cypherbox.sign_once.not_saved}</Text> : null}
            <TouchableOpacity
                style={styles.secondary}
                onPress={() => {
                    Clipboard.setString((signed as bitcoin.Psbt).toBase64());
                    SimpleToast.show(loc.cypherbox.sign_once.copied, SimpleToast.SHORT);
                }}
                accessibilityRole="button"
            >
                <Text h3>{loc.cypherbox.sign_once.copy}</Text>
            </TouchableOpacity>
            <TouchableOpacity
                style={styles.secondary}
                onPress={() => fs.writeFileAndExport(`signed-${Date.now()}.psbt`, (signed as bitcoin.Psbt).toBase64())}
                accessibilityRole="button"
            >
                <Text h3>{loc.cypherbox.sign_once.save_file}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={() => navigation.goBack()} accessibilityRole="button">
                <Text h3 style={styles.primaryText}>{loc.cypherbox.sign_once.done}</Text>
            </TouchableOpacity>
            <SigningPhoneStatus />
            {mode === 'backup' && !signingMode ? (
                <TouchableOpacity style={styles.link} onPress={useForSigningOnly} accessibilityRole="button">
                    <Text style={styles.linkText}>{loc.cypherbox.sign_once.turn_on_signer}</Text>
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

import React, { useEffect, useRef, useState } from "react";
import { Platform, Text as SelectableText, ScrollView, StyleSheet, Switch, TextInput, TouchableOpacity, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import SimpleToast from "react-native-simple-toast";
import * as bip39 from "bip39";

import { ScreenLayout, Text } from "@Cypher/component-library";
import OfflineSeedWarning from "@Cypher/components/OfflineSeedWarning";
import SeedQRGrid from "@Cypher/components/SeedQRGrid";
import { backupToMnemonic, dispatchNavigate, mnemonicToSeedQR, seedQRGrid } from "@Cypher/helpers";
import { colors, widths } from "@Cypher/style-guide";
import { HDSegwitBech32Wallet } from "../../../class";
import QRCodeComponent from "../../../components/QRCodeComponent";
import useProtectSecret from "../../custom-hooks/useProtectSecret";
import useElectrumConnection from "../../custom-hooks/useElectrumConnection";
import useSeedQRCheck from "../../custom-hooks/useSeedQRCheck";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";

type Step = 'intro' | 'load' | 'words' | 'seedqr' | 'check' | 'key';

interface PublicInfo {
    xpub: string;
    fingerprint: string;
    addresses: string[];
    path: string;
}

/**
 * A seed-signer's seed, made and shown without ever being saved: generated in memory (dice rolls optional, mixed with
 * the phone's randomness), backed up as words and a SeedQR, the copy checked, then only the public side shown, for the
 * watch-only wallet. Leaving the screen drops it. Nothing goes to the app's storage or the Keychain, so nothing outlives
 * the app (on iOS the Keychain does) or waits to be wiped. With `mode: 'show'` it loads a SeedQR or typed words to show
 * that seed's public key again, saving nothing either.
 */
export default function CreateSignerSeed({ route, navigation }: { route: any; navigation: any }) {
    const showOnly = route?.params?.mode === 'show';
    useProtectSecret();

    const [step, setStep] = useState<Step>(showOnly ? 'load' : 'intro');
    const [dice, setDice] = useState<Buffer | null>(null);
    const [usePassphrase, setUsePassphrase] = useState(false);
    const [passphrase, setPassphrase] = useState('');
    const [passphraseAgain, setPassphraseAgain] = useState('');
    const [mnemonic, setMnemonic] = useState('');
    const [revealed, setRevealed] = useState(false);
    const [typed, setTyped] = useState('');
    const [info, setInfo] = useState<PublicInfo | null>(null);
    const [error, setError] = useState<string | null>(null);
    const check = useSeedQRCheck(mnemonic);
    // a seed is only made or loaded while no server answers: on a phone that's online, it would be a hot wallet
    const connection = useElectrumConnection(true, false);
    const offline = connection === 'no-answer';
    const onlineNote = connection === 'checking'
        ? 'Checking this phone is offline…'
        : "This phone is online. A seed is only made or loaded once it's offline: Airplane Mode on, Wi-Fi and Bluetooth off.";

    // only ever in this screen's memory, and cleared on the way out
    const forget = () => {
        setMnemonic('');
        setPassphrase('');
        setPassphraseAgain('');
        setTyped('');
        setDice(null);
    };
    const forgetRef = useRef(forget);
    forgetRef.current = forget;
    useEffect(() => () => forgetRef.current(), []);

    useEffect(() => {
        if (check.result === 'ok') setStep('key');
    }, [check.result]);

    const publicInfo = (phrase: string, pass: string): PublicInfo => {
        const w = new HDSegwitBech32Wallet();
        w.setSecret(phrase);
        if (pass) w.setPassphrase(pass);
        return {
            xpub: w.getXpub(),
            fingerprint: String(w.getMasterFingerprintHex()).toUpperCase(),
            addresses: [0, 1, 2].map(i => w._getExternalAddressByIndex(i)),
            path: w.getDerivationPath() ?? "m/84'/0'/0'",
        };
    };

    const generate = async () => {
        setError(null);
        if (!offline) {
            setError(onlineNote);
            return;
        }
        if (usePassphrase && (!passphrase || passphrase !== passphraseAgain)) {
            setError(passphrase ? "The passphrases don't match." : 'Type a passphrase, or turn it off.');
            return;
        }
        try {
            const w = new HDSegwitBech32Wallet();
            // the dice screen hands back its rolls already mixed with the phone's randomness
            if (dice && dice.length >= 16) w.setSecret(bip39.entropyToMnemonic(dice.slice(0, 16).toString('hex')));
            else await w.generate();
            const phrase = w.getSecret();
            setInfo(publicInfo(phrase, usePassphrase ? passphrase : ''));
            setMnemonic(phrase);
            setStep('words');
        } catch (e: any) {
            setError(e?.message ?? 'The seed could not be made.');
        }
    };

    const load = (text: string) => {
        setError(null);
        if (!offline) {
            setError(onlineNote);
            return;
        }
        try {
            const phrase = backupToMnemonic(text);
            setInfo(publicInfo(phrase, passphrase));
            setTyped('');
            setPassphrase('');
            setStep('key');
        } catch (e: any) {
            setError(e?.message ?? "That isn't a recovery phrase or a SeedQR.");
        }
    };

    const scanSeedQR = () =>
        requestCameraAuthorization().then(() => {
            let done = false;
            navigation.navigate('ScanQRCodeRoot', {
                screen: 'ScanQRCode',
                params: {
                    showFileImportButton: false,
                    onBarScanned: (ret: any) => {
                        if (done) return;
                        done = true;
                        navigation.getParent()?.pop();
                        const data = typeof ret === 'string' ? ret : ret?.data;
                        if (data) load(String(data));
                    },
                },
            });
        });

    const checkTyped = () => {
        setError(null);
        try {
            if (backupToMnemonic(typed) === mnemonic) {
                setTyped('');
                setStep('key');
            } else {
                setError("That isn't the same phrase. Check your copy word by word.");
            }
        } catch (e: any) {
            setError(e?.message);
        }
    };

    const done = () => {
        forget();
        setInfo(null);
        navigation.goBack();
    };

    const words = mnemonic ? mnemonic.split(' ') : [];
    const grid = mnemonic ? seedQRGrid(mnemonicToSeedQR(mnemonic)) : null;
    const errorText = error ? <Text style={styles.error}>{error}</Text> : null;

    return (
        <ScreenLayout showToolbar isBackButton disableScroll>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                {step === 'intro' && (
                    <>
                        <Text style={styles.title}>Create a Seed</Text>
                        {!offline ? <Text style={styles.online}>{onlineNote}</Text> : null}
                        <Text style={styles.body}>
                            This phone makes a seed (12 words) for you to back up on paper and as a SeedQR. It's never
                            saved here: once you've checked your copy and taken the public key to your watch-only wallet,
                            it's gone from this phone. To sign, you scan the SeedQR.
                        </Text>
                        {dice ? (
                            <View style={styles.row}>
                                <Text style={styles.ok}>Dice rolls added, mixed with the phone's randomness</Text>
                                <TouchableOpacity onPress={() => setDice(null)} accessibilityRole="button">
                                    <Text style={styles.link}>Remove</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <TouchableOpacity
                                onPress={() => dispatchNavigate('ProvideEntropy', {
                                    minBits: 128,
                                    limit: 128,
                                    mixWithRng: true,
                                    onGenerated: (buf: Buffer) => {
                                        if (buf && buf.length >= 16) setDice(buf);
                                    },
                                })}
                                accessibilityRole="button"
                            >
                                <Text style={styles.link}>Add your own dice rolls (optional)</Text>
                            </TouchableOpacity>
                        )}
                        <View style={styles.row}>
                            <Text style={styles.label}>Add a passphrase (optional)</Text>
                            <Switch value={usePassphrase} onValueChange={setUsePassphrase} />
                        </View>
                        {usePassphrase ? (
                            <>
                                <Text style={styles.note}>
                                    The SeedQR alone then can't spend: you type the passphrase each time you sign. Keep
                                    it apart from the SeedQR. Lose it and the coins are gone.
                                </Text>
                                <TextInput style={styles.input} value={passphrase} onChangeText={setPassphrase}
                                    placeholder="Passphrase" placeholderTextColor="#666" secureTextEntry
                                    autoCapitalize="none" autoCorrect={false} autoComplete="off" importantForAutofill="no" />
                                <TextInput style={styles.input} value={passphraseAgain} onChangeText={setPassphraseAgain}
                                    placeholder="Passphrase again" placeholderTextColor="#666" secureTextEntry
                                    autoCapitalize="none" autoCorrect={false} autoComplete="off" importantForAutofill="no" />
                            </>
                        ) : null}
                        <TouchableOpacity style={styles.primary} onPress={generate} accessibilityRole="button">
                            <Text h3 style={styles.primaryText}>Generate Seed</Text>
                        </TouchableOpacity>
                        {errorText}
                    </>
                )}

                {step === 'load' && (
                    <>
                        <Text style={styles.title}>Show a Seed's Public Key</Text>
                        {!offline ? <Text style={styles.online}>{onlineNote}</Text> : null}
                        <Text style={styles.body}>
                            Scan the SeedQR, or type the words, to show the public key and first addresses to set up or
                            check a watch-only wallet. Nothing is saved.
                        </Text>
                        <TextInput style={styles.input} value={passphrase} onChangeText={setPassphrase}
                            placeholder="Passphrase (only if you use one)" placeholderTextColor="#666" secureTextEntry
                            autoCapitalize="none" autoCorrect={false} autoComplete="off" importantForAutofill="no" />
                        <TouchableOpacity style={styles.primary} onPress={scanSeedQR} accessibilityRole="button">
                            <Text h3 style={styles.primaryText}>Scan SeedQR</Text>
                        </TouchableOpacity>
                        <TextInput style={[styles.input, styles.words]} value={typed} onChangeText={setTyped}
                            placeholder="Or type your 12 or 24 words" placeholderTextColor="#666" multiline
                            autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off"
                            importantForAutofill="no" />
                        <TouchableOpacity style={styles.secondary} onPress={() => load(typed)} accessibilityRole="button">
                            <Text h3>Continue</Text>
                        </TouchableOpacity>
                        {errorText}
                    </>
                )}

                {step === 'words' && (
                    <>
                        <Text style={styles.title}>Write down your 12 words</Text>
                        <Text style={styles.body}>In order, on paper. This is the only time they're shown.</Text>
                        {revealed ? (
                            <View style={styles.wordGrid}>
                                {words.map((word, i) => (
                                    <Text key={i} style={styles.word}>{`${i + 1}. ${word}`}</Text>
                                ))}
                            </View>
                        ) : (
                            <TouchableOpacity style={styles.secondary} onPress={() => setRevealed(true)} accessibilityRole="button">
                                <Text h3>Show the words</Text>
                            </TouchableOpacity>
                        )}
                        <OfflineSeedWarning style={styles.warning} />
                        {revealed ? (
                            <TouchableOpacity style={styles.primary} onPress={() => setStep('seedqr')} accessibilityRole="button">
                                <Text h3 style={styles.primaryText}>Next: the SeedQR</Text>
                            </TouchableOpacity>
                        ) : null}
                    </>
                )}

                {step === 'seedqr' && grid && (
                    <>
                        <Text style={styles.title}>Copy your SeedQR</Text>
                        <Text style={styles.body}>
                            Copy each filled square onto a SeedQR template or a steel plate. Zoom into each quarter. Never
                            photograph it.
                        </Text>
                        <SeedQRGrid grid={grid} width={widths - 48} />
                        <OfflineSeedWarning style={styles.warning} />
                        <TouchableOpacity style={styles.primary} onPress={() => setStep('check')} accessibilityRole="button">
                            <Text h3 style={styles.primaryText}>I've copied it</Text>
                        </TouchableOpacity>
                    </>
                )}

                {step === 'check' && (
                    <>
                        <Text style={styles.title}>Check your copy</Text>
                        <Text style={styles.body}>
                            The seed isn't saved anywhere on this phone, so your copy is all there is. Scan it to check.
                        </Text>
                        <TouchableOpacity style={styles.primary} onPress={check.scan} accessibilityRole="button">
                            <Text h3 style={styles.primaryText}>Scan my SeedQR copy</Text>
                        </TouchableOpacity>
                        {check.result === 'mismatch' ? (
                            <Text style={styles.error}>That copy gives a different seed. Compare it with the grid.</Text>
                        ) : null}
                        <Text style={styles.note}>No camera? Check the written words instead:</Text>
                        <TextInput style={[styles.input, styles.words]} value={typed} onChangeText={setTyped}
                            placeholder="Type your 12 words" placeholderTextColor="#666" multiline
                            autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off"
                            importantForAutofill="no" />
                        <TouchableOpacity style={styles.secondary} onPress={checkTyped} accessibilityRole="button">
                            <Text h3>Check the words</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setStep('seedqr')} accessibilityRole="button">
                            <Text style={styles.link}>Show the grid again</Text>
                        </TouchableOpacity>
                        {errorText}
                    </>
                )}

                {step === 'key' && info && (
                    <>
                        <Text style={styles.title}>{showOnly ? "This seed's public key" : 'Your seed is backed up'}</Text>
                        <Text style={styles.body}>
                            Add this public key to your watch & broadcast only wallet (a Cypher Box Cold Vault, Sparrow or
                            another app), then check its first addresses match these.
                        </Text>
                        <View style={styles.qr}>
                            <QRCodeComponent value={info.xpub} isLogoRendered={false} isMenuAvailable={false} size={widths - 96} />
                        </View>
                        <SelectableText selectable style={styles.mono}>{info.xpub}</SelectableText>
                        <TouchableOpacity style={styles.secondary} onPress={() => {
                            Clipboard.setString(info.xpub);
                            SimpleToast.show('Public key copied', SimpleToast.SHORT);
                        }} accessibilityRole="button">
                            <Text h3>Copy public key</Text>
                        </TouchableOpacity>
                        <View style={styles.facts}>
                            <Text style={styles.fact}>Key fingerprint  <Text style={styles.factValue}>{info.fingerprint}</Text></Text>
                            <Text style={styles.fact}>Path  <Text style={styles.factValue}>{info.path}</Text></Text>
                            <Text style={styles.fact}>First addresses</Text>
                            {info.addresses.map((a, i) => (
                                <SelectableText key={a} selectable style={styles.mono}>{`${i}  ${a}`}</SelectableText>
                            ))}
                        </View>
                        <Text style={styles.note}>
                            Nothing is kept on this phone. Still, if it's ever stolen, assume the seed is compromised and
                            move your coins to a new seed: getting a seed out of a phone is very difficult, but not
                            something to bet on.
                        </Text>
                        <TouchableOpacity style={styles.primary} onPress={done} accessibilityRole="button">
                            <Text h3 style={styles.primaryText}>Done</Text>
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
        paddingBottom: 48,
    },
    title: {
        fontSize: 20,
        lineHeight: 28,
        fontFamily: 'Archivo-SemiBold',
        marginBottom: 12,
    },
    body: {
        fontSize: 15,
        lineHeight: 22,
        color: '#CCC',
        marginBottom: 16,
    },
    note: {
        fontSize: 13,
        lineHeight: 19,
        color: colors.gray.light,
        marginTop: 12,
        marginBottom: 8,
    },
    label: {
        fontSize: 15,
        flex: 1,
    },
    ok: {
        fontSize: 14,
        color: colors.green,
        flex: 1,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 12,
        gap: 12,
    },
    link: {
        fontSize: 14,
        color: colors.blueText,
        textDecorationLine: 'underline',
        marginVertical: 10,
    },
    input: {
        minHeight: 48,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#444',
        paddingHorizontal: 14,
        color: colors.white,
        fontSize: 16,
        marginBottom: 10,
    },
    words: {
        minHeight: 96,
        paddingTop: 12,
        textAlignVertical: 'top',
    },
    primary: {
        height: 52,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.green,
        marginTop: 16,
    },
    primaryText: {
        color: '#000',
    },
    secondary: {
        height: 50,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#444',
        marginTop: 12,
    },
    wordGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    word: {
        width: '30%',
        fontSize: 16,
        lineHeight: 26,
    },
    warning: {
        marginHorizontal: 0,
    },
    qr: {
        alignItems: 'center',
        marginVertical: 12,
    },
    mono: {
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 12,
        lineHeight: 18,
        color: '#CCC',
        marginBottom: 6,
    },
    facts: {
        marginTop: 16,
        gap: 4,
    },
    fact: {
        fontSize: 14,
        color: colors.gray.light,
    },
    factValue: {
        color: colors.white,
        fontWeight: '600',
    },
    online: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.redLight,
        marginBottom: 12,
    },
    error: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.redLight,
        marginTop: 12,
    },
});

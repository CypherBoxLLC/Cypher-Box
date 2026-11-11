import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    Platform,
    Text as SelectableText,
    ScrollView,
    StyleSheet,
    Switch,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import SimpleToast from "react-native-simple-toast";
import Ionicons from "react-native-vector-icons/Ionicons";
import * as bip39 from "bip39";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { EyeVisible } from "@Cypher/assets/images";
import OfflineSeedWarning from "@Cypher/components/OfflineSeedWarning";
import ScannableQR from "@Cypher/components/ScannableQR";
import SeedQRGrid from "@Cypher/components/SeedQRGrid";
import {
    SignerPublicKey,
    backupToMnemonic,
    dispatchNavigate,
    mnemonicToSeedQR,
    nextFrame,
    rootFromMnemonic,
    seedQRGrid,
    signerPublicKey,
} from "@Cypher/helpers";
import { colors, widths } from "@Cypher/style-guide";
import { randomBytes } from "../../../class/rng";
import useProtectSecret from "../../custom-hooks/useProtectSecret";
import useElectrumConnection from "../../custom-hooks/useElectrumConnection";
import useSeedQRCheck from "../../custom-hooks/useSeedQRCheck";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";

/**
 * intro → backup (the words and the SeedQR, as two tabs of one screen) → created (what's next, the last warnings and
 * the check of the copy) → key. Show mode: load → key.
 */
type Step = 'intro' | 'load' | 'backup' | 'created' | 'key';
type BackupTab = 'words' | 'seedqr';

function Instruction({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
    return (
        <View style={styles.instruction}>
            <View style={styles.instructionNumber}>
                <Text bold style={styles.instructionNumberText}>{String(number)}</Text>
            </View>
            <View style={styles.instructionText}>
                <Text bold style={styles.instructionTitle}>{title}</Text>
                <Text style={styles.instructionBody}>{children}</Text>
            </View>
        </View>
    );
}

function Warning({ children }: { children: React.ReactNode }) {
    return (
        <View style={styles.warningRow}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.redLight} style={styles.warningIcon} />
            <Text style={styles.warningText}>{children}</Text>
        </View>
    );
}

/**
 * A seed-signer's seed, made and shown without ever being saved: generated in memory (dice rolls optional, mixed with
 * the phone's randomness), backed up as words and a SeedQR, the copy checked, then only the public side shown, for the
 * watch-only wallet. Leaving the screen drops it. Nothing goes to the app's storage or the Keychain, so nothing outlives
 * the app (on iOS the Keychain does) or waits to be wiped. With `mode: 'show'` it loads a SeedQR or typed words to show
 * that seed's public key again, saving nothing either.
 *
 * Making the words is instant. The public key needs the BIP39 seed, the slow step, so it's worked out once, after the
 * copy is checked, with the native PBKDF2 when the phone has it.
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
    const [tab, setTab] = useState<BackupTab>('words');
    const [typed, setTyped] = useState('');
    const [info, setInfo] = useState<SignerPublicKey | null>(null);
    const [deriving, setDeriving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const check = useSeedQRCheck(mnemonic);
    // a seed is only made or loaded while no server answers: on a phone that's online, it would be a hot wallet
    const connection = useElectrumConnection(true, false);
    const offline = connection === 'no-answer';
    const onlineNote = connection === 'checking'
        ? 'Checking this phone is offline…'
        : "This phone is online. A seed is only made or loaded once it's offline: Airplane Mode on, Wi-Fi and Bluetooth off.";
    const newPassphrase = usePassphrase ? passphrase : '';

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

    // The back arrow, a swipe or Android's back button. From "created" it goes back to the backup; from the backup it
    // asks first, since leaving drops a seed that may be only half copied. Other ways off the screen aren't held up.
    const stepRef = useRef(step);
    stepRef.current = step;
    const leaving = useRef(false);
    useEffect(() => {
        const unsubscribe = navigation?.addListener?.('beforeRemove', (e: any) => {
            const type = e?.data?.action?.type;
            if (leaving.current || (type !== 'GO_BACK' && type !== 'POP')) return;
            if (stepRef.current === 'created') {
                e.preventDefault();
                setError(null);
                setStep('backup');
            } else if (stepRef.current === 'backup') {
                e.preventDefault();
                Alert.alert(
                    'Leave without finishing?',
                    "This seed isn't saved anywhere. If you leave now, it's gone, and you'll make a new one next time.",
                    [
                        { text: 'Stay', style: 'cancel' },
                        {
                            text: 'Leave',
                            style: 'destructive',
                            onPress: () => {
                                leaving.current = true;
                                navigation.dispatch(e.data.action);
                            },
                        },
                    ],
                );
            }
        });
        return unsubscribe;
    }, [navigation]);

    // the one slow step: the seed from the words, then everything public the key screen shows
    const deriveKey = async (phrase: string, pass: string, from: Step) => {
        setError(null);
        setInfo(null);
        setDeriving(true);
        setStep('key');
        try {
            await nextFrame();
            setInfo(signerPublicKey(await rootFromMnemonic(phrase, pass)));
            // its public side is all that's needed from here
            forget();
        } catch (e: any) {
            setError(e?.message ?? "This seed's public key couldn't be worked out.");
            setStep(from);
        } finally {
            setDeriving(false);
        }
    };

    useEffect(() => {
        if (check.result === 'ok' && stepRef.current === 'created') deriveKey(mnemonic, newPassphrase, 'created');
        // only a new scan result starts it
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [check.result]);

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
            let phrase: string;
            // the dice screen hands back its rolls already mixed with the phone's randomness
            if (dice && dice.length >= 16) {
                phrase = bip39.entropyToMnemonic(dice.slice(0, 16).toString('hex'));
            } else {
                // the phone's randomness, as BlueWallet's wallets make theirs, but without loading the wallet classes:
                // each runs an elliptic-curve self-test, seconds in all on a slow phone
                phrase = bip39.entropyToMnemonic((await randomBytes(16)).toString('hex'));
            }
            setMnemonic(phrase);
            setRevealed(false);
            setTab('words');
            setTyped('');
            setStep('backup');
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
        let phrase: string;
        try {
            phrase = backupToMnemonic(text);
        } catch (e: any) {
            setError(e?.message ?? "That isn't a recovery phrase or a SeedQR.");
            return;
        }
        return deriveKey(phrase, passphrase, 'load');
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
                return deriveKey(mnemonic, newPassphrase, 'created');
            }
            setError("That isn't the same phrase. Check your copy word by word.");
        } catch (e: any) {
            setError(e?.message);
        }
    };

    const backToBackup = () => {
        setError(null);
        setStep('backup');
    };

    const done = () => {
        forget();
        setInfo(null);
        navigation.goBack();
    };

    const words = mnemonic ? mnemonic.split(' ') : [];
    const grid = useMemo(() => (mnemonic ? seedQRGrid(mnemonicToSeedQR(mnemonic)) : null), [mnemonic]);
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

                {step === 'backup' && (
                    <>
                        <Text style={styles.title}>Back up your seed</Text>
                        <Text style={styles.body}>
                            Write the {words.length} words on paper, in order, and copy the SeedQR onto a SeedQR template
                            or a steel plate. This is the only time this phone shows them.
                        </Text>
                        {newPassphrase ? (
                            <Text style={styles.passphraseNote}>
                                Your passphrase isn't part of this backup. Keep it written down, apart from it.
                            </Text>
                        ) : null}
                        {/* one backup, two ways to copy it, as when a Hot Vault is made */}
                        <View style={styles.tabs}>
                            {(['words', 'seedqr'] as const).map(t => (
                                <TouchableOpacity
                                    key={t}
                                    onPress={() => setTab(t)}
                                    style={[styles.tab, tab === t && styles.tabOn]}
                                    accessibilityRole="tab"
                                    accessibilityState={{ selected: tab === t }}
                                >
                                    <Text bold style={tab === t ? styles.tabTextOn : styles.tabText}>
                                        {t === 'words' ? `${words.length} words` : 'SeedQR'}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                        {!revealed ? (
                            <View style={[styles.backupBox, styles.hidden]}>
                                <Text bold center style={styles.hiddenTitle}>Tap to reveal your seed phrase</Text>
                                <Text center style={styles.hiddenBody}>Make sure no one is watching your screen.</Text>
                                <TouchableOpacity style={styles.view} onPress={() => setRevealed(true)} accessibilityRole="button">
                                    <Image source={EyeVisible} />
                                    <Text h3 style={styles.viewText}>View</Text>
                                </TouchableOpacity>
                            </View>
                        ) : tab === 'words' ? (
                            <View style={[styles.backupBox, styles.wordGrid]}>
                                {words.map((word, i) => (
                                    <View key={i} style={styles.wordPill}>
                                        <Text style={styles.word}>{`${i + 1}. ${word}`}</Text>
                                    </View>
                                ))}
                            </View>
                        ) : grid ? (
                            <>
                                <Text style={styles.body}>
                                    Copy each filled square onto a SeedQR template or a steel plate. Zoom into each
                                    quarter. Never photograph it.
                                </Text>
                                <SeedQRGrid grid={grid} width={widths - 48} />
                            </>
                        ) : null}
                        <OfflineSeedWarning style={styles.warning} />
                        <TouchableOpacity
                            style={[styles.primary, !revealed && styles.disabled]}
                            disabled={!revealed}
                            onPress={() => setStep('created')}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !revealed }}
                        >
                            <Text h3 style={styles.primaryText}>I've backed it up</Text>
                        </TouchableOpacity>
                    </>
                )}

                {step === 'created' && (
                    <>
                        <Text style={styles.createdTitle}>Seed-Signer created!</Text>
                        <Text style={styles.body}>
                            Your seed now lives only on your backup: the words on paper and the SeedQR. This phone
                            forgets it when you leave this screen.
                        </Text>

                        <Text style={styles.sectionTitle}>What's next</Text>
                        <Instruction number={1} title="Check your backup">
                            Scan your SeedQR copy below, or type the words. The public key only shows once the copy
                            checks out, so no coins go to a seed whose backup has a mistake.
                        </Instruction>
                        <Instruction number={2} title="Set up your watch-only wallet">
                            Add the public key this phone then shows to your watch & broadcast only wallet (a Cypher
                            Box Cold Vault, Sparrow or another app), and check its first addresses match.
                        </Instruction>
                        <Instruction number={3} title="Sign by scanning">
                            To sign, tap Sign a Transaction with SeedQR, scan the transaction your watch-only wallet
                            made, check it, then scan your SeedQR. The phone signs and forgets the seed again.
                        </Instruction>

                        <Text style={styles.sectionTitle}>Before you go</Text>
                        <Warning>
                            This phone doesn't keep your seed. Your words and SeedQR are the only copies: lose them and
                            the coins are gone.
                        </Warning>
                        <Warning>
                            Anyone who sees your words or SeedQR can take the coins. Never photograph them or type them
                            into a phone or computer that's online, and keep them apart from this phone.
                        </Warning>
                        {newPassphrase ? (
                            <Warning>
                                Your passphrase isn't in the words or the SeedQR. You type it each time you sign: lose it
                                and the coins are gone.
                            </Warning>
                        ) : null}
                        <OfflineSeedWarning style={styles.warning} />

                        <Text style={styles.sectionTitle}>Check your backup</Text>
                        <TouchableOpacity style={styles.primary} onPress={check.scan} accessibilityRole="button">
                            <Text h3 style={styles.primaryText}>Scan my SeedQR copy</Text>
                        </TouchableOpacity>
                        {check.result === 'mismatch' ? (
                            <Text style={styles.error}>That copy gives a different seed. Compare it with the backup.</Text>
                        ) : null}
                        <Text style={styles.note}>No camera? Check the written words instead:</Text>
                        <TextInput style={[styles.input, styles.words]} value={typed} onChangeText={setTyped}
                            placeholder="Type your 12 words" placeholderTextColor="#666" multiline
                            autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off"
                            importantForAutofill="no" />
                        <TouchableOpacity style={styles.secondary} onPress={checkTyped} accessibilityRole="button">
                            <Text h3>Check the words</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={backToBackup} accessibilityRole="button">
                            <Text style={styles.link}>Show the backup again</Text>
                        </TouchableOpacity>
                        {errorText}
                    </>
                )}

                {step === 'key' && deriving && (
                    <View style={styles.working}>
                        <ActivityIndicator size="large" color={colors.green} />
                        <Text style={styles.workingText}>Working out this seed's public key…</Text>
                    </View>
                )}

                {step === 'key' && !deriving && info && (
                    <>
                        <Text style={styles.title}>{showOnly ? "This seed's public key" : 'Your seed is backed up'}</Text>
                        <Text style={styles.body}>
                            Add this public key to your watch & broadcast only wallet (a Cypher Box Cold Vault, Sparrow or
                            another app), then check its first addresses match these. The part in brackets is the key
                            fingerprint and path, which your wallet needs to make transactions this seed can sign.
                        </Text>
                        <View style={styles.qr}>
                            <ScannableQR value={info.key} width={widths - 48} />
                        </View>
                        <SelectableText selectable style={styles.mono}>{info.key}</SelectableText>
                        <TouchableOpacity style={styles.secondary} onPress={() => {
                            Clipboard.setString(info.key);
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
    createdTitle: {
        fontSize: 24,
        lineHeight: 32,
        fontFamily: 'Archivo-SemiBold',
        color: colors.green,
        textAlign: 'center',
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
    passphraseNote: {
        fontSize: 13,
        lineHeight: 19,
        color: '#FFD54F',
        marginBottom: 12,
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
        color: colors.green,
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
    disabled: {
        opacity: 0.4,
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
    // the words / SeedQR switch, drawn like the Hot Vault's
    tabs: {
        flexDirection: 'row',
        alignSelf: 'center',
        marginBottom: 14,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.gray.disable,
        padding: 3,
    },
    tab: {
        paddingHorizontal: 22,
        paddingVertical: 7,
        borderRadius: 17,
    },
    tabOn: {
        backgroundColor: colors.green,
    },
    tabText: {
        fontSize: 14,
        lineHeight: 18,
    },
    tabTextOn: {
        fontSize: 14,
        lineHeight: 18,
        color: '#000',
    },
    backupBox: {
        minHeight: 260,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.gray.disable,
        padding: 10,
    },
    hidden: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(34, 37, 49, 0.97)',
    },
    hiddenTitle: {
        fontSize: 14,
    },
    hiddenBody: {
        fontSize: 12,
        marginTop: 15,
    },
    view: {
        backgroundColor: colors.black.light,
        width: 102,
        height: 56,
        borderRadius: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 30,
    },
    viewText: {
        fontFamily: 'Archivo-Bold',
        marginStart: 5,
    },
    wordGrid: {
        // the words read left to right in every language
        direction: 'ltr',
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignContent: 'center',
    },
    wordPill: {
        width: '31%',
        height: 34,
        marginVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.green,
        alignItems: 'center',
        justifyContent: 'center',
    },
    word: {
        fontFamily: 'Archivo-Bold',
        fontSize: 14,
    },
    warning: {
        marginHorizontal: 0,
    },
    instruction: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 14,
    },
    instructionNumber: {
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: colors.green,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 1,
    },
    instructionNumberText: {
        fontSize: 13,
        color: colors.green,
    },
    instructionText: {
        flex: 1,
    },
    instructionTitle: {
        fontSize: 15,
        lineHeight: 21,
        marginBottom: 2,
    },
    instructionBody: {
        fontSize: 14,
        lineHeight: 20,
        color: '#CCC',
    },
    warningRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 10,
    },
    warningIcon: {
        marginTop: 1,
        marginRight: 8,
    },
    warningText: {
        flex: 1,
        fontSize: 14,
        lineHeight: 20,
        color: colors.redLight,
    },
    working: {
        alignItems: 'center',
        paddingVertical: 80,
        gap: 16,
    },
    workingText: {
        fontSize: 15,
        lineHeight: 22,
        color: '#CCC',
        textAlign: 'center',
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
    sectionTitle: {
        fontSize: 17,
        lineHeight: 24,
        fontFamily: 'Archivo-SemiBold',
        marginTop: 8,
        marginBottom: 10,
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

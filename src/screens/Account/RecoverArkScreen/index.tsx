import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, TouchableOpacity, View } from "react-native";
import DocumentPicker, { types as DocTypes } from "react-native-document-picker";
import RNFS from "react-native-fs";
import * as Keychain from "react-native-keychain";

import { Button, Input, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import {
    AUTO_BACKUP_PATH,
    createArkWallet,
    hasArkDatadir,
    restoreArkBackupBlob,
    connectGoogleDrive,
    isGoogleDriveConnected,
    downloadArkBackupFromDrive,
    readArkBackupFromSaf,
} from "@Cypher/services/ark";
import { validateMnemonic } from "@secondts/bark-react-native";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";

import styles from "./styles";

/**
 * Keychain convention — MUST match ArkSeedPhraseScreen / recover.ts / reset.ts.
 * If these drift, the next session can't unlock the seed and the on-chain
 * sidecar (`ensureArkOnchainHandle`) will fail with "seed not in Keychain".
 */
const KEYCHAIN_SERVICE = "ark-seed-phrase";
const KEYCHAIN_ACCOUNT = "ark";

const inputs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

type Mode = 'auto' | 'type';

const BIOMETRIC_LABEL = Platform.OS === 'ios' ? 'Face ID' : 'Touch ID';

/**
 * RecoverArkScreen — manual 12-word recovery for an Ark wallet.
 *
 * Architecture: progressive disclosure. The screen mounts a tiny
 * "choose recovery method" view first (a couple of buttons, zero TextInputs).
 * The heavy 12-input grid + restore-with-typed-seed flow only mounts when
 * the user explicitly taps "Type seed manually".
 *
 * Why: prior to this rewrite the screen mounted the entire 1067-line tree —
 * including 12 Input components — synchronously during the slide-in
 * transition, blocking the JS thread badly enough on older Galaxy devices
 * that the slide stalled midway. Splitting into chooser + typed-grid
 * subviews keeps first paint cheap regardless of navigation timing.
 *
 * Recovery paths preserved from the previous implementation:
 *   1. Keychain fast path — Face ID unlock → Restore from backup file/cloud.
 *      Used for same-device reinstall where the seed survived.
 *   2. Typed grid — user types 12 words. Surfaces the existing two CTAs:
 *      "Recover" (seed-only, lands on empty wallet) and
 *      "Restore from backup file" (the only path that actually returns funds).
 *   3. Backup file / cloud — works with whichever mnemonic is resolved
 *      (keychain-unlocked or typed). VTXOs aren't seed-derivable in Bark,
 *      so this is the *only* path that returns funds.
 */
export default function RecoverArkScreen() {
    const {
        allBTCWallets,
        setAllBTCWallets,
        setArkAuth,
        setArkWallet,
    } = useAuthStore();

    const [mode, setMode] = useState<Mode>('auto');
    const [secretWords, setSecretWords] = useState<string[]>(
        Array(inputs.length).fill(""),
    );
    const [submitting, setSubmitting] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [datadirExists, setDatadirExists] = useState<boolean | null>(null);
    const [keychainHasSeed, setKeychainHasSeed] = useState<boolean | null>(null);
    const [unlockedMnemonic, setUnlockedMnemonic] = useState<string | null>(null);
    const [unlocking, setUnlocking] = useState(false);
    const inputRefs = useRef<Array<any>>(new Array(inputs.length));

    // Pre-flight: detect a stale datadir AND surface the Keychain fast path.
    // hasGenericPassword is metadata-only — it does NOT trigger biometrics.
    // The biometric prompt only fires when we actually read the secret in
    // handleUnlockWithFaceId.
    useEffect(() => {
        (async () => {
            try {
                setDatadirExists(await hasArkDatadir());
            } catch {
                setDatadirExists(false);
            }
            try {
                // react-native-keychain@8.1.2 doesn't have `hasGenericPassword`.
                // Use the metadata-only `getAllGenericPasswordServices` which
                // lists every service slot that has stored credentials. No
                // biometric prompt — that only fires on `getGenericPassword`.
                const services = await Keychain.getAllGenericPasswordServices();
                setKeychainHasSeed(
                    Array.isArray(services) && services.includes(KEYCHAIN_SERVICE),
                );
            } catch {
                setKeychainHasSeed(false);
            }
        })();
    }, []);

    const handleSecretWordChange = (index: number, value: string) => {
        const next = [...secretWords];
        next[index] = value;
        setSecretWords(next);
        if (errorMsg) setErrorMsg(null);
    };

    const handleKeyPress = (event: any, index: number) => {
        if (event.nativeEvent.key === " " || event.nativeEvent.key === "Enter") {
            if (index < inputRefs.current.length - 1) {
                inputRefs.current[index + 1]?.focus();
            }
        }
    };

    /**
     * Resolve the mnemonic to use for restore — Keychain first, typed grid
     * second. Same logic as the previous implementation; kept stable so the
     * downstream restore handlers don't change behavior.
     */
    const resolveMnemonicForRestore = async (): Promise<
        { mnemonic: string; source: 'keychain' | 'typed' } | null
    > => {
        if (unlockedMnemonic) {
            return { mnemonic: unlockedMnemonic, source: 'keychain' };
        }
        const mnemonic = secretWords
            .map((w) => w.trim().toLowerCase())
            .filter(Boolean)
            .join(" ");
        if (mnemonic.split(/\s+/).length !== 12) {
            setErrorMsg(
                keychainHasSeed
                    ? `Tap "Unlock with ${BIOMETRIC_LABEL}" first, or type all 12 words manually.`
                    : "Type all 12 seed words first, then choose your backup file.",
            );
            return null;
        }
        let valid = false;
        try {
            valid = validateMnemonic(mnemonic);
        } catch {
            setErrorMsg("Couldn't validate seed phrase. Check the words and try again.");
            return null;
        }
        if (!valid) {
            setErrorMsg(
                "Invalid seed phrase. Double-check spelling — each word must be a BIP39 word.",
            );
            return null;
        }
        return { mnemonic, source: 'typed' };
    };

    const handleUnlockWithFaceId = async () => {
        if (unlocking || unlockedMnemonic) return;
        setUnlocking(true);
        setErrorMsg(null);
        try {
            const creds = await Keychain.getGenericPassword({
                service: KEYCHAIN_SERVICE,
            });
            if (creds && creds.password) {
                setUnlockedMnemonic(creds.password);
            } else {
                setErrorMsg(
                    "Keychain returned no seed. Tap \"Type seed manually\" below.",
                );
            }
        } catch (err: any) {
            console.warn('[Ark restore] Keychain read declined:', err?.message ?? err);
            setErrorMsg(
                `${BIOMETRIC_LABEL} was declined. Tap unlock again, or type your 12 words manually.`,
            );
        } finally {
            setUnlocking(false);
        }
    };

    const confirmReplaceDatadir = async (sourceLabel: string): Promise<boolean> => {
        if (!datadirExists) return true;
        return new Promise<boolean>((resolve) => {
            Alert.alert(
                "Replace existing Ark wallet?",
                `Restoring ${sourceLabel} will wipe the current wallet and replace it with the encrypted backup. Anything in flight (mid-round, unsettled HTLC) that isn't in the backup will be lost.`,
                [
                    { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                    { text: "Replace", style: "destructive", onPress: () => resolve(true) },
                ],
                { cancelable: true, onDismiss: () => resolve(false) },
            );
        });
    };

    const persistSeedToKeychain = async (mnemonic: string, label: string) => {
        try {
            await Keychain.setGenericPassword(KEYCHAIN_ACCOUNT, mnemonic, {
                service: KEYCHAIN_SERVICE,
                accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
                accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
            });
        } catch (err) {
            // Wallet's already restored & open — non-fatal warning.
            console.warn(`[Ark restore] Keychain save failed (${label}):`, err);
        }
    };

    const finalizeWallet = (restoredFrom?: string) => {
        const wallet = {
            id: `ark-${Date.now()}`,
            createdAt: new Date().toISOString(),
            useHotVaultSeed: false,
            keychainSaved: true,
            restored: true,
            restoredFrom: restoredFrom ?? null,
            backupDestination: null,
        };
        setArkWallet(wallet);
        setArkAuth(true);
        if (!allBTCWallets.includes("ARK")) {
            setAllBTCWallets([...allBTCWallets, "ARK"]);
        }
        dispatchReset("HomeScreen", { isComplete: true });
    };

    // forcePicker bypasses the local-first read so the user can restore from
    // some other .cbark — e.g. an older manually-exported snapshot. Wired to
    // the "Pick a different file…" escape hatch in both view variants.
    const handleRestoreFromFile = async (forcePicker = false) => {
        if (submitting || restoring) return;
        const resolved = await resolveMnemonicForRestore();
        if (!resolved) return;
        const { mnemonic } = resolved;

        if (!(await confirmReplaceDatadir("from this backup file"))) return;

        setRestoring(true);
        setErrorMsg(null);

        // Local-first auto-discovery, in order of preference:
        //   1. AUTO_BACKUP_PATH — Documents/ark-backup.cbark, the
        //      always-on local file. Wiped on `pm uninstall` and
        //      `pm clear`, so this only hits on `install -r` or app-data
        //      preserved scenarios.
        //   2. SAF folder — the user-chosen Storage Access Framework
        //      folder, populated by writeArkAutoBackup via
        //      writeArkBackupToSaf when configured. The persisted URI
        //      (in AsyncStorage) is wiped on uninstall/pm-clear too,
        //      but during `install -r` recovery the URI survives, so
        //      the SAF auto-find covers update reinstalls when
        //      Documents was wiped but the SAF URI persisted.
        //   3. DocumentPicker — the explicit picker. Default landing on
        //      Android is "Recent files"; the user navigates from
        //      there to wherever they kept the .cbark (Drive folder,
        //      manual export they emailed themselves, etc.). This is
        //      the only path that works after a fresh reinstall on a
        //      different device.
        //
        // Each step skipped when forcePicker is true — that bypasses
        // the local-first reads so the user can pick an OLDER
        // manually-exported .cbark even when the always-current one
        // is on disk.
        let blob: string | null = null;
        if (!forcePicker) {
            try {
                if (await RNFS.exists(AUTO_BACKUP_PATH)) {
                    blob = await RNFS.readFile(AUTO_BACKUP_PATH, 'utf8');
                }
            } catch (err) {
                console.warn('[Ark restore] local AUTO_BACKUP_PATH read failed:', err);
            }
        }

        if (!blob && !forcePicker) {
            // SAF folder fallback — Android only (no-op on iOS via the
            // service-side guard). Survives `install -r` even when the
            // app-private Documents file is gone, because the SAF
            // folder lives outside the app sandbox.
            try {
                const safBlob = await readArkBackupFromSaf();
                if (safBlob) blob = safBlob;
            } catch (err) {
                console.warn('[Ark restore] SAF folder read failed:', err);
            }
        }

        if (!blob) {
            try {
                const result = await DocumentPicker.pickSingle({
                    type: [DocTypes.allFiles],
                    copyTo: "cachesDirectory",
                });
                const pickedUri = result.fileCopyUri ?? result.uri;
                if (!pickedUri) {
                    setRestoring(false);
                    setErrorMsg("Couldn't read picked file (no path returned)");
                    return;
                }
                const cleanPath = pickedUri.replace(/^file:\/\//, "");
                blob = await RNFS.readFile(cleanPath, "utf8");
            } catch (err: any) {
                if (DocumentPicker.isCancel(err)) {
                    setRestoring(false);
                    return;
                }
                console.warn('[Ark restore] picker threw:', err);
                setRestoring(false);
                setErrorMsg(`Couldn't open file picker: ${err?.message ?? "unknown error"}`);
                return;
            }
        }

        try {
            await restoreArkBackupBlob(blob, mnemonic);
        } catch (err: any) {
            console.warn('[Ark restore] failed:', err);
            setRestoring(false);
            setErrorMsg(
                `Restore failed: ${err?.message ?? "unknown error"}. ` +
                `Make sure your seed matches the backup, and that this is the right ark-backup file.`,
            );
            return;
        }

        await persistSeedToKeychain(mnemonic, "file restore");
        setRestoring(false);
        finalizeWallet();
    };

    const handleRestoreFromGoogleDrive = async () => {
        if (submitting || restoring) return;
        const resolved = await resolveMnemonicForRestore();
        if (!resolved) return;
        const { mnemonic } = resolved;

        if (!(await confirmReplaceDatadir("from Google Drive"))) return;

        setRestoring(true);
        setErrorMsg(null);
        try {
            const connected = await isGoogleDriveConnected();
            if (!connected) {
                const ok = await connectGoogleDrive();
                if (!ok) {
                    setRestoring(false);
                    setErrorMsg("Google Sign-In was declined.");
                    return;
                }
            }
            const blob = await downloadArkBackupFromDrive();
            if (!blob) {
                setRestoring(false);
                setErrorMsg(
                    "No backup found in Google Drive for this Google account. " +
                    "Make sure you signed in with the same account you used when you first connected Drive.",
                );
                return;
            }
            await restoreArkBackupBlob(blob, mnemonic);
        } catch (err: any) {
            console.warn('[Ark restore] Drive flow failed:', err);
            setRestoring(false);
            setErrorMsg(
                `Restore from Drive failed: ${err?.message ?? "unknown error"}. ` +
                `Make sure your seed matches the backup.`,
            );
            return;
        }

        await persistSeedToKeychain(mnemonic, "Drive restore");
        setRestoring(false);
        finalizeWallet('google-drive');
    };

    const handleRestoreFromICloud = async () => {
        if (submitting || restoring) return;
        const resolved = await resolveMnemonicForRestore();
        if (!resolved) return;
        const { mnemonic } = resolved;

        if (!(await confirmReplaceDatadir("from iCloud Drive"))) return;

        setRestoring(true);
        setErrorMsg(null);

        let blob: string | null = null;
        try {
            if (await RNFS.exists(AUTO_BACKUP_PATH)) {
                blob = await RNFS.readFile(AUTO_BACKUP_PATH, 'utf8');
            }
        } catch (err) {
            console.warn('[Ark restore] local AUTO_BACKUP_PATH read failed:', err);
        }

        if (!blob) {
            try {
                const result = await DocumentPicker.pickSingle({
                    type: [DocTypes.allFiles],
                    copyTo: 'cachesDirectory',
                    presentationStyle: 'fullScreen',
                });
                const pickedUri = result.fileCopyUri ?? result.uri;
                if (!pickedUri) {
                    setRestoring(false);
                    setErrorMsg("Couldn't read picked file (no path returned)");
                    return;
                }
                const cleanPath = pickedUri.replace(/^file:\/\//, '');
                blob = await RNFS.readFile(cleanPath, 'utf8');
            } catch (err: any) {
                if (DocumentPicker.isCancel(err)) {
                    setRestoring(false);
                    return;
                }
                console.warn('[Ark restore] iCloud picker threw:', err);
                setRestoring(false);
                setErrorMsg(
                    `Couldn't read backup from iCloud Drive: ${err?.message ?? 'unknown error'}. ` +
                    `Make sure iCloud Drive is enabled for Cypher Box, then tap again — ` +
                    `the picker should show "iCloud Drive → Cypher Box → ark-backup.cbark".`,
                );
                return;
            }
        }

        try {
            await restoreArkBackupBlob(blob, mnemonic);
        } catch (err: any) {
            console.warn('[Ark restore] iCloud blob restore failed:', err);
            setRestoring(false);
            setErrorMsg(
                `Restore from iCloud failed: ${err?.message ?? 'unknown error'}. ` +
                `Make sure your seed matches the backup, and that this is the right ark-backup file.`,
            );
            return;
        }

        await persistSeedToKeychain(mnemonic, "iCloud restore");
        setRestoring(false);
        finalizeWallet('icloud-drive');
    };

    const handleRecoverSeedOnly = async () => {
        if (submitting) return;
        const mnemonic = secretWords
            .map((w) => w.trim().toLowerCase())
            .filter(Boolean)
            .join(" ");

        if (mnemonic.split(/\s+/).length !== 12) {
            setErrorMsg("Please fill in all 12 words.");
            return;
        }
        let valid = false;
        try {
            valid = validateMnemonic(mnemonic);
        } catch (err) {
            console.warn("[Ark recover] validateMnemonic threw:", err);
            setErrorMsg("Couldn't validate seed phrase. Check the words and try again.");
            return;
        }
        if (!valid) {
            setErrorMsg(
                "Invalid seed phrase. Double-check spelling — each word must be a BIP39 word.",
            );
            return;
        }

        if (datadirExists) {
            Alert.alert(
                "An Ark wallet already exists",
                "There's already wallet data on this device. Open the existing setup screen to either reopen it (if the seed matches) or reset before recovering with a new seed.",
                [
                    { text: "Cancel", style: "cancel" },
                    { text: "Open setup", onPress: () => dispatchNavigate("CreateArkScreen") },
                ],
            );
            return;
        }

        setSubmitting(true);
        setErrorMsg(null);

        try {
            await Keychain.setGenericPassword(KEYCHAIN_ACCOUNT, mnemonic, {
                service: KEYCHAIN_SERVICE,
                accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
                accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
            });
        } catch (err: any) {
            console.warn("[Ark recover] Keychain save failed:", err);
            setSubmitting(false);
            setErrorMsg(
                `Couldn't save the seed to Keychain: ${err?.message ?? "unknown error"}. Recovery aborted to keep state consistent.`,
            );
            return;
        }

        try {
            await createArkWallet(mnemonic, true);
        } catch (err: any) {
            console.warn("[Ark recover] createArkWallet failed:", err);
            const msg = (err as Error)?.message ?? "unknown error";
            setSubmitting(false);
            setErrorMsg(
                /Internal/i.test(msg)
                    ? "Couldn't open or create the Ark wallet — local state may be stale. Open the setup screen and tap Reset, then try again."
                    : `Recovery failed: ${msg}`,
            );
            return;
        }

        setSubmitting(false);
        finalizeWallet();
    };

    const cloudLabel = Platform.OS === 'ios' ? 'iCloud Drive' : 'Google Drive';
    const cloudHandler = Platform.OS === 'ios' ? handleRestoreFromICloud : handleRestoreFromGoogleDrive;
    const probing = keychainHasSeed === null;
    // Show the typed-grid view when the probe says no seed exists (cold
    // install / new device — typing is the only way in) OR when the user
    // explicitly opted into typing from the Face ID chooser.
    const showTypeView = mode === 'type' || keychainHasSeed === false;

    if (submitting || restoring) {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.ark.light} />
                    <Text style={styles.loadingText}>
                        {restoring ? "Restoring from backup file…" : "Recovering Ark wallet…"}
                    </Text>
                </View>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout title="Recover Ark Wallet" showToolbar isBackButton disableScroll>
            <View style={styles.container}>
                {probing ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.ark.light} />
                    </View>
                ) : showTypeView ? (
                    <TypeSeedView
                        secretWords={secretWords}
                        inputRefs={inputRefs}
                        errorMsg={errorMsg}
                        cloudLabel={cloudLabel}
                        canGoBack={keychainHasSeed === true}
                        onWordChange={handleSecretWordChange}
                        onKeyPress={handleKeyPress}
                        onRecover={handleRecoverSeedOnly}
                        onRestoreFile={() => handleRestoreFromFile(false)}
                        onPickDifferentFile={() => handleRestoreFromFile(true)}
                        onRestoreCloud={cloudHandler}
                        onBack={() => {
                            setErrorMsg(null);
                            setMode('auto');
                        }}
                    />
                ) : (
                    <ChooseView
                        unlocking={unlocking}
                        unlockedMnemonic={unlockedMnemonic}
                        cloudLabel={cloudLabel}
                        errorMsg={errorMsg}
                        onUnlockFaceId={handleUnlockWithFaceId}
                        onTypeSeed={() => {
                            setErrorMsg(null);
                            setMode('type');
                        }}
                        onRestoreFile={() => handleRestoreFromFile(false)}
                        onPickDifferentFile={() => handleRestoreFromFile(true)}
                        onRestoreCloud={cloudHandler}
                    />
                )}
            </View>
        </ScreenLayout>
    );
}

interface ChooseViewProps {
    unlocking: boolean;
    unlockedMnemonic: string | null;
    cloudLabel: string;
    errorMsg: string | null;
    onUnlockFaceId(): void;
    onTypeSeed(): void;
    onRestoreFile(): void;
    onPickDifferentFile(): void;
    onRestoreCloud(): void;
}

// Face ID chooser — only shown when the device's Keychain already has the
// seed at the `ark-seed-phrase` slot. Cold-install users skip this view
// entirely and land on TypeSeedView directly.
function ChooseView({
    unlocking,
    unlockedMnemonic,
    cloudLabel,
    errorMsg,
    onUnlockFaceId,
    onTypeSeed,
    onRestoreFile,
    onPickDifferentFile,
    onRestoreCloud,
}: ChooseViewProps) {
    return (
        <>
            <Text bold style={styles.introTitle}>
                Restore your Ark wallet
            </Text>
            <Text style={styles.introBody}>
                {`Your Ark seed phrase is in this device's Keychain — you don't need to type it. Tap unlock below to load the seed via ${BIOMETRIC_LABEL} / passcode.\n\nArk VTXOs aren't seed-derivable, so you'll also need your ark-backup file — from ${cloudLabel} (if you connected it earlier) or a manual export.`}
            </Text>

            {!unlockedMnemonic && (
                <Button
                    text={unlocking ? "Unlocking…" : `Unlock with ${BIOMETRIC_LABEL}`}
                    onPress={onUnlockFaceId}
                    style={styles.button}
                    textStyle={styles.btnText}
                    disable={unlocking}
                />
            )}

            {unlockedMnemonic && (
                <View
                    style={{
                        alignSelf: "center",
                        marginTop: 8,
                        marginBottom: 6,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: colors.green,
                        backgroundColor: "rgba(40, 200, 110, 0.08)",
                    }}
                >
                    <Text style={{ color: colors.green, fontSize: 12 }}>
                        ✓ Seed unlocked — ready to restore
                    </Text>
                </View>
            )}

            {unlockedMnemonic && (
                <Button
                    text="Restore from backup file"
                    onPress={onRestoreFile}
                    style={styles.button}
                    textStyle={styles.btnText}
                />
            )}

            {unlockedMnemonic && (
                <TouchableOpacity
                    onPress={onRestoreCloud}
                    style={{
                        alignSelf: 'stretch',
                        marginHorizontal: 0,
                        marginTop: 10,
                        paddingVertical: 14,
                        paddingHorizontal: 18,
                        borderRadius: 12,
                        borderWidth: 1.5,
                        borderColor: colors.ark?.light ?? colors.pink.default,
                        alignItems: 'center',
                    }}
                >
                    <Text bold style={{ color: colors.ark?.light ?? colors.pink.default, fontSize: 14 }}>
                        Restore from {cloudLabel}
                    </Text>
                </TouchableOpacity>
            )}

            {/* Tertiary escape hatch: skip the always-fresh local copy and
                pick some other .cbark (e.g. an older manually-exported one). */}
            {unlockedMnemonic && (
                <TouchableOpacity
                    onPress={onPickDifferentFile}
                    style={{ alignSelf: "center", marginTop: 12, paddingVertical: 8 }}
                >
                    <Text
                        style={{
                            color: colors.gray.light,
                            fontSize: 12,
                            textDecorationLine: "underline",
                        }}
                    >
                        Pick a different .cbark file instead
                    </Text>
                </TouchableOpacity>
            )}

            {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}

            {/* Once the seed is unlocked from Keychain, typing it would just
                duplicate work — hide the manual fallback so the user goes
                straight from "✓ Seed unlocked" to one of the restore CTAs. */}
            {!unlockedMnemonic && (
                <TouchableOpacity
                    onPress={onTypeSeed}
                    style={{ alignSelf: "center", marginTop: 24, paddingVertical: 8 }}
                >
                    <Text
                        style={{
                            color: colors.gray.light,
                            fontSize: 12,
                            textDecorationLine: "underline",
                        }}
                    >
                        Type seed manually instead
                    </Text>
                </TouchableOpacity>
            )}
        </>
    );
}

interface TypeSeedViewProps {
    secretWords: string[];
    inputRefs: React.MutableRefObject<Array<any>>;
    errorMsg: string | null;
    cloudLabel: string;
    canGoBack: boolean;
    onWordChange(index: number, value: string): void;
    onKeyPress(event: any, index: number): void;
    onRecover(): void;
    onRestoreFile(): void;
    onPickDifferentFile(): void;
    onRestoreCloud(): void;
    onBack(): void;
}

function TypeSeedView({
    secretWords,
    inputRefs,
    errorMsg,
    cloudLabel,
    canGoBack,
    onWordChange,
    onKeyPress,
    onRecover,
    onRestoreFile,
    onPickDifferentFile,
    onRestoreCloud,
    onBack,
}: TypeSeedViewProps) {
    return (
        <>
            <Text bold style={styles.introTitle}>
                Type your 12-word Ark seed phrase
            </Text>
            <Text style={styles.introBody}>
                Enter the words exactly as you wrote them down — order matters. Tap space or return to jump to the next box.
                {"\n\n"}
                Note: Ark VTXOs cannot be recovered from the seed alone. To restore your funds, also restore from your ark-backup file (the buttons below).
            </Text>

            <View style={styles.inputsContainer}>
                <View style={styles.inputColumn}>
                    {inputs.slice(0, 6).map((label, index) => (
                        <View key={label} style={styles.inputContainer}>
                            <Text h2 style={styles.labelText}>{label}.</Text>
                            <Input
                                ref={(el: any) => (inputRefs.current[index] = el)}
                                style={styles.inputStyle}
                                onChange={(value: string) => onWordChange(index, value)}
                                value={secretWords[index]}
                                textInputStyle={styles.textInputStyle}
                                autoCapitalize="none"
                                onKeyPress={(event: any) => onKeyPress(event, index)}
                                onSubmitEditing={() => {
                                    if (index < inputRefs.current.length - 1) {
                                        inputRefs.current[index + 1]?.focus();
                                    }
                                }}
                            />
                        </View>
                    ))}
                </View>
                <View style={styles.inputColumn}>
                    {inputs.slice(6).map((label, index) => (
                        <View key={label} style={styles.inputContainer}>
                            <Text h2 style={styles.labelText}>{label}.</Text>
                            <Input
                                ref={(el: any) => (inputRefs.current[index + 6] = el)}
                                style={styles.inputStyle}
                                onChange={(value: string) => onWordChange(index + 6, value)}
                                value={secretWords[index + 6]}
                                textInputStyle={styles.textInputStyle}
                                autoCapitalize="none"
                                onKeyPress={(event: any) => onKeyPress(event, index + 6)}
                                onSubmitEditing={() => {
                                    if (index + 6 < inputRefs.current.length - 1) {
                                        inputRefs.current[index + 7]?.focus();
                                    }
                                }}
                            />
                        </View>
                    ))}
                </View>
            </View>

            {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}

            <Button
                text="Restore from backup file"
                onPress={onRestoreFile}
                style={styles.button}
                textStyle={styles.btnText}
            />

            <TouchableOpacity
                onPress={onRestoreCloud}
                style={{
                    marginHorizontal: 24,
                    marginTop: 10,
                    paddingVertical: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.ark?.light ?? colors.pink.default,
                    alignItems: 'center',
                }}
            >
                <Text bold style={{ color: colors.ark?.light ?? colors.pink.default, fontSize: 14 }}>
                    Restore from {cloudLabel}
                </Text>
            </TouchableOpacity>

            <TouchableOpacity
                onPress={onPickDifferentFile}
                style={{ alignSelf: "center", marginTop: 10, paddingVertical: 8 }}
            >
                <Text
                    style={{
                        color: colors.gray.light,
                        fontSize: 12,
                        textDecorationLine: "underline",
                    }}
                >
                    Pick a different .cbark file instead
                </Text>
            </TouchableOpacity>

            {canGoBack && (
                <TouchableOpacity
                    onPress={onBack}
                    style={{ alignSelf: "center", marginTop: 8, paddingVertical: 8 }}
                >
                    <Text style={{ color: colors.gray.light, fontSize: 12 }}>{`← Back to ${BIOMETRIC_LABEL} unlock`}</Text>
                </TouchableOpacity>
            )}
        </>
    );
}

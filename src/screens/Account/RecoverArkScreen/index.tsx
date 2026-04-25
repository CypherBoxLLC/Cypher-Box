import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, TouchableOpacity, View } from "react-native";
import DocumentPicker, { types as DocTypes } from "react-native-document-picker";
import RNFS from "react-native-fs";
import * as Keychain from "react-native-keychain";

import { Button, Input, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import {
    createArkWallet,
    hasArkDatadir,
    restoreArkBackupBlob,
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

/**
 * RecoverArkScreen — manual 12-word recovery for an Ark wallet.
 *
 * Mirrors the hot-vault Recover screen (`RecoverSavingVault`) so the two
 * recovery flows feel identical. Differences:
 *
 *   1. No Keychain auto-recovery section. The Ark seed lives at a single
 *      Keychain slot (`service='ark-seed-phrase'`) — there's no per-wallet
 *      enumeration to surface, and the seed-only DEV recovery path on the
 *      Capsules tab covers that case from inside an authed session. This
 *      screen exists for the cold-start case: typing a written-down seed
 *      on a fresh install / new device.
 *
 *   2. Datadir conflict handling. Bark's `Wallet.create(..., overwrite=false)`
 *      refuses if a datadir already exists for a different seed. Rather
 *      than surface a cryptic `BarkError.Internal`, we proactively check
 *      `hasArkDatadir()` before submission and bounce the user into
 *      CreateArkScreen — which already owns the "open existing / reset"
 *      conflict UI.
 *
 *   3. Single submit step. We don't show pre-import progress because the
 *      slow part isn't a multi-format scan (hot vault) but a single
 *      `Wallet.create` UniFFI call that finishes in well under a second
 *      against the ASP. Just a spinner + one terminal message.
 */
export default function RecoverArkScreen() {
    const {
        allBTCWallets,
        setAllBTCWallets,
        setArkAuth,
        setArkWallet,
    } = useAuthStore();

    const [secretWords, setSecretWords] = useState<string[]>(
        Array(inputs.length).fill(""),
    );
    const [submitting, setSubmitting] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [datadirExists, setDatadirExists] = useState<boolean | null>(null);
    /**
     * Whether a seed exists in this device's Keychain at the
     * `ark-seed-phrase` service slot. Probed silently on mount via
     * `Keychain.hasGenericPassword` (no biometric prompt — that comes
     * later when we actually read the secret). Drives whether we show
     * the "Restore using Keychain seed" fast path or require typing.
     *
     * `null` = probe in flight. `true` / `false` after the first tick.
     */
    const [keychainHasSeed, setKeychainHasSeed] = useState<boolean | null>(null);
    const inputRefs = useRef<Array<any>>(new Array(inputs.length));

    // Pre-flight: detect a stale datadir AND surface the Keychain fast path
    // BEFORE the user starts typing words they may not need to type at all.
    // hasGenericPassword is the metadata-only probe — it does NOT trigger
    // FaceID/Touch ID. The biometric prompt only fires when we actually
    // read the secret in the restore handler.
    useEffect(() => {
        (async () => {
            try {
                setDatadirExists(await hasArkDatadir());
            } catch {
                setDatadirExists(false);
            }
            try {
                const has = await Keychain.hasGenericPassword({
                    service: "ark-seed-phrase",
                });
                setKeychainHasSeed(!!has);
            } catch {
                // hasGenericPassword can throw if the keychain is locked
                // entirely (rare); treat as "no fast path available".
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
                inputRefs.current[index + 1].focus();
            }
        }
    };

    /**
     * Backup-file restore — the only path that actually returns funds.
     *
     * Bark VTXOs cannot be re-derived from the seed alone (no ASP-side
     * pubkey lookup, presigned forfeit/exit txs are local-only). To recover
     * a wallet with funds intact, the user MUST present:
     *   1. The encrypted .cbark backup file produced by the Capsules tab's
     *      "Back up wallet state" action
     *   2. The original 12-word seed phrase that was active when the
     *      backup was made
     *
     * Flow:
     *   a. Read the typed seed from the input grid (same validation as
     *      seed-only path)
     *   b. Open the iOS document picker, get a file path
     *   c. Read the file as UTF-8 text (it's our JSON envelope)
     *   d. `restoreArkBackupBlob(blob, mnemonic)` — closes any open handle,
     *      wipes/recreates datadir, writes manifest files, opens wallet
     *   e. Persist seed to Keychain (so future on-chain sidecar reads work)
     *   f. Flip auth flags + navigate
     *
     * Failure modes we surface to the user:
     *   - Picker cancelled → silent (no error)
     *   - File can't be read → "Couldn't read backup file"
     *   - Wrong seed → decryptBackupBlob throws "Decryption failed"
     *   - Manifest path tries to escape datadir → throws "unsafe path"
     */
    /**
     * Resolve the mnemonic to use for restore — Keychain first, typed
     * grid second.
     *
     * Returns `{ mnemonic, source }` on success; throws / returns null
     * on caller-recoverable failure (we'll surface a setErrorMsg).
     *
     * Source semantics:
     *   - `'keychain'` → seed came from the device's Keychain (biometric
     *     prompt fired). User did NOT have to type. Fast path.
     *   - `'typed'` → user typed all 12 words; we validated via
     *     `validateMnemonic`.
     *
     * Why this priority: if the user has a wallet on this device they're
     * trying to restore, the seed is by construction in Keychain (we
     * persist it on every successful create / recover / restore). Asking
     * them to type 12 words AGAIN is gratuitous friction. Only fall back
     * to typing when Keychain has nothing — i.e. a fresh install / new
     * device.
     */
    const resolveMnemonicForRestore = async (): Promise<
        { mnemonic: string; source: 'keychain' | 'typed' } | null
    > => {
        if (keychainHasSeed) {
            try {
                const creds = await Keychain.getGenericPassword({
                    service: "ark-seed-phrase",
                });
                if (creds && creds.password) {
                    return { mnemonic: creds.password, source: 'keychain' };
                }
                // Probe said true but read came back empty — maybe the
                // entry was wiped between probe and read. Fall through to
                // typed-grid path so the user isn't stuck.
            } catch (err: any) {
                // Most common cause: user dismissed the FaceID prompt. Fall
                // through to the typed grid as a manual escape hatch
                // rather than failing outright.
                console.warn('[Ark restore] Keychain read declined:', err?.message ?? err);
            }
        }

        // Typed-grid fallback. Same validation we always had.
        const mnemonic = secretWords
            .map((w) => w.trim().toLowerCase())
            .filter(Boolean)
            .join(" ");
        if (mnemonic.split(/\s+/).length !== 12) {
            setErrorMsg(
                keychainHasSeed
                    ? "Keychain didn't return your seed. Type all 12 words to continue."
                    : "Type all 12 seed words first, then choose your backup file.",
            );
            return null;
        }
        let valid = false;
        try {
            valid = validateMnemonic(mnemonic);
        } catch (err) {
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

    const handleRestoreFromFile = async () => {
        if (submitting || restoring) return;

        const resolved = await resolveMnemonicForRestore();
        if (!resolved) return;
        const { mnemonic, source: mnemonicSource } = resolved;

        // Datadir conflict — for the restore path we don't bounce to
        // CreateArkScreen the way the seed-only path does, because
        // `restoreArkBackupBlob` ALREADY wipes and rewrites the datadir
        // internally as part of its own logic. The honest UX is "tell the
        // user it'll replace their current wallet, and let them decide".
        // Anything in flight on the live wallet that isn't in the backup
        // file gets nuked — same trade-off any restore-from-backup
        // operation has anywhere.
        if (datadirExists) {
            const proceed = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    "Replace existing Ark wallet?",
                    "There's already wallet data on this device. Restoring will wipe the current wallet and replace it with the contents of the backup file. Anything in flight (mid-round, unsettled HTLC) that isn't in the backup will be lost.",
                    [
                        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                        {
                            text: "Replace",
                            style: "destructive",
                            onPress: () => resolve(true),
                        },
                    ],
                    { cancelable: true, onDismiss: () => resolve(false) },
                );
            });
            if (!proceed) return;
        }

        // Pick file. `react-native-document-picker` returns an array (we
        // only allow `single` selection though). On user cancel it throws
        // a typed error we silence rather than treat as a failure.
        let pickedUri: string | null = null;
        let pickedName = "ark-backup.cbark";
        try {
            const result = await DocumentPicker.pickSingle({
                // We allow any type because iCloud Drive sometimes assigns
                // `public.data` instead of our custom UTI; the JSON parse
                // step will catch wrong files cleanly anyway.
                type: [DocTypes.allFiles],
                copyTo: "cachesDirectory",
            });
            // `fileCopyUri` is the path we should actually read from when
            // copyTo is set — `uri` may be a file:// or content:// scheme
            // that RNFS doesn't always handle on Android.
            pickedUri = result.fileCopyUri ?? result.uri;
            pickedName = result.name ?? pickedName;
        } catch (err: any) {
            if (DocumentPicker.isCancel(err)) {
                return;
            }
            console.warn('[Ark restore] picker threw:', err);
            setErrorMsg(`Couldn't open file picker: ${err?.message ?? "unknown error"}`);
            return;
        }

        if (!pickedUri) {
            setErrorMsg("Couldn't read picked file (no path returned)");
            return;
        }

        setRestoring(true);
        setErrorMsg(null);
        try {
            // Strip the file:// prefix if present — RNFS.readFile expects
            // a plain path on iOS.
            const cleanPath = pickedUri.replace(/^file:\/\//, "");
            const blob = await RNFS.readFile(cleanPath, "utf8");
            await restoreArkBackupBlob(blob, mnemonic);
        } catch (err: any) {
            console.warn('[Ark restore] failed:', err);
            setErrorMsg(
                `Restore failed: ${err?.message ?? "unknown error"}. ` +
                `Make sure your seed matches the backup, and that this is the right .cbark file.`,
            );
            setRestoring(false);
            return;
        }

        // Persist seed to Keychain so the next session's on-chain sidecar
        // (`ensureArkOnchainHandle`) and any maintenance task can find it.
        try {
            await Keychain.setGenericPassword("ark", mnemonic, {
                service: "ark-seed-phrase",
                accessControl:
                    Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
                accessible:
                    Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
            });
        } catch (err: any) {
            // Wallet is already restored & open — this is a "next session
            // will be degraded" warning, not a fatal error. Surface it but
            // don't roll back the restore.
            console.warn('[Ark restore] Keychain save failed (wallet still restored):', err);
        }

        const wallet = {
            id: `ark-${Date.now()}`,
            createdAt: new Date().toISOString(),
            useHotVaultSeed: false,
            keychainSaved: true,
            restored: true,
            // We could thread the source backup destination through; for
            // now leave null so the post-restore experience re-prompts.
            backupDestination: null,
        };
        setArkWallet(wallet);
        setArkAuth(true);
        if (!allBTCWallets.includes("ARK")) {
            setAllBTCWallets([...allBTCWallets, "ARK"]);
        }

        setRestoring(false);
        dispatchReset("HomeScreen", { isComplete: true });
    };

    const handleRecover = async () => {
        if (submitting) return;

        // Normalize: SDK expects a single space-separated string.
        // Lowercase + trim each word so a stray capital from autocorrect
        // doesn't fail BIP39 word-list lookup.
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
            setErrorMsg(
                "Couldn't validate seed phrase. Check the words and try again.",
            );
            return;
        }
        if (!valid) {
            setErrorMsg(
                "Invalid seed phrase. Double-check spelling — each word must be a BIP39 word.",
            );
            return;
        }

        // Datadir conflict — bounce to CreateArkScreen which already owns the
        // "Open existing / Reset" UI. We could attempt Wallet.open here but
        // duplicating that conflict resolution is asking for drift.
        if (datadirExists) {
            Alert.alert(
                "An Ark wallet already exists",
                "There's already wallet data on this device. Open the existing setup screen to either reopen it (if the seed matches) or reset before recovering with a new seed.",
                [
                    { text: "Cancel", style: "cancel" },
                    {
                        text: "Open setup",
                        onPress: () => dispatchNavigate("CreateArkScreen"),
                    },
                ],
            );
            return;
        }

        setSubmitting(true);
        setErrorMsg(null);

        // Persist seed BEFORE wallet create — `ensureArkOnchainHandle` and
        // any future re-init (`recoverArkWalletFromKeychain`) read from this
        // slot. If we created the wallet first and Keychain.setGenericPassword
        // failed (biometric cancel, locked device), the wallet would be live
        // but its sidecar APIs would be broken on next session.
        try {
            await Keychain.setGenericPassword(KEYCHAIN_ACCOUNT, mnemonic, {
                service: KEYCHAIN_SERVICE,
                accessControl:
                    Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
                accessible:
                    Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
            });
        } catch (err: any) {
            console.warn("[Ark recover] Keychain save failed:", err);
            setSubmitting(false);
            setErrorMsg(
                `Couldn't save the seed to Keychain: ${
                    err?.message ?? "unknown error"
                }. Recovery aborted to keep state consistent.`,
            );
            return;
        }

        try {
            // forceRescan=true → ask the ASP to enumerate VTXOs for this
            // seed's pubkey and populate the local store. Without this the
            // user types their seed and lands on an empty wallet even if
            // the ASP has spendable funds for them.
            await createArkWallet(mnemonic, true);
        } catch (err: any) {
            console.warn("[Ark recover] createArkWallet failed:", err);
            // Common cause: a datadir from a previous wallet sneaked back
            // between our pre-flight check and submission (Metro reload, race).
            // Tell the user to reset rather than spinning forever.
            const msg = (err as Error)?.message ?? "unknown error";
            setSubmitting(false);
            setErrorMsg(
                /Internal/i.test(msg)
                    ? "Couldn't open or create the Ark wallet — local state may be stale. Open the setup screen and tap Reset, then try again."
                    : `Recovery failed: ${msg}`,
            );
            return;
        }

        const wallet = {
            id: `ark-${Date.now()}`,
            createdAt: new Date().toISOString(),
            useHotVaultSeed: false,
            keychainSaved: true,
            restored: true,
            // Recovery doesn't know which backup destination the previous
            // install used — leave it null so the post-create backup task
            // re-prompts. Better than committing to the wrong target.
            backupDestination: null,
        };
        setArkWallet(wallet);
        setArkAuth(true);
        if (!allBTCWallets.includes("ARK")) {
            setAllBTCWallets([...allBTCWallets, "ARK"]);
        }

        setSubmitting(false);
        dispatchReset("HomeScreen", { isComplete: true });
    };

    if (submitting || restoring) {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.ark.light} />
                    <Text style={styles.loadingText}>
                        {restoring
                            ? "Restoring from backup file…"
                            : "Recovering Ark wallet…"}
                    </Text>
                </View>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout
            title="Recover Ark Wallet"
            showToolbar
            isBackButton
            disableScroll
        >
            <View style={styles.container}>
                {keychainHasSeed ? (
                    <>
                        <Text bold style={styles.introTitle}>
                            Restore your Ark wallet
                        </Text>
                        <Text style={styles.introBody}>
                            Your Ark seed phrase is in this device's Keychain —
                            you don't need to type it. Tap "Restore from backup
                            file" below; iPhone will ask for FaceID / passcode
                            and use the stored seed.{"\n\n"}
                            Ark VTXOs aren't seed-derivable, so you'll also
                            need the encrypted .cbark backup file you exported
                            from "Back up wallet state". The 12-word grid
                            below is only a fallback if Keychain access is
                            declined.
                        </Text>
                    </>
                ) : (
                    <>
                        <Text bold style={styles.introTitle}>
                            Type your 12-word Ark seed phrase
                        </Text>
                        <Text style={styles.introBody}>
                            Enter the words exactly as you wrote them down —
                            order matters. Tap space or return to jump to the
                            next box.{"\n\n"}
                            Note: Ark VTXOs cannot be recovered from the seed
                            alone. To restore your funds, you also need the
                            encrypted .cbark backup file you exported from
                            "Back up wallet state". Pick it after typing your
                            seed using the button below.
                        </Text>
                    </>
                )}

                <View style={styles.inputsContainer}>
                    {/* First column — words 1-6 */}
                    <View style={styles.inputColumn}>
                        {inputs.slice(0, 6).map((input, index) => (
                            <View key={input} style={styles.inputContainer}>
                                <Text h2 style={styles.labelText}>
                                    {input}.
                                </Text>
                                <Input
                                    ref={(el) => (inputRefs.current[index] = el)}
                                    style={styles.inputStyle}
                                    onChange={(value: string) =>
                                        handleSecretWordChange(index, value)
                                    }
                                    value={secretWords[index]}
                                    textInputStyle={styles.textInputStyle}
                                    autoCapitalize="none"
                                    onKeyPress={(event: any) =>
                                        handleKeyPress(event, index)
                                    }
                                    onSubmitEditing={() => {
                                        if (
                                            index <
                                            inputRefs.current.length - 1
                                        ) {
                                            inputRefs.current[index + 1].focus();
                                        }
                                    }}
                                />
                            </View>
                        ))}
                    </View>

                    {/* Second column — words 7-12 */}
                    <View style={styles.inputColumn}>
                        {inputs.slice(6).map((input, index) => (
                            <View key={input} style={styles.inputContainer}>
                                <Text h2 style={styles.labelText}>
                                    {input}.
                                </Text>
                                <Input
                                    ref={(el) =>
                                        (inputRefs.current[index + 6] = el)
                                    }
                                    style={styles.inputStyle}
                                    onChange={(value: string) =>
                                        handleSecretWordChange(
                                            index + 6,
                                            value,
                                        )
                                    }
                                    value={secretWords[index + 6]}
                                    textInputStyle={styles.textInputStyle}
                                    autoCapitalize="none"
                                    onKeyPress={(event: any) =>
                                        handleKeyPress(event, index + 6)
                                    }
                                    onSubmitEditing={() => {
                                        if (
                                            index + 6 <
                                            inputRefs.current.length - 1
                                        ) {
                                            inputRefs.current[
                                                index + 7
                                            ].focus();
                                        }
                                    }}
                                />
                            </View>
                        ))}
                    </View>
                </View>

                {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}

                {/* Primary path: restore from encrypted backup file. This
                    is the only path that actually returns funds (Bark
                    protocol limitation: VTXOs aren't seed-derivable).
                    The plain "Recover" button below is kept as a fallback
                    for users who only have the seed and accept they'll
                    land on an empty wallet. */}
                <Button
                    text="Restore from backup file"
                    onPress={handleRestoreFromFile}
                    style={styles.button}
                    textStyle={styles.btnText}
                />

                <TouchableOpacity
                    onPress={handleRecover}
                    style={{ alignSelf: "center", marginTop: 16, paddingVertical: 8 }}
                >
                    <Text
                        style={{
                            color: colors.gray.light,
                            fontSize: 12,
                            textDecorationLine: "underline",
                        }}
                    >
                        Recover seed only (no backup file — empty wallet)
                    </Text>
                </TouchableOpacity>
            </View>
        </ScreenLayout>
    );
}

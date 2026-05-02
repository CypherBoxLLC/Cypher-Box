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
    /**
     * When the Keychain fast path is available we hide the 12-word grid
     * by default — earlier UX showed grid + "you don't need to type it"
     * copy together, which Bam reasonably read as a contradiction and
     * typed all 12 words anyway. Now the grid is collapsed behind a
     * small "type manually instead" link, only visible when the user
     * explicitly opts in or when biometric reads aren't available.
     */
    const [showTypedGrid, setShowTypedGrid] = useState(false);
    /**
     * Mnemonic resolved from the Keychain via the explicit "Unlock with
     * Face ID" tap. Held only in component state — never persisted, never
     * logged. Cleared on screen unmount automatically. Once present, the
     * Restore button uses this value and skips the biometric prompt
     * (Bam: "I don't want the wallet to automatically pull FaceID to
     * recover — better if there's a button I tap first").
     */
    const [unlockedMnemonic, setUnlockedMnemonic] = useState<string | null>(null);
    const [unlocking, setUnlocking] = useState(false);
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
     *   1. The ark-backup file (the encrypted .cbark snapshot written by
     *      `writeArkAutoBackup` on every sync tick — local in Documents
     *      and, if connected, mirrored to iCloud Drive / Google Drive)
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
        // Fast path: user already tapped "Unlock with Face ID" earlier
        // and the mnemonic is sitting in component state. Reuse it so
        // the Restore button doesn't re-prompt for biometrics — that
        // double prompt was the friction Bam was complaining about.
        if (unlockedMnemonic) {
            return { mnemonic: unlockedMnemonic, source: 'keychain' };
        }

        // Typed-grid fallback. Same validation we always had.
        const mnemonic = secretWords
            .map((w) => w.trim().toLowerCase())
            .filter(Boolean)
            .join(" ");
        if (mnemonic.split(/\s+/).length !== 12) {
            setErrorMsg(
                keychainHasSeed
                    ? "Tap \"Unlock with Face ID\" first, or type all 12 words manually."
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

    /**
     * Explicit "Unlock with Face ID" tap. Reads the seed from the
     * Keychain, holds it in component state, and surfaces a clear
     * confirmation pill once unlocked. The Restore button below uses
     * `unlockedMnemonic` thereafter and never re-prompts biometrics.
     *
     * If the user dismisses the FaceID prompt or the Keychain entry is
     * missing, surface a clear error and leave them in the locked
     * state — they can retry, or fall back to the typed grid.
     */
    const handleUnlockWithFaceId = async () => {
        if (unlocking || unlockedMnemonic) return;
        setUnlocking(true);
        setErrorMsg(null);
        try {
            const creds = await Keychain.getGenericPassword({
                service: "ark-seed-phrase",
            });
            if (creds && creds.password) {
                setUnlockedMnemonic(creds.password);
            } else {
                setErrorMsg(
                    "Keychain returned no seed. Try \"type seed manually instead\" below.",
                );
            }
        } catch (err: any) {
            // Most common cause: user dismissed FaceID. Don't shout.
            console.warn('[Ark restore] Keychain read declined:', err?.message ?? err);
            setErrorMsg(
                "Face ID was declined. Tap unlock again, or type your 12 words manually.",
            );
        } finally {
            setUnlocking(false);
        }
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
                `Make sure your seed matches the backup, and that this is the right ark-backup file.`,
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

    /**
     * Android-only: pull the encrypted .cbark from the user's Google
     * Drive appDataFolder, then run it through the same restore pipe
     * the file-picker path uses. Two extra steps vs. file-picker:
     *   1. Resolve the mnemonic (Keychain fast-path or typed grid)
     *   2. Sign in to Google if not already
     *   3. Download blob from Drive (or surface "no backup found")
     *   4. Restore blob → Wallet.open against the rebuilt datadir
     *
     * Skipped on iOS — we don't ship Drive auth there because iCloud
     * Drive sync of Documents is the off-device path, and the user
     * recovers via the file-picker pointing at iCloud Drive.
     */
    const handleRestoreFromGoogleDrive = async () => {
        if (submitting || restoring) return;
        const resolved = await resolveMnemonicForRestore();
        if (!resolved) return;
        const { mnemonic } = resolved;

        if (datadirExists) {
            const proceed = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    "Replace existing Ark wallet?",
                    "Restoring from Google Drive will wipe the current wallet and replace it with the encrypted backup pulled from Drive. Anything in flight (mid-round, unsettled HTLC) that isn't in the backup will be lost.",
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

        setRestoring(true);
        setErrorMsg(null);
        try {
            // Sign in lazily — many users will hit this screen before
            // they've ever connected Drive in this session.
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
                    "Make sure you signed in with the same account you used when " +
                    "you first connected Drive.",
                );
                return;
            }
            await restoreArkBackupBlob(blob, mnemonic);
        } catch (err: any) {
            console.warn('[Ark restore] Drive flow failed:', err);
            setErrorMsg(
                `Restore from Drive failed: ${err?.message ?? "unknown error"}. ` +
                `Make sure your seed matches the backup.`,
            );
            setRestoring(false);
            return;
        }

        // Persist seed to Keychain so the next session's on-chain sidecar
        // can find it without re-prompting the user. Same as the file-
        // picker flow. Failure here is non-fatal — wallet's already open.
        try {
            await Keychain.setGenericPassword(KEYCHAIN_ACCOUNT, mnemonic, {
                service: KEYCHAIN_SERVICE,
                accessControl:
                    Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
                accessible:
                    Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
            });
        } catch (err: any) {
            console.warn('[Ark restore] Keychain save failed (Drive restore):', err);
        }

        const wallet = {
            id: `ark-${Date.now()}`,
            createdAt: new Date().toISOString(),
            useHotVaultSeed: false,
            keychainSaved: true,
            restored: true,
            restoredFrom: 'google-drive',
            backupDestination: null,
        };
        if (!allBTCWallets.includes("ARK")) {
            setAllBTCWallets([...allBTCWallets, "ARK"]);
        }
        setArkWallet(wallet);
        setArkAuth(true);
        setRestoring(false);
        dispatchReset("HomeScreen", { isComplete: true });
    };

    /**
     * iOS-only: restore from the iCloud-synced .cbark backup.
     *
     * On iOS, `writeArkAutoBackup` writes the encrypted blob to
     * `Documents/cypher-box-ark-backup.cbark`. When the user has iCloud
     * Drive enabled for Cypher Box (Settings → Apple ID → iCloud → Cypher
     * Box), Apple transparently mirrors that file to iCloud Drive — visible
     * to the user under "Cypher Box" in the Files app, and synced back
     * to *this* device whenever it shows up. We see only ciphertext.
     *
     * Two paths to recover from iCloud, in priority order:
     *   1. Direct read of `AUTO_BACKUP_PATH` if present locally. This is
     *      the happy path on a same-device reinstall: iCloud has restored
     *      the file before the user reaches this screen, so we don't need
     *      a picker at all.
     *   2. UIDocumentPicker fallback. If the local copy isn't there yet
     *      (fresh device, slow iCloud sync, user manually deleted it),
     *      open the iOS document picker. iCloud Drive shows up as a
     *      prominent location in the picker chrome — the user navigates
     *      to "Cypher Box" and taps the .cbark file. We read it through
     *      the same RNFS path we use for the generic file picker.
     *
     * Skipped on Android — the Documents folder isn't surfaced by Google
     * Drive automatically; that's why we have the explicit Drive path
     * (`handleRestoreFromGoogleDrive`) instead.
     */
    const handleRestoreFromICloud = async () => {
        if (submitting || restoring) return;
        const resolved = await resolveMnemonicForRestore();
        if (!resolved) return;
        const { mnemonic } = resolved;

        if (datadirExists) {
            const proceed = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    "Replace existing Ark wallet?",
                    "Restoring from iCloud Drive will wipe the current wallet and replace it with the encrypted backup file. Anything in flight (mid-round, unsettled HTLC) that isn't in the backup will be lost.",
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

        setRestoring(true);
        setErrorMsg(null);

        let blob: string | null = null;

        // Path 1: try the local Documents copy. If iCloud Drive has already
        // synced the file back to this device (typical same-device
        // reinstall), this avoids the picker entirely.
        try {
            const exists = await RNFS.exists(AUTO_BACKUP_PATH);
            if (exists) {
                blob = await RNFS.readFile(AUTO_BACKUP_PATH, 'utf8');
            }
        } catch (err) {
            console.warn('[Ark restore] local AUTO_BACKUP_PATH read failed:', err);
            // Fall through to picker.
        }

        // Path 2: file picker, with copy that nudges toward iCloud Drive.
        if (!blob) {
            try {
                const result = await DocumentPicker.pickSingle({
                    // `allFiles` because iCloud Drive sometimes assigns
                    // `public.data` instead of our custom UTI; the JSON
                    // parse step in restoreArkBackupBlob catches wrong
                    // files cleanly anyway.
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

        // Persist seed to Keychain — same rationale as the other restore
        // paths. Failure here is non-fatal; the wallet is already open.
        try {
            await Keychain.setGenericPassword(KEYCHAIN_ACCOUNT, mnemonic, {
                service: KEYCHAIN_SERVICE,
                accessControl:
                    Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
                accessible:
                    Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
            });
        } catch (err: any) {
            console.warn('[Ark restore] Keychain save failed (iCloud restore):', err);
        }

        const wallet = {
            id: `ark-${Date.now()}`,
            createdAt: new Date().toISOString(),
            useHotVaultSeed: false,
            keychainSaved: true,
            restored: true,
            restoredFrom: 'icloud-drive',
            backupDestination: null,
        };
        if (!allBTCWallets.includes('ARK')) {
            setAllBTCWallets([...allBTCWallets, 'ARK']);
        }
        setArkWallet(wallet);
        setArkAuth(true);
        setRestoring(false);
        dispatchReset('HomeScreen', { isComplete: true });
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
                            you don't need to type it. Tap unlock below to load
                            the seed via FaceID / passcode.{"\n\n"}
                            Ark VTXOs aren't seed-derivable, so you'll also
                            need your ark-backup file —
                            from {Platform.OS === 'ios' ? 'iCloud Drive' : 'Google Drive'}
                            {' '}(if you connected it earlier) or a manual
                            export.
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
                            alone. To restore your funds, you also need your
                            ark-backup file — pull it from
                            {' '}{Platform.OS === 'ios' ? 'iCloud Drive' : 'Google Drive'}
                            {' '}(if you connected it earlier) or pick a manual
                            export using the buttons below.
                        </Text>
                    </>
                )}

                {/*
                  Grid visibility:
                    - keychainHasSeed === true → hide by default. User can
                      reveal via the "type seed manually instead" link
                      below for the rare case the FaceID prompt is
                      declined or the Keychain entry is corrupted.
                    - keychainHasSeed !== true → show always. Either no
                      Keychain entry exists (cold install on a new device)
                      or the probe is still in flight.
                */}
                {(!keychainHasSeed || showTypedGrid) && (
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
                )}

                {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}

                {/*
                  Unlock-then-Restore two-step flow when Keychain has the
                  seed:
                    - Step 1: explicit "Unlock with Face ID" button. Tap
                      → biometrics prompt → seed lands in `unlockedMnemonic`.
                    - Step 2: "Restore from backup file" becomes the
                      primary CTA, marked with a "✓ Seed loaded" pill so
                      the user knows they're past the auth step. No
                      second biometric prompt — the Restore handler
                      reuses `unlockedMnemonic`.
                  When Keychain is empty (cold install) or the user
                  opted into typing manually, only the Restore button
                  shows.
                */}
                {keychainHasSeed && !unlockedMnemonic && !showTypedGrid && (
                    <Button
                        text={
                            unlocking
                                ? "Unlocking…"
                                : "Seedphrase detected in Keychain — unlock with Face ID"
                        }
                        onPress={handleUnlockWithFaceId}
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

                {/* Primary path: restore from encrypted backup file. This
                    is the only path that actually returns funds (Bark
                    protocol limitation: VTXOs aren't seed-derivable).
                    The plain "Recover" button below is kept as a fallback
                    for users who only have the seed and accept they'll
                    land on an empty wallet.
                    Hidden in the locked state so the user has only one
                    primary CTA at a time (Unlock first, Restore after). */}
                {(unlockedMnemonic || !keychainHasSeed || showTypedGrid) && (
                    <Button
                        text="Restore from backup file"
                        onPress={handleRestoreFromFile}
                        style={styles.button}
                        textStyle={styles.btnText}
                    />
                )}

                {/* Platform-specific cloud restore. We expose the right cloud
                    label for the host OS so users don't have to guess where
                    their backup actually lives:
                      - Android → Google Drive (we drove the OAuth + REST
                        upload to appDataFolder ourselves; not reachable
                        through Files app)
                      - iOS → iCloud Drive (Apple's transparent Documents
                        sync; the file is either already on this device
                        or one tap away in the document picker)
                    Both call into restoreArkBackupBlob underneath, so the
                    decryption + Wallet.open path is identical. */}
                {Platform.OS === 'android' && (unlockedMnemonic || !keychainHasSeed || showTypedGrid) && (
                    <TouchableOpacity
                        onPress={handleRestoreFromGoogleDrive}
                        disabled={restoring}
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
                            Restore from Google Drive
                        </Text>
                    </TouchableOpacity>
                )}

                {Platform.OS === 'ios' && (unlockedMnemonic || !keychainHasSeed || showTypedGrid) && (
                    <TouchableOpacity
                        onPress={handleRestoreFromICloud}
                        disabled={restoring}
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
                            Restore from iCloud Drive
                        </Text>
                    </TouchableOpacity>
                )}

                {/* Manual-grid escape hatch — only shown when the Keychain
                    fast path is available (otherwise the grid is already
                    visible above). Lets the user fall back to typing if
                    they declined biometrics or the Keychain entry is
                    suspect, without forcing the long form by default. */}
                {keychainHasSeed && !showTypedGrid && (
                    <TouchableOpacity
                        onPress={() => setShowTypedGrid(true)}
                        style={{ alignSelf: "center", marginTop: 14, paddingVertical: 8 }}
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

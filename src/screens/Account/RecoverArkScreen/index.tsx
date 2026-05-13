import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, TouchableOpacity, View } from "react-native";
import DocumentPicker, { types as DocTypes } from "react-native-document-picker";
import RNFS from "react-native-fs";
import * as Keychain from "react-native-keychain";

import { Button, Input, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import {
    checkArkSeedKeychainConflict,
    classifyPickedBackupBlob,
    connectGoogleDrive,
    createArkWallet,
    deriveBackupFingerprint,
    getArkWalletHandle,
    hasArkDatadir,
    isGoogleDriveConnected,
    lookupArkBackupInLocalDocuments,
    lookupArkBackupInSafFolder,
    lookupArkBackupOnDrive,
    restoreArkBackupBlob,
    setArkBackgroundRefreshEnabled,
} from "@Cypher/services/ark";
import type { ChannelLookupResult } from "@Cypher/services/ark";
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
        isArkAuth,
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
        // Datadir-on-disk alone doesn't mean a live wallet exists.
        // Orphan datadirs are common after a failed/stuck delete (boot
        // restore hits `open-failed`, leaves the directory behind) and
        // there's nothing for the user to "replace" — they're trying
        // to recover precisely because no live wallet is present.
        // Mirror CreateArkScreen's mount-time heuristic: only prompt
        // if a live handle OR `isArkAuth` is set; otherwise let the
        // restore wipe the orphan silently (the restore is already
        // gated by seed entry + biometric).
        const liveWallet = !!getArkWalletHandle() || isArkAuth;
        if (!liveWallet) return true;
        return new Promise<boolean>((resolve) => {
            Alert.alert(
                "Replace existing Ark wallet?",
                `Restoring ${sourceLabel} replaces the current Ark wallet with the backup file. Any incoming Lightning payments still being settled won't carry over.`,
                [
                    { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                    { text: "Replace", style: "destructive", onPress: () => resolve(true) },
                ],
                { cancelable: true, onDismiss: () => resolve(false) },
            );
        });
    };

    const persistSeedToKeychain = async (mnemonic: string, label: string) => {
        // Conflict guard — same rationale as ArkSeedPhraseScreen. The
        // recovery path can hit this when the user previously had a
        // different wallet active with "keep on device" set: the old
        // wallet's seed is still in keychain, and the just-recovered
        // wallet has a different fingerprint. Silent overwrite would
        // strand the previous wallet's biometric fast-recover path.
        //
        // Different from create flow: here the wallet is ALREADY
        // restored and open — declining the overwrite just means we
        // skip the keychain save. The user can still operate the
        // recovered wallet this session and recover again next time
        // by typing the seed.
        const conflict = await checkArkSeedKeychainConflict(mnemonic);
        if (conflict.kind === 'different-wallet' || conflict.kind === 'unreadable') {
            const proceed = await new Promise<boolean>(resolve => {
                const keychainLabel = Platform.OS === 'ios' ? 'Keychain' : 'Keystore';
                const message =
                    conflict.kind === 'different-wallet'
                        ? `A saved seed already exists on this device's ${keychainLabel} behind ${BIOMETRIC_LABEL} for wallet ${conflict.existingFingerprint}.\n\nIf you want the new seed to take its place, make sure the old seed is written down somewhere safe.`
                        : `A saved seed already exists on this device's ${keychainLabel} but couldn't be read to compare (${conflict.reason}).\n\nIf you want the new seed to take its place, make sure the old seed is written down somewhere safe — it may otherwise be lost.`;
                Alert.alert(
                    "Replace keychain-saved seed?",
                    message,
                    [
                        { text: `Keep old seed in ${keychainLabel}`, style: "cancel", onPress: () => resolve(false) },
                        { text: `Save new seed in ${keychainLabel}`, onPress: () => resolve(true) },
                    ],
                    { cancelable: true, onDismiss: () => resolve(false) },
                );
            });
            if (!proceed) {
                // Skip the keychain write. Wallet stays open this session;
                // user types seed next time. Not an error.
                return;
            }
        }

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

    const finalizeWallet = async (mnemonic: string, restoredFrom?: string) => {
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
        // Arm background-refresh the same way the create flow does
        // (ArkSeedPhraseScreen). clearArkAuth resets arkBgRefreshEnabled
        // to false on disconnect, so a fresh recovery would otherwise
        // come back with auto-refresh OFF — which silently leaves the
        // user's restored arkoor VTXOs under server-trust until they
        // notice the toggle. Mirroring create here keeps the post-
        // recovery experience identical to a fresh wallet.
        try {
            await setArkBackgroundRefreshEnabled(true, mnemonic);
        } catch (err) {
            console.warn("[Ark recover] failed to arm bg refresh:", err);
        }
        dispatchReset("HomeScreen", { isComplete: true });
    };

    /**
     * Run a `ChannelLookupResult` through restore + finalize. v2 matches
     * decrypt definitively; v1 candidates may have come from a different
     * wallet so a decrypt failure here gets the "no backup matches this
     * seed" treatment rather than the generic "restore failed."
     *
     * Returns true if the wallet was restored + finalized, false if the
     * caller should keep searching other channels / surface a no-match
     * error.
     */
    const tryRestoreFromLookup = async (
        result: ChannelLookupResult,
        mnemonic: string,
        finalizeChannel: string | undefined,
        keychainLabel: string,
    ): Promise<boolean> => {
        if (result.kind === 'not-found') return false;
        try {
            await restoreArkBackupBlob(result.blob, mnemonic);
        } catch (err: any) {
            // v2 match should never fail decrypt — fingerprints matched
            // and the AES key is the same seed. If it does, the file is
            // genuinely corrupt; surface a precise error.
            if (result.kind === 'matched') {
                console.warn('[Ark restore] decrypt of fingerprint-matched blob failed:', err);
                setRestoring(false);
                setErrorMsg(
                    `Backup file is corrupt: ${err?.message ?? 'decryption failed'}. ` +
                    `Try a different backup source — Drive, iCloud, or pick a manually-exported file.`,
                );
                return true; // handled (with error); don't keep scanning
            }
            // v1 candidate: this file was the last-resort try; failure
            // means it didn't belong to this seed. Pretend not-found so
            // caller surfaces the unified "no backup matches" error.
            if (__DEV__) console.log('[Ark restore] legacy v1 try-decrypt failed:', err?.message ?? err);
            return false;
        }
        await persistSeedToKeychain(mnemonic, keychainLabel);
        setRestoring(false);
        await finalizeWallet(mnemonic, finalizeChannel);
        return true;
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

        // Derive the BIP32 fingerprint from the entered seed once, up
        // front. Every channel scan hashes against this — without it
        // we'd be try-decrypting blindly and producing the misleading
        // "decryption failed" UX the v2 envelope was designed to fix.
        let fingerprint: string;
        try {
            fingerprint = await deriveBackupFingerprint(mnemonic);
        } catch (err: any) {
            console.warn('[Ark restore] fingerprint derive failed:', err);
            setRestoring(false);
            setErrorMsg(`Couldn't process the seed phrase: ${err?.message ?? 'unknown error'}.`);
            return;
        }

        // Auto-discovery, in order of preference:
        //   1. Local Documents — Documents/ark-backup-{fp}.cbark and
        //      every other .cbark scanned for header match. Includes
        //      legacy-v1 fallback (pre-multi-wallet single-name file).
        //   2. SAF folder (Android) — same shape via the native bridge.
        //      Survives `install -r` even when Documents is wiped.
        //   3. DocumentPicker — explicit user pick. Header-checked the
        //      same way; mismatch surfaces as "this isn't a backup for
        //      this seed phrase."
        //
        // Each step skipped when forcePicker is true — bypasses
        // auto-discovery so the user can pick an older manually-
        // exported .cbark even when the rolling auto-backup is fresh.
        if (!forcePicker) {
            const local = await lookupArkBackupInLocalDocuments(fingerprint);
            if (await tryRestoreFromLookup(local, mnemonic, undefined, 'file restore')) return;
        }

        if (!forcePicker) {
            try {
                const saf = await lookupArkBackupInSafFolder(fingerprint);
                if (await tryRestoreFromLookup(saf, mnemonic, undefined, 'file restore')) return;
            } catch (err) {
                if (__DEV__) console.log('[Ark restore] SAF lookup threw:', err);
                // Fall through to picker — SAF permission may be revoked.
            }
        }

        // DocumentPicker: user navigates to wherever they kept the
        // .cbark (Drive folder, manual export they emailed themselves,
        // etc.). The only path that works after a fresh reinstall on a
        // different device. Header-checked: fingerprint match → decrypt;
        // v1 with no header → try-decrypt; mismatch → clean error.
        let pickedBlob: string;
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
            pickedBlob = await RNFS.readFile(cleanPath, "utf8");
        } catch (err: any) {
            if (DocumentPicker.isCancel(err)) {
                setRestoring(false);
                // No no-match error — user explicitly cancelled.
                return;
            }
            console.warn('[Ark restore] picker threw:', err);
            setRestoring(false);
            setErrorMsg(`Couldn't open file picker: ${err?.message ?? "unknown error"}`);
            return;
        }

        const picked = classifyPickedBackupBlob(pickedBlob, fingerprint);
        if (picked.kind === 'not-found') {
            setRestoring(false);
            setErrorMsg(
                "This file isn't a backup for the seed phrase you entered. " +
                "Pick a different file, or check your seed.",
            );
            return;
        }
        if (await tryRestoreFromLookup(picked, mnemonic, undefined, 'file restore')) return;

        setRestoring(false);
        setErrorMsg(
            "No backup matches this seed phrase. " +
            "Check the seed, or proceed without a backup if you don't have one.",
        );
    };

    const handleRestoreFromGoogleDrive = async () => {
        if (submitting || restoring) return;
        const resolved = await resolveMnemonicForRestore();
        if (!resolved) return;
        const { mnemonic } = resolved;

        if (!(await confirmReplaceDatadir("from Google Drive"))) return;

        setRestoring(true);
        setErrorMsg(null);

        let fingerprint: string;
        try {
            fingerprint = await deriveBackupFingerprint(mnemonic);
        } catch (err: any) {
            console.warn('[Ark restore] fingerprint derive failed:', err);
            setRestoring(false);
            setErrorMsg(`Couldn't process the seed phrase: ${err?.message ?? 'unknown error'}.`);
            return;
        }

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

            // `lookupArkBackupOnDrive` does the full scan: fast-path
            // by per-wallet name, then full appDataFolder scan with
            // header match (rename-tolerant), then legacy v1 / v0
            // fallback (try-decrypt for unmigrated single-name files).
            const result = await lookupArkBackupOnDrive(fingerprint);
            if (await tryRestoreFromLookup(result, mnemonic, 'google-drive', 'Drive restore')) {
                return;
            }
            setRestoring(false);
            setErrorMsg(
                "No backup matches this seed phrase in Google Drive. " +
                "Check that you're signed in with the right Google account, or pick a backup file manually.",
            );
        } catch (err: any) {
            console.warn('[Ark restore] Drive flow failed:', err);
            setRestoring(false);
            setErrorMsg(
                `Couldn't reach Google Drive: ${err?.message ?? "unknown error"}. ` +
                `Try again, or pick a backup file manually.`,
            );
        }
    };

    const handleRestoreFromICloud = async () => {
        if (submitting || restoring) return;
        const resolved = await resolveMnemonicForRestore();
        if (!resolved) return;
        const { mnemonic } = resolved;

        if (!(await confirmReplaceDatadir("from iCloud Drive"))) return;

        setRestoring(true);
        setErrorMsg(null);

        let fingerprint: string;
        try {
            fingerprint = await deriveBackupFingerprint(mnemonic);
        } catch (err: any) {
            console.warn('[Ark restore] fingerprint derive failed:', err);
            setRestoring(false);
            setErrorMsg(`Couldn't process the seed phrase: ${err?.message ?? 'unknown error'}.`);
            return;
        }

        // iOS local Documents IS the iCloud Drive folder for the app —
        // Apple mirrors it transparently when the user has iCloud Drive
        // enabled for Cypher Box. So scanning Documents finds files
        // that originated locally AND files that came down from iCloud.
        // Includes legacy-v1 fallback automatically.
        const local = await lookupArkBackupInLocalDocuments(fingerprint);
        if (await tryRestoreFromLookup(local, mnemonic, 'icloud-drive', 'iCloud restore')) {
            return;
        }

        // Fallback: DocumentPicker into iCloud Drive proper. Lets the
        // user navigate to a backup that lives somewhere else in iCloud
        // (e.g. they exported manually to iCloud Drive → Cypher Box).
        let pickedBlob: string;
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
            pickedBlob = await RNFS.readFile(cleanPath, 'utf8');
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
                `the picker should show "iCloud Drive → Cypher Box → ark-backup-{fingerprint}.cbark".`,
            );
            return;
        }

        const picked = classifyPickedBackupBlob(pickedBlob, fingerprint);
        if (picked.kind === 'not-found') {
            setRestoring(false);
            setErrorMsg(
                "This file isn't a backup for the seed phrase you entered. " +
                "Pick a different file, or check your seed.",
            );
            return;
        }
        if (await tryRestoreFromLookup(picked, mnemonic, 'icloud-drive', 'iCloud restore')) return;

        setRestoring(false);
        setErrorMsg(
            "No backup matches this seed phrase. " +
            "Check the seed, or proceed without a backup if you don't have one.",
        );
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
                "There's already an Ark wallet set up on this device. Open it first to reset before restoring from backup — otherwise the existing wallet stays.",
                [
                    { text: "Cancel", style: "cancel" },
                    { text: "Open setup", onPress: () => dispatchNavigate("CreateArkScreen") },
                ],
            );
            return;
        }

        setSubmitting(true);
        setErrorMsg(null);

        // Conflict guard: same as the file-restore paths. Seed-only
        // recovery (no .cbark) is a strong signal the user is committed
        // to this seed; still surface the overwrite warning so the
        // previous wallet's biometric fast-recover isn't silently lost.
        const conflict = await checkArkSeedKeychainConflict(mnemonic);
        if (conflict.kind === 'different-wallet' || conflict.kind === 'unreadable') {
            const proceed = await new Promise<boolean>(resolve => {
                const keychainLabel = Platform.OS === 'ios' ? 'Keychain' : 'Keystore';
                const message =
                    conflict.kind === 'different-wallet'
                        ? `A saved seed already exists on this device's ${keychainLabel} behind ${BIOMETRIC_LABEL} for wallet ${conflict.existingFingerprint}.\n\nIf you want the new seed to take its place, make sure the old seed is written down somewhere safe.`
                        : `A saved seed already exists on this device's ${keychainLabel} but couldn't be read to compare (${conflict.reason}).\n\nIf you want the new seed to take its place, make sure the old seed is written down somewhere safe — it may otherwise be lost.`;
                Alert.alert(
                    "Replace keychain-saved seed?",
                    message,
                    [
                        { text: `Keep old seed in ${keychainLabel}`, style: "cancel", onPress: () => resolve(false) },
                        { text: `Save new seed in ${keychainLabel}`, onPress: () => resolve(true) },
                    ],
                    { cancelable: true, onDismiss: () => resolve(false) },
                );
            });
            if (!proceed) {
                setSubmitting(false);
                return;
            }
        }

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
        await finalizeWallet(mnemonic);
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
                {`Your Ark seed phrase is in this device's Keychain — you don't need to type it. Tap unlock below to load the seed via ${BIOMETRIC_LABEL} / passcode.\n\nVTXO capsules can't be re-derived from the seed alone, so you'll also need your ark-backup file — from ${cloudLabel} (if you connected it earlier) or a manual export.`}
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
                Note: VTXO capsules cannot be recovered from the seed alone. To restore your funds, also restore from your ark-backup file (the buttons below).
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

import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import DocumentPicker, { types as DocTypes } from "react-native-document-picker";
import RNFS from "react-native-fs";
import * as Keychain from "react-native-keychain";

import { Button, Input, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import {
    checkArkSeedKeychainConflict,
    classifyPickedBackupBlob,
    clearArkWalletHandle,
    connectGoogleDrive,
    createArkWallet,
    deleteArkDatadir,
    deriveBackupFingerprint,
    getArkWalletHandle,
    getLastArkRecoveryReport,
    hasArkDatadir,
    isTransientArkOpenError,
    openArkWallet,
    isGoogleDriveConnected,
    lookupArkBackupInLocalDocuments,
    lookupArkBackupInSafFolder,
    lookupArkBackupOnDrive,
    ArkRestoreApplyError,
    restoreArkBackupBlob,
    saveArkSeedToKeychain,
    setArkBackgroundRefreshEnabled,
} from "@Cypher/services/ark";
import type { ChannelLookupResult } from "@Cypher/services/ark";
import { validateMnemonic } from "@secondts/bark-react-native";
import useAuthStore from "@Cypher/stores/authStore";
import { useKeyboardLift } from "@Cypher/custom-hooks";
import { colors, ltr, rtl } from "@Cypher/style-guide";

import styles from "./styles";
import loc from "../../../../loc";

/**
 * Keychain convention: MUST match seedKeychain.ts / recover.ts / reset.ts.
 * If these drift, the next session can't unlock the seed and the on-chain
 * sidecar (`ensureArkOnchainHandle`) will fail with "seed not in Keychain".
 *
 * Only the service name is needed here now, for the read paths. The WRITE
 * lives in src/services/ark/seedKeychain.ts so the biometric-gate check
 * cannot be forgotten at one call site and applied at another.
 */
const KEYCHAIN_SERVICE = "ark-seed-phrase";

const inputs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

type Mode = 'auto' | 'type';

const BIOMETRIC_LABEL = Platform.OS === 'ios' ? 'Face ID' : 'Touch ID';

// Single source of truth for the seed-only CTA. The "no backup matches this
// seed" errors quote it verbatim, so the words in the error are the words on
// the button. Only TypeSeedView renders it, so only TypeSeedView's errors may
// name it (see noBackupMatchError).
const getSeedOnlyCtaLabel = () => loc.cypherbox.account.recover_ark.seed_only_cta;

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
 *   2. Typed grid — user types 12 words. Surfaces two CTAs:
 *      "Restore from backup file" and, for the user who has no .cbark,
 *      "Continue without a backup file" (seed-only).
 *   3. Backup file / cloud — works with whichever mnemonic is resolved
 *      (keychain-unlocked or typed). Restores local state verbatim, so it
 *      returns the most.
 *
 * Seed-only is NOT an empty-wallet path any more. bark 0.6.1 scans a
 * server-side recovery mailbox on the open that creates the wallet locally
 * (`WalletOpenArgs.skipRecovery = !forceRescan`, see walletHandle.ts) and
 * re-imports the VTXOs the ASP still tracks for this seed. It is best-effort,
 * not a guarantee: the scan can fail while the open still succeeds, and VTXOs
 * keyed past the 50-consecutive-unused-index gap limit land in the report's
 * `foreign` bucket and are not recoverable by retrying. That is why the .cbark
 * is still the recommended path, and why the outcome is shown to the user
 * instead of silently dropping them on Home.
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
            } catch (probeErr: any) {
                // Do NOT swallow this silently. If the metadata probe throws,
                // the biometric fast path vanishes and the user is dropped into
                // the 12-word grid with no explanation, which is
                // indistinguishable from "no seed is stored". Log it so the
                // two cases can be told apart on a real device.
                console.warn(
                    '[Ark recover] keychain service probe failed:',
                    probeErr?.message ?? probeErr,
                );
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
                    ? String(loc.formatString(loc.cypherbox.account.recover_ark.tap_unlock_first, { biometric: BIOMETRIC_LABEL }))
                    : loc.cypherbox.account.recover_ark.type_all_first,
            );
            return null;
        }
        let valid = false;
        try {
            valid = validateMnemonic(mnemonic);
        } catch {
            setErrorMsg(loc.cypherbox.account.recover_ark.validate_failed);
            return null;
        }
        if (!valid) {
            setErrorMsg(
                loc.cypherbox.account.recover_ark.invalid_seed,
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
                    loc.cypherbox.account.recover_ark.keychain_no_seed,
                );
            }
        } catch (err: any) {
            console.warn('[Ark restore] Keychain read declined:', err?.message ?? err);
            setErrorMsg(
                String(loc.formatString(loc.cypherbox.account.recover_ark.biometric_declined, { biometric: BIOMETRIC_LABEL })),
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
                loc.cypherbox.account.recover_ark.replace_existing_title,
                String(loc.formatString(loc.cypherbox.account.recover_ark.replace_existing_body, { source: sourceLabel })),
                [
                    { text: loc._.cancel, style: "cancel", onPress: () => resolve(false) },
                    { text: loc.cypherbox.account.recover_ark.replace, style: "destructive", onPress: () => resolve(true) },
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
                        ? String(loc.formatString(loc.cypherbox.account.common.keychain_conflict_different, { keychain: keychainLabel, biometric: BIOMETRIC_LABEL, fingerprint: conflict.existingFingerprint }))
                        : String(loc.formatString(loc.cypherbox.account.common.keychain_conflict_unreadable, { keychain: keychainLabel, reason: conflict.reason }));
                Alert.alert(
                    loc.cypherbox.account.common.replace_keychain_seed_title,
                    message,
                    [
                        { text: String(loc.formatString(loc.cypherbox.account.common.keep_old_seed_in, { keychain: keychainLabel })), style: "cancel", onPress: () => resolve(false) },
                        { text: String(loc.formatString(loc.cypherbox.account.common.save_new_seed_in, { keychain: keychainLabel })), onPress: () => resolve(true) },
                    ],
                    { cancelable: true, onDismiss: () => resolve(false) },
                );
            });
            if (!proceed) {
                // Skip the keychain write. Wallet stays open this session;
                // user types seed next time. Not an error, but the seed is
                // NOT on this device, and the caller must record that.
                return false;
            }
        }

        const saved = await saveArkSeedToKeychain(mnemonic);
        if (!saved.ok) {
            // Wallet is already restored and open, so this is non-fatal. The
            // user can operate this session and type the seed next time.
            if (saved.kind === 'no-biometric-gate') {
                console.warn(
                    `[Ark restore] seed NOT saved (${label}): no biometric gate, storage=`,
                    saved.storage,
                );
                Alert.alert(
                    loc.cypherbox.account.common.seed_not_saved_title,
                    loc.cypherbox.account.recover_ark.seed_not_saved_body,
                );
            } else {
                console.warn(`[Ark restore] Keychain save failed (${label}):`, saved.reason);
            }
        }
        return saved.ok;
    };

    const finalizeWallet = async (mnemonic: string, restoredFrom?: string, keychainSaved: boolean = true) => {
        const wallet = {
            id: `ark-${Date.now()}`,
            createdAt: new Date().toISOString(),
            useHotVaultSeed: false,
            // Must reflect what ACTUALLY happened. This flag is the consent
            // signal gating the non-biometric background seed mirror in
            // backgroundKeychain.ts, so hardcoding `true` after a save that
            // was skipped, refused, or downgraded would reopen the very hole
            // that gate exists to close.
            keychainSaved,
            restored: true,
            restoredFrom: restoredFrom ?? null,
            backupDestination: null,
        };
        setArkWallet(wallet);
        setArkAuth(true);
        if (!allBTCWallets.includes("ARK")) {
            setAllBTCWallets([...allBTCWallets, "ARK"]);
        }
        // Arm reminders + foreground auto-refresh the same way the create
        // flow does (ArkSeedPhraseScreen). clearArkAuth resets
        // arkBgRefreshEnabled to false on disconnect, so a fresh recovery
        // would otherwise come back with auto-refresh OFF — which silently
        // leaves the user's restored arkoor VTXOs under server-trust until
        // they notice the toggle. Mirroring create here keeps the post-
        // recovery experience identical to a fresh wallet.
        try {
            await setArkBackgroundRefreshEnabled(true);
        } catch (err) {
            console.warn("[Ark recover] failed to arm reminders:", err);
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
            // and the AES key is the same seed. If decrypt itself fails,
            // the file is genuinely corrupt; surface a precise error.
            //
            // BUT: `restoreArkBackupBlob` doesn't ONLY decrypt — its last
            // step is `await openArkWallet(mnemonic)` which connects to
            // the ASP and esplora. A network failure there throws BACK
            // through this catch, which used to flatten every failure
            // into "Backup file is corrupt: BarkError.ServerConnection"
            // — wildly misleading. The file was fine; the user just
            // couldn't reach the server. Cost us 45 minutes of debugging
            // on 2026-05-30 because the toast was actively lying.
            //
            // Distinguish by message shape: known network/server errors
            // get a connectivity message + a "your backup is intact"
            // reassurance, everything else stays as the original corrupt-
            // file path.
            if (result.kind === 'matched') {
                // restoreArkBackupBlob decrypts + validates the manifest BEFORE
                // it touches disk or the network. An ArkRestoreApplyError means
                // those passed and only the apply/open step failed (server
                // unreachable, or storage) — the file is provably intact, so it
                // is NEVER corrupt. Reuse the same "backup is safe, retry"
                // reassurance the network branch shows.
                if (err instanceof ArkRestoreApplyError || err?.backupIntact === true) {
                    console.warn('[Ark restore] apply/open failed after decrypt (file intact):', err);
                    setRestoring(false);
                    setErrorMsg(
                        loc.cypherbox.account.recover_ark.server_unreachable_intact,
                    );
                    return true;
                }
                const msg = String(err?.message ?? '');
                const isNetworkError =
                    msg.includes('BarkError.ServerConnection') ||
                    msg.includes('BarkError.Network') ||
                    msg.includes('ServerConnection') ||
                    msg.includes('failed to open wallet') ||
                    msg.includes('Reqwest') ||
                    msg.includes('Timed out') ||
                    msg.includes('connect to') ||
                    msg.toLowerCase().includes('network');

                if (isNetworkError) {
                    console.warn('[Ark restore] post-decrypt network failure (file is intact, server unreachable):', err);
                    setRestoring(false);
                    setErrorMsg(
                        loc.cypherbox.account.recover_ark.server_unreachable_intact,
                    );
                    return true;
                }

                console.warn('[Ark restore] decrypt of fingerprint-matched blob failed:', err);
                setRestoring(false);
                setErrorMsg(
                    String(loc.formatString(loc.cypherbox.account.recover_ark.backup_corrupt, { error: err?.message ?? loc.cypherbox.account.recover_ark.decryption_failed })),
                );
                return true; // handled (with error); don't keep scanning
            }
            // v1 candidate: this file was the last-resort try; failure
            // means it didn't belong to this seed. Pretend not-found so
            // caller surfaces the unified "no backup matches" error.
            if (__DEV__) console.log('[Ark restore] legacy v1 try-decrypt failed:', err?.message ?? err);
            return false;
        }
        const seedStored = await persistSeedToKeychain(mnemonic, keychainLabel);
        setRestoring(false);
        await finalizeWallet(mnemonic, finalizeChannel, seedStored);
        return true;
    };

    // Show the typed-grid view when the probe says no seed exists (cold
    // install / new device — typing is the only way in) OR when the user
    // explicitly opted into typing from the Face ID chooser.
    const showTypeView = mode === 'type' || keychainHasSeed === false;

    // The seed-only CTA lives in TypeSeedView only. In ChooseView the restore
    // buttons appear only once `unlockedMnemonic` is set, and "Type seed
    // manually instead" is hidden in exactly that state, so a ChooseView
    // no-match has no route to the seed-only path on screen. Naming the button
    // there would send the user hunting for a control that isn't rendered, so
    // that branch stays generic.
    const noBackupMatchError = () =>
        showTypeView
            ? String(loc.formatString(loc.cypherbox.account.recover_ark.no_match_type, { cta: getSeedOnlyCtaLabel() }))
            : loc.cypherbox.account.recover_ark.no_match_choose;

    // forcePicker bypasses the local-first read so the user can restore from
    // some other .cbark — e.g. an older manually-exported snapshot. Wired to
    // the "Pick a different file…" escape hatch in both view variants.
    const handleRestoreFromFile = async (forcePicker = false) => {
        if (submitting || restoring) return;
        const resolved = await resolveMnemonicForRestore();
        if (!resolved) return;
        const { mnemonic } = resolved;

        if (!(await confirmReplaceDatadir(loc.cypherbox.account.recover_ark.from_this_backup_file))) return;

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
            setErrorMsg(String(loc.formatString(loc.cypherbox.account.recover_ark.process_seed_failed, { error: err?.message ?? loc.cypherbox.account.common.unknown_error })));
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
                setErrorMsg(loc.cypherbox.account.recover_ark.picked_no_path);
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
            setErrorMsg(String(loc.formatString(loc.cypherbox.account.recover_ark.picker_failed, { error: err?.message ?? loc.cypherbox.account.common.unknown_error })));
            return;
        }

        const picked = classifyPickedBackupBlob(pickedBlob, fingerprint);
        if (picked.kind === 'not-found') {
            setRestoring(false);
            setErrorMsg(
                loc.cypherbox.account.recover_ark.not_backup_for_seed,
            );
            return;
        }
        if (await tryRestoreFromLookup(picked, mnemonic, undefined, 'file restore')) return;

        setRestoring(false);
        setErrorMsg(noBackupMatchError());
    };

    const handleRestoreFromGoogleDrive = async () => {
        if (submitting || restoring) return;
        const resolved = await resolveMnemonicForRestore();
        if (!resolved) return;
        const { mnemonic } = resolved;

        if (!(await confirmReplaceDatadir(loc.cypherbox.account.recover_ark.from_google_drive))) return;

        setRestoring(true);
        setErrorMsg(null);

        let fingerprint: string;
        try {
            fingerprint = await deriveBackupFingerprint(mnemonic);
        } catch (err: any) {
            console.warn('[Ark restore] fingerprint derive failed:', err);
            setRestoring(false);
            setErrorMsg(String(loc.formatString(loc.cypherbox.account.recover_ark.process_seed_failed, { error: err?.message ?? loc.cypherbox.account.common.unknown_error })));
            return;
        }

        try {
            const connected = await isGoogleDriveConnected();
            if (!connected) {
                const ok = await connectGoogleDrive();
                if (!ok) {
                    setRestoring(false);
                    setErrorMsg(loc.cypherbox.account.recover_ark.google_signin_declined);
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
                loc.cypherbox.account.recover_ark.drive_no_match +
                (showTypeView ? String(loc.formatString(loc.cypherbox.account.recover_ark.drive_no_match_seed_only, { cta: getSeedOnlyCtaLabel() })) : ""),
            );
        } catch (err: any) {
            console.warn('[Ark restore] Drive flow failed:', err);
            setRestoring(false);
            setErrorMsg(
                String(loc.formatString(loc.cypherbox.account.recover_ark.drive_unreachable, { error: err?.message ?? loc.cypherbox.account.common.unknown_error })),
            );
        }
    };

    const handleRestoreFromICloud = async () => {
        if (submitting || restoring) return;
        const resolved = await resolveMnemonicForRestore();
        if (!resolved) return;
        const { mnemonic } = resolved;

        if (!(await confirmReplaceDatadir(loc.cypherbox.account.recover_ark.from_icloud_drive))) return;

        setRestoring(true);
        setErrorMsg(null);

        let fingerprint: string;
        try {
            fingerprint = await deriveBackupFingerprint(mnemonic);
        } catch (err: any) {
            console.warn('[Ark restore] fingerprint derive failed:', err);
            setRestoring(false);
            setErrorMsg(String(loc.formatString(loc.cypherbox.account.recover_ark.process_seed_failed, { error: err?.message ?? loc.cypherbox.account.common.unknown_error })));
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
                setErrorMsg(loc.cypherbox.account.recover_ark.picked_no_path);
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
                String(loc.formatString(loc.cypherbox.account.recover_ark.icloud_read_failed, { error: err?.message ?? loc.cypherbox.account.common.unknown_error, fingerprint: '{fingerprint}' })),
            );
            return;
        }

        const picked = classifyPickedBackupBlob(pickedBlob, fingerprint);
        if (picked.kind === 'not-found') {
            setRestoring(false);
            setErrorMsg(
                loc.cypherbox.account.recover_ark.not_backup_for_seed,
            );
            return;
        }
        if (await tryRestoreFromLookup(picked, mnemonic, 'icloud-drive', 'iCloud restore')) return;

        setRestoring(false);
        setErrorMsg(noBackupMatchError());
    };

    /**
     * Tell the user what the recovery-mailbox scan actually found, before
     * finalizeWallet dispatchResets to Home and destroys the back stack.
     *
     * Without this, a seed-only recovery that found nothing is visually
     * identical to a brand-new empty wallet, and the user has no way to tell
     * "this seed genuinely holds nothing" apart from "the scan failed". Those
     * two are fund-safety-distinct: bark logs a failed scan and lets the open
     * succeed, so an absent report is NOT proof that nothing is missing.
     */
    const reportRecoveryOutcome = async (): Promise<void> => {
        let report: ReturnType<typeof getLastArkRecoveryReport>;
        try {
            report = getLastArkRecoveryReport();
        } catch (err) {
            console.warn("[Ark recover] getLastArkRecoveryReport threw:", err);
            return;
        }

        const recoveredCount = report ? report.recovered.vtxoIds.length : 0;
        const recoveredSats = report ? Number(report.recovered.totalSats) : 0;
        // `isComplete` is the SDK's own "no failed, no foreign" flag. Do not
        // re-derive it from the buckets.
        const incomplete = !!report && !report.isComplete;

        // Every id the scan looked at, across all five buckets. Only an
        // all-empty report justifies "the server had no capsules for this
        // seed". A zero `recovered` count alone does not, because the ids may
        // have landed in skipped/exited (nothing left to bring back) or in
        // failed/foreign (funds may be missing).
        const bucketsTouched = report
            ? report.recovered.vtxoIds.length +
              report.skipped.vtxoIds.length +
              report.foreign.vtxoIds.length +
              report.failed.vtxoIds.length +
              report.exited.vtxoIds.length
            : 0;

        let title: string;
        let message: string;
        if (!report) {
            title = loc.cypherbox.account.recover_ark.recovered_title;
            message =
                loc.cypherbox.account.recover_ark.no_report_body;
        } else if (incomplete) {
            // MUST precede the recovered === 0 test. `isComplete` false means
            // the scan left ids in `failed` or `foreign`, and the SDK documents
            // both as "funds may be missing". Telling this user "no capsules
            // found" states the opposite of the fund state, which is the exact
            // failure this function exists to prevent.
            title = loc.cypherbox.account.recover_ark.unresolved_title;
            message =
                (recoveredCount === 0
                    ? loc.cypherbox.account.recover_ark.unresolved_none
                    : String(loc.formatString(recoveredCount === 1 ? loc.cypherbox.account.recover_ark.unresolved_some_one : loc.cypherbox.account.recover_ark.unresolved_some_other, { count: recoveredCount, sats: recoveredSats }))) +
                loc.cypherbox.account.recover_ark.unresolved_tail;
        } else if (bucketsTouched === 0) {
            title = loc.cypherbox.account.recover_ark.no_capsules_title;
            message =
                loc.cypherbox.account.recover_ark.no_capsules_body;
        } else if (recoveredCount === 0) {
            // Complete scan, nothing to bring back: every id was already spent,
            // exited on-chain, or reported non-spendable. That is a definite
            // answer, unlike the branches above.
            title = loc.cypherbox.account.recover_ark.nothing_left_title;
            message =
                loc.cypherbox.account.recover_ark.nothing_left_body;
        } else {
            title = loc.cypherbox.account.recover_ark.recovered_title;
            message = String(loc.formatString(recoveredCount === 1 ? loc.cypherbox.account.recover_ark.recovered_one : loc.cypherbox.account.recover_ark.recovered_other, { count: recoveredCount, sats: recoveredSats }));
        }

        // Resolve on dismiss as well as on the button. This promise gates
        // finalizeWallet, so an Alert that is swiped away or dismissed by the
        // Android back button must not leave the user parked on the recover
        // screen with a wallet that is already open. Dismissing just means
        // "continue", so there is nothing to lose by treating it as the button.
        await new Promise<void>((resolve) => {
            Alert.alert(title, message, [{ text: loc._.continue, onPress: () => resolve() }], {
                cancelable: true,
                onDismiss: () => resolve(),
            });
        });
    };

    const handleRecoverSeedOnly = async () => {
        if (submitting || restoring) return;
        // Resolve through the shared resolver rather than reading the typed
        // grid directly. It prefers `unlockedMnemonic`, which is what makes
        // this handler usable from ChooseView: a user who unlocked the seed
        // with Face ID has an empty grid, and reading `secretWords` here used
        // to fail them with "Please fill in all 12 words" for a seed the
        // device was already holding. It applies the same 12-word and BIP39
        // checks, so the typed path is unchanged.
        const resolved = await resolveMnemonicForRestore();
        if (!resolved) return;
        const { mnemonic } = resolved;

        // `datadirExists` is a mount-time snapshot (the probe effect has an
        // empty dep array). A .cbark restore attempted after mount unlinks,
        // recreates and repopulates the datadir before its open throws, so the
        // snapshot can say "no datadir" while a full one is on disk. Re-probe,
        // because everything below branches on it.
        const datadirOnDisk = await hasArkDatadir();

        // A live wallet is left strictly alone.
        if (datadirOnDisk && (!!getArkWalletHandle() || isArkAuth)) {
            Alert.alert(
                loc.cypherbox.account.recover_ark.already_open_title,
                loc.cypherbox.account.recover_ark.already_open_body,
                [
                    { text: loc._.cancel, style: "cancel" },
                    { text: loc.cypherbox.account.recover_ark.open_setup, onPress: () => dispatchNavigate("CreateArkScreen") },
                ],
            );
            return;
        }

        setSubmitting(true);
        setErrorMsg(null);

        // Datadir on disk with no live wallet. Ask the datadir who it belongs
        // to rather than guessing, and never route the user to CreateArkScreen.
        //
        // Both of the obvious shortcuts are wrong, and each has drawn blood:
        //
        //   Wiping on "no handle and !isArkAuth" looks safe and is not.
        //   `isArkAuth` is not a liveness proof: useArkRestoreOnBoot clears it
        //   whenever restoreArkWalletFromDisk returns `no-datadir`, and
        //   hasArkDatadir() swallows every RNFS error into `false`, so one
        //   transient read clears auth on a device that does have a funded
        //   vault. Wiping there takes exit-tree txs, presigned CPFP children,
        //   LN preimages and arkoor refs, none of them seed-derivable and none
        //   of them on the recovery mailbox.
        //
        //   Sending the user to CreateArkScreen is worse, which is why this
        //   replaced it. That screen sees the same orphan-looking datadir and
        //   auto-cleans it SILENTLY with no prompt, then presents its create
        //   UI, so the user taps through and lands on a brand new generated
        //   seed instead of the one they just typed. Observed on device.
        //
        // openArkWallet is open-only (createIfNotExists: false) and never
        // deletes, so probing with it is free. A successful open is positive
        // proof the datadir is this seed's wallet.
        if (datadirOnDisk) {
            let probeErr: string | null = null;
            try {
                await openArkWallet(mnemonic);
            } catch (err: any) {
                probeErr = `${(err as { tag?: string })?.tag ?? ''} ${(err as Error)?.message ?? String(err)}`;
            }

            if (!probeErr) {
                // It is this seed's own wallet, already on disk and openable.
                // Nothing to recover and nothing to destroy: adopt it. The
                // mailbox scan does not run on an open (only on the create),
                // but that is the correct trade here. Re-deriving this wallet
                // from the mailbox would mean deleting local state that the
                // mailbox cannot give back.
                const adopted = await persistSeedToKeychain(mnemonic, 'seed-only adopt');
                setSubmitting(false);
                await new Promise<void>((resolve) => {
                    Alert.alert(
                        loc.cypherbox.account.recover_ark.reopened_title,
                        loc.cypherbox.account.recover_ark.reopened_body,
                        [{ text: loc._.continue, onPress: () => resolve() }],
                        { cancelable: true, onDismiss: () => resolve() },
                    );
                });
                await finalizeWallet(mnemonic, undefined, adopted);
                return;
            }

            if (isTransientArkOpenError(probeErr)) {
                // We do NOT know whose datadir this is. Saying "wrong seed" here
                // and offering a wipe would invite the user to delete their own
                // wallet because esplora happened to be rate-limiting.
                await clearArkWalletHandle();
                setSubmitting(false);
                setErrorMsg(
                    loc.cypherbox.account.recover_ark.server_unreachable_check,
                );
                return;
            }

            // Non-transient: the datadir does not open with this seed, so it
            // belongs to a different wallet (or is corrupt). Only now is a
            // delete defensible, and only with an explicit decision.
            console.warn('[Ark recover] existing datadir does not open with this seed:', probeErr.trim());
            await clearArkWalletHandle();
            const proceed = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    loc.cypherbox.account.recover_ark.different_data_title,
                    loc.cypherbox.account.recover_ark.different_data_body,
                    [
                        { text: loc._.cancel, style: "cancel", onPress: () => resolve(false) },
                        { text: loc.cypherbox.account.recover_ark.replace_it, style: "destructive", onPress: () => resolve(true) },
                    ],
                    { cancelable: true, onDismiss: () => resolve(false) },
                );
            });
            if (!proceed) {
                setSubmitting(false);
                return;
            }
            try {
                await deleteArkDatadir();
            } catch (err: any) {
                console.warn('[Ark recover] datadir delete failed:', err?.message ?? err);
                setSubmitting(false);
                setErrorMsg(
                    loc.cypherbox.account.recover_ark.clear_failed,
                );
                return;
            }
        }

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
                        ? String(loc.formatString(loc.cypherbox.account.common.keychain_conflict_different, { keychain: keychainLabel, biometric: BIOMETRIC_LABEL, fingerprint: conflict.existingFingerprint }))
                        : String(loc.formatString(loc.cypherbox.account.common.keychain_conflict_unreadable, { keychain: keychainLabel, reason: conflict.reason }));
                Alert.alert(
                    loc.cypherbox.account.common.replace_keychain_seed_title,
                    message,
                    [
                        { text: String(loc.formatString(loc.cypherbox.account.common.keep_old_seed_in, { keychain: keychainLabel })), style: "cancel", onPress: () => resolve(false) },
                        { text: String(loc.formatString(loc.cypherbox.account.common.save_new_seed_in, { keychain: keychainLabel })), onPress: () => resolve(true) },
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
            await createArkWallet(mnemonic, true);
        } catch (err: any) {
            console.warn("[Ark recover] createArkWallet failed:", err);
            const msg = (err as Error)?.message ?? "unknown error";
            setSubmitting(false);
            setErrorMsg(
                /Internal/i.test(msg)
                    ? loc.cypherbox.account.recover_ark.open_create_failed
                    : String(loc.formatString(loc.cypherbox.account.recover_ark.recovery_failed, { error: msg })),
            );
            return;
        }

        // Seed write AFTER the wallet is open, matching every restore path
        // (persistSeedToKeychain). The ordering is load-bearing: a write here
        // that fails must not have already clobbered the previous wallet's
        // keychain seed for a recovery that never completed. The conflict
        // prompt above stays BEFORE the create on purpose, because it only
        // reads, and declining it has to abort before anything is touched.
        const savedSeed = await saveArkSeedToKeychain(mnemonic);
        if (!savedSeed.ok) {
            // Non-fatal in both branches now: the wallet is already open, so
            // aborting here would strand a recovered wallet rather than
            // protect anything. The user just types the seed again next time.
            //
            // AWAITED, because reportRecoveryOutcome fires its own Alert in the
            // same tick. Two unawaited Alerts back to back means the second
            // replaces the first on iOS and queues behind it on Android, so the
            // "your seed is not on this device" warning is the one the user
            // never reads.
            const body =
                savedSeed.kind === 'no-biometric-gate'
                    ? loc.cypherbox.account.recover_ark.seed_not_saved_continue
                    : String(loc.formatString(loc.cypherbox.account.recover_ark.seed_not_saved_reason, { reason: savedSeed.reason }));
            if (savedSeed.kind === 'no-biometric-gate') {
                console.warn(
                    '[Ark recover] seed not saved: no biometric gate, storage=',
                    savedSeed.storage,
                );
            } else {
                console.warn("[Ark recover] Keychain save failed:", savedSeed.reason);
            }
            await new Promise<void>((resolve) => {
                Alert.alert(loc.cypherbox.account.common.seed_not_saved_title, body, [{ text: loc._.ok, onPress: () => resolve() }], {
                    cancelable: true,
                    onDismiss: () => resolve(),
                });
            });
        }

        // `submitting` stays TRUE across both alerts on purpose. Clearing it
        // re-renders the typed-seed grid behind the modal, putting all 12
        // plaintext words back on screen in a room the user may no longer be
        // alone in. finalizeWallet navigates away, so nothing needs the grid
        // back; the only reset is on the error paths above, which do need it.
        await reportRecoveryOutcome();
        // savedSeed.ok is false when the biometric gate could not be applied
        // (we continued the recovery deliberately), so the wallet record must
        // not claim the seed is on this device.
        await finalizeWallet(mnemonic, undefined, savedSeed.ok);
        setSubmitting(false);
    };

    const cloudLabel = Platform.OS === 'ios' ? 'iCloud Drive' : 'Google Drive';
    const cloudHandler = Platform.OS === 'ios' ? handleRestoreFromICloud : handleRestoreFromGoogleDrive;
    const probing = keychainHasSeed === null;

    if (submitting || restoring) {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.ark.light} />
                    <Text style={styles.loadingText}>
                        {restoring ? loc.cypherbox.account.recover_ark.restoring : loc.cypherbox.account.recover_ark.recovering}
                    </Text>
                </View>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout title={loc.cypherbox.account.recover_ark.screen_title} showToolbar isBackButton disableScroll>
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
                        onRecoverSeedOnly={handleRecoverSeedOnly}
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
    onRecoverSeedOnly(): void;
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
    onRecoverSeedOnly,
}: ChooseViewProps) {
    return (
        <>
            <Text bold style={styles.introTitle}>
                {loc.cypherbox.account.recover_ark.choose_title}
            </Text>
            <Text style={styles.introBody}>
                {loc.formatString(loc.cypherbox.account.recover_ark.choose_body, { biometric: BIOMETRIC_LABEL, cloud: cloudLabel })}
            </Text>

            {!unlockedMnemonic && (
                <Button
                    text={unlocking ? loc.cypherbox.account.recover_ark.unlocking : String(loc.formatString(loc.cypherbox.account.recover_ark.unlock_with, { biometric: BIOMETRIC_LABEL }))}
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
                        {loc.cypherbox.account.recover_ark.seed_unlocked}
                    </Text>
                </View>
            )}

            {unlockedMnemonic && (
                <Button
                    text={loc.cypherbox.account.recover_ark.restore_from_file}
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
                        {loc.formatString(loc.cypherbox.account.recover_ark.restore_from_cloud, { cloud: cloudLabel })}
                    </Text>
                </TouchableOpacity>
            )}

            {/* Seed-only, same tier and label as in TypeSeedView. This view's
                whole audience is a same-device return where the seed is in the
                Keychain, which is exactly the population most likely to have
                lost the .cbark. Without this they were offered only the two
                file paths and had no way forward at all. */}
            {unlockedMnemonic && (
                <TouchableOpacity onPress={onRecoverSeedOnly} style={styles.seedOnlyLink}>
                    <Text style={styles.seedOnlyLinkText}>{getSeedOnlyCtaLabel()}</Text>
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
                        {loc.cypherbox.account.recover_ark.pick_different_file}
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
                        {loc.cypherbox.account.recover_ark.type_manually}
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
    // Lift the view when the keyboard shows so words 11/12 stay visible
    // while typing (slides up under the header, same as RecoverSavingVault).
    const keyboardLift = useKeyboardLift(40);
    return (
        <Animated.View style={{ transform: [{ translateY: keyboardLift }] }}>
            <Text bold style={styles.introTitle}>
                {loc.cypherbox.account.recover_ark.type_title}
            </Text>
            <Text style={styles.introBody}>
                {loc.cypherbox.account.recover_ark.type_body_1}
                {"\n\n"}
                {loc.cypherbox.account.recover_ark.type_body_2}
            </Text>

            <View style={styles.inputsContainer}>
                <View style={styles.inputColumn}>
                    {inputs.slice(0, 6).map((label, index) => (
                        <View key={label} style={styles.inputContainer}>
                            <Text h2 style={[styles.labelText, rtl.ltrText]}>{ltr(`${label}.`)}</Text>
                            <Input
                                ref={(el: any) => (inputRefs.current[index] = el)}
                                style={styles.inputStyle}
                                onChange={(value: string) => onWordChange(index, value)}
                                value={secretWords[index]}
                                textInputStyle={StyleSheet.flatten([styles.textInputStyle, rtl.ltrText])}
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
                            <Text h2 style={[styles.labelText, rtl.ltrText]}>{ltr(`${label}.`)}</Text>
                            <Input
                                ref={(el: any) => (inputRefs.current[index + 6] = el)}
                                style={styles.inputStyle}
                                onChange={(value: string) => onWordChange(index + 6, value)}
                                value={secretWords[index + 6]}
                                textInputStyle={StyleSheet.flatten([styles.textInputStyle, rtl.ltrText])}
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
                text={loc.cypherbox.account.recover_ark.restore_from_file}
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
                    {loc.formatString(loc.cypherbox.account.recover_ark.restore_from_cloud, { cloud: cloudLabel })}
                </Text>
            </TouchableOpacity>

            {/* Seed-only path. Ranked above the gray "pick a different file"
                link on purpose: for a user with no .cbark this is the only
                route in, and the no-match errors point at it by name, so the
                label here and SEED_ONLY_CTA_LABEL must stay the same string.
                Fires handleRecoverSeedOnly, which calls
                createArkWallet(mnemonic, true), so bark opens with the
                recovery-mailbox scan enabled (skipRecovery = !forceRescan).
                Ark-coloured rather than gray because it is a real branch, not
                a refinement of the backup-file group above it. */}
            <TouchableOpacity onPress={onRecover} style={styles.seedOnlyLink}>
                <Text style={styles.seedOnlyLinkText}>{getSeedOnlyCtaLabel()}</Text>
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
                    {loc.cypherbox.account.recover_ark.pick_different_file}
                </Text>
            </TouchableOpacity>

            {canGoBack && (
                <TouchableOpacity
                    onPress={onBack}
                    style={{ alignSelf: "center", marginTop: 8, paddingVertical: 8 }}
                >
                    <Text style={{ color: colors.gray.light, fontSize: 12 }}>{loc.formatString(loc.cypherbox.account.recover_ark.back_to_unlock, { biometric: BIOMETRIC_LABEL })}</Text>
                </TouchableOpacity>
            )}
        </Animated.View>
    );
}

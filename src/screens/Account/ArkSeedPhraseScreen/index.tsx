import React, { useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, ScrollView, Switch, TouchableOpacity, View } from "react-native";
import { BlurView } from "@react-native-community/blur";
import { useRoute } from "@react-navigation/native";
import Share from "react-native-share";
import SimpleToast from "react-native-simple-toast";

import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { HeaderWithLine } from "@Cypher/components";
import { EyeVisible } from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import {
    checkArkSeedKeychainConflict,
    connectGoogleDrive,
    createArkWallet,
    getSavedSafBackupFolder,
    isGoogleDriveConnected,
    isICloudBackupAvailable,
    messageForDriveError,
    messageForSafError,
    pickSafBackupFolder,
    resetArkWalletState,
    saveArkSeedToKeychain,
    setArkBackgroundRefreshEnabled,
    writeAndVerifyArkBackup,
    writeArkBackupToTempFile,
} from "@Cypher/services/ark";
import type { DriveErrorClass, SafErrorClass } from "@Cypher/services/ark";
import useAuthStore from "@Cypher/stores/authStore";
import { colors, rtl } from "@Cypher/style-guide";
import { recordEvent } from "@Cypher/stores/eventLogStore";

import styles from "./styles";
import loc from "../../../../loc";

/**
 * Ark Keychain storage convention.
 *
 * service: 'ark-seed-phrase' — namespaced so it doesn't collide with CoinOS creds.
 * username slot: 'ark' — fixed identifier; one Ark wallet per device.
 * password slot: the BIP39 mnemonic (space-separated).
 *
 * Access control: BIOMETRY_ANY_OR_DEVICE_PASSCODE — FaceID/TouchID OR passcode.
 * Accessibility: WHEN_PASSCODE_SET_THIS_DEVICE_ONLY — never synced anywhere,
 *   readable only when device is unlocked.
 *
 * SURVIVAL ON UNINSTALL — platform diverges:
 *   - iOS: entries are OS-level Keychain items, scoped to bundle ID +
 *     accessGroup (default = bundle ID). They survive app delete-and-
 *     reinstall by the same bundle ID. This is the recovery property
 *     we depend on for iOS — user can uninstall, reinstall, and the
 *     seed is still in Keychain when they open the app again.
 *   - Android: react-native-keychain stores via Android KeyStore +
 *     EncryptedSharedPreferences (or DataStore on newer builds), all
 *     of which live inside the app's UID-scoped sandbox. When the
 *     user uninstalls, the package manager assigns a fresh UID on the
 *     next install and the OS wipes everything keyed to the old UID,
 *     including the Keystore entry. NO recovery property. The
 *     onboarding copy in the keychain row says so explicitly so users
 *     don't think the toggle gives them more than it actually does.
 *     This is the gap that contributed to the 2026-05-05 loss-event
 *     scenario — see project_play_signing_oauth.md memory.
 *
 * TODO (v2 / opt-in): iCloud Keychain sync via `synchronizable: true` and
 * `accessGroup`. Brings cross-device auto-restore but extends trust to Apple's
 * E2E. Surface as a separate, off-by-default toggle.
 */
// The keychain service/account constants and the write itself now live in
// src/services/ark/seedKeychain.ts, which also verifies that the biometric
// gate was actually applied before reporting success.

/**
 * Wallet DB backup destinations.
 *
 * The seed phrase DOES recover the Ark wallet on a new device as of bark
 * 0.6.1: the open that creates the wallet locally scans a server-side recovery
 * mailbox and re-imports the VTXOs the ASP still tracks for that seed. This
 * used to say the opposite, and that was true of pre-0.15 bark, which had no
 * rescan API at all.
 *
 * The datadir is still worth backing up. The scan is best-effort: it can fail
 * while the open still succeeds (so an empty RecoveryReport is not proof that
 * nothing is missing), VTXOs past the key-derivation gap limit are unreachable
 * by it, and pre-signed exit txs and in-flight round state are local-only and
 * not on the mailbox at all.
 *
 * Backup model:
 *   - Local auto-backup is always-on. `writeArkAutoBackup` writes an
 *     encrypted .cbark to Documents on every sync tick (see useArkSync).
 *     On iOS the file is visible in Files → On My iPhone → Cypher Box.
 *     This covers app-reinstall and data-corruption recovery.
 *   - Off-device cloud sync is opt-in. Drive on Android, transparent
 *     iCloud Drive sync of Documents on iOS. This is the only protection
 *     against device loss and is gated behind a soft warn on Continue.
 *
 * `backupDestination` is a free-form audit string; downstream code only
 * stores it for analytics, no behavior keys off it. Legacy 'icloud' /
 * 'manual' / 'auto+manual' values from older builds still round-trip. A
 * wallet created without a backup file records null.
 */
type BackupDestination = "local" | "auto+manual" | "icloud" | "manual";

const isIOS = Platform.OS === "ios";

/**
 * ArkSeedPhraseScreen — shown after CreateArkScreen when the user opts to
 * generate a fresh Ark mnemonic (i.e. NOT reusing the hot vault seed).
 *
 * Two backup decisions live on this screen — the seed and the wallet DB —
 * but they are NOT symmetric. The seed is mandatory and sufficient for a
 * best-effort recovery on its own. The DB is optional and covers what the
 * mailbox scan cannot reach, and it is useless without the seed anyway since
 * the .cbark is encrypted under a PBKDF2 key derived from that mnemonic.
 *
 * Flow:
 *   1. Display the 12-word mnemonic with tap-to-reveal blur (BIP39).
 *   2. Optional: save mnemonic to iPhone Keychain (biometric-protected).
 *   3. Pick wallet DB backup destination.
 *   4. Continue → CheckingAccountCreated (with accountType: 'ark').
 *
 * SECURITY NOTE on route.params: the mnemonic transits via React Navigation
 * params, which can appear in dev logs / deep link intents. Acceptable for
 * the mockup since no real funds are attached. For the real impl, switch to
 * a transient in-memory store (zustand `_pendingArkMnemonic`, NOT persisted).
 */
export default function ArkSeedPhraseScreen() {
    const route = useRoute();
    const { mnemonic } = (route.params || {}) as { mnemonic?: string };

    const {
        allBTCWallets,
        FirstTimeArk,
        arkUseHotVaultSeed,
        setAllBTCWallets,
        setArkAuth,
        setArkWallet,
        setFirstTimeArk,
        setArkIosBackupReminderActive,
    } = useAuthStore();

    const words: string[] = (mnemonic || "").trim().split(/\s+/).filter(Boolean);

    const [revealed, setRevealed] = useState(false);
    const [revealing, setRevealing] = useState(false);
    const [saveToKeychain, setSaveToKeychain] = useState(true);
    // Android-only: live tracking of Google Drive auth state. Probed on
    // mount + after the Connect button resolves, so the button label
    // flips to "Connected" without needing a manual refresh.
    const [driveConnected, setDriveConnected] = useState<boolean>(false);

    React.useEffect(() => {
        if (isIOS) return; // iCloud Drive sync handled by Apple, no in-app auth.
        let cancelled = false;
        isGoogleDriveConnected().then((ok) => {
            if (!cancelled) setDriveConnected(ok);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const [submitting, setSubmitting] = useState(false);
    const [keychainStatus, setKeychainStatus] = useState<null | "ok" | "err" | "cancelled">(null);

    // Backup state. Two independent channels satisfy the Continue gate
    // — one cloud, one local — chosen per platform:
    //
    //   Android:
    //     - cloudBackupDone (Drive)        — off-device, survives device loss
    //     - safBackupConfirmed (SAF folder) — local but out-of-sandbox,
    //       survives `pm uninstall`
    //
    //   iOS:
    //     - cloudBackupDone (Documents → iCloud) — local file in Documents
    //       which Apple transparently mirrors to iCloud Drive when the user
    //       enables iCloud Drive for Cypher Box. No SAF equivalent on iOS
    //       (Documents already plays both roles).
    //
    // Continue requires AT LEAST ONE channel verified. The previous version
    // also accepted a one-shot "Save backup file" share-sheet confirmation
    // as a third gate-satisfying path; that's been moved to Settings →
    // Ark Backup as a manual export action since it doesn't auto-update
    // and isn't a real backup channel — just a snapshot save. Continue
    // gate only counts auto-updating channels now.
    //
    // The strict-no-override gate stays: funds must never enter a wallet
    // without a backup the user has somewhere off this device.
    // (Loss-event 2026-05-05: Drive upload silently failed during create;
    // user got a "wallet created" toast and lost 5000 sats when uninstall
    // wiped the local copy.)
    const [cloudBackupBusy, setCloudBackupBusy] = useState(false);
    const [cloudBackupDone, setCloudBackupDone] = useState(false);
    const [driveError, setDriveError] = useState<{ cls: DriveErrorClass; message: string } | null>(null);
    const [safBackupBusy, setSafBackupBusy] = useState(false);
    const [safBackupConfirmed, setSafBackupConfirmed] = useState(false);
    const [safError, setSafError] = useState<{ cls: SafErrorClass | 'cancelled'; message: string } | null>(null);
    const [safFolderConfigured, setSafFolderConfigured] = useState(false);

    // Pick up an already-configured SAF folder from a previous session
    // (e.g. user re-installed the dev build but kept the AsyncStorage
    // entry). Doesn't probe whether it's still reachable — the actual
    // write attempt does that.
    React.useEffect(() => {
        if (isIOS) return;
        let cancelled = false;
        getSavedSafBackupFolder().then((uri) => {
            if (!cancelled) setSafFolderConfigured(!!uri);
        });
        return () => {
            cancelled = true;
        };
    }, []);
    // Track whether `createArkWallet` has been called yet on this screen.
    // The original flow created the wallet on Continue; once we let backup
    // buttons run before Continue, we have to materialise the datadir
    // earlier (otherwise the backup pipeline throws "datadir is empty").
    // Either backup button or Continue itself triggers ensureWalletCreated,
    // and the wallet-create cost is paid at most once.
    const [walletReady, setWalletReady] = useState(false);

    /**
     * Materialise the bark wallet on disk so the encrypted backup pipeline
     * has files to read. Idempotent — second and subsequent calls are
     * no-ops. Failure modes:
     *   - InvalidMnemonic: route param was malformed (shouldn't happen,
     *     CreateArkScreen generates a fresh BIP39 mnemonic before nav)
     *   - Internal / Database: usually a leftover datadir from a previous
     *     session. Same fix as before — point user at the Reset escape
     *     hatch on CreateArkScreen.
     */
    const ensureWalletCreated = async (): Promise<boolean> => {
        if (walletReady) return true;
        if (!mnemonic || !mnemonic.trim()) {
            SimpleToast.show(loc.cypherbox.account.ark_seed.no_seed, SimpleToast.LONG);
            return false;
        }
        try {
            await createArkWallet(mnemonic);
            setWalletReady(true);
            return true;
        } catch (err) {
            console.warn("[Ark] Wallet.create failed during backup setup:", err);
            const msg = (err as Error)?.message ?? "unknown error";
            // bark's error strings for "a datadir already exists on disk but
            // this seed can't open it": Internal / Database (0-byte or schema
            // residue) and "incorrect mnemonic" (the datadir was created with a
            // DIFFERENT seed, i.e. the poisoned-datadir trap left by a create that
            // died mid-flight, e.g. the esplora bot-block). All three route to
            // the user-confirmed Reset & retry below; without "incorrect
            // mnemonic" here that case dead-ended on a bare toast and the only
            // way out was reinstalling the app.
            const looksLikeStaleDatadir = /Internal|InvalidMnemonic|Database|incorrect mnemonic/i.test(msg);

            // Non-stale-datadir errors: just toast and bail. Caller retries on next tap.
            if (!looksLikeStaleDatadir) {
                SimpleToast.show(String(loc.formatString(loc.cypherbox.account.ark_seed.create_failed, { error: msg })), SimpleToast.LONG);
                return false;
            }

            // Stale-datadir trap: a previous (different-seed) Bark wallet's
            // datadir is on disk and rejects opens with this new seed.
            // Used to send the user "back to the Create screen" hoping the
            // auto-clean would fire — but that path is invisible and often
            // doesn't unblock. Offer an explicit in-context reset that
            // wipes the orphan + retries the create with the seed in hand.
            return await new Promise<boolean>((resolve) => {
                Alert.alert(
                    loc.cypherbox.account.ark_seed.stale_title,
                    loc.cypherbox.account.ark_seed.stale_body,
                    [
                        { text: loc._.cancel, style: "cancel", onPress: () => resolve(false) },
                        {
                            text: loc.cypherbox.account.ark_seed.reset_retry,
                            style: "destructive",
                            onPress: async () => {
                                try {
                                    // Preserve the keychain seed of the OLD wallet — it's not
                                    // useful without its backup file anyway, but keeping it lets
                                    // a user who recovers the backup later still unlock.
                                    await resetArkWalletState({ keepSeedInKeychain: true });
                                } catch (resetErr: any) {
                                    console.warn("[Ark] resetArkWalletState failed:", resetErr);
                                    SimpleToast.show(
                                        String(loc.formatString(loc.cypherbox.account.ark_seed.reset_failed, { error: resetErr?.message ?? loc.cypherbox.account.common.unknown_error })),
                                        SimpleToast.LONG,
                                    );
                                    resolve(false);
                                    return;
                                }
                                try {
                                    await createArkWallet(mnemonic);
                                    setWalletReady(true);
                                    resolve(true);
                                } catch (retryErr: any) {
                                    console.warn("[Ark] Wallet.create still failed after reset:", retryErr);
                                    SimpleToast.show(
                                        String(loc.formatString(loc.cypherbox.account.ark_seed.still_failed, { error: retryErr?.message ?? loc.cypherbox.account.common.unknown_error })),
                                        SimpleToast.LONG,
                                    );
                                    resolve(false);
                                }
                            },
                        },
                    ],
                    { cancelable: true, onDismiss: () => resolve(false) },
                );
            });
        }
    };

    /**
     * Primary cloud-backup path — strict, structured result.
     *
     * Android: Connect Drive (OAuth) → write local + upload to Drive →
     *          read back from Drive + decrypt + sanity-check manifest.
     *          ALL THREE must succeed before we treat the cloud backup
     *          as done. The previous version showed a success toast on
     *          local-write success even when the Drive upload silently
     *          failed (loss-event 2026-05-05).
     *
     * iOS:     Write to Documents (transparent iCloud Drive sync if the
     *          user has it on for Cypher Box). We can't probe iCloud
     *          state in-app, so the "done" semantics here are
     *          best-effort: local write succeeded. Users who want a
     *          guaranteed off-device copy on iOS use the manual
     *          share-sheet path below.
     *
     * On Drive failure: surface the classified error inline (driveError
     * state) with actionable copy, leave cloudBackupDone === false so
     * the user must either retry or take the manual path.
     */
    const handleConnectAndBackupCloud = async () => {
        if (cloudBackupBusy || cloudBackupDone) return;
        if (!revealed) {
            SimpleToast.show(loc.cypherbox.account.common.reveal_seed_first, SimpleToast.SHORT);
            return;
        }
        setCloudBackupBusy(true);
        setDriveError(null);
        try {
            if (!isIOS && !driveConnected) {
                const ok = await connectGoogleDrive();
                if (!ok) {
                    // User dismissed the Google account picker — don't
                    // promote to a hard error, they can tap again.
                    SimpleToast.show(
                        loc.cypherbox.account.ark_seed.drive_connect_failed,
                        SimpleToast.LONG,
                    );
                    return;
                }
                setDriveConnected(true);
            }

            const ready = await ensureWalletCreated();
            if (!ready) return;
            const m: string = mnemonic as string;

            const result = await writeAndVerifyArkBackup(m);

            if (!result.local.ok) {
                // Local write failure is rare (disk full, sandbox glitch).
                // Treat as hard error — neither path completed.
                Alert.alert(
                    loc.cypherbox.account.common.backup_write_failed_title,
                    String(loc.formatString(loc.cypherbox.account.common.backup_write_failed_local, { error: result.local.error })),
                );
                return;
            }

            if (isIOS) {
                // iOS — preferred path: probe iCloud Drive. Cypher Box
                // declares an iCloud Documents container (NSUbiquitousContainers
                // → iCloud.io.cypherbox.btc); when the user has iCloud Drive
                // enabled for the app, the OS provisions a sandbox-external
                // folder under that container's Documents/ subdir, and the
                // auto-tick writes the .cbark there directly (see
                // src/services/ark/backup.ts → getActiveAutoBackupPath).
                // That gives genuine off-device sync: the file appears
                // under iCloud Drive → Cypher Box on every Apple device on
                // the same Apple ID, survives uninstall, mirrors instantly
                // as VTXOs change. So when the probe says iCloud is
                // reachable, we can pass the gate without even showing
                // the share sheet — the auto-tick covers everything.
                //
                // Probe-fails fallback: manual share + explicit confirmation.
                // The user physically saves the encrypted backup somewhere
                // they trust (ideally iCloud Drive — once Cypher Box is
                // enabled in iCloud's per-app list the auto-tick takes
                // over and the manual snapshot becomes redundant), and
                // confirms via the alert. Only the explicit "I saved it"
                // tap flips the gate. Persistent reminder banner + Settings
                // dismiss flow keeps nagging the user to enable iCloud
                // Drive for the app, after which the reminder auto-clears.
                const iCloudOn = await isICloudBackupAvailable();
                if (iCloudOn) {
                    setCloudBackupDone(true);
                    SimpleToast.show(
                        loc.cypherbox.account.ark_seed.icloud_on,
                        SimpleToast.LONG,
                    );
                    return;
                }
                // Snapshot caveat for the manual fallback: the file the
                // user just shared is a one-shot snapshot. We set
                // arkIosBackupReminderActive=true unconditionally and let
                // the persistent reminder banners + the Settings dismiss
                // (which now auto-validates via the same probe) clear it
                // the moment iCloud becomes available.
                let file: { path: string; sizeBytes: number; createdAt: number };
                try {
                    file = await writeArkBackupToTempFile(m);
                } catch (writeErr: any) {
                    Alert.alert(
                        loc.cypherbox.account.common.backup_write_failed_title,
                        String(loc.formatString(loc.cypherbox.account.ark_seed.prepare_failed, { error: writeErr?.message ?? loc.cypherbox.account.common.unknown_error })),
                    );
                    return;
                }

                try {
                    await Share.open({
                        url: file.path,
                        type: 'application/octet-stream',
                        filename: 'ark-backup.cbark',
                        failOnCancel: false,
                    });
                } catch (shareErr: any) {
                    // react-native-share throws on user-cancel even with
                    // failOnCancel:false on some iOS builds. Surface only
                    // genuine errors; cancel falls through to the confirm
                    // prompt where the user can say "no, didn't save".
                    if (__DEV__) console.log("[Ark] Share open returned:", shareErr?.message ?? shareErr);
                }

                const saved = await new Promise<boolean>((resolve) => {
                    Alert.alert(
                        loc.cypherbox.account.ark_seed.saved_q_title,
                        loc.cypherbox.account.ark_seed.saved_q_body,
                        [
                            { text: loc.cypherbox.account.ark_seed.not_yet, style: "cancel", onPress: () => resolve(false) },
                            { text: loc.cypherbox.account.ark_seed.yes_saved, onPress: () => resolve(true) },
                        ],
                        { cancelable: true, onDismiss: () => resolve(false) },
                    );
                });

                if (saved) {
                    setCloudBackupDone(true);
                    setArkIosBackupReminderActive(true);
                    SimpleToast.show(loc.cypherbox.account.ark_seed.backup_saved, SimpleToast.SHORT);
                }
                return;
            }

            // SAF cross-flip: if a SAF folder was already configured, the
            // verified path wrote there too. Reflect that in state silently
            // so the gate knows about it without forcing a separate tap.
            if (result.saf.kind === 'written-and-verified') {
                setSafBackupConfirmed(true);
                setSafError(null);
            }

            // Android: branch on the structured Drive outcome.
            switch (result.drive.kind) {
                case 'uploaded-and-verified':
                    setCloudBackupDone(true);
                    SimpleToast.show(
                        loc.cypherbox.account.ark_seed.drive_verified,
                        SimpleToast.LONG,
                    );
                    break;
                case 'skipped-not-connected':
                    // Probe said connected, but at upload time we weren't.
                    // Token was likely revoked between checks. Treat as
                    // auth-token-missing.
                    setDriveError({
                        cls: 'auth-token-missing',
                        message: messageForDriveError('auth-token-missing'),
                    });
                    setDriveConnected(false);
                    break;
                case 'upload-failed':
                    setDriveError({
                        cls: result.drive.classification,
                        message: messageForDriveError(result.drive.classification),
                    });
                    if (__DEV__) {
                        console.warn("[Ark] Drive upload failed:", result.drive.classification, result.drive.error);
                    }
                    break;
                case 'verify-failed':
                    // Upload reported success but the round-trip didn't
                    // produce a decryptable manifest. Could be a Drive
                    // server issue or (worst case) the upload didn't
                    // actually persist. Treat as a verification failure
                    // and force manual fallback — refusing to call this
                    // backup "verified" is the whole point.
                    setDriveError({
                        cls: 'unknown',
                        message:
                            loc.cypherbox.account.ark_seed.drive_verify_failed,
                    });
                    if (__DEV__) {
                        console.warn("[Ark] Drive verify failed:", result.drive.error);
                    }
                    break;
                case 'skipped-platform':
                    // Unreachable on Android, but kept exhaustive.
                    break;
            }
        } catch (err: any) {
            console.warn("[Ark] Cloud backup failed:", err);
            SimpleToast.show(
                String(loc.formatString(loc.cypherbox.account.ark_seed.backup_failed, { error: err?.message ?? loc.cypherbox.account.common.unknown_error })),
                SimpleToast.LONG,
            );
        } finally {
            setCloudBackupBusy(false);
        }
    };

    const handleReveal = () => {
        setRevealing(true);
        setTimeout(() => {
            setRevealing(false);
            setRevealed(true);
        }, 800);
    };

    const persistToKeychain = async (): Promise<'ok' | 'cancelled' | 'error'> => {
        // Conflict guard: the keychain holds at most ONE Ark seed at a
        // time. If a previous wallet's seed is still there (e.g. user
        // chose "keep on device" on delete and is now creating a new
        // wallet), silently overwriting it would orphan the prior
        // wallet's biometric fast-recover path. Prompt before doing it.
        const conflict = await checkArkSeedKeychainConflict(mnemonic || "");
        if (conflict.kind === 'different-wallet' || conflict.kind === 'unreadable') {
            const ok = await new Promise<boolean>(resolve => {
                const keychainLabel = isIOS ? 'Keychain' : 'Keystore';
                const biometricLabel = isIOS ? 'Face ID' : loc.cypherbox.account.common.fingerprint;
                const message =
                    conflict.kind === 'different-wallet'
                        ? String(loc.formatString(loc.cypherbox.account.common.keychain_conflict_different, { keychain: keychainLabel, biometric: biometricLabel, fingerprint: conflict.existingFingerprint }))
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
            if (!ok) {
                // User chose to keep the existing keychain seed. NOT an
                // error — they have an explicit intent. Distinguish from
                // a real write failure below so the caller can skip the
                // error toast on this path.
                setKeychainStatus("cancelled");
                return 'cancelled';
            }
        }

        // saveArkSeedToKeychain verifies the biometric gate was actually
        // applied. A plain setGenericPassword can resolve successfully while
        // silently falling back to a NON auth-bound cipher, which stored an
        // unprotected seed and reported it as protected.
        const saved = await saveArkSeedToKeychain(mnemonic || "");
        if (saved.ok) {
            setKeychainStatus("ok");
            return 'ok';
        }
        if (saved.kind === 'no-biometric-gate') {
            console.warn('[Ark] seed NOT saved: no biometric gate, storage=', saved.storage);
            Alert.alert(
                loc.cypherbox.account.common.seed_not_saved_title,
                loc.cypherbox.account.ark_seed.seed_not_saved_body,
            );
            setKeychainStatus("err");
            return 'error';
        }
        console.warn("[Ark] Keychain save failed:", saved.reason);
        setKeychainStatus("err");
        return 'error';
    };

    /**
     * Pick a phone-storage folder via Storage Access Framework and write
     * the encrypted backup there. Android-only — iOS users have Files +
     * iCloud Drive transparency, no equivalent need.
     *
     * What this earns: a backup file in a user-controlled folder that
     * SURVIVES `pm uninstall`, unlike Documents/ark-backup.cbark and
     * unlike the Android Keystore seed entry. The single channel that
     * would have prevented the 2026-05-05 loss-event without depending
     * on Drive.
     *
     * Picking the folder also persists the URI to AsyncStorage so
     * subsequent sync ticks (writeArkAutoBackup → writeArkBackupToSaf)
     * keep the same folder updated as VTXOs change. Same auto-update
     * cadence as Drive and the local Documents file.
     */
    const handlePickAndBackupSafFolder = async () => {
        if (safBackupBusy) return;
        if (isIOS) return;
        if (!revealed) {
            SimpleToast.show(loc.cypherbox.account.common.reveal_seed_first, SimpleToast.SHORT);
            return;
        }
        setSafBackupBusy(true);
        setSafError(null);
        try {
            // pickSafBackupFolder opens the system folder chooser, takes a
            // persistable grant on the chosen URI, persists it to AsyncStorage.
            // Returns null on user cancel.
            let pickedUri: string | null = null;
            try {
                pickedUri = await pickSafBackupFolder();
            } catch (pickErr: any) {
                console.warn("[Ark/SAF] pick failed:", pickErr);
                setSafError({
                    cls: 'unknown',
                    message: messageForSafError('unknown'),
                });
                return;
            }
            if (!pickedUri) {
                // User cancelled — don't surface as a hard error, they can
                // tap again. Mark a soft "cancelled" state distinct from
                // 'native-not-loaded' / 'unknown' so the panel copy reads
                // "tap to pick again" rather than "something failed".
                setSafError({
                    cls: 'cancelled',
                    message: loc.cypherbox.account.ark_seed.no_folder_picked,
                });
                return;
            }
            setSafFolderConfigured(true);

            const ready = await ensureWalletCreated();
            if (!ready) return;
            const m: string = mnemonic as string;

            const result = await writeAndVerifyArkBackup(m);

            if (!result.local.ok) {
                Alert.alert(
                    loc.cypherbox.account.common.backup_write_failed_title,
                    String(loc.formatString(loc.cypherbox.account.common.backup_write_failed_local, { error: result.local.error })),
                );
                return;
            }

            // Drive cross-flip: same logic as the inverse path. If Drive
            // happened to be already-connected and verified, reflect it.
            if (result.drive.kind === 'uploaded-and-verified') {
                setCloudBackupDone(true);
                setDriveError(null);
            }

            switch (result.saf.kind) {
                case 'written-and-verified':
                    setSafBackupConfirmed(true);
                    SimpleToast.show(
                        loc.cypherbox.account.ark_seed.folder_verified,
                        SimpleToast.LONG,
                    );
                    break;
                case 'write-failed':
                    setSafError({
                        cls: result.saf.classification,
                        message: messageForSafError(result.saf.classification),
                    });
                    if (__DEV__) {
                        console.warn("[Ark/SAF] write failed:", result.saf.classification, result.saf.error);
                    }
                    break;
                case 'verify-failed':
                    setSafError({
                        cls: 'unknown',
                        message:
                            loc.cypherbox.account.ark_seed.folder_verify_failed,
                    });
                    if (__DEV__) {
                        console.warn("[Ark/SAF] verify failed:", result.saf.error);
                    }
                    break;
                case 'skipped-platform':
                case 'skipped-not-configured':
                    // Unreachable here (we just configured the folder), but
                    // kept exhaustive so the switch satisfies TS.
                    break;
            }
        } catch (err: any) {
            console.warn("[Ark/SAF] unexpected:", err);
            SimpleToast.show(
                String(loc.formatString(loc.cypherbox.account.ark_seed.folder_save_failed, { error: err?.message ?? loc.cypherbox.account.common.unknown_error })),
                SimpleToast.LONG,
            );
        } finally {
            setSafBackupBusy(false);
        }
    };

    const handleContinue = async () => {
        if (!revealed) {
            SimpleToast.show(loc.cypherbox.account.ark_seed.reveal_and_backup, SimpleToast.SHORT);
            return;
        }

        // BACKUP FILE: RECOMMENDED, NOT REQUIRED (owner ruling 2026-09-21).
        // The written seed is the requirement (the `revealed` check above).
        // Since bark 0.6.1 the seed alone restores the wallet through the
        // server's recovery mailbox, and the .cbark file brings back what
        // that scan can miss. Two channels (one cloud, one local) count as
        // a saved file:
        //   - cloudBackupDone: Drive upload+verified (Android) OR, on iOS,
        //     iCloud Drive on for Cypher Box (the auto-tick writes into the
        //     ubiquity container) or a share-sheet save the user confirmed.
        //   - safBackupConfirmed (Android only): user picked a Storage
        //     Access Framework folder, .cbark write+roundtrip-verified.
        //     Survives `pm uninstall`.
        //
        // Skipping the file is allowed, but never silently. This used to be
        // a hard gate (bd7be37) after the 2026-05-05 loss of 5000 sats:
        // Drive failed silently, the wallet showed "created", and uninstall
        // wiped the only copy, at a time when the seed could not restore
        // capsules on its own. So creating without a file takes an explicit
        // "Create without it" on a dialog that says what the file adds.
        const hasVerifiedBackup = cloudBackupDone || safBackupConfirmed;
        if (!hasVerifiedBackup) {
            Alert.alert(
                loc.cypherbox.account.ark_seed.no_backup_confirm_title,
                loc.cypherbox.account.ark_seed.no_backup_confirm_body,
                [
                    { text: loc.cypherbox.account.ark_seed.no_backup_confirm_save, style: 'cancel' },
                    {
                        text: loc.cypherbox.account.ark_seed.no_backup_confirm_create,
                        style: 'destructive',
                        onPress: () => { void completeArkCreate(); },
                    },
                ],
                { cancelable: true },
            );
            return;
        }

        await completeArkCreate();
    };

    // Everything after the backup decision. Reached with a saved backup file,
    // or after the user confirmed creating without one. (Not named
    // createArkWallet: that is the imported service ensureWalletCreated calls.)
    const completeArkCreate = async () => {
        setSubmitting(true);

        if (saveToKeychain) {
            const result = await persistToKeychain();
            if (result === 'error') {
                SimpleToast.show(loc.cypherbox.account.ark_seed.keychain_save_failed, SimpleToast.LONG);
            }
            // 'cancelled' = user kept the existing keychain seed by
            // choice. Silent, not a failure.
        }

        // Wallet may already exist from a backup-button tap;
        // ensureWalletCreated is idempotent.
        const created = await ensureWalletCreated();
        if (!created) {
            setSubmitting(false);
            return;
        }

        // backupDestination is an audit string. We keep the legacy
        // values ("local" / "icloud" / "manual" / "auto+manual") for
        // backwards-compat with older wallet records and pick the most
        // descriptive label for the active backup channels.
        let backupDestination: BackupDestination | null;
        if (cloudBackupDone && safBackupConfirmed) {
            backupDestination = "auto+manual";
        } else if (cloudBackupDone) {
            backupDestination = isIOS ? "icloud" : "auto+manual";
        } else if (safBackupConfirmed) {
            // SAF-only path. Tagged "manual" in the legacy string set —
            // initial decision was a manual folder pick, even though
            // subsequent updates are automatic.
            backupDestination = "manual";
        } else {
            // Created without a backup file (confirmed in handleContinue).
            // null, as RecoverArkScreen records for a restored wallet.
            backupDestination = null;
        }

        const wallet = {
            id: `ark-${Date.now()}`,
            createdAt: new Date().toISOString(),
            useHotVaultSeed: arkUseHotVaultSeed,
            keychainSaved: saveToKeychain && keychainStatus === "ok",
            backupDestination,
        };
        setArkWallet(wallet);
        setArkAuth(true);
        if (!allBTCWallets.includes("ARK")) {
            setAllBTCWallets([...allBTCWallets, "ARK"]);
        }
        // Activity log: emit AFTER the backup decision and after setArkAuth
        // has flipped — at this point the wallet is durably created and a
        // recovery path exists (the written seed, plus the file if saved).
        // Earlier emits would record half-created state if the user backed
        // out at the backup step.
        recordEvent({ kind: 'ark-created' });

        // Arm background-refresh for the new wallet. The zustand default
        // is `arkBgRefreshEnabled: true` so the toggle in ArkCapsules
        // shows ON immediately; this call flips the flag. Wrapped in
        // try/catch so a failure doesn't block the create flow. The user
        // can flip the toggle off any time from Settings.
        try {
            // requestNotificationPermission: false — do NOT prompt here. This
            // runs before CheckingAccountCreated mounts, so the OS dialog used
            // to land on the user before anything had explained what capsule
            // reminders are. That screen asks for consent on exit instead,
            // and mints the push token after a "Yes". With false, this call
            // also skips minting unless notifications are already allowed,
            // since minting from an undecided permission shows the dialog.
            await setArkBackgroundRefreshEnabled(true, { requestNotificationPermission: false });
        } catch (err) {
            console.warn("[Ark create] failed to arm reminders:", err);
        }

        setSubmitting(false);

        // Always land on the educational vault-created screen after a
        // successful create, even on subsequent wallets — the screen
        // covers Ark's self-custody invariants (capsules must be
        // refreshed, expired VTXOs can be swept, where the backup file
        // lives) and a refresher each time someone re-creates a wallet
        // is cheaper than the funds-loss risk of skipping it.
        setFirstTimeArk(false);
        dispatchNavigate("CheckingAccountCreated", { accountType: "ark" });
    };

    if (submitting) {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.ark.light} />
                    <Text style={styles.loadingText}>{loc.cypherbox.account.common.creating_ark_wallet}</Text>
                </View>
            </ScreenLayout>
        );
    }


    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <HeaderWithLine title={loc.cypherbox.account.ark_seed.header} titleColor={colors.yellow} />

                <ScrollView
                    contentContainerStyle={styles.scroll}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.content}>
                        <Text style={styles.sectionTitle}>{loc.cypherbox.account.ark_seed.seed_required}</Text>
                        <Text style={styles.warnTitle}>{loc.cypherbox.account.ark_seed.write_down}</Text>
                        <Text style={styles.warnBody}>
                            {loc.cypherbox.account.ark_seed.keep_offline}
                        </Text>

                        <View style={styles.keychainRow}>
                            <Text bold style={[styles.keychainLabel, { flex: 1 }]}>
                                {loc.formatString(loc.cypherbox.account.ark_seed.save_to, { store: isIOS ? 'iPhone Keychain' : 'Android Keystore', biometric: isIOS ? 'Face ID' : loc.cypherbox.account.common.fingerprint })}
                            </Text>
                            <Switch
                                value={saveToKeychain}
                                onValueChange={setSaveToKeychain}
                                trackColor={{ false: "#3a3a3a", true: colors.green }}
                                thumbColor={colors.white}
                            />
                        </View>

                        {keychainStatus === "ok" && (
                            <Text style={styles.statusOk}>{loc.cypherbox.account.ark_seed.saved_keychain}</Text>
                        )}
                        {keychainStatus === "err" && (
                            <Text style={styles.statusErr}>
                                {loc.cypherbox.account.ark_seed.keychain_failed_manual}
                            </Text>
                        )}

                        <Text style={styles.headerNote}>
                            {loc.formatString(loc.cypherbox.account.ark_seed.header_note, { backup_file: <Text style={{ color: '#FF5A5A' }}>{loc.cypherbox.account.ark_seed.bark_backup_file}</Text> })}
                        </Text>

                        <View style={styles.gridWrap}>
                            <View style={styles.grid}>
                                {words.map((word, idx) => (
                                    <View key={`${idx}-${word}`} style={styles.word}>
                                        <Text style={[styles.wordText, rtl.ltrText]}>{`${idx + 1}. ${word}`}</Text>
                                    </View>
                                ))}

                                {!revealed && (
                                    <>
                                        {/*
                                          BlurView is decorative only — pointerEvents="none"
                                          so it doesn't intercept taps on iOS. The interactive
                                          reveal CTA renders as a sibling overlay above it.
                                          (Native UIVisualEffectView can capture touches
                                          even when its TouchableOpacity child is on top.)
                                        */}
                                        <BlurView
                                            style={styles.blurOverlay}
                                            blurType="dark"
                                            blurAmount={9}
                                            reducedTransparencyFallbackColor="black"
                                            pointerEvents="none"
                                        />
                                        <View style={styles.revealOverlay} pointerEvents="box-none">
                                            {revealing ? (
                                                <ActivityIndicator color={colors.ark.light} />
                                            ) : (
                                                <View style={styles.revealCenter}>
                                                    <Text style={styles.revealTitle}>
                                                        {loc.cypherbox.account.ark_seed.tap_to_reveal}
                                                    </Text>
                                                    <TouchableOpacity
                                                        style={styles.revealBtn}
                                                        onPress={handleReveal}
                                                        activeOpacity={0.85}
                                                    >
                                                        <Image source={EyeVisible} />
                                                        <Text style={styles.revealBtnText}>{loc.cypherbox.account.ark_seed.reveal}</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            )}
                                        </View>
                                    </>
                                )}
                            </View>
                        </View>

                        <View style={styles.divider} />

                        {/* Section 2 — Wallet backup. Local auto-backup is the
                            default story: writeArkAutoBackup writes an encrypted
                            .cbark to Documents on every sync tick (see useArkSync),
                            and on iOS that file is visible in Files → On My iPhone
                            → Cypher Box because UIFileSharingEnabled +
                            LSSupportsOpeningDocumentsInPlace are both YES.
                            That covers app-reinstall / data-corruption recovery.
                            The cloud option below is the opt-in for device-loss
                            protection — without it, losing the phone loses the
                            local file too. Since bark 0.6.1 the seed alone DOES
                            restore VTXOs via the server recovery mailbox, but that
                            scan is best-effort (it can fail while the open still
                            succeeds, and VTXOs past the gap limit are unreachable),
                            so the file is still what covers the remainder. */}
                        <Text style={styles.sectionTitle}>{loc.cypherbox.account.ark_seed.backup_section}</Text>
                        <Text style={styles.sectionSub}>
                            {loc.formatString(loc.cypherbox.account.ark_seed.backup_section_desc, { location: isIOS ? loc.cypherbox.account.ark_seed.ios_location : loc.cypherbox.account.ark_seed.android_location })}
                        </Text>

                        {/* Optional CTA — off-device redundancy.
                            Android: Drive OAuth + first upload. Subsequent
                                     auto-backup ticks update the same Drive file.
                            iOS:     Writes to Documents (auto-syncs via iCloud
                                     Drive transparently if the user has it on
                                     for Cypher Box). We can't probe the toggle,
                                     so the copy is honest about the conditional. */}
                        <Text style={[styles.sectionSub, { marginTop: 18 }]}>
                            {loc.cypherbox.account.ark_seed.lose_phone}
                        </Text>
                        <View style={[styles.backupOption, styles.backupOptionSelected]}>
                            <View style={[styles.backupRadioOuter, styles.backupRadioOuterSelected]}>
                                <View style={styles.backupRadioInner} />
                            </View>
                            <View style={styles.backupOptionTextWrap}>
                                <Text style={styles.backupOptionLabel}>
                                    {isIOS
                                        ? loc.cypherbox.account.ark_seed.ios_option_label
                                        : loc.cypherbox.account.ark_seed.android_option_label}
                                    {cloudBackupDone ? "  ✓" : ""}
                                </Text>
                                <Text style={styles.backupOptionDetail}>
                                    {isIOS
                                        ? loc.cypherbox.account.ark_seed.ios_option_detail
                                        : loc.cypherbox.account.ark_seed.android_option_detail}
                                </Text>
                                <TouchableOpacity
                                    onPress={handleConnectAndBackupCloud}
                                    disabled={!revealed || cloudBackupBusy || cloudBackupDone}
                                    style={{
                                        marginTop: 10,
                                        paddingVertical: 11,
                                        paddingHorizontal: 16,
                                        borderRadius: 10,
                                        alignSelf: 'flex-start',
                                        backgroundColor: cloudBackupDone
                                            ? 'rgba(40, 200, 110, 0.12)'
                                            : (colors.ark?.light ?? colors.pink.default),
                                        borderWidth: cloudBackupDone ? 1 : 0,
                                        borderColor: cloudBackupDone ? colors.green : 'transparent',
                                        opacity: !revealed ? 0.45 : 1,
                                    }}
                                >
                                    {cloudBackupBusy ? (
                                        <ActivityIndicator color={colors.black.default} />
                                    ) : (
                                        <Text bold style={{
                                            color: cloudBackupDone ? colors.green : colors.black.default,
                                            fontSize: 13,
                                        }}>
                                            {cloudBackupDone
                                                ? (isIOS
                                                    ? loc.cypherbox.account.ark_seed.saved_check
                                                    : loc.cypherbox.account.ark_seed.connected_verified)
                                                : (isIOS
                                                    ? loc.cypherbox.account.ark_seed.save_backup_file
                                                    : driveError
                                                        ? loc.cypherbox.account.ark_seed.retry_connect
                                                        : loc.cypherbox.account.ark_seed.connect_save)}
                                        </Text>
                                    )}
                                </TouchableOpacity>

                                {/* Inline Drive failure with classified, actionable
                                    copy. Replaces the previous bare toast that
                                    confused build-config bugs (auth-not-configured)
                                    with transient hiccups. Disappears on retry. */}
                                {driveError && (
                                    <View style={{
                                        marginTop: 10,
                                        paddingVertical: 10,
                                        paddingHorizontal: 12,
                                        borderRadius: 8,
                                        backgroundColor: 'rgba(255, 90, 90, 0.10)',
                                        borderWidth: 1,
                                        borderColor: 'rgba(255, 90, 90, 0.35)',
                                    }}>
                                        <Text bold style={{ color: '#FF5A5A', fontSize: 13, marginBottom: 4 }}>
                                            {loc.cypherbox.account.ark_seed.drive_incomplete}
                                        </Text>
                                        <Text style={{ color: colors.white, fontSize: 12, lineHeight: 17 }}>
                                            {driveError.message}
                                        </Text>
                                    </View>
                                )}

                                {!revealed && (
                                    <Text style={{
                                        marginTop: 6,
                                        color: colors.gray.disable,
                                        fontSize: 12,
                                    }}>
                                        {loc.cypherbox.account.common.reveal_seed_first}
                                    </Text>
                                )}
                            </View>
                        </View>

                        {/* Phone-storage folder backup (Android only). The
                            only Android channel that survives `pm uninstall`
                            because the file lives in a user-chosen folder
                            outside the app sandbox. SAF write happens on
                            every sync tick after this initial pick, so the
                            file stays current as VTXOs change — same
                            cadence as Drive and the local Documents file. */}
                        {!isIOS && (
                            <View style={[
                                styles.backupOption,
                                safBackupConfirmed && styles.backupOptionSelected,
                                { marginTop: 14 },
                            ]}>
                                <View style={[
                                    styles.backupRadioOuter,
                                    safBackupConfirmed && styles.backupRadioOuterSelected,
                                ]}>
                                    <View style={styles.backupRadioInner} />
                                </View>
                                <View style={styles.backupOptionTextWrap}>
                                    <Text style={styles.backupOptionLabel}>
                                        {loc.cypherbox.account.ark_seed.folder_option_label}
                                        {safBackupConfirmed ? "  ✓" : ""}
                                    </Text>
                                    <Text style={styles.backupOptionDetail}>
                                        {loc.formatString(loc.cypherbox.account.ark_seed.folder_option_detail, { survives: <Text bold>{loc.cypherbox.account.ark_seed.survives}</Text> })}
                                    </Text>
                                    <TouchableOpacity
                                        onPress={handlePickAndBackupSafFolder}
                                        disabled={!revealed || safBackupBusy}
                                        style={{
                                            marginTop: 10,
                                            paddingVertical: 11,
                                            paddingHorizontal: 16,
                                            borderRadius: 10,
                                            alignSelf: 'flex-start',
                                            backgroundColor: safBackupConfirmed
                                                ? 'rgba(40, 200, 110, 0.12)'
                                                : (colors.ark?.light ?? colors.pink.default),
                                            borderWidth: safBackupConfirmed ? 1 : 0,
                                            borderColor: safBackupConfirmed ? colors.green : 'transparent',
                                            opacity: !revealed ? 0.45 : 1,
                                        }}
                                    >
                                        {safBackupBusy ? (
                                            <ActivityIndicator color={colors.black.default} />
                                        ) : (
                                            <Text bold style={{
                                                color: safBackupConfirmed ? colors.green : colors.black.default,
                                                fontSize: 13,
                                            }}>
                                                {safBackupConfirmed
                                                    ? loc.cypherbox.account.ark_seed.folder_linked
                                                    : safFolderConfigured
                                                        ? loc.cypherbox.account.ark_seed.repick_folder
                                                        : loc.cypherbox.account.ark_seed.pick_folder}
                                            </Text>
                                        )}
                                    </TouchableOpacity>

                                    {/* Inline SAF failure with classified copy.
                                        Same shape as the Drive error panel. */}
                                    {safError && (
                                        <View style={{
                                            marginTop: 10,
                                            paddingVertical: 10,
                                            paddingHorizontal: 12,
                                            borderRadius: 8,
                                            backgroundColor: 'rgba(255, 90, 90, 0.10)',
                                            borderWidth: 1,
                                            borderColor: 'rgba(255, 90, 90, 0.35)',
                                        }}>
                                            <Text bold style={{ color: '#FF5A5A', fontSize: 13, marginBottom: 4 }}>
                                                {loc.cypherbox.account.ark_seed.folder_incomplete}
                                            </Text>
                                            <Text style={{ color: colors.white, fontSize: 12, lineHeight: 17 }}>
                                                {safError.message}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            </View>
                        )}

                        {/* No-backup-file notice. Both options above are
                            optional (the written seed restores the wallet),
                            so this no longer blocks Create; it says what the
                            file adds, and Create asks once more before going
                            ahead without one. Kept red because skipping the
                            file is how the 5000-sat loss on 2026-05-05
                            happened, back when the seed alone could not
                            restore capsules.
                            On iOS without iCloud Drive enabled for the app,
                            users who pass the gate via manual share+confirm
                            see a persistent reminder banner in Settings →
                            Ark Backup with an inline "Re-export now" pill —
                            that's the snapshot-refresh path, no longer a
                            standalone Manual export row in the Ark Backup
                            card. The reminder + pill auto-clear when the
                            useArkSync iCloud probe sees the container come
                            online. */}
                        {revealed && !cloudBackupDone && !safBackupConfirmed && (
                            <View style={styles.warnPanel}>
                                <Text bold style={styles.warnPanelTitle}>
                                    {loc.cypherbox.account.ark_seed.no_backup_note_title}
                                </Text>
                                <Text style={styles.warnPanelBody}>
                                    {loc.cypherbox.account.ark_seed.no_backup_note_body}
                                </Text>
                            </View>
                        )}
                    </View>
                </ScrollView>

                <Button
                    text={
                        !revealed
                            ? loc.cypherbox.account.ark_seed.reveal_seed_first_btn
                            : (cloudBackupDone || safBackupConfirmed)
                                ? loc.cypherbox.account.ark_seed.backed_up_create
                                : loc.cypherbox.account.ark_seed.written_down_create
                    }
                    onPress={handleContinue}
                    style={styles.button}
                    textStyle={styles.btnText}
                />
                <TouchableOpacity onPress={() => dispatchNavigate("HomeScreen")}>
                    <Text style={styles.cancelText}>{loc._.cancel}</Text>
                </TouchableOpacity>
            </View>
        </ScreenLayout>
    );
}

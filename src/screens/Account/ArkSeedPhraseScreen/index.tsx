import React, { useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, ScrollView, Switch, TouchableOpacity, View } from "react-native";
import { BlurView } from "@react-native-community/blur";
import { useRoute } from "@react-navigation/native";
import * as Keychain from "react-native-keychain";
import Share from "react-native-share";
import SimpleToast from "react-native-simple-toast";

import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { HeaderWithLine } from "@Cypher/components";
import { EyeVisible } from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import {
    connectGoogleDrive,
    createArkWallet,
    getSavedSafBackupFolder,
    isGoogleDriveConnected,
    isICloudBackupAvailable,
    messageForDriveError,
    messageForSafError,
    pickSafBackupFolder,
    setArkBackgroundRefreshEnabled,
    writeAndVerifyArkBackup,
    writeArkBackupToTempFile,
} from "@Cypher/services/ark";
import type { DriveErrorClass, SafErrorClass } from "@Cypher/services/ark";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import { recordEvent } from "@Cypher/stores/eventLogStore";

import styles from "./styles";

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
const KEYCHAIN_SERVICE = "ark-seed-phrase";
const KEYCHAIN_ACCOUNT = "ark";

/**
 * Wallet DB backup destinations.
 *
 * The seed phrase alone CANNOT recover the Ark wallet on a new device — the
 * Bark SDK stores VTXOs, pre-signed exit txs, and round state in an on-disk
 * datadir. Without that datadir, re-deriving from the seed only gives you an
 * empty wallet (Bark recovery limitation, see Second.tech docs).
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
 * 'manual' / 'auto+manual' values from older builds still round-trip.
 */
type BackupDestination = "local" | "auto+manual" | "icloud" | "manual";

const isIOS = Platform.OS === "ios";

/**
 * ArkSeedPhraseScreen — shown after CreateArkScreen when the user opts to
 * generate a fresh Ark mnemonic (i.e. NOT reusing the hot vault seed).
 *
 * Two backup decisions live on this screen — the seed and the wallet DB —
 * because they're a coupled pair: the seed alone is useless for full
 * recovery, the DB alone is useless without the seed. Surfacing both
 * together prevents users from thinking "I wrote down the seed, I'm safe."
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
    const [keychainStatus, setKeychainStatus] = useState<null | "ok" | "err">(null);

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
            SimpleToast.show("No seed phrase available — go back and try again.", SimpleToast.LONG);
            return false;
        }
        try {
            await createArkWallet(mnemonic);
            setWalletReady(true);
            return true;
        } catch (err) {
            console.warn("[Ark] Wallet.create failed during backup setup:", err);
            const msg = (err as Error)?.message ?? "unknown error";
            const looksLikeStaleDatadir = /Internal|InvalidMnemonic|Database/i.test(msg);
            SimpleToast.show(
                looksLikeStaleDatadir
                    ? "An Ark wallet already exists on this device. Go back and tap Reset Ark wallet state, then try again."
                    : `Ark wallet creation failed: ${msg}`,
                SimpleToast.LONG,
            );
            return false;
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
            SimpleToast.show("Reveal your seed first.", SimpleToast.SHORT);
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
                        "Couldn't connect Google Drive. Make sure Play Services is up to date and try again.",
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
                    "Backup write failed",
                    `Couldn't write the encrypted backup file on this device: ${result.local.error}. Free up storage and try again.`,
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
                        'iCloud Drive is on for Cypher Box — backup syncs automatically.',
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
                        "Backup write failed",
                        `Couldn't prepare the backup file: ${writeErr?.message ?? "unknown error"}. Free up storage and try again.`,
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
                        "Did you save the backup file?",
                        "The .cbark file is encrypted with your seed phrase — safe to keep in iCloud Drive, email to yourself, or any cloud storage. Without this file plus your seed, your Ark balance can't be fully recovered.\n\nThe best path is to enable iCloud Drive for Cypher Box (iOS Settings → [your name] → iCloud → iCloud Drive → Cypher Box) — Cypher Box will then keep an encrypted copy current in your iCloud Drive automatically. Until you do that, re-export from the reminder banner in Ark Settings → Ark Backup after every Lightning receive.",
                        [
                            { text: "Not yet", style: "cancel", onPress: () => resolve(false) },
                            { text: "Yes, I saved it", onPress: () => resolve(true) },
                        ],
                        { cancelable: true, onDismiss: () => resolve(false) },
                    );
                });

                if (saved) {
                    setCloudBackupDone(true);
                    setArkIosBackupReminderActive(true);
                    SimpleToast.show("Backup saved.", SimpleToast.SHORT);
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
                        "Backup uploaded to Google Drive and verified — it will keep updating automatically.",
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
                            "Google Drive accepted the upload, but reading it back didn't return a valid backup. Save the backup file manually below to be safe.",
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
                `Backup failed: ${err?.message ?? "unknown error"}. Try again, or save the backup file manually below.`,
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

    const persistToKeychain = async (): Promise<boolean> => {
        try {
            await Keychain.setGenericPassword(KEYCHAIN_ACCOUNT, mnemonic || "", {
                service: KEYCHAIN_SERVICE,
                accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
                accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
            });
            setKeychainStatus("ok");
            return true;
        } catch (err) {
            console.warn("[Ark] Keychain save failed:", err);
            setKeychainStatus("err");
            return false;
        }
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
            SimpleToast.show("Reveal your seed first.", SimpleToast.SHORT);
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
                    message: 'No folder picked. Tap "Pick folder" to try again.',
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
                    "Backup write failed",
                    `Couldn't write the encrypted backup file on this device: ${result.local.error}. Free up storage and try again.`,
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
                        "Backup saved to your folder and verified — it will keep updating automatically.",
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
                            "The backup was written to your folder but reading it back didn't return a valid file. Try picking a different folder.",
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
                `Couldn't save the backup to that folder: ${err?.message ?? "unknown error"}.`,
                SimpleToast.LONG,
            );
        } finally {
            setSafBackupBusy(false);
        }
    };

    const handleContinue = async () => {
        if (!revealed) {
            SimpleToast.show("Please reveal and back up your seed phrase first", SimpleToast.SHORT);
            return;
        }

        // STRICT GATE: at least one verified backup destination must
        // exist before this wallet is allowed to receive funds. Two
        // channels (one cloud, one local) and the gate accepts either:
        //   - cloudBackupDone: Drive upload+verified (Android) OR local
        //     Documents write succeeded (iOS — Apple transparently
        //     mirrors Documents to iCloud Drive when the user has
        //     iCloud Drive on for Cypher Box).
        //   - safBackupConfirmed (Android only): user picked a Storage
        //     Access Framework folder, .cbark write+roundtrip-verified.
        //     Survives `pm uninstall`.
        //
        // No "Continue anyway" override. The previous version allowed
        // it and the user lost 5000 sats on 2026-05-05 when Drive
        // silently failed, the wallet showed "created", and uninstall
        // wiped the local copy. If you change this gate, re-read
        // memory/project_play_signing_oauth.md first.
        const hasVerifiedBackup = cloudBackupDone || safBackupConfirmed;
        if (!hasVerifiedBackup) {
            Alert.alert(
                "Save your backup first",
                isIOS
                    ? "Your seed phrase alone can't restore Ark funds — the encrypted backup file is required too. Tap 'Save backup file' above and save it somewhere you trust (iCloud Drive recommended)."
                    : "Your seed phrase alone can't restore Ark funds — the encrypted backup file is required too. Pick at least one: Google Drive (off-device), or a folder on this phone (survives uninstall).",
                [{ text: "OK" }],
                { cancelable: true },
            );
            return;
        }

        setSubmitting(true);

        if (saveToKeychain) {
            const ok = await persistToKeychain();
            if (!ok) {
                SimpleToast.show("Keychain save failed — please back up manually", SimpleToast.LONG);
            }
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
        let backupDestination: BackupDestination;
        if (cloudBackupDone && safBackupConfirmed) {
            backupDestination = "auto+manual";
        } else if (cloudBackupDone) {
            backupDestination = isIOS ? "icloud" : "auto+manual";
        } else {
            // SAF-only path. Tagged "manual" in the legacy string set —
            // initial decision was a manual folder pick, even though
            // subsequent updates are automatic.
            backupDestination = "manual";
        }

        const wallet = {
            id: `ark-${Date.now()}`,
            createdAt: new Date().toISOString(),
            useHotVaultSeed: arkUseHotVaultSeed,
            keychainSaved: saveToKeychain && keychainStatus !== "err",
            backupDestination,
        };
        setArkWallet(wallet);
        setArkAuth(true);
        if (!allBTCWallets.includes("ARK")) {
            setAllBTCWallets([...allBTCWallets, "ARK"]);
        }
        // Activity log: emit AFTER the strict backup gate has passed and
        // setArkAuth has flipped — at this point the wallet is durably
        // created and a recovery path exists. Earlier emits would record
        // half-created state if the user backed out at the backup gate.
        recordEvent({ kind: 'ark-created' });

        // Arm background-refresh for the new wallet. The zustand default
        // is `arkBgRefreshEnabled: true` so the toggle in ArkCapsules
        // shows ON immediately; this call does the actual work — writing
        // the bg-keychain seed copy, scheduling the AlarmManager fire,
        // subscribing to the relay's silent-push channel. Wrapped in
        // try/catch so a scheduling failure (rare — usually just means
        // the OS denied a low-priority resource) doesn't block the
        // create flow. The bg-refresh banner in WalletsView surfaces
        // any subsequent failures, and the user can flip the toggle off
        // any time from Capsules. Battery-optimisation onboarding lives
        // in the toggle's own handler — for first-time enable here we
        // skip it so the create flow finishes cleanly; users will see
        // it when they next interact with the toggle.
        try {
            await setArkBackgroundRefreshEnabled(true, mnemonic);
        } catch (err) {
            console.warn("[Ark create] failed to arm bg refresh:", err);
        }

        setSubmitting(false);

        // iOS-only post-create reminder. The user satisfied the gate via
        // manual share + confirm — they have an off-device copy, but it's
        // a snapshot. Surface the recurring action they need to take if
        // their saved location isn't iCloud Drive (which we can't probe).
        // The arkIosBackupReminderActive flag persists in zustand so a
        // separate banner — added in a follow-up — can keep nagging them
        // until they tell us iCloud Drive is on.
        if (isIOS && cloudBackupDone) {
            await new Promise<void>((resolve) => {
                Alert.alert(
                    "One thing to remember",
                    "The best path is to enable iCloud Drive for Cypher Box (iOS Settings → [your name] → iCloud → iCloud Drive → Cypher Box) — once that's on, your backup syncs automatically and this reminder goes away on its own.\n\nUntil then, the file you saved is a one-time snapshot. Open Ark Settings → Ark Backup and tap 'Re-export now' after every Lightning receive so a future restore picks up your latest funds.",
                    [{ text: "Got it", onPress: () => resolve() }],
                    { cancelable: false, onDismiss: () => resolve() },
                );
            });
        }

        if (FirstTimeArk) {
            setFirstTimeArk(false);
            dispatchNavigate("CheckingAccountCreated", { accountType: "ark" });
        } else {
            dispatchReset("HomeScreen", { isComplete: true });
        }
    };

    if (submitting) {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.ark.light} />
                    <Text style={styles.loadingText}>Creating Ark wallet…</Text>
                </View>
            </ScreenLayout>
        );
    }


    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <HeaderWithLine title="Your Ark Seed Phrase" titleColor={colors.yellow} />

                <ScrollView
                    contentContainerStyle={styles.scroll}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.content}>
                        <Text style={styles.sectionTitle}>1/2 — Seed phrase</Text>
                        <Text style={styles.warnTitle}>⚠ Write these 12 words down</Text>
                        <Text style={styles.warnBody}>
                            This phrase is the master key to your Ark wallet. Keep it offline,
                            somewhere only you can find it. Anyone with these words can spend
                            your funds.
                        </Text>
                        <Text style={styles.sectionSub}>
                            Can be saved in Keychain behind {isIOS ? 'Face ID' : 'Touch ID'}.
                        </Text>
                        <Text style={styles.headerNote}>
                            Note: even with the seed, full balance recovery on a new device
                            also requires your{' '}
                            <Text style={{ color: '#FF5A5A' }}>Ark backup file</Text>
                            {' '}— set the destination below.
                        </Text>

                        <View style={styles.gridWrap}>
                            <View style={styles.grid}>
                                {words.map((word, idx) => (
                                    <View key={`${idx}-${word}`} style={styles.word}>
                                        <Text style={styles.wordText}>{`${idx + 1}. ${word}`}</Text>
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
                                                        Tap to reveal your seed phrase
                                                    </Text>
                                                    <TouchableOpacity
                                                        style={styles.revealBtn}
                                                        onPress={handleReveal}
                                                        activeOpacity={0.85}
                                                    >
                                                        <Image source={EyeVisible} />
                                                        <Text style={styles.revealBtnText}>Reveal</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            )}
                                        </View>
                                    </>
                                )}
                            </View>
                        </View>

                        <View style={styles.divider} />

                        <View style={styles.keychainRow}>
                            <View style={{ flex: 1 }}>
                                <Text bold style={styles.keychainLabel}>
                                    {isIOS ? "iPhone Keychain" : "Android Keystore"}
                                </Text>
                                <Text style={styles.keychainSub}>
                                    {isIOS
                                        ? "Encrypted on this device, unlocked by FaceID / passcode. Survives app reinstall. Does not sync to iCloud or any other device."
                                        : "Encrypted on this device, unlocked by your screen lock / fingerprint. ⚠ Wiped if you uninstall Cypher Box (Android removes the Keystore entry when the app's UID changes), so write the 12 words down somewhere safe even with this on."}
                                </Text>
                            </View>
                            <Switch
                                value={saveToKeychain}
                                onValueChange={setSaveToKeychain}
                                trackColor={{ false: colors.gray.disable, true: colors.ark.dark }}
                                thumbColor={saveToKeychain ? colors.ark.light : colors.gray.light}
                            />
                        </View>

                        {keychainStatus === "ok" && (
                            <Text style={styles.statusOk}>✓ Saved to Keychain</Text>
                        )}
                        {keychainStatus === "err" && (
                            <Text style={styles.statusErr}>
                                ✗ Keychain save failed — please back up the words manually
                            </Text>
                        )}

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
                            local file too, and seed alone can't restore VTXOs. */}
                        <Text style={styles.sectionTitle}>2/2 — Ark backup file</Text>
                        <Text style={styles.sectionSub}>
                            Can be stored and auto-updated on this device and on your cloud.
                            Each time you send or receive, an encrypted snapshot updates in{' '}
                            {isIOS
                                ? "Files → On My iPhone → Cypher Box"
                                : "the app's local storage"}.
                            That covers app reinstalls and data corruption.
                        </Text>

                        {/* Optional CTA — off-device redundancy.
                            Android: Drive OAuth + first upload. Subsequent
                                     auto-backup ticks update the same Drive file.
                            iOS:     Writes to Documents (auto-syncs via iCloud
                                     Drive transparently if the user has it on
                                     for Cypher Box). We can't probe the toggle,
                                     so the copy is honest about the conditional. */}
                        <Text style={[styles.sectionSub, { marginTop: 18 }]}>
                            Lose the phone, though, and the local file goes with it —
                            and your seed alone can't restore Ark funds. Add an
                            optional off-device copy for device-loss protection:
                        </Text>
                        <View style={[styles.backupOption, styles.backupOptionSelected]}>
                            <View style={[styles.backupRadioOuter, styles.backupRadioOuterSelected]}>
                                <View style={styles.backupRadioInner} />
                            </View>
                            <View style={styles.backupOptionTextWrap}>
                                <Text style={styles.backupOptionLabel}>
                                    {isIOS
                                        ? "Save your backup file"
                                        : "Optional: sync backup to Google Drive"}
                                    {cloudBackupDone ? "  ✓" : ""}
                                </Text>
                                <Text style={styles.backupOptionDetail}>
                                    {isIOS
                                        ? "Opens the share sheet so you can save the encrypted ark-backup file. We recommend saving inside iCloud Drive — Cypher Box will then keep it current automatically as your VTXO capsules change. Anywhere else (email, AirDrop, local Files) works for recovery too, but you'll need to re-export after every Lightning receive. Whoever stores it sees ciphertext only."
                                        : "Connects your Google account and uploads your ark-backup file to Drive's appDataFolder — hidden from the main Drive UI, only Cypher Box can read it. Updates upload automatically as your VTXO capsules change. Google sees only ciphertext."}
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
                                                    ? "✓ Saved"
                                                    : "✓ Connected · backup verified")
                                                : (isIOS
                                                    ? "Save backup file"
                                                    : driveError
                                                        ? "Retry connect & save"
                                                        : "Connect & save backup")}
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
                                            Google Drive backup didn't complete
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
                                        Reveal your seed first.
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
                                        Save to a folder on this phone (auto-updates)
                                        {safBackupConfirmed ? "  ✓" : ""}
                                    </Text>
                                    <Text style={styles.backupOptionDetail}>
                                        Pick a folder you control — for example
                                        Internal Storage → Documents → Backups.
                                        The encrypted file is written there
                                        whenever your wallet changes, and unlike
                                        the app's private storage it{' '}
                                        <Text bold>survives uninstalling Cypher Box</Text>.
                                        Whatever stores it sees ciphertext only.
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
                                                    ? "✓ Folder linked · backup verified"
                                                    : safFolderConfigured
                                                        ? "Re-pick folder & save"
                                                        : "Pick folder & save backup"}
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
                                                Phone-folder backup didn't complete
                                            </Text>
                                            <Text style={{ color: colors.white, fontSize: 12, lineHeight: 17 }}>
                                                {safError.message}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            </View>
                        )}

                        {/* Hard-gate warning — Continue is blocked until at
                            least one backup destination is verified. Replaces
                            the prior soft-warn that allowed override (cause of
                            the 5000-sat loss on 2026-05-05).
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
                                    ⚠ Save your backup before continuing
                                </Text>
                                <Text style={styles.warnPanelBody}>
                                    Your seed phrase alone can't restore Ark
                                    funds — Bark stores per-VTXO state in an
                                    encrypted backup file we can't re-derive
                                    from the seed. Pick any one option above
                                    before creating the wallet.
                                </Text>
                            </View>
                        )}
                    </View>
                </ScrollView>

                <Button
                    text={
                        !revealed
                            ? "Reveal seed phrase first"
                            : (cloudBackupDone || safBackupConfirmed)
                                ? "I've backed it up - Create"
                                : "Save a backup first"
                    }
                    onPress={handleContinue}
                    style={styles.button}
                    textStyle={styles.btnText}
                />
                <TouchableOpacity onPress={() => dispatchNavigate("HomeScreen")}>
                    <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
            </View>
        </ScreenLayout>
    );
}

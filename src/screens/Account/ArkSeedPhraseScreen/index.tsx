import React, { useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, ScrollView, Switch, TouchableOpacity, View } from "react-native";
import { BlurView } from "@react-native-community/blur";
import { useRoute } from "@react-navigation/native";
import * as Keychain from "react-native-keychain";
import SimpleToast from "react-native-simple-toast";

import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { HeaderWithLine } from "@Cypher/components";
import { EyeVisible } from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import {
    connectGoogleDrive,
    createArkWallet,
    isGoogleDriveConnected,
    writeArkAutoBackup,
} from "@Cypher/services/ark";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";

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
 *   readable only when device is unlocked. Survives app reinstall on iOS
 *   (Keychain is OS-level), which is the recovery property we want vs.
 *   RNSecureKeyStore (cleared on uninstall).
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

    // Off-device backup state. Local auto-backup is always-on; the cloud
    // path is the optional opt-in for device-loss protection. Continue gate
    // soft-warns once if the user skipped it but still allows override.
    const [cloudBackupBusy, setCloudBackupBusy] = useState(false);
    const [cloudBackupDone, setCloudBackupDone] = useState(false);
    // Track whether `createArkWallet` has been called yet on this screen.
    // The original flow created the wallet on Continue; once we let backup
    // buttons run before Continue, we have to materialise the datadir
    // earlier (otherwise writeArkAutoBackup throws "datadir is empty").
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
     * Primary "set up auto-syncing backup" path.
     *
     * Android: Connect Google Drive (OAuth) → write+upload encrypted backup.
     *          Subsequent auto-backup ticks will keep the same Drive file
     *          updated as wallet state changes (handled inside writeArkAutoBackup).
     *
     * iOS:     Write the encrypted backup to Documents (transparent iCloud
     *          Drive sync if the user has it on for Cypher Box) AND offer
     *          a Files-app save sheet so they have an explicit iCloud Drive
     *          copy regardless of the transparent-sync toggle. Auto-update
     *          only happens when iCloud Drive sync is enabled — copy in the
     *          UI is honest about that.
     *
     * Edge cases:
     *   - Drive OAuth cancelled → silent return, button stays unconnected.
     *   - Drive upload 5xx / network down → toast, leave cloudBackupDone
     *     false so the user can retry.
     *   - Wallet creation fails (stale datadir) → toast routes to Reset.
     *   - Tapped twice while busy → busy guard blocks the second.
     */
    const handleConnectAndBackupCloud = async () => {
        if (cloudBackupBusy || cloudBackupDone) return;
        if (!revealed) {
            SimpleToast.show("Reveal your seed first.", SimpleToast.SHORT);
            return;
        }
        setCloudBackupBusy(true);
        try {
            if (!isIOS && !driveConnected) {
                const ok = await connectGoogleDrive();
                if (!ok) {
                    // Most common cause: user dismissed the Google account
                    // picker. Don't shout — they'll try again or pick the
                    // manual snapshot path.
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
            // ensureWalletCreated guarantees mnemonic is a non-empty string
            // when it returns true; narrow for TS.
            const m: string = mnemonic as string;

            // writeArkAutoBackup writes to Documents (auto-syncs via iCloud
            // Drive on iOS if enabled) AND uploads to Drive's appDataFolder
            // on Android (when isGoogleDriveConnected returns true). Same
            // function we run on every sync tick — picking the same path
            // here keeps the "first backup" byte-identical to "subsequent
            // backups" in failure-mode terms.
            await writeArkAutoBackup(m);
            setCloudBackupDone(true);
            SimpleToast.show(
                isIOS
                    ? "Backup saved. It will sync to iCloud Drive automatically if iCloud Drive is on for Cypher Box."
                    : "Backup uploaded to Google Drive — it will keep updating automatically.",
                SimpleToast.LONG,
            );
        } catch (err: any) {
            console.warn("[Ark] Cloud backup failed:", err);
            SimpleToast.show(
                `Backup failed: ${err?.message ?? "unknown error"} — try again, or skip and continue with local-only backup.`,
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

    const handleContinue = async () => {
        if (!revealed) {
            SimpleToast.show("Please reveal and back up your seed phrase first", SimpleToast.SHORT);
            return;
        }

        // Local auto-backup is always-on (writeArkAutoBackup runs every sync
        // cycle). It protects against app reinstall / data corruption but NOT
        // against device loss — if the phone is lost or broken, the local
        // .cbark goes with it. The cloud option is the only protection
        // against device loss. Soft-warn (single nudge, override allowed)
        // when the user skipped it; the seed-only recovery path can't
        // restore VTXOs.
        if (!cloudBackupDone) {
            const proceed = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    "No off-device backup",
                    isIOS
                        ? "Your wallet is backed up on this device automatically, but if you lose this phone the encrypted file goes with it — your seed alone can't restore Ark funds. Want to add iCloud Drive sync first?"
                        : "Your wallet is backed up on this device automatically, but if you lose this phone the encrypted file goes with it — your seed alone can't restore Ark funds. Want to connect Google Drive first?",
                    [
                        { text: "Add cloud backup", onPress: () => resolve(false), style: "cancel" },
                        { text: "Continue anyway", onPress: () => resolve(true), style: "destructive" },
                    ],
                    { cancelable: true, onDismiss: () => resolve(false) },
                );
            });
            if (!proceed) return;
        }

        setSubmitting(true);

        if (saveToKeychain) {
            const ok = await persistToKeychain();
            if (!ok) {
                SimpleToast.show("Keychain save failed — please back up manually", SimpleToast.LONG);
            }
        }

        // Wallet may already exist from a backup-button tap; ensureWalletCreated
        // is idempotent. If neither button was tapped (continued through the
        // soft-warn), we create the wallet here for the first time.
        const created = await ensureWalletCreated();
        if (!created) {
            setSubmitting(false);
            return;
        }

        const wallet = {
            id: `ark-${Date.now()}`,
            createdAt: new Date().toISOString(),
            useHotVaultSeed: arkUseHotVaultSeed,
            keychainSaved: saveToKeychain && keychainStatus !== "err",
            backupDestination: cloudBackupDone
                ? (isIOS ? "icloud" : "auto+manual")
                : "local",
        };
        setArkWallet(wallet);
        setArkAuth(true);
        if (!allBTCWallets.includes("ARK")) {
            setAllBTCWallets([...allBTCWallets, "ARK"]);
        }

        setSubmitting(false);

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
                                    iPhone Keychain
                                </Text>
                                <Text style={styles.keychainSub}>
                                    Encrypted on this device, unlocked by FaceID / passcode.
                                    Survives app reinstall. Does not sync to iCloud or any other device.
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
                                        ? "Optional: sync backup to iCloud Drive"
                                        : "Optional: sync backup to Google Drive"}
                                    {cloudBackupDone ? "  ✓" : ""}
                                </Text>
                                <Text style={styles.backupOptionDetail}>
                                    {isIOS
                                        ? "If iCloud Drive is on for Cypher Box (iOS Settings → Apple ID → iCloud → Cypher Box), your ark-backup file syncs off-device and updates whenever your VTXOs change. Apple sees only ciphertext."
                                        : "Connects your Google account and uploads your ark-backup file to Drive's appDataFolder — hidden from the main Drive UI, only Cypher Box can read it. Updates upload automatically as your VTXOs change. Google sees only ciphertext."}
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
                                                    ? "✓ Saved · syncs via iCloud Drive"
                                                    : "✓ Connected · backup saved")
                                                : (isIOS
                                                    ? "Save backup now"
                                                    : "Connect & save backup")}
                                        </Text>
                                    )}
                                </TouchableOpacity>
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

                        {/* Soft warning — local backup is fine for most failures
                            but device loss kills it. Single nudge; Continue still
                            allows override via the alert in handleContinue. */}
                        {revealed && !cloudBackupDone && (
                            <View style={styles.warnPanel}>
                                <Text bold style={styles.warnPanelTitle}>
                                    ⚠ No off-device backup
                                </Text>
                                <Text style={styles.warnPanelBody}>
                                    Local auto-backup protects against reinstalls and
                                    corruption, but not device loss. Without an
                                    off-device copy, losing this phone means your
                                    seed alone can't recover your Ark balance —
                                    Bark stores per-VTXO state we can't re-derive.
                                </Text>
                            </View>
                        )}
                    </View>
                </ScrollView>

                <Button
                    text={revealed ? "I've backed it up - Create" : "Reveal seed phrase first"}
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

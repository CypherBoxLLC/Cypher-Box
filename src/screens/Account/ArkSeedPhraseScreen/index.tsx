import React, { useState } from "react";
import { ActivityIndicator, Image, Platform, ScrollView, Switch, TouchableOpacity, View } from "react-native";
import { BlurView } from "@react-native-community/blur";
import { useRoute } from "@react-navigation/native";
import * as Keychain from "react-native-keychain";
import SimpleToast from "react-native-simple-toast";

import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { HeaderWithLine } from "@Cypher/components";
import { EyeVisible } from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { createArkWallet } from "@Cypher/services/ark";
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
 * v1 strategy: encrypt the datadir locally with a key derived from the seed
 * (HKDF), then upload the opaque ciphertext to one of:
 *   - 'icloud'   → iCloud Drive (iOS) / Google Drive (Android). Zero-friction
 *                  default. Provider sees only ciphertext.
 *   - 'manual'   → User-driven file export only (paranoid mode escape hatch).
 *
 * Deliberately excluded:
 *   - Cypher Box VPS as a backup target — declining to operate a recovery
 *     service avoids custody-adjacent regulatory ambiguity and removes a
 *     forever-cost / single-point-of-failure dependency on us.
 *   - "No backup" option — outright footgun; we don't want to ship a path
 *     where users can lose their balance just by tapping through defaults.
 *     If a user truly wants no backup they can opt for "Manual export" and
 *     simply never run the export.
 *
 * The actual upload pipeline is built later — this screen just persists the
 * user's chosen destination so the post-creation backup task picks it up.
 */
type BackupDestination = "icloud" | "manual";

const isIOS = Platform.OS === "ios";
const cloudLabel = isIOS ? "iCloud Drive" : "Google Drive";

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
    const [backupDest, setBackupDest] = useState<BackupDestination>("icloud");
    const [submitting, setSubmitting] = useState(false);
    const [keychainStatus, setKeychainStatus] = useState<null | "ok" | "err">(null);

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
        setSubmitting(true);

        if (saveToKeychain) {
            const ok = await persistToKeychain();
            if (!ok) {
                SimpleToast.show("Keychain save failed — please back up manually", SimpleToast.LONG);
            }
        }

        try {
            await createArkWallet(mnemonic || "");
        } catch (err) {
            console.warn("[Ark] Wallet.create failed:", err);
            // Most common cause: a datadir from a previous wallet is still on
            // disk, so both `Wallet.open` (wrong seed) and `Wallet.create`
            // (datadir occupied) fail. Point the user at the Reset escape
            // hatch on CreateArkScreen rather than leaving them stuck.
            const msg = (err as Error)?.message ?? "unknown error";
            const looksLikeStaleDatadir = /Internal|InvalidMnemonic/i.test(msg);
            SimpleToast.show(
                looksLikeStaleDatadir
                    ? "An Ark wallet already exists on this device. Go back and tap Reset Ark wallet state, then try again."
                    : `Ark wallet creation failed: ${msg}`,
                SimpleToast.LONG,
            );
            setSubmitting(false);
            return;
        }

        const wallet = {
            id: `ark-${Date.now()}`,
            createdAt: new Date().toISOString(),
            useHotVaultSeed: arkUseHotVaultSeed,
            keychainSaved: saveToKeychain && keychainStatus !== "err",
            backupDestination: backupDest,
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

    const renderBackupOption = (
        value: BackupDestination,
        label: string,
        detail: string,
        tag: { text: string; style: "rec" | "opt" | "warn" } | null,
    ) => {
        const selected = backupDest === value;
        return (
            <TouchableOpacity
                key={value}
                style={[styles.backupOption, selected && styles.backupOptionSelected]}
                onPress={() => setBackupDest(value)}
                activeOpacity={0.7}
            >
                <View
                    style={[
                        styles.backupRadioOuter,
                        selected && styles.backupRadioOuterSelected,
                    ]}
                >
                    {selected && <View style={styles.backupRadioInner} />}
                </View>
                <View style={styles.backupOptionTextWrap}>
                    <Text style={styles.backupOptionLabel}>{label}</Text>
                    <Text style={styles.backupOptionDetail}>{detail}</Text>
                    {tag && (
                        <Text
                            style={
                                tag.style === "rec"
                                    ? styles.backupTagRecommended
                                    : tag.style === "warn"
                                    ? styles.backupTagWarn
                                    : styles.backupTagOptIn
                            }
                        >
                            {tag.text}
                        </Text>
                    )}
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <HeaderWithLine title="Your Ark Seed Phrase" />

                <ScrollView
                    contentContainerStyle={styles.scroll}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.content}>
                        <Text style={styles.warnTitle}>⚠ Write these 12 words down</Text>
                        <Text style={styles.warnBody}>
                            This phrase is the master key to your Ark wallet. Keep it offline,
                            somewhere only you can find it. Anyone with these words can spend
                            your funds.
                        </Text>
                        <Text style={styles.headerNote}>
                            Note: even with the seed, full balance recovery on a new device
                            also requires your wallet backup — set the destination below.
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
                                                    <Text style={styles.revealDetail}>
                                                        Make sure no one is watching your screen.
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

                        {/* Section 1 — Mnemonic convenience storage */}
                        <Text style={styles.sectionTitle}>Save seed to device</Text>
                        <Text style={styles.sectionSub}>
                            Convenience copy of the 12 words on this device only.
                        </Text>

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

                        {/* Section 2 — Wallet DB backup destination (the actual recovery layer) */}
                        <Text style={styles.sectionTitle}>Wallet backup destination</Text>
                        <Text style={styles.sectionSub}>
                            The seed alone can't restore your Ark balance — Bark also needs a
                            copy of your wallet state. We encrypt it locally (no one else can
                            read it) and upload to:
                        </Text>

                        {renderBackupOption(
                            "icloud",
                            cloudLabel,
                            `Automatic, encrypted with your seed before upload. ${
                                isIOS ? "Apple" : "Google"
                            } sees only ciphertext.`,
                            { text: "Recommended", style: "rec" },
                        )}
                        {renderBackupOption(
                            "manual",
                            "Manual export only",
                            "You export an encrypted file yourself. No automatic uploads.",
                            { text: "Power user", style: "opt" },
                        )}
                    </View>
                </ScrollView>

                <Button
                    text={revealed ? "I've backed it up — Continue" : "Reveal seed phrase first"}
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

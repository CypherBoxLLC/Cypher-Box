import React, { useContext, useState } from "react";
import { Switch, View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import { PrivateKeyGenerater, Tips } from "@Cypher/components";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import useAuthStore from "@Cypher/stores/authStore";
import { backupHotVaultSeedWithMeta } from "@Cypher/services/hotVaultKeychain";
import { recordEvent } from "@Cypher/stores/eventLogStore";

/**
 * SavingVault — the second screen of the hot-vault creation flow.
 *
 * Flow: HomeScreen → "Unlock Hot Vault" → SavingVaultIntro (Generate Private
 * Key) → SavingVault (this screen, displays 12-word seed) → SavingVaultCreated.
 *
 * At this point `SavingVaultIntro` has already:
 *   - called `w.generate()` to produce a BIP39 mnemonic
 *   - persisted the wallet via `addWallet(w) + saveToDisk()` (encrypted storage)
 *   - saved `walletID = w.getID()` into zustand
 *
 * This screen adds a per-session opt-in: "also save the mnemonic to the OS
 * Keychain (FaceID/passcode-gated)". We defer the actual Keychain write
 * until the user confirms they've written the seed down, so declining the
 * continue button cancels the Keychain save as well.
 *
 * The Keychain copy is convenience storage for re-install recovery. Primary
 * custody is still BlueWallet's encrypted disk store; losing that while
 * keeping Keychain gives the user a biometric unlock path back into their
 * seed without having to type 12 words.
 */
export default function SavingVault() {
    const [isValidate, setIsValidate] = useState(false);
    const [saveToKeychain, setSaveToKeychain] = useState(true);
    const [keychainStatus, setKeychainStatus] = useState<null | "ok" | "err">(
        null,
    );
    const [submitting, setSubmitting] = useState(false);

    const walletID = useAuthStore(s => s.walletID);
    const setHotVaultKeychainBackup = useAuthStore(s => s.setHotVaultKeychainBackup);
    const { wallets } = useContext(BlueStorageContext);

    const nextClickInitiate = () => {
        setIsValidate(true);
    };

    const nextClickHandler = async () => {
        if (submitting) return;
        setSubmitting(true);

        if (saveToKeychain) {
            // Re-resolve the wallet at tap time rather than caching it across
            // renders — the user might have navigated in from a deep link
            // with a stale storage-context snapshot.
            const wallet = wallets.find((w: any) => w.getID() === walletID);
            const mnemonic = wallet?.getSecret?.();

            if (!walletID || !mnemonic) {
                // Extremely unlikely — walletID is set in SavingVaultIntro
                // right before navigation. If we land here something's off
                // but we don't want to block seed-confirmation on it.
                console.warn(
                    "[HotVault] Skipping Keychain save — walletID or mnemonic missing",
                );
                setKeychainStatus("err");
                SimpleToast.show(
                    "Keychain save skipped — you can enable it later in vault settings",
                    SimpleToast.LONG,
                );
            } else {
                // Write BOTH the mnemonic (biometric-gated) and the
                // unprotected meta sidecar (createdAt timestamp) so the
                // recovery picker can show a human-readable row later —
                // even if the user ends up with multiple backups stacked
                // on the same device. Seed is written first; a meta-only
                // failure is logged and swallowed inside the helper.
                const result = await backupHotVaultSeedWithMeta(
                    walletID,
                    mnemonic,
                    {
                        createdAt: Date.now(),
                        // No passphrase flag. Recording whether this vault has a
                        // passphrase is what let the recovery flow announce a
                        // hidden wallet exists, defeating the point of having
                        // one. Keychain recovery is passphrase-agnostic now: it
                        // opens the words as-is and stays silent. See
                        // HotVaultMeta in services/hotVaultKeychain.
                    },
                );
                if (result.ok) {
                    setKeychainStatus("ok");
                    setHotVaultKeychainBackup(walletID, true);
                } else {
                    setKeychainStatus("err");
                    console.warn(
                        "[HotVault] Keychain save failed:",
                        result.error,
                    );
                    SimpleToast.show(
                        "Keychain save failed — please back up the 12 words manually",
                        SimpleToast.LONG,
                    );
                    // Intentional: we do NOT abort the flow here. The seed
                    // is already persisted in the encrypted wallet store;
                    // the Keychain copy is an optional convenience layer.
                }
            }
        }

        setSubmitting(false);
        // Activity log: emit AFTER seed-confirmation rather than at
        // wallet-generation in SavingVaultIntro — a user who backs out
        // before this point hasn't actually committed to having a Hot
        // Vault yet, even though the wallet object already exists.
        recordEvent({ kind: 'hot-vault-created' });
        dispatchNavigate("SavingVaultCreated");
    };

    return (
        <ScreenLayout
            showToolbar
            progress={1}
            color={[colors.green, colors.green]}
            isBackButton={false}
            isClose
        >
            <View style={styles.container}>
                <Text style={styles.title} center>
                    Private Key Generated
                </Text>
                <Text h4 style={styles.descption} center>
                    Write this backup copy on a piece of paper
                </Text>
                {/* Passphrase vaults: the words alone are NOT the full
                    backup. Remind here, at the moment the paper backup is
                    being written, per the creation-screen guidance
                    (memorise it and include it on the paper). The
                    passphrase itself is never displayed. */}
                {!!(wallets.find((w: any) => w.getID() === walletID)?.getPassphrase?.()) && (
                    <Text center style={{ color: '#FFD54F', fontSize: 12, lineHeight: 17, marginTop: 6, marginHorizontal: 16 }}>
                        ⚠ This vault has a passphrase. Recovery needs these 12 words AND your passphrase. Write both on your paper backup.
                    </Text>
                )}
                <PrivateKeyGenerater callNext={nextClickInitiate} />
                <Tips />

                {/*
                  Opt-in Keychain backup. Default ON — lines up with user
                  expectations of "iOS apps remember things" while still
                  letting power users opt out. We don't block the Continue
                  button on this; it's additive to the paper backup, not a
                  replacement.
                */}
                <View style={styles.keychainRow}>
                    <View style={styles.keychainTextWrap}>
                        <Text bold style={styles.keychainLabel}>
                            Also save to iPhone Keychain
                        </Text>
                        <Text style={styles.keychainSub}>
                            Encrypted on this device, unlocked by FaceID /
                            passcode. Survives app reinstall. Does not sync to
                            iCloud.
                        </Text>
                    </View>
                    <Switch
                        value={saveToKeychain}
                        onValueChange={setSaveToKeychain}
                        trackColor={{
                            false: colors.gray.disable,
                            true: colors.green,
                        }}
                        thumbColor={colors.white}
                    />
                </View>

                {keychainStatus === "ok" && (
                    <Text style={styles.keychainStatusOk}>
                        ✓ Saved to Keychain
                    </Text>
                )}
                {keychainStatus === "err" && (
                    <Text style={styles.keychainStatusErr}>
                        ✗ Keychain save failed — paper backup still required
                    </Text>
                )}

                <Button
                    text={submitting ? "Saving…" : "Ok, I wrote it down!"}
                    onPress={nextClickHandler}
                    style={styles.button}
                    textStyle={styles.btnText}
                    disabled={!isValidate || submitting}
                />
            </View>
        </ScreenLayout>
    );
}

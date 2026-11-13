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
import { hotVaultKeychainText } from "@Cypher/helpers/hotVaultKeychainText";
import loc from "../../../loc";

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
 * Keychain (Face ID/passcode-gated on iOS, fingerprint-gated on Android)".
 * We defer the actual Keychain write until the user confirms they've written
 * the seed down, so declining the continue button cancels the Keychain save
 * as well.
 *
 * The Keychain copy is convenience storage. On iOS it also covers a
 * re-install; on Android it is deleted with the app, so the switch text
 * differs per platform (helpers/hotVaultKeychainText). Primary custody is
 * still BlueWallet's encrypted disk store; losing that while keeping the
 * Keychain copy gives the user a biometric unlock path back into their seed
 * without having to type 12 words.
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
    // a signing phone keeps no second copy of the seed, so there's no Keychain backup to offer
    const signingMode = useAuthStore(s => s.signingMode);
    const { wallets } = useContext(BlueStorageContext);
    // iPhone Keychain or Android Keystore wording, in the current language
    const keychainText = hotVaultKeychainText().create;

    const nextClickInitiate = () => {
        setIsValidate(true);
    };

    const nextClickHandler = async () => {
        if (submitting) return;
        setSubmitting(true);

        if (saveToKeychain && !signingMode) {
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
                    keychainText.skippedToast,
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
                } else if (result.kind === "no-biometric-gate") {
                    // Android only: the OS handed back a cipher that is NOT
                    // bound to a fingerprint, so the helper deleted the
                    // un-gated entry instead of leaving the seed readable with
                    // no prompt. Tell the truth, and do NOT flip the backup
                    // flag, so the UI never claims a protection that is absent.
                    setKeychainStatus("err");
                    console.warn(
                        "[HotVault] Keychain save rejected, no biometric gate (storage=",
                        result.storage,
                        ")",
                    );
                    SimpleToast.show(
                        loc.cypherbox.vault.saving_vault.keychain_no_fingerprint,
                        SimpleToast.LONG,
                    );
                } else {
                    setKeychainStatus("err");
                    console.warn(
                        "[HotVault] Keychain save failed:",
                        result.error,
                    );
                    SimpleToast.show(
                        keychainText.failedToast,
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
                    {loc.cypherbox.vault.saving_vault.title}
                </Text>
                <Text h4 style={styles.descption} center>
                    {loc.cypherbox.vault.saving_vault.write_backup}
                </Text>
                {/* Passphrase vaults: the words alone are NOT the full
                    backup. Remind here, at the moment the paper backup is
                    being written, per the creation-screen guidance
                    (memorise it and include it on the paper). The
                    passphrase itself is never displayed. */}
                {!!(wallets.find((w: any) => w.getID() === walletID)?.getPassphrase?.()) && (
                    <Text center style={{ color: '#FFD54F', fontSize: 12, lineHeight: 17, marginTop: 6, marginHorizontal: 16 }}>
                        {loc.cypherbox.vault.saving_vault.passphrase_reminder}
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
                {!signingMode && <View style={styles.keychainRow}>
                    <View style={styles.keychainTextWrap}>
                        <Text bold style={styles.keychainLabel}>
                            {keychainText.label}
                        </Text>
                        <Text style={styles.keychainSub}>
                            {keychainText.sub}
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
                </View>}

                {keychainStatus === "ok" && (
                    <Text style={styles.keychainStatusOk}>
                        {keychainText.saved}
                    </Text>
                )}
                {keychainStatus === "err" && (
                    <Text style={styles.keychainStatusErr}>
                        {keychainText.failed}
                    </Text>
                )}

                <Button
                    text={submitting ? loc.cypherbox.vault.saving_vault.saving : loc.cypherbox.vault.saving_vault.wrote_it_down}
                    onPress={nextClickHandler}
                    style={styles.button}
                    textStyle={styles.btnText}
                    disabled={!isValidate || submitting}
                />
            </View>
        </ScreenLayout>
    );
}

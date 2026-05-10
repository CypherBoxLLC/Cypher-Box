import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Switch, TouchableOpacity, View } from "react-native";
import { generateMnemonic as barkGenerateMnemonic } from "@secondts/bark-react-native";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { HeaderWithLine } from "@Cypher/components";
import { dispatchNavigate } from "@Cypher/helpers";
import { dispatchReset } from "@Cypher/helpers/navigation";
import {
    getArkWalletHandle,
    hasArkDatadir,
    resetArkWalletState,
    restoreArkWalletFromDisk,
} from "@Cypher/services/ark";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import { recordEvent } from "@Cypher/stores/eventLogStore";
import styles from "./styles";

/**
 * CreateArkScreen — Ark wallet creation flow.
 *
 * Before showing the create form, we check whether an Ark wallet already
 * lives on disk (datadir + optional Keychain mnemonic). If it does, we show
 * an "existing wallet" panel instead — offering Open (silent reopen from
 * Keychain) and, in __DEV__, Reset (nuke datadir + Keychain so the user can
 * start clean). This fixes the drift where zustand was cleared but the
 * datadir survived, leaving no Ark card on home AND a broken create path.
 *
 * Seed source for a fresh create:
 *   (1) Generate a new seed (default)
 *   (2) Reuse the Hot Vault seed (toggle, only if hot vault exists)
 *
 * On create, a fresh seed flow navigates to ArkSeedPhraseScreen, which is
 * where the real `Wallet.create` call lives (alongside the Keychain save).
 */
export default function CreateArkScreen() {
    const {
        allBTCWallets,
        walletID,
        FirstTimeArk,
        arkUseHotVaultSeed,
        isArkAuth,
        setAllBTCWallets,
        setArkAuth,
        setArkWallet,
        setArkUseHotVaultSeed,
        setFirstTimeArk,
        clearArkAuth,
    } = useAuthStore();
    const [loading, setLoading] = useState(false);
    const [existingCheck, setExistingCheck] = useState<"checking" | "none" | "exists">("checking");
    const [openingExisting, setOpeningExisting] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [existingError, setExistingError] = useState<string | null>(null);
    const hasHotVault = !!walletID;

    useEffect(() => {
        (async () => {
            const exists = await hasArkDatadir();
            if (!exists) {
                setExistingCheck("none");
                return;
            }

            // Datadir exists. Distinguish "live, healthy wallet" from
            // "orphan datadir from an interrupted create / recover."
            //
            // Heuristic without re-prompting biometric (the boot hook in
            // useArkRestoreOnBoot already triggered the prompt once and
            // either set the in-memory handle + zustand auth, or reported
            // 'needs-reset' and bailed out):
            //
            //   live handle  → wallet is operational, show "Open existing"
            //   isArkAuth    → zustand says authed, even if handle is null
            //                  (Metro reload edge case; restore will re-open
            //                  silently via the "already-open" short-circuit
            //                  inside restoreArkWalletFromDisk)
            //   neither      → orphan: datadir on disk but no live state.
            //                  Auto-clean silently (preserve keychain in
            //                  case the still-stored seed maps to a `.cbark`
            //                  the user will recover later).
            //
            // Auto-clean is a destructive operation but the only state it
            // wipes is the local `${docDir}/ark-datadir/` — backup files at
            // every destination are preserved (multi-wallet PR invariant).
            // If a user actually had funds in this orphan datadir, those
            // funds are still recoverable via the matching `.cbark` file.
            const handle = getArkWalletHandle();
            if (handle || isArkAuth) {
                setExistingCheck("exists");
                return;
            }

            try {
                if (__DEV__) console.log('[CreateArkScreen] orphan datadir detected — auto-cleaning');
                await resetArkWalletState({ keepSeedInKeychain: true });
            } catch (err: any) {
                console.warn('[CreateArkScreen] orphan auto-clean failed:', err?.message ?? err);
                // Fall back to showing the existing-wallet branch with the
                // (DEV-gated) Reset button. Users in a release build hitting
                // this fallback can navigate to RecoverArkScreen and recover
                // from a `.cbark`, which wipes the datadir as part of restore.
                setExistingCheck("exists");
                return;
            }
            setExistingCheck("none");
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleOpenExisting = async () => {
        setOpeningExisting(true);
        setExistingError(null);
        try {
            const result = await restoreArkWalletFromDisk();
            if (!result.restored) {
                // `already-open` is a success path too — the handle is live
                // (Metro reload kept it, or another tab restored it) so we
                // just flip zustand and head home.
                if (result.reason !== "already-open") {
                    setExistingError(
                        result.reason === "no-keychain"
                            ? "Seed phrase isn't on this device — tap Reset to start over."
                            : result.reason === "open-failed"
                            ? "Wallet state and seed don't match — tap Reset to start over."
                            : `Couldn't reopen wallet (${result.reason}).`,
                    );
                    setOpeningExisting(false);
                    return;
                }
            }

            setArkWallet({
                id: `ark-${Date.now()}`,
                createdAt: new Date().toISOString(),
                useHotVaultSeed: false,
                restored: true,
            });
            setArkAuth(true);
            if (!allBTCWallets.includes("ARK")) {
                setAllBTCWallets([...allBTCWallets, "ARK"]);
            }
            recordEvent({ kind: 'ark-recovered' });
            setOpeningExisting(false);
            dispatchReset("HomeScreen", { isComplete: true });
        } catch (err) {
            setExistingError((err as Error)?.message ?? "Failed to open existing wallet");
            setOpeningExisting(false);
        }
    };

    const handleResetExisting = () => {
        Alert.alert(
            "Reset Ark wallet?",
            "This wipes your Ark wallet on this device. Without a backup file saved somewhere off-device, your VTXO capsules can't be recovered.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Reset",
                    style: "destructive",
                    onPress: async () => {
                        setResetting(true);
                        try {
                            await resetArkWalletState();
                        } finally {
                            clearArkAuth();
                            setExistingCheck("none");
                            setExistingError(null);
                            setResetting(false);
                        }
                    },
                },
            ],
        );
    };

    const handleCreate = async () => {
        setLoading(true);

        // Branch on seed source:
        //   - Hot Vault seed reuse: skip the seed phrase screen entirely
        //     (user has already backed up that mnemonic during hot vault
        //     creation). Mock-init and head to CheckingAccountCreated.
        //   - Fresh seed: generate a real BIP39 12-word mnemonic, hand it to
        //     ArkSeedPhraseScreen which does the actual Bark wallet init.
        if (arkUseHotVaultSeed && hasHotVault) {
            await new Promise((r) => setTimeout(r, 600));

            const wallet = {
                id: `ark-${Date.now()}`,
                createdAt: new Date().toISOString(),
                useHotVaultSeed: true,
            };
            setArkWallet(wallet);
            setArkAuth(true);
            if (!allBTCWallets.includes("ARK")) {
                setAllBTCWallets([...allBTCWallets, "ARK"]);
            }
            // Activity log: hot-vault-seed-reuse path is the canonical
            // creation moment for this branch. The fresh-seed branch
            // emits later in ArkSeedPhraseScreen, after Wallet.create.
            recordEvent({ kind: 'ark-created' });

            setLoading(false);

            if (FirstTimeArk) {
                setFirstTimeArk(false);
                dispatchNavigate("CheckingAccountCreated", { accountType: "ark" });
            } else {
                dispatchReset("HomeScreen", { isComplete: true });
            }
            return;
        }

        const mnemonic = barkGenerateMnemonic();
        setLoading(false);
        dispatchNavigate("ArkSeedPhraseScreen", { mnemonic });
    };

    if (loading || existingCheck === "checking") {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.ark.light} />
                    <Text style={styles.loadingText}>
                        {loading ? "Creating Ark wallet…" : "Checking Ark state…"}
                    </Text>
                </View>
            </ScreenLayout>
        );
    }

    if (existingCheck === "exists") {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.container}>
                    <HeaderWithLine title="Existing Ark Wallet" />

                    <View style={styles.content}>
                        <Text style={styles.warnTitle}>An Ark wallet already exists</Text>
                        <Text style={styles.warnBody}>
                            An Ark wallet was found on this device. Open it to resume
                            using the seed in your Keychain.
                        </Text>
                        <Text style={styles.warnBody}>
                            If this wallet isn't yours, or the seed no longer matches, tap
                            Reset to delete everything and start over.
                        </Text>

                        {existingError && (
                            <Text style={styles.errorText}>{existingError}</Text>
                        )}
                    </View>

                    <Button
                        text={openingExisting ? "Opening…" : "Open existing wallet"}
                        onPress={handleOpenExisting}
                        style={styles.button}
                        textStyle={styles.btnText}
                        disabled={openingExisting || resetting}
                    />
                    {__DEV__ && (
                        <TouchableOpacity onPress={handleResetExisting} disabled={resetting}>
                            <Text style={styles.resetText}>
                                {resetting ? "Resetting…" : "Reset Ark wallet state (DEV)"}
                            </Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => dispatchNavigate("HomeScreen")}>
                        <Text style={styles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                </View>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <HeaderWithLine title="Create Ark Wallet" />

                <View style={styles.content}>
                    <Text style={styles.warnTitle}>⚠ Experimental</Text>
                    <Text style={styles.warnBody}>
                        Ark is a new Bitcoin Layer 2 protocol (by Second.tech). It enables
                        cheap non-custodial Lightning-style payments — but the SDK is pre-1.0
                        and wallet recovery from seed is <Text bold>not yet supported</Text>.
                    </Text>
                    <Text style={styles.warnBody}>
                        Use for small amounts only until recovery ships.
                    </Text>

                    <View style={styles.divider} />

                    <Text style={styles.sectionTitle}>Seed source</Text>

                    <View style={styles.toggleRow}>
                        <View style={{ flex: 1 }}>
                            <Text bold style={styles.toggleLabel}>
                                Use Hot Vault seed
                            </Text>
                            <Text style={styles.toggleSub}>
                                {hasHotVault
                                    ? "Derive Ark wallet from your existing hot vault mnemonic."
                                    : "No hot vault found. A fresh seed will be generated."}
                            </Text>
                        </View>
                        <Switch
                            value={arkUseHotVaultSeed && hasHotVault}
                            disabled={!hasHotVault}
                            onValueChange={setArkUseHotVaultSeed}
                            trackColor={{ false: "#3a3a3a", true: colors.green }}
                            thumbColor={colors.white}
                        />
                    </View>

                    <Text style={styles.infoText}>
                        {arkUseHotVaultSeed && hasHotVault
                            ? "🔒 Ark will share the same seed as your Hot Vault. A leak of the mnemonic compromises both."
                            : "🔑 A fresh Ark-only seed will be generated and stored securely."}
                    </Text>

                    <View style={styles.divider} />

                    <Text style={styles.sectionTitle}>What to know</Text>
                    <Text style={styles.bullet}>• Single server operator (Second.tech) sees your payment activity.</Text>
                    <Text style={styles.bullet}>• Balance state is on-device. Back up your app before wiping.</Text>
                    <Text style={styles.bullet}>• Can receive Lightning payments and on-chain deposits (board).</Text>
                </View>

                <Button
                    text="Create Ark Wallet"
                    onPress={handleCreate}
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

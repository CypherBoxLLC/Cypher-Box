import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Switch, TouchableOpacity, View } from "react-native";
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
import loc from "../../../../loc";

const SECOND_TERMS_URL = "https://second.tech/terms";

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
                            ? loc.cypherbox.account.create_ark.err_no_keychain
                            : result.reason === "open-failed"
                            ? loc.cypherbox.account.create_ark.err_open_failed
                            : String(loc.formatString(loc.cypherbox.account.create_ark.err_reopen, { reason: result.reason })),
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
            setExistingError((err as Error)?.message ?? loc.cypherbox.account.create_ark.err_open_existing);
            setOpeningExisting(false);
        }
    };

    const handleResetExisting = () => {
        // Two-step confirmation. The first alert spells out the risk in
        // user-readable language; the second is a final "are you SURE"
        // gate before we wipe the datadir + the keychain seed. Both steps
        // are needed in production — the existing-wallet gate is the only
        // protection against a user who hits Create on an unrelated
        // device and would otherwise wipe a wallet that's not theirs.
        Alert.alert(
            loc.cypherbox.account.create_ark.reset_title,
            loc.cypherbox.account.create_ark.reset_body,
            [
                { text: loc._.cancel, style: "cancel" },
                {
                    text: loc.cypherbox.account.create_ark.continue_ellipsis,
                    style: "destructive",
                    onPress: () => {
                        Alert.alert(
                            loc.cypherbox.account.create_ark.last_chance_title,
                            loc.cypherbox.account.create_ark.last_chance_body,
                            [
                                { text: loc._.cancel, style: "cancel" },
                                {
                                    text: loc.cypherbox.account.create_ark.reset_wipe,
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

            // Always land on the educational vault-created screen, even
            // on a second-or-later wallet — matches ArkSeedPhraseScreen.
            // Hot-vault-seed-reuse skips ArkSeedPhraseScreen entirely
            // so this is its only path through that education flow.
            setFirstTimeArk(false);
            dispatchNavigate("CheckingAccountCreated", { accountType: "ark" });
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
                        {loading ? loc.cypherbox.account.common.creating_ark_wallet : loc.cypherbox.account.create_ark.checking}
                    </Text>
                </View>
            </ScreenLayout>
        );
    }

    if (existingCheck === "exists") {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.container}>
                    <HeaderWithLine title={loc.cypherbox.account.create_ark.existing_header} />

                    <View style={styles.content}>
                        <Text style={styles.warnTitle}>{loc.cypherbox.account.create_ark.exists_title}</Text>
                        <Text style={styles.warnBody}>
                            {loc.cypherbox.account.create_ark.exists_body_1}
                        </Text>
                        <Text style={styles.warnBody}>
                            {loc.cypherbox.account.create_ark.exists_body_2}
                        </Text>

                        {existingError && (
                            <Text style={styles.errorText}>{existingError}</Text>
                        )}
                    </View>

                    <Button
                        text={openingExisting ? loc.cypherbox.account.create_ark.opening : loc.cypherbox.account.create_ark.open_existing}
                        onPress={handleOpenExisting}
                        style={styles.button}
                        textStyle={styles.btnText}
                        disabled={openingExisting || resetting}
                    />
                    {/* Reset is always reachable in production — locking it
                        behind __DEV__ created a real trap: users who lost
                        their seed + backup had no way to recover the
                        Create flow short of uninstalling the app. The two-
                        step confirmation in handleResetExisting (with
                        explicit data-loss warning) is the safety net. */}
                    <TouchableOpacity
                        onPress={handleResetExisting}
                        disabled={resetting || openingExisting}
                        style={{
                            alignSelf: "center",
                            marginTop: 14,
                            paddingVertical: 10,
                            paddingHorizontal: 18,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: "rgba(255, 90, 90, 0.55)",
                            backgroundColor: "rgba(255, 90, 90, 0.08)",
                            opacity: resetting || openingExisting ? 0.5 : 1,
                        }}
                    >
                        <Text bold style={{ color: "#FF5A5A", fontSize: 13 }}>
                            {resetting ? loc.cypherbox.account.create_ark.resetting : loc.cypherbox.account.create_ark.reset_wipe_wallet}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => dispatchNavigate("HomeScreen")}>
                        <Text style={styles.cancelText}>{loc._.cancel}</Text>
                    </TouchableOpacity>
                </View>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <HeaderWithLine title={loc.cypherbox.account.create_ark.header} />

                <View style={styles.content}>
                    <Text style={styles.warnTitle}>{loc.cypherbox.account.create_ark.experimental}</Text>
                    <Text style={styles.warnBody}>
                        {loc.cypherbox.account.create_ark.experimental_body}
                    </Text>
                    <Text style={styles.warnBody}>
                        {loc.cypherbox.account.create_ark.recovery_body}
                    </Text>

                    <View style={styles.divider} />

                    <Text style={styles.sectionTitle}>{loc.cypherbox.account.create_ark.seed_source}</Text>

                    <View style={styles.toggleRow}>
                        <View style={{ flex: 1 }}>
                            <Text bold style={styles.toggleLabel}>
                                {loc.cypherbox.account.create_ark.use_hot_vault_seed}
                            </Text>
                            <Text style={styles.toggleSub}>
                                {hasHotVault
                                    ? loc.cypherbox.account.create_ark.derive_from_hot
                                    : loc.cypherbox.account.create_ark.no_hot_vault}
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
                            ? loc.cypherbox.account.create_ark.shared_seed_warning
                            : loc.cypherbox.account.create_ark.fresh_seed_info}
                    </Text>

                    <View style={styles.divider} />

                    <Text style={styles.sectionTitle}>{loc.cypherbox.account.create_ark.what_to_know}</Text>
                    <Text style={styles.bullet}>{loc.cypherbox.account.create_ark.bullet_operator}</Text>
                    <Text style={styles.bullet}>{loc.cypherbox.account.create_ark.bullet_balance}</Text>
                    <Text style={styles.bullet}>{loc.cypherbox.account.create_ark.bullet_receive}</Text>
                    {/* Second's terms bind anyone whose wallet connects to their
                        Ark server, so Bark Vault users are their users too even
                        though they never see a Second-branded screen. Surface the
                        link here, at the moment of funding, not only in our ToS. */}
                    <Text style={styles.bullet}>{loc.cypherbox.account.create_ark.bullet_terms}</Text>
                    <Text style={styles.link} onPress={() => Linking.openURL(SECOND_TERMS_URL)}>
                        second.tech/terms
                    </Text>
                </View>

                <Button
                    text={loc.cypherbox.account.create_ark.header}
                    onPress={handleCreate}
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

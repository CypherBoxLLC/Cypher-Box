import React, { useState, useContext, useEffect, useRef } from 'react';
import { Alert, ActivityIndicator, TouchableOpacity, View } from 'react-native';
import styles from './styles';
import { ScreenLayout, Text, Input, Button } from '@Cypher/component-library';
import { colors } from '@Cypher/style-guide';
import { HDSegwitBech32Wallet } from '../../../class';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../../blue_modules/hapticFeedback';
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import useAuthStore from "@Cypher/stores/authStore";
import { dispatchReset } from '@Cypher/helpers/navigation';
import {
    getHotVaultSeedFromKeychain,
    listHotVaultKeychainBackupsWithMeta,
    resetHotVaultBackupFully,
    HotVaultBackupSummary,
} from '@Cypher/services/hotVaultKeychain';
import { recordEvent } from '@Cypher/stores/eventLogStore';

const inputs = [
    1, 2, 3, 4, 5, 6,
    7, 8, 9, 10, 11, 12
];

interface Props {
    route: any;
}




export default function RecoverSavingVault({ route }: Props) {
    const [secretWords, setSecretWords] = useState<string[]>(Array(inputs.length).fill(''));
    const { addAndSaveWallet, wallets } = useContext(BlueStorageContext);
    const { setWalletID, setHotVaultKeychainBackup } = useAuthStore();

    const [loading, setLoading] = useState(false);
    const [keychainLoading, setKeychainLoading] = useState(false);
    const [keychainBackups, setKeychainBackups] = useState<HotVaultBackupSummary[]>([]);
    const [pendingDeleteID, setPendingDeleteID] = useState<string | null>(null);
    const autoAttempted = useRef(false);
    const importing = useRef(false);
    const inputRefs = useRef<Array<any>>(new Array(inputs.length));

    // Auto-recover from Keychain on mount — mimics password-autofill UX.
    //
    // Two-phase:
    //   1. Enumerate service NAMES + read meta sidecars silently (no seed
    //      read, no biometric). Meta reads are cheap and parallel.
    //   2. If exactly one backup exists → immediately fire the biometric
    //      prompt and, on approval, run the import. iOS's native FaceID
    //      sheet IS the UI — no in-app button to find and tap.
    //
    // If the user cancels the biometric prompt we land on the screen's
    // manual 12-word form with the Keychain section also visible as a
    // retry path. `autoAttempted` gates re-entry so a re-render doesn't
    // re-trigger FaceID after a cancel.
    //
    // Multi-backup case (N > 1) skips the auto-trigger because we can't
    // guess which vault to restore — user picks from the visible list,
    // which renders date + walletID prefix per row.
    useEffect(() => {
        (async () => {
            const summaries = await listHotVaultKeychainBackupsWithMeta();
            setKeychainBackups(summaries);
            if (summaries.length === 1 && !autoAttempted.current) {
                autoAttempted.current = true;
                handleKeychainRecover(summaries[0].walletID);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveWallet = (wallet: any) => {
        if (importing.current) return;
        importing.current = true;
        // If this wallet is already in BlueApp, the user isn't importing a new
        // wallet — they're restoring a hot vault the UI lost track of (the
        // pointer drifted while the wallet stayed in storage). Don't dead-end
        // on addAndSaveWallet's "This wallet has been previously imported"
        // alert: re-point walletID to the existing wallet so the home screen
        // resolves it, and let the caller navigate. The seed match guarantees
        // this is the right wallet (getID == sha256(seed)), so re-adopting it
        // can't surface someone else's wallet. (fastImportHotVault also sets
        // walletID, but doing it here keeps every saveWallet caller healing.)
        const existing = wallets.find((i: any) => i.getID() === wallet.getID());
        if (existing) {
            setWalletID(existing.getID());
            return;
        }
        addAndSaveWallet(wallet);
    };

    /**
     * Fast-path hot-vault recovery — single code path for both Keychain-
     * sourced and manually-typed seeds on THIS screen.
     *
     * This screen is the "Recover Hot Vault" flow; every hot vault our app
     * generates is an `HDSegwitBech32Wallet` (BIP84, m/84'/0'/0'), so we
     * can skip `startImport`'s 14-step wallet-type discovery entirely.
     * That generator makes ~10 `wasEverUsed()` Electrum round-trips per
     * recovery (BIP44 / BIP49 / BIP84 / WIF variants / Electrum / AEZEED
     * / SLIP39 / …), which is 3–8 seconds of "why is the app frozen?"
     * before the user sees their funds. For a type we already know, the
     * scan is pure overhead.
     *
     * Trade-off: a user who pastes a seed from a different wallet app
     * (e.g. an Electrum seed with a custom derivation) will get an
     * `HDSegwitBech32Wallet` at m/84'/0'/0' instead of being auto-
     * categorized. That's acceptable here because: (a) this screen is
     * labelled "Already have a hot vault? Recover" — not a generic
     * importer; (b) any seed typed here that produces an empty wallet
     * can still be re-imported via the generic flow elsewhere; (c) the
     * slow scan couldn't have saved the user anyway if their seed is
     * from a non-standard wallet class not in BlueWallet's format list.
     *
     * `restoredWalletID` is optional:
     *   - Keychain path passes the ID enumerated before the unlock, so we
     *     can re-flip the zustand "backed up" flag post-recovery (the
     *     Settings tile wants to say "✓ Backed up" after reinstall).
     *   - Manual-typed path passes nothing — we have no pre-existing
     *     Keychain entry to reconnect to. The ID equality check keeps
     *     us defensive against the (never-seen) case where the Keychain
     *     walletID drifted from `getID()` output.
     *
     * Chain sync still runs — it's async in the background via whatever
     * the BlueStorage context's `addAndSaveWallet` kicks off post-save.
     * We just don't block the navigation on it. Same eventual state as
     * the slow path, minus the perceived lag.
     */
    const fastImportHotVault = (
        mnemonic: string,
        restoredWalletID?: string,
    ) => {
        if (importing.current) return;
        const w = new HDSegwitBech32Wallet();
        w.setSecret(mnemonic.trim());
        if (!w.validateMnemonic()) {
            Alert.alert(
                'Invalid Mnemonic',
                'Please check your seed phrase and try again.',
            );
            return;
        }
        const id = w.getID();
        setWalletID(id);
        if (restoredWalletID && restoredWalletID === id) {
            setHotVaultKeychainBackup(id, true);
        }
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        saveWallet(w); // flips importing.current + persists via BlueStorage
        // Activity log: 'cloud' covers any auto-recovery path (Keychain on
        // iOS, future iCloud Drive). 'seed' is manual 12-word entry. The
        // schema name follows the brief's terminology even though Keychain
        // is a per-device backup, not a remote cloud sync.
        recordEvent({
            kind: 'hot-vault-recovered',
            source: restoredWalletID ? 'cloud' : 'seed',
        });
        // Reset stack — recovery flow has multiple intermediate screens that
        // stay mounted under HomeScreen on iOS Fabric otherwise. See
        // TransactionBroadCast for the full half-mount explanation.
        dispatchReset('HomeScreen');
    };

    const handleSecretWordChange = (index: number, value: string) => {
        const updatedSecretWords = [...secretWords];
        updatedSecretWords[index] = value;
        setSecretWords(updatedSecretWords);
    };

    // NOTE: we used to run `startImport` here — BlueWallet's generic seed
    // importer that probes 14 wallet formats in sequence, with ~10
    // Electrum `wasEverUsed()` network calls per recovery. For this
    // screen it was 3–8 seconds of dead air for a wallet type we
    // already know (HDSegwitBech32Wallet / BIP84). All recover paths
    // now route through `fastImportHotVault` above — Keychain path,
    // manual-typed path, and single-backup auto-fire. See the doc-
    // comment on `fastImportHotVault` for the trade-off rationale.

    /**
     * Pull a specific backup out of Keychain and hand it to the importer.
     *
     * This triggers the biometric / passcode prompt (the only place in the
     * recovery flow that does). On decline or error we fall back to leaving
     * the user on the manual-entry screen — they still have the 12-word
     * boxes as an escape hatch.
     *
     * The `restoredWalletID` threaded through to `handleImport` lets the
     * onWallet callback rehydrate the zustand "backed up" flag so the
     * Settings UI stays in sync post-recovery.
     */
    const handleKeychainRecover = async (walletID: string) => {
        if (keychainLoading || loading) return;
        setKeychainLoading(true);
        const result = await getHotVaultSeedFromKeychain(walletID);
        setKeychainLoading(false);

        if (result.ok) {
            triggerHapticFeedback(HapticFeedbackTypes.ImpactLight);
            // Deliberately NOT populating the input boxes — we skip straight
            // to import so the 12 words are never briefly displayed to
            // anyone watching the screen.
            //
            // Fast path: bypass startImport's multi-type discovery scan
            // entirely. We know this came from our own Keychain and is
            // therefore an HDSegwitBech32Wallet. Saves 3–8s of perceived
            // latency compared to the generic handleImport path.
            fastImportHotVault(result.mnemonic, walletID);
            return;
        }

        if (result.reason === 'not-found') {
            // Race: entry vanished between enumeration and read. Drop it
            // from the on-screen list and let the user retry manually.
            setKeychainBackups(prev =>
                prev.filter(s => s.walletID !== walletID),
            );
            Alert.alert(
                'Backup not found',
                'This Keychain entry is no longer available. You can recover manually by typing your 12 words below.',
            );
            return;
        }

        // read-failed: typically biometric declined or locked. Don't badger
        // the user; just reset state so they can retry or fall back.
        console.warn('[HotVault] Keychain recovery failed:', result.error);
    };

    /**
     * Prune a single Keychain backup without recovering it.
     *
     * Offered per-row in the multi-backup picker so users who accumulated
     * stale backups (created, deleted, recreated over time) can clean up
     * without first restoring the vault they don't want. Confirmation is
     * mandatory — if the user hasn't written the seed down, a tap here
     * destroys their recovery path.
     *
     * Uses `resetHotVaultBackupFully` so both the seed and its meta
     * sidecar go in one operation. On success, optimistically drop the
     * row from state rather than re-enumerating — faster feedback.
     */
    const handleKeychainDelete = (summary: HotVaultBackupSummary) => {
        if (pendingDeleteID || keychainLoading || loading) return;
        Alert.alert(
            'Remove this Keychain backup?',
            'The 12 words for this vault will be removed from this device\u2019s Keychain. If you haven\u2019t written them down on paper, you WILL lose access to any funds in this vault.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                        setPendingDeleteID(summary.walletID);
                        const ok = await resetHotVaultBackupFully(
                            summary.walletID,
                        );
                        setPendingDeleteID(null);
                        if (ok) {
                            triggerHapticFeedback(
                                HapticFeedbackTypes.NotificationSuccess,
                            );
                            setKeychainBackups(prev =>
                                prev.filter(
                                    s => s.walletID !== summary.walletID,
                                ),
                            );
                        } else {
                            Alert.alert(
                                'Could not remove backup',
                                'The Keychain entry may still be present. Try again, or remove it from the vault\u2019s Settings.',
                            );
                        }
                    },
                },
            ],
        );
    };

    /**
     * Format `createdAt` as a short, locale-aware date string.
     *
     * Picker rows are tight — we don't want a full timestamp. `Intl.DateTimeFormat`
     * with `medium` date style gives "Apr 21, 2026" on en-US and the right
     * equivalent on other locales. Legacy backups (no meta) get a placeholder
     * that reads clearly as "we don't know when this was saved".
     */
    const formatBackupDate = (createdAt?: number | null): string => {
        if (!createdAt) return 'Backed up (legacy)';
        try {
            const d = new Date(createdAt);
            const formatter = new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
            } as Intl.DateTimeFormatOptions);
            return `Backed up ${formatter.format(d)}`;
        } catch {
            return `Backed up ${new Date(createdAt).toDateString()}`;
        }
    };

    const handleKeyPress = (event: any, index: number) => {
        if (event.nativeEvent.key === ' ' || event.nativeEvent.key === 'Enter') {
            if (index < inputRefs.current.length - 1) {
                inputRefs.current[index + 1].focus();
            }
        }
    };

    /**
     * Render the Keychain-recovery section above the manual input grid.
     *
     * Always visible — three honest states so users understand what the
     * system sees without having to guess:
     *   - 0 backups → muted "no backup found" info line (discoverable,
     *                 not a CTA). Feature exists, nothing to restore.
     *   - 1 backup  → auto-recovery fires on mount. Row is a retry
     *                 path if the user cancelled the native FaceID sheet.
     *   - N backups → one row per entry, each showing date + ID prefix
     *                 plus a trash icon for in-place pruning.
     *
     * Row layout (multi-backup case):
     *
     *   ┌──────────────────────────────────────────┐
     *   │  Backed up  Apr 21, 2026                 │
     *   │  Vault ID   3f2a8c1b…               🗑    │
     *   └──────────────────────────────────────────┘
     *     ^ tap anywhere but the trash → recover   ^ tap trash → confirm + delete
     *
     * Rows are sorted newest-first by the enumeration helper. Legacy entries
     * (no meta) render with a "Backed up (legacy)" placeholder and sink to
     * the bottom — distinguishable without being alarming.
     */
    const renderKeychainSection = () => {
        if (keychainBackups.length === 0) {
            return (
                <View style={styles.keychainSection}>
                    <Text bold style={styles.keychainTitle}>
                        Recover from iPhone Keychain
                    </Text>
                    <Text style={styles.keychainSub}>
                        No Keychain backup found on this device. To use this,
                        create a hot vault with "Save to iPhone Keychain"
                        enabled, or turn it on later in vault settings.
                    </Text>
                </View>
            );
        }

        const isSingle = keychainBackups.length === 1;

        return (
            <View style={styles.keychainSection}>
                <Text bold style={styles.keychainTitle}>
                    Recover from iPhone Keychain
                </Text>
                <Text style={styles.keychainSub}>
                    {isSingle
                        ? 'Tap to unlock with FaceID / passcode and restore — no typing required.'
                        : `We found ${keychainBackups.length} backed-up hot vaults on this device. Pick one to restore, or remove ones you no longer need.`}
                </Text>

                {keychainBackups.map(summary => {
                    const { walletID, meta } = summary;
                    const isDeleting = pendingDeleteID === walletID;
                    const isBusyOther =
                        (keychainLoading || loading) && !isDeleting;

                    if (isSingle) {
                        // Single-backup case keeps the original big-green-button
                        // shape — no date/ID clutter needed since there's only
                        // one thing to do and iOS already auto-fired FaceID on
                        // mount. This is just the retry path.
                        return (
                            <TouchableOpacity
                                key={walletID}
                                style={styles.keychainButton}
                                onPress={() => handleKeychainRecover(walletID)}
                                disabled={keychainLoading || loading}
                                activeOpacity={0.8}
                            >
                                {keychainLoading ? (
                                    <ActivityIndicator color={colors.white} />
                                ) : (
                                    <Text bold style={styles.keychainButtonText}>
                                        Recover from Keychain
                                    </Text>
                                )}
                            </TouchableOpacity>
                        );
                    }

                    // Multi-backup: rich row. The outer TouchableOpacity is the
                    // recover target; the trash TouchableOpacity inside stops
                    // propagation via its own onPress so tapping 🗑 doesn't
                    // also fire the recover handler underneath it.
                    return (
                        <View key={walletID} style={styles.keychainRowWrap}>
                            <TouchableOpacity
                                style={styles.keychainRow}
                                onPress={() => handleKeychainRecover(walletID)}
                                disabled={
                                    isBusyOther ||
                                    isDeleting ||
                                    !!pendingDeleteID
                                }
                                activeOpacity={0.8}
                            >
                                <View style={styles.keychainRowInfo}>
                                    <Text style={styles.keychainRowDate}>
                                        {formatBackupDate(meta?.createdAt)}
                                    </Text>
                                    <Text style={styles.keychainRowId}>
                                        {`Vault ID  ${walletID.slice(0, 12)}\u2026`}
                                    </Text>
                                </View>
                                {keychainLoading && !isDeleting ? (
                                    <ActivityIndicator color={colors.white} />
                                ) : (
                                    <Text style={styles.keychainRowCta}>
                                        Recover
                                    </Text>
                                )}
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.keychainRowDelete}
                                onPress={() => handleKeychainDelete(summary)}
                                disabled={
                                    isBusyOther ||
                                    isDeleting ||
                                    !!pendingDeleteID
                                }
                                hitSlop={{
                                    top: 10,
                                    bottom: 10,
                                    left: 10,
                                    right: 10,
                                }}
                                accessibilityLabel="Remove this Keychain backup"
                            >
                                {isDeleting ? (
                                    <ActivityIndicator color={colors.white} />
                                ) : (
                                    <Text style={styles.keychainRowDeleteText}>
                                        Remove
                                    </Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    );
                })}

                <View style={styles.keychainDivider}>
                    <View style={styles.keychainDividerLine} />
                    <Text style={styles.keychainDividerText}>or type your 12 words</Text>
                    <View style={styles.keychainDividerLine} />
                </View>
            </View>
        );
    };



    return (
        <ScreenLayout title="Enter Your Seed phrase" showToolbar isBackButton disableScroll>
            <View style={styles.container}>
                {loading ?
                    <ActivityIndicator style={{ marginTop: 10, marginBottom: 20 }} color={colors.white} />
                    :
                    <>
                        {renderKeychainSection()}
                        <View style={styles.inputsContainer}>
                            {/* First Column */}
                            <View style={styles.inputColumn}>
                                {inputs.slice(0, 6).map((input, index) => (
                                    <View key={input} style={styles.inputContainer}>
                                        <Text h2 style={styles.labelText}>{input}.</Text>
                                        <Input
                                            ref={el => inputRefs.current[index] = el}
                                            style={styles.inputStyle}
                                            onChange={(value) => handleSecretWordChange(index, value)}
                                            value={secretWords[index]}
                                            textInputStyle={styles.textInputStyle}
                                            autoCapitalize='none'
                                            onKeyPress={(event) => handleKeyPress(event, index)}
                                            onSubmitEditing={() => {
                                                if (index < inputRefs.current.length - 1) {
                                                    inputRefs.current[index + 1].focus();
                                                }
                                            }}
                                        />
                                    </View>
                                ))}
                            </View>

                            {/* Second Column */}
                            <View style={styles.inputColumn}>
                                {inputs.slice(6).map((input, index) => (
                                    <View key={input} style={styles.inputContainer}>
                                        <Text h2 style={styles.labelText}>{input}.</Text>
                                        <Input
                                            ref={el => inputRefs.current[index + 6] = el}
                                            style={styles.inputStyle}
                                            onChange={(value) => handleSecretWordChange(index + 6, value)}
                                            value={secretWords[index + 6]}
                                            textInputStyle={styles.textInputStyle}
                                            autoCapitalize='none'
                                            onKeyPress={(event) => handleKeyPress(event, index + 6)}
                                            onSubmitEditing={() => {
                                                if (index + 6 < inputRefs.current.length - 1) {
                                                    inputRefs.current[index + 7].focus();
                                                }
                                            }}
                                        />
                                    </View>
                                ))}
                            </View>
                        </View>
                        <Button
                            text="Recover"
                            onPress={() =>
                                fastImportHotVault(secretWords.join(' '))
                            }
                            style={styles.button}
                            textStyle={styles.btnText}
                        />
                    </>
                }
            </View>
        </ScreenLayout>
    );
}

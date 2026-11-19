import React, { useState, useContext, useEffect, useRef } from 'react';
import { Alert, ActivityIndicator, StyleSheet, Switch, TouchableOpacity, View } from 'react-native';
import styles from './styles';
import { ScreenLayout, Text, Input, Button } from '@Cypher/component-library';
import { colors, ltr, rtl } from '@Cypher/style-guide';
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
import { hotVaultKeychainText } from '@Cypher/helpers/hotVaultKeychainText';
import loc, { formatBalance } from '../../../loc';
import { BitcoinUnit } from '../../../models/bitcoinUnits';

const inputs = [
    1, 2, 3, 4, 5, 6,
    7, 8, 9, 10, 11, 12
];

interface Props {
    route: any;
}

/**
 * What checking a Keychain backup shows before anything is restored: the vault its 12 words open, told apart by its
 * master fingerprint (two backups with the same fingerprint hold the same words), its first receive address, and its
 * balance from the Electrum server. Like the restore itself, the check uses the words alone, so it shows exactly what
 * typing them would.
 */
export interface BackupCheck {
    walletID: string;
    fingerprint: string;
    firstAddress: string;
    status: 'checking' | 'done' | 'failed';
    balance: number | null;
    used: boolean | null;
}

/** How long the balance check may take before the panel says it couldn't be checked. The restore never waits for it. */
export const BACKUP_CHECK_TIMEOUT_MS = 30000;

/**
 * The balance of a wallet that isn't saved, and whether any of its addresses was ever used. Unlike fetchBalance, which
 * logs and swallows errors, this throws, so a check that failed never reads as 0 sats.
 */
export async function scanBackupBalance(w: HDSegwitBech32Wallet): Promise<{ balance: number; used: boolean }> {
    const change = await w._binarySearchIterationForInternalAddress(1000);
    const receive = await w._binarySearchIterationForExternalAddress(1000);
    w.next_free_change_address_index = change;
    w.next_free_address_index = receive;
    await w._fetchBalance();
    return { balance: w.getBalance(), used: change > 0 || receive > 0 };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        work.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}


export default function RecoverSavingVault({ route }: Props) {
    const [secretWords, setSecretWords] = useState<string[]>(Array(inputs.length).fill(''));
    const { addAndSaveWallet, wallets } = useContext(BlueStorageContext);
    const { setWalletID, setHotVaultKeychainBackup } = useAuthStore();
    // iPhone Keychain or Android Keystore wording, in the current language
    const keychainText = hotVaultKeychainText().recover;

    const [loading, setLoading] = useState(false);
    // The backup whose Face ID / passcode unlock is under way: only its row shows a spinner, and the others wait.
    const [unlockingID, setUnlockingID] = useState<string | null>(null);
    // The one backup checked so far, shown under its row until it's restored or closed.
    const [check, setCheck] = useState<BackupCheck | null>(null);
    // Its 12 words, kept in memory only while its check is open, for "Restore this vault".
    const checkedWords = useRef<{ walletID: string; mnemonic: string } | null>(null);
    // Bumped whenever a check is closed or replaced, so a balance that arrives late is dropped.
    const checkRun = useRef(0);
    // Optional BIP39 passphrase for manual recovery. Toggle-gated exactly
    // like creation: nothing is typed or applied unless the user opts in.
    // Used as typed — never trimmed, never stored.
    const [usePassphrase, setUsePassphrase] = useState(false);
    const [recoverPassphrase, setRecoverPassphrase] = useState('');
    const [keychainBackups, setKeychainBackups] = useState<HotVaultBackupSummary[]>([]);
    const [pendingDeleteID, setPendingDeleteID] = useState<string | null>(null);
    const importing = useRef(false);
    const inputRefs = useRef<Array<any>>(new Array(inputs.length));

    // Leaving the screen drops any words a check still holds.
    useEffect(
        () => () => {
            checkRun.current += 1;
            checkedWords.current = null;
        },
        [],
    );

    // List any Keychain backups on mount so the user can choose one to
    // restore. Enumerate service NAMES + read meta sidecars silently (no seed
    // read, no biometric). Meta reads are cheap and parallel.
    //
    // Recovery itself requires an explicit tap on a row, which fires the
    // biometric prompt. We do NOT auto-fire that prompt on mount, even for a
    // single backup: opening this screen should never, on its own, offer to
    // restore a seed. The restore stays a deliberate user action.
    useEffect(() => {
        (async () => {
            const summaries = await listHotVaultKeychainBackupsWithMeta();
            setKeychainBackups(summaries);
        })();
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
        passphrase?: string,
    ) => {
        if (importing.current) return;
        const w = new HDSegwitBech32Wallet();
        w.setSecret(mnemonic.trim());
        if (!w.validateMnemonic()) {
            Alert.alert(
                loc.cypherbox.vault.recover_saving_vault.invalid_mnemonic_title,
                loc.cypherbox.vault.recover_saving_vault.invalid_mnemonic_message,
            );
            return;
        }
        // BIP39 passphrase: applied exactly as typed BEFORE getID() — the
        // wallet ID hash includes the passphrase, which is what makes the
        // Keychain-path verification below possible.
        if (passphrase) {
            w.setPassphrase(passphrase);
        }
        const id = w.getID();
        // NO mismatch alert. The sidecar's walletID was derived from
        // words+passphrase at save time, so a passphrase-free keychain import
        // legitimately produces a different id. This used to hard-stop with
        // "the passphrase does not match this vault", which told anyone holding
        // the phone that a hidden wallet existed — the exact thing a BIP39
        // passphrase is meant to conceal.
        //
        // A differing id is now simply the decoy, imported in silence. The
        // `restoredWalletID === id` check below still runs, so the "backed up
        // to Keychain" marker is only ever set on a vault that genuinely owns
        // that keychain entry.
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

    /** Close the open check and drop its words. A balance still on its way is ignored. */
    const closeCheck = () => {
        checkRun.current += 1;
        checkedWords.current = null;
        setCheck(null);
    };

    /**
     * Unlock one backup and show what it holds, without restoring it.
     *
     * This triggers the biometric / passcode prompt (the only place in the
     * recovery flow that does). The words then stay in memory, never on
     * screen, while the backup's check shows its master fingerprint, first
     * receive address and balance under its row. Nothing is restored until
     * "Restore this vault" (restoreCheckedBackup). With several backups on a
     * phone, that is how the user tells them apart and finds the one with
     * funds. On decline or error the user stays on this screen, with the
     * 12-word boxes as an escape hatch.
     */
    // No `knownMeta` parameter by design: this flow must not be able to read
    // the sidecar's passphrase state, because acting on it is what leaked the
    // existence of a hidden wallet. The words are all it needs.
    const handleKeychainCheck = async (walletID: string) => {
        if (unlockingID || loading || pendingDeleteID) return;
        closeCheck();
        setUnlockingID(walletID);
        const result = await getHotVaultSeedFromKeychain(walletID);

        if (!result.ok) {
            setUnlockingID(null);
            if (result.reason === 'not-found') {
                // Race: entry vanished between enumeration and read. Drop it
                // from the on-screen list and let the user retry manually.
                setKeychainBackups(prev =>
                    prev.filter(s => s.walletID !== walletID),
                );
                Alert.alert(
                    loc.cypherbox.vault.recover_saving_vault.backup_not_found_title,
                    keychainText.notFoundMessage,
                );
                return;
            }
            // read-failed: typically biometric declined or locked. Don't badger
            // the user; just reset state so they can retry or fall back.
            console.warn('[HotVault] Keychain recovery failed:', result.error);
            return;
        }

        triggerHapticFeedback(HapticFeedbackTypes.ImpactLight);
        // PASSPHRASE-AGNOSTIC BY DESIGN. The check and the restore use the
        // words with no passphrase and say nothing about whether one exists.
        //
        // A BIP39 passphrase is a deniability tool: under duress you hand
        // over twelve words and the wallet they open is the only wallet
        // anyone can see. This flow used to break that. It read a
        // `hasPassphrase` flag from the keychain sidecar and, when set,
        // announced "This vault is passphrase-protected" before prompting.
        // Anyone holding the unlocked phone (which, under duress, is the
        // whole premise) learned a hidden wallet existed. Clearing the flag
        // did not help either: the sidecar's walletID was derived WITH the
        // passphrase, so a passphrase-free import mismatched and the guard
        // in fastImportHotVault said "the passphrase does not match this
        // vault" instead. Both branches leaked.
        //
        // So: no prompt, no mismatch alert, no flag. The check shows the
        // decoy, exactly as typing the words by hand would, and the restore
        // opens it. Reaching the real vault means adding the passphrase on
        // the manual recovery path below, which is where the toggle lives.
        //
        // The cost, accepted deliberately: a passphrase user sees their
        // decoy here with no explanation. Explaining it is the leak.
        const wallet = new HDSegwitBech32Wallet();
        wallet.setSecret(result.mnemonic.trim());
        if (!wallet.validateMnemonic()) {
            setUnlockingID(null);
            Alert.alert(
                loc.cypherbox.vault.recover_saving_vault.invalid_mnemonic_title,
                loc.cypherbox.vault.recover_saving_vault.invalid_mnemonic_message,
            );
            return;
        }
        // Let the spinner draw before the seed's key stretching (a second or
        // two of JS on older phones) holds the thread.
        await new Promise(resolve => setTimeout(resolve, 50));
        let fingerprint = '';
        let firstAddress = '';
        try {
            fingerprint = wallet.getMasterFingerprintHex().toUpperCase();
            firstAddress = wallet._getExternalAddressByIndex(0);
        } catch (e) {
            console.warn('[HotVault] Keychain backup check could not read the vault:', e);
        }
        const run = ++checkRun.current;
        checkedWords.current = { walletID, mnemonic: result.mnemonic };
        setCheck({ walletID, fingerprint, firstAddress, status: 'checking', balance: null, used: null });
        setUnlockingID(null);
        try {
            const { balance, used } = await withTimeout(scanBackupBalance(wallet), BACKUP_CHECK_TIMEOUT_MS);
            if (checkRun.current !== run) return;
            setCheck(prev => (prev && prev.walletID === walletID ? { ...prev, status: 'done', balance, used } : prev));
        } catch (e) {
            if (checkRun.current !== run) return;
            console.warn('[HotVault] Keychain backup balance check failed:', e);
            setCheck(prev => (prev && prev.walletID === walletID ? { ...prev, status: 'failed' } : prev));
        }
    };

    /**
     * Restore the checked backup. The words go straight to the importer and
     * are never put in the input boxes, so they're never shown on screen.
     * Fast path: we know they came from our own Keychain, so the wallet is an
     * HDSegwitBech32Wallet and startImport's multi-type scan is skipped.
     */
    const restoreCheckedBackup = () => {
        const checked = checkedWords.current;
        if (!checked || importing.current) return;
        checkRun.current += 1;
        checkedWords.current = null;
        fastImportHotVault(checked.mnemonic, checked.walletID);
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
        if (pendingDeleteID || unlockingID || loading) return;
        Alert.alert(
            keychainText.removeTitle,
            keychainText.removeMessage,
            [
                { text: loc._.cancel, style: 'cancel' },
                {
                    text: loc.cypherbox.vault.recover_saving_vault.remove,
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
                            if (checkedWords.current?.walletID === summary.walletID) {
                                closeCheck();
                            }
                            setKeychainBackups(prev =>
                                prev.filter(
                                    s => s.walletID !== summary.walletID,
                                ),
                            );
                        } else {
                            Alert.alert(
                                loc.cypherbox.vault.recover_saving_vault.remove_failed_title,
                                keychainText.removeFailedMessage,
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
        if (!createdAt) return loc.cypherbox.vault.recover_saving_vault.backed_up_legacy;
        try {
            const d = new Date(createdAt);
            const formatter = new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
            } as Intl.DateTimeFormatOptions);
            return String(loc.formatString(loc.cypherbox.vault.recover_saving_vault.backed_up, { date: formatter.format(d) }));
        } catch {
            return String(loc.formatString(loc.cypherbox.vault.recover_saving_vault.backed_up, { date: new Date(createdAt).toDateString() }));
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
     * The check of one backup, under its row: master fingerprint, first
     * receive address and balance, then "Restore this vault" or Close. The
     * restore doesn't wait for the balance.
     */
    const renderBackupCheck = (walletID: string) => {
        if (!check || check.walletID !== walletID) return null;
        let balanceLine: string;
        if (check.status === 'checking') {
            balanceLine = loc.cypherbox.vault.recover_saving_vault.check_balance_checking;
        } else if (check.status === 'failed') {
            balanceLine = loc.cypherbox.vault.recover_saving_vault.check_balance_failed;
        } else {
            balanceLine = String(
                loc.formatString(loc.cypherbox.vault.recover_saving_vault.check_balance, { amount: formatBalance(check.balance ?? 0, BitcoinUnit.SATS, true) }),
            );
        }
        return (
            <View style={styles.checkPanel} testID="keychainBackupCheck">
                {check.fingerprint ? (
                    <Text style={styles.checkLine}>
                        {loc.cypherbox.vault.storage_vault.settings.master_fingerprint}{'  '}
                        <Text bold style={[styles.checkLine, rtl.ltrText]}>{ltr(check.fingerprint)}</Text>
                    </Text>
                ) : null}
                {check.firstAddress ? (
                    <>
                        <Text style={styles.checkLabel}>{loc.cypherbox.vault.recover_saving_vault.check_first_address}</Text>
                        <Text style={[styles.checkAddress, rtl.ltrText]}>
                            {ltr(check.firstAddress)}
                        </Text>
                    </>
                ) : null}
                <View style={styles.checkBalanceRow}>
                    {check.status === 'checking' ? <ActivityIndicator size="small" color={colors.white} style={styles.checkSpinner} /> : null}
                    <Text style={styles.checkLine} testID="keychainBackupBalance">{balanceLine}</Text>
                </View>
                {check.status === 'done' && !check.used ? (
                    <Text style={styles.checkMuted}>{loc.cypherbox.vault.recover_saving_vault.check_never_used}</Text>
                ) : null}
                <View style={styles.checkButtons}>
                    <TouchableOpacity
                        style={styles.checkRestore}
                        onPress={restoreCheckedBackup}
                        accessibilityRole="button"
                        testID="keychainBackupRestore"
                    >
                        <Text bold style={styles.checkRestoreText}>{loc.cypherbox.vault.recover_saving_vault.check_restore}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.checkClose}
                        onPress={closeCheck}
                        accessibilityRole="button"
                        testID="keychainBackupClose"
                    >
                        <Text style={styles.checkCloseText}>{loc._.close}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    /**
     * Render the Keychain-recovery section above the manual input grid.
     *
     * Always visible — three honest states so users understand what the
     * system sees without having to guess:
     *   - 0 backups → muted "no backup found" info line (discoverable,
     *                 not a CTA). Feature exists, nothing to restore.
     *   - 1 backup  → one big button: unlock, then its check.
     *   - N backups → one row per entry, each showing date + ID prefix,
     *                 a Check button and a Remove button. The screen
     *                 scrolls, so every row and the 12-word boxes stay
     *                 reachable however many backups there are.
     *
     * Row layout (multi-backup case):
     *
     *   ┌──────────────────────────────────────────┐ ┌────────┐
     *   │  Backed up  Apr 21, 2026          Check  │ │ Remove │
     *   │  Vault ID   3f2a8c1b…                    │ └────────┘
     *   └──────────────────────────────────────────┘
     *   (its check opens here, under the row)
     *
     * Only the row being unlocked shows a spinner; the others wait. Rows are
     * sorted newest-first by the enumeration helper. Legacy entries (no meta)
     * render with a "Backed up (legacy)" placeholder and sink to the bottom.
     */
    const renderKeychainSection = () => {
        if (keychainBackups.length === 0) {
            return (
                <View style={styles.keychainSection}>
                    <Text bold style={styles.keychainTitle}>
                        {keychainText.title}
                    </Text>
                    <Text style={styles.keychainSub}>
                        {keychainText.noBackup}
                    </Text>
                </View>
            );
        }

        const isSingle = keychainBackups.length === 1;

        return (
            <View style={styles.keychainSection}>
                <Text bold style={styles.keychainTitle}>
                    {keychainText.title}
                </Text>
                <Text style={styles.keychainSub}>
                    {isSingle
                        ? keychainText.tapToUnlock
                        : loc.formatString(loc.cypherbox.vault.recover_saving_vault.found_backups, { count: keychainBackups.length })}
                </Text>

                {keychainBackups.map(summary => {
                    const { walletID, meta } = summary;
                    const isDeleting = pendingDeleteID === walletID;
                    const isUnlocking = unlockingID === walletID;
                    // One backup at a time: while any unlock or removal runs, every other row waits.
                    const isBlocked = loading || (!!unlockingID && !isUnlocking) || (!!pendingDeleteID && !isDeleting);
                    const isChecked = check?.walletID === walletID;

                    if (isSingle) {
                        // Single-backup case keeps the original big-green-button
                        // shape — no date/ID clutter needed since there's only
                        // one thing to do. Its check opens under the button.
                        return (
                            <View key={walletID}>
                                {isChecked ? null : (
                                    <TouchableOpacity
                                        style={styles.keychainButton}
                                        onPress={() => handleKeychainCheck(walletID)}
                                        disabled={isBlocked || isUnlocking}
                                        activeOpacity={0.8}
                                        testID="keychainBackupRow"
                                    >
                                        {isUnlocking ? (
                                            <ActivityIndicator color={colors.white} />
                                        ) : (
                                            <Text bold style={styles.keychainButtonText}>
                                                {keychainText.recoverButton}
                                            </Text>
                                        )}
                                    </TouchableOpacity>
                                )}
                                {renderBackupCheck(walletID)}
                            </View>
                        );
                    }

                    // Multi-backup: rich row. The row is the Check target; the
                    // Remove button beside it has its own onPress, so a tap on
                    // it never also fires the check underneath.
                    return (
                        <View key={walletID}>
                            <View style={[styles.keychainRowWrap, isBlocked && styles.keychainRowWaiting]}>
                                <TouchableOpacity
                                    style={[styles.keychainRow, isChecked && styles.keychainRowChecked]}
                                    onPress={() => (isChecked ? closeCheck() : handleKeychainCheck(walletID))}
                                    disabled={isBlocked || isUnlocking || isDeleting}
                                    activeOpacity={0.8}
                                    testID="keychainBackupRow"
                                >
                                    <View style={styles.keychainRowInfo}>
                                        <Text style={styles.keychainRowDate}>
                                            {formatBackupDate(meta?.createdAt)}
                                        </Text>
                                        <Text style={styles.keychainRowId}>
                                            {loc.formatString(loc.cypherbox.vault.recover_saving_vault.vault_id, { id: walletID.slice(0, 12) })}
                                        </Text>
                                    </View>
                                    {isUnlocking ? (
                                        <ActivityIndicator color={colors.white} />
                                    ) : isChecked ? null : (
                                        <Text style={styles.keychainRowCta}>
                                            {loc.cypherbox.vault.recover_saving_vault.check}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.keychainRowDelete}
                                    onPress={() => handleKeychainDelete(summary)}
                                    disabled={isBlocked || isUnlocking || isDeleting}
                                    hitSlop={{
                                        top: 10,
                                        bottom: 10,
                                        left: 10,
                                        right: 10,
                                    }}
                                    accessibilityLabel={keychainText.removeA11y}
                                >
                                    {isDeleting ? (
                                        <ActivityIndicator color={colors.white} />
                                    ) : (
                                        <Text style={styles.keychainRowDeleteText}>
                                            {loc.cypherbox.vault.recover_saving_vault.remove}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                            {renderBackupCheck(walletID)}
                        </View>
                    );
                })}

                <View style={styles.keychainDivider}>
                    <View style={styles.keychainDividerLine} />
                    <Text style={styles.keychainDividerText}>{loc.cypherbox.vault.recover_saving_vault.or_type_words}</Text>
                    <View style={styles.keychainDividerLine} />
                </View>
            </View>
        );
    };



    return (
        // keyboardAware: the screen scrolls (any number of Keychain backups, then the 12-word boxes), and the field being
        // typed in is scrolled above the keyboard.
        <ScreenLayout title={loc.cypherbox.vault.recover_saving_vault.title} showToolbar isBackButton keyboardAware bottomPadding={40}>
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
                                        <Text h2 style={[styles.labelText, rtl.ltrText]}>{ltr(`${input}.`)}</Text>
                                        <Input
                                            ref={el => inputRefs.current[index] = el}
                                            style={styles.inputStyle}
                                            onChange={(value) => handleSecretWordChange(index, value)}
                                            value={secretWords[index]}
                                            textInputStyle={StyleSheet.flatten([styles.textInputStyle, rtl.ltrText])}
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
                                        <Text h2 style={[styles.labelText, rtl.ltrText]}>{ltr(`${input}.`)}</Text>
                                        <Input
                                            ref={el => inputRefs.current[index + 6] = el}
                                            style={styles.inputStyle}
                                            onChange={(value) => handleSecretWordChange(index + 6, value)}
                                            value={secretWords[index + 6]}
                                            textInputStyle={StyleSheet.flatten([styles.textInputStyle, rtl.ltrText])}
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
                        {/* Opt-in passphrase for manual recovery, mirroring
                            the creation screen's toggle-gated field. */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, marginHorizontal: 20 }}>
                            <Text bold style={{ color: '#FFF', fontSize: 14, flex: 1 }}>
                                {loc.cypherbox.vault.recover_saving_vault.optional_passphrase}
                            </Text>
                            <Switch
                                value={usePassphrase}
                                onValueChange={setUsePassphrase}
                                trackColor={{ false: '#3a3a3a', true: colors.green }}
                                thumbColor={'#FFF'}
                            />
                        </View>
                        {usePassphrase && (
                            <Input
                                onChange={setRecoverPassphrase}
                                value={recoverPassphrase}
                                label={loc.cypherbox.vault.recover_saving_vault.passphrase_label}
                                autoCapitalize="none"
                                secureTextEntry
                                textInputStyle={{ color: '#FFF' }}
                                style={{ marginHorizontal: 20, marginTop: 6 }}
                            />
                        )}
                        <Button
                            text={loc.cypherbox.vault.recover_saving_vault.recover}
                            onPress={() =>
                                fastImportHotVault(
                                    secretWords.join(' '),
                                    undefined,
                                    usePassphrase && recoverPassphrase ? recoverPassphrase : undefined,
                                )
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

/**
 * Whether a Bark Vault's backup file exists anywhere but inside the app on
 * this phone.
 *
 * `arkLastBackupAt` is stamped by any backup write, and the app's private
 * folder counts as one. That folder is deleted with the app and lost with the
 * phone, so a vault created with "Create without it" showed "Backed up" on
 * every capsule while its only file sat next to the wallet it was meant to
 * protect. The copy that survives is tracked on its own, from what each write
 * actually reached: the iCloud Drive container on iOS, Google Drive or the
 * chosen folder on Android. The folder counts the way the create screen
 * counts it: it is outside the app, so it survives an uninstall.
 *
 * Pure, so the store can apply it and tests can pin it without a device.
 */

/**
 * What one auto-backup write did beyond the app's own folder.
 *   - 'written': at least one of iCloud Drive, Google Drive or the chosen
 *     folder took this snapshot.
 *   - 'failed':  one of them is set up, and none took it.
 *   - 'none':    none of them is set up (iCloud Drive off for Cypher Box, no
 *     Google Drive connected, no folder chosen).
 */
export type ArkOffDeviceOutcome = 'written' | 'failed' | 'none';

/**
 * What the wallet has, for the capsule labels and the reminders.
 *   - 'off-device': a copy outside the app is being kept current.
 *   - 'this-phone': backups are written, but only inside the app.
 *   - 'none':       nothing has been written yet.
 */
export type ArkBackupCoverage = 'off-device' | 'this-phone' | 'none';

/**
 * Failed writes in a row, with a destination set up, after which its last
 * copy stops counting. One failure is usually a network blip that the next
 * sync tick retries, and calling that "On this phone only" would put a
 * reminder in front of someone whose copy is fine. A revoked folder or a dead
 * Drive sign-in fails every time, and its copy falls further behind with
 * every capsule that arrives, so it cannot keep counting for good either.
 */
export const ARK_OFF_DEVICE_FAIL_LIMIT = 3;

export function arkBackupCoverage(
    lastBackupAt: number | null | undefined,
    lastOffDeviceBackupAt: number | null | undefined,
): ArkBackupCoverage {
    if (lastOffDeviceBackupAt != null) return 'off-device';
    return lastBackupAt != null ? 'this-phone' : 'none';
}

export type OffDeviceBackupState = {
    /** When the last write that reached a copy outside the app was made, epoch ms. */
    at: number | null;
    /** Failed writes in a row since then, with a destination set up. */
    failStreak: number;
};

/** Fold one write's outcome into the stored off-device state. */
export function nextOffDeviceBackupState(
    prev: OffDeviceBackupState,
    outcome: ArkOffDeviceOutcome,
    createdAt: number,
): OffDeviceBackupState {
    switch (outcome) {
        case 'written':
            return { at: createdAt, failStreak: 0 };
        case 'none':
            // Nothing outside the app is set up any more, so whatever copy is
            // left there stops getting new capsules from this write on.
            return { at: null, failStreak: 0 };
        case 'failed':
        default: {
            const failStreak = (prev.failStreak ?? 0) + 1;
            return {
                at: failStreak >= ARK_OFF_DEVICE_FAIL_LIMIT ? null : prev.at,
                failStreak,
            };
        }
    }
}

/** The fields a store saved by 0.1.12 or earlier can answer from. */
export type LegacyBackupState = {
    arkLastBackupAt?: number | null;
    arkIosBackupReminderActive?: boolean;
    arkWallet?: { backupDestination?: string | null; restoredFrom?: string | null } | null;
};

/**
 * What a store saved before `arkLastOffDeviceBackupAt` existed (0.1.12 and
 * earlier) says about a copy outside the app, for the time until this build's
 * first backup write decides it. Without it every upgraded vault would read
 * "On this phone only" and show the reminder until that write, including the
 * ones whose iCloud or Drive copy is fine.
 *
 * Up to 0.1.12 a vault could only be created once a copy was saved outside the
 * app, and `backupDestination` records which: "icloud" on iOS, "auto+manual"
 * for Google Drive and "manual" for the chosen folder on Android. A vault
 * restored from Google Drive had Drive connected to do it. The iOS
 * share-sheet path also records "icloud", but it keeps
 * `arkIosBackupReminderActive` on until iCloud Drive is turned on, so a vault
 * with that flag on gets nothing carried over. So does anything else: no
 * backup yet, an older "local" vault, a restore from a file or from the
 * iCloud folder, which can also be a file the user saved there by hand.
 */
export function legacyArkOffDeviceBackupAt(
    persisted: LegacyBackupState | null | undefined,
): number | null {
    const at = persisted?.arkLastBackupAt;
    if (typeof at !== 'number') return null;
    if (persisted?.arkIosBackupReminderActive) return null;
    const dest = persisted?.arkWallet?.backupDestination;
    if (dest === 'icloud' || dest === 'auto+manual' || dest === 'manual') return at;
    if (persisted?.arkWallet?.restoredFrom === 'google-drive') return at;
    return null;
}

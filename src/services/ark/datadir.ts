import RNFS from 'react-native-fs';

export const ARK_DATADIR = `${RNFS.DocumentDirectoryPath}/bark`;

let ensured = false;

export async function ensureArkDatadir(): Promise<string> {
    if (ensured) return ARK_DATADIR;
    if (!(await RNFS.exists(ARK_DATADIR))) {
        await RNFS.mkdir(ARK_DATADIR, {
            NSURLIsExcludedFromBackupKey: true,
            NSFileProtectionKey: 'NSFileProtectionCompleteUntilFirstUserAuthentication',
        });
    }
    ensured = true;
    return ARK_DATADIR;
}

/**
 * Delete the Ark datadir (VTXO state, SQLite, exit txs).
 *
 * DESTRUCTIVE: any funds in VTXOs not backed up externally are unrecoverable
 * after this. Intended for dev-only resets. The `ensured` latch is flipped
 * back so a subsequent `ensureArkDatadir()` recreates the folder cleanly.
 */
export async function deleteArkDatadir(): Promise<void> {
    if (await RNFS.exists(ARK_DATADIR)) {
        await RNFS.unlink(ARK_DATADIR);
    }
    ensured = false;
}

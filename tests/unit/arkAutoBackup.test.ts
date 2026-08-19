/**
 * writeArkAutoBackup must never destroy the last good backup on a tick that
 * stored nothing.
 *
 * Every destination in this function is deliberately silent-fail, which is
 * right for a background write that retries next tick. The hazard is that
 * "this function resolved" was then treated as evidence that something was
 * stored, by two callers that must not be wrong about it:
 *
 *   1. migrateLegacyBackupsForActiveWallet, which DELETES the previous
 *      snapshot, and
 *   2. arkLastBackupAt, which drives "Backed up" in the capsule UI.
 *
 * For a Bark vault the .cbark carries the pre-signed exit chain, so losing
 * every copy also loses the ability to exit unilaterally. That is why this is
 * a unit test and not device QA: you cannot make iCloud, Drive and SAF all
 * fail from the UI, but a background tick on a device with no space and no
 * network does it for free.
 */

const mockRNFS = {
    DocumentDirectoryPath: '/docs',
    writeFile: jest.fn(),
    moveFile: jest.fn(),
    unlink: jest.fn(),
    exists: jest.fn(),
    readFile: jest.fn(),
    readDir: jest.fn(),
    mkdir: jest.fn(),
    stat: jest.fn(),
};

const mockPlatform = { OS: 'ios' as 'ios' | 'android' };
const mockGetICloudDocumentsPath = jest.fn();

jest.mock('react-native', () => ({
    __esModule: true,
    get Platform() {
        return mockPlatform;
    },
    NativeModules: {
        get CypherCloudStorage() {
            return { getICloudDocumentsPath: mockGetICloudDocumentsPath };
        },
    },
}));

jest.mock('react-native-fs', () => ({ __esModule: true, default: mockRNFS }));

jest.mock('react-native-aes-crypto', () => ({
    __esModule: true,
    default: {
        pbkdf2: jest.fn().mockResolvedValue('00'.repeat(32)),
        randomKey: jest.fn().mockResolvedValue('11'.repeat(16)),
        encrypt: jest.fn().mockResolvedValue('CIPHERTEXT'),
        decrypt: jest.fn().mockResolvedValue('{}'),
    },
}));

jest.mock('../../src/services/ark/backupFingerprint', () => ({
    __esModule: true,
    deriveBackupFingerprint: jest.fn().mockResolvedValue('17424cf4'),
    normalizeMnemonic: (m: string) => m.trim(),
}));

jest.mock('../../src/services/ark/datadir', () => ({
    __esModule: true,
    ARK_DATADIR: '/datadir',
    ensureArkDatadir: jest.fn().mockResolvedValue('/datadir'),
}));

const mockIsGoogleDriveConnected = jest.fn();
const mockUploadArkBackupToDrive = jest.fn();
jest.mock('../../src/services/ark/googleDrive', () => ({
    __esModule: true,
    classifyDriveError: jest.fn(() => 'unknown'),
    deleteDriveBackupByFingerprint: jest.fn(),
    deleteLegacyDriveBackup: jest.fn(),
    downloadArkBackupFromDrive: jest.fn().mockResolvedValue(null),
    downloadDriveBackupByFingerprint: jest.fn().mockResolvedValue(null),
    isGoogleDriveConnected: mockIsGoogleDriveConnected,
    uploadArkBackupToDrive: mockUploadArkBackupToDrive,
}));

const mockGetSavedSafBackupFolder = jest.fn();
const mockWriteArkBackupToSaf = jest.fn();
jest.mock('../../src/services/ark/safFolderBackup', () => ({
    __esModule: true,
    deleteLegacySafBackup: jest.fn(),
    deleteSafBackupByFingerprint: jest.fn(),
    getSavedSafBackupFolder: mockGetSavedSafBackupFolder,
    readArkBackupFromSaf: jest.fn().mockResolvedValue(null),
    writeAndReadbackSafBackup: jest.fn(),
    writeArkBackupToSaf: mockWriteArkBackupToSaf,
}));

jest.mock('../../src/services/ark/walletHandle', () => ({
    __esModule: true,
    clearArkWalletHandle: jest.fn(),
}));

jest.mock('../../src/services/ark/restore', () => ({
    __esModule: true,
    openArkWalletWithRotation: jest.fn(),
}));

import { writeArkAutoBackup } from '../../src/services/ark/backup';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/**
 * Deletions that would destroy a real backup.
 *
 * `atomicWriteFile` unlinks its own `.tmp` scratch file on the failure path,
 * which is correct and unrelated. Only non-tmp unlinks represent the legacy
 * cleanup that must not run on a tick that stored nothing.
 */
function legacyDeletions(): string[] {
    return mockRNFS.unlink.mock.calls
        .map((c) => String(c[0]))
        .filter((p) => !p.endsWith('.tmp'));
}

/** Datadir with one file, so the packer always has something to encrypt. */
function healthyDatadir() {
    mockRNFS.readDir.mockResolvedValue([
        { name: 'db.sqlite', path: '/datadir/db.sqlite', isFile: () => true, isDirectory: () => false, size: 10 },
    ]);
    mockRNFS.readFile.mockResolvedValue('ZGF0YQ==');
}

/** Both the atomic move and the direct write fail: no local copy is stored. */
function localWriteFails() {
    mockRNFS.writeFile.mockRejectedValue(new Error('ENOSPC: no space left on device'));
    mockRNFS.moveFile.mockRejectedValue(new Error('ENOSPC: no space left on device'));
}

function localWriteSucceeds() {
    mockRNFS.writeFile.mockResolvedValue(undefined);
    mockRNFS.moveFile.mockResolvedValue(undefined);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.OS = 'ios';
    healthyDatadir();
    mockRNFS.exists.mockResolvedValue(false);
    mockRNFS.mkdir.mockResolvedValue(undefined);
    mockRNFS.unlink.mockResolvedValue(undefined);
    // Default: every mirror unavailable.
    mockGetICloudDocumentsPath.mockResolvedValue(null);
    mockIsGoogleDriveConnected.mockResolvedValue(false);
    mockGetSavedSafBackupFolder.mockResolvedValue(null);
});

describe('writeArkAutoBackup when every destination fails', () => {
    it('rejects rather than resolving, so callers skip the "Backed up" stamp', async () => {
        localWriteFails();
        await expect(writeArkAutoBackup(MNEMONIC)).rejects.toThrow(/wrote nothing/i);
    });

    it('does NOT delete the legacy backup', async () => {
        // The whole point. Pre-fix, the legacy cleanup ran unconditionally, so a
        // tick that stored nothing still removed the previous good snapshot and
        // could leave the wallet with no .cbark anywhere.
        localWriteFails();
        mockRNFS.exists.mockResolvedValue(true); // a legacy file IS present
        await expect(writeArkAutoBackup(MNEMONIC)).rejects.toThrow();
        expect(legacyDeletions()).toEqual([]);
    });

    it('still fails when iCloud is reachable but its write throws', async () => {
        localWriteFails();
        mockGetICloudDocumentsPath.mockResolvedValue('/icloud');
        // iCloud goes through the same RNFS writer, already rejecting above.
        await expect(writeArkAutoBackup(MNEMONIC)).rejects.toThrow(/wrote nothing/i);
        expect(legacyDeletions()).toEqual([]);
    });

    it('still fails when Drive is connected but the upload throws', async () => {
        localWriteFails();
        mockPlatform.OS = 'android';
        mockIsGoogleDriveConnected.mockResolvedValue(true);
        mockUploadArkBackupToDrive.mockRejectedValue(new Error('403 quota'));
        await expect(writeArkAutoBackup(MNEMONIC)).rejects.toThrow(/wrote nothing/i);
        expect(legacyDeletions()).toEqual([]);
    });

    it('still fails when a SAF folder is chosen but the write throws', async () => {
        localWriteFails();
        mockPlatform.OS = 'android';
        mockGetSavedSafBackupFolder.mockResolvedValue('content://tree/backups');
        mockWriteArkBackupToSaf.mockRejectedValue(new Error('permission revoked'));
        await expect(writeArkAutoBackup(MNEMONIC)).rejects.toThrow(/wrote nothing/i);
        expect(legacyDeletions()).toEqual([]);
    });
});

describe('writeArkAutoBackup when at least one destination succeeds', () => {
    it('resolves when only the local write succeeds', async () => {
        localWriteSucceeds();
        await expect(writeArkAutoBackup(MNEMONIC)).resolves.toEqual(
            expect.objectContaining({ path: expect.stringContaining('ark-backup-17424cf4.cbark') }),
        );
    });

    it('resolves when the local write fails but Drive succeeds', async () => {
        // A local-write failure must not veto a tick that DID reach a mirror,
        // otherwise an out-of-space device stops backing up entirely.
        localWriteFails();
        mockPlatform.OS = 'android';
        mockIsGoogleDriveConnected.mockResolvedValue(true);
        mockUploadArkBackupToDrive.mockResolvedValue(undefined);
        await expect(writeArkAutoBackup(MNEMONIC)).resolves.toBeDefined();
    });

    it('resolves when the local write fails but a SAF folder succeeds', async () => {
        localWriteFails();
        mockPlatform.OS = 'android';
        mockGetSavedSafBackupFolder.mockResolvedValue('content://tree/backups');
        mockWriteArkBackupToSaf.mockResolvedValue(undefined);
        await expect(writeArkAutoBackup(MNEMONIC)).resolves.toBeDefined();
    });

    it('reports the size of what it actually wrote', async () => {
        localWriteSucceeds();
        const res = await writeArkAutoBackup(MNEMONIC);
        expect(res.sizeBytes).toBeGreaterThan(0);
        expect(typeof res.createdAt).toBe('number');
    });
});

/**
 * Backup filenames, and who is allowed to touch a file.
 *
 * The bug these guard: a name built from the seed's fingerprint alone is the
 * same name on every device holding that seed, so every device resolved the
 * same path in the same shared storage and the last writer replaced the rest.
 * The instance id puts the writer in the name.
 */

jest.mock('react-native-aes-crypto', () => ({
    randomKey: jest.fn(async (bytes: number) => 'ab'.repeat(bytes)),
}));
jest.mock('@Cypher/stores/storageService', () => ({
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
}));

import {
    buildArkBackupFilename,
    isOwnBackupFilename,
    isValidInstanceId,
    parseArkBackupFilename,
    loadArkBackupInstanceId,
    __resetArkBackupInstanceIdCacheForTests,
    LEGACY_BACKUP_FILENAME_V1,
} from '../../src/services/ark/backupInstance';

const FP = 'd8f74ce1';
const INSTANCE_A = '1111aaaa';
const INSTANCE_B = '2222bbbb';

afterEach(() => {
    __resetArkBackupInstanceIdCacheForTests();
    jest.clearAllMocks();
});

describe('buildArkBackupFilename', () => {
    it('includes both the seed fingerprint and the writing device', () => {
        expect(buildArkBackupFilename(FP, INSTANCE_A)).toBe(
            `ark-backup-${FP}-${INSTANCE_A}.cbark`,
        );
    });

    it('gives two devices holding one seed two different names', () => {
        expect(buildArkBackupFilename(FP, INSTANCE_A)).not.toBe(
            buildArkBackupFilename(FP, INSTANCE_B),
        );
    });

    it('falls back to the v2 name when no instance is known', () => {
        expect(buildArkBackupFilename(FP)).toBe(`ark-backup-${FP}.cbark`);
        expect(buildArkBackupFilename(FP, null)).toBe(`ark-backup-${FP}.cbark`);
    });

    it('falls back to the v1 name when there is no fingerprint either', () => {
        expect(buildArkBackupFilename(null)).toBe(LEGACY_BACKUP_FILENAME_V1);
    });
});

describe('parseArkBackupFilename', () => {
    it('round-trips a per-device name', () => {
        const name = buildArkBackupFilename(FP, INSTANCE_A);
        expect(parseArkBackupFilename(name)).toEqual({
            fingerprint: FP,
            instance: INSTANCE_A,
        });
    });

    it('reports a v2 name as having no identified writer', () => {
        expect(parseArkBackupFilename(`ark-backup-${FP}.cbark`)).toEqual({
            fingerprint: FP,
            instance: null,
        });
    });

    it('returns null for legacy and foreign names', () => {
        for (const name of [
            'ark-backup.cbark',
            'cypher-box-ark-backup.cbark',
            'ark-backup-2026-01-01T00-00-00.cbark',
            'something-else.txt',
            '',
        ]) {
            expect(parseArkBackupFilename(name)).toBeNull();
        }
    });
});

describe('isOwnBackupFilename', () => {
    it('lets a device replace its own file', () => {
        const mine = buildArkBackupFilename(FP, INSTANCE_A);
        expect(isOwnBackupFilename(mine, INSTANCE_A)).toBe(true);
    });

    it('refuses another device file for the same seed, which is the whole bug', () => {
        const theirs = buildArkBackupFilename(FP, INSTANCE_B);
        expect(isOwnBackupFilename(theirs, INSTANCE_A)).toBe(false);
    });

    it('refuses a v2 or legacy file, which has no identified writer', () => {
        expect(isOwnBackupFilename(`ark-backup-${FP}.cbark`, INSTANCE_A)).toBe(false);
        expect(isOwnBackupFilename('ark-backup.cbark', INSTANCE_A)).toBe(false);
    });

    it('refuses everything when this device has no instance yet', () => {
        expect(isOwnBackupFilename(buildArkBackupFilename(FP, INSTANCE_A), null)).toBe(false);
    });
});

describe('loadArkBackupInstanceId', () => {
    it('mints a valid id and caches it for the process', async () => {
        const first = await loadArkBackupInstanceId();
        expect(isValidInstanceId(first)).toBe(true);
        expect(await loadArkBackupInstanceId()).toBe(first);
    });

    it('never mints two ids for concurrent callers', async () => {
        const [a, b, c] = await Promise.all([
            loadArkBackupInstanceId(),
            loadArkBackupInstanceId(),
            loadArkBackupInstanceId(),
        ]);
        expect(b).toBe(a);
        expect(c).toBe(a);
    });

    it('reuses a persisted id rather than minting a second one', async () => {
        const storage = require('@Cypher/stores/storageService');
        storage.getItem.mockResolvedValueOnce('beefcafe');
        expect(await loadArkBackupInstanceId()).toBe('beefcafe');
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('ignores a stored value that is not a valid id', async () => {
        const storage = require('@Cypher/stores/storageService');
        storage.getItem.mockResolvedValueOnce('not-an-id');
        const id = await loadArkBackupInstanceId();
        expect(isValidInstanceId(id)).toBe(true);
        expect(id).not.toBe('not-an-id');
    });

    it('still returns an id when storage cannot be read or written', async () => {
        const storage = require('@Cypher/stores/storageService');
        storage.getItem.mockRejectedValueOnce(new Error('mmkv down'));
        storage.setItem.mockRejectedValueOnce(new Error('mmkv down'));
        // A backup under an ephemeral name beats no backup, and it still
        // cannot collide with another device's file.
        expect(isValidInstanceId(await loadArkBackupInstanceId())).toBe(true);
    });
});

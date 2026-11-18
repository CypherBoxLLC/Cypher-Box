/**
 * Restore and verify must read the file a device actually wrote.
 *
 * With per-device names, the fingerprint-only `ark-backup-<fp>.cbark` is a
 * file from before the upgrade that no build writes any more. Code that still
 * asked for that name first went wrong in two ways:
 *
 *   - Recovery tried it before scanning. On any device that had backed up
 *     before upgrading, it restored the snapshot frozen at the upgrade and
 *     never looked at the per-device files.
 *   - The verified-create flow uploaded `ark-backup-<fp>-<instance>.cbark`
 *     and then read back `ark-backup-<fp>.cbark`. With no old file that read
 *     finds nothing and the backup gate fails. With an old file it checks a
 *     file the upload never touched.
 */

// The modules under test are imported after the mocks below, which build the
// in-memory filesystem, SAF folder and Drive they read, as in arkAutoBackup.
/* eslint-disable import/first */

const FP = 'd8f74ce1';
const MINE = '1111aaaa';
const THEIRS = '2222bbbb';
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SAF_TREE = 'content://tree/backups';

function envelope(v: number, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
        v,
        ...(v >= 2 ? { fingerprint: FP } : {}),
        ...extra,
        kdf: { algo: 'pbkdf2-sha256', salt: 'cypher-box-ark-datadir-v1', iter: 100000 },
        iv: '00'.repeat(16),
        ct: `ct-${v}-${String(extra.instance ?? 'none')}`,
    });
}

/** Written before the upgrade, never written again. */
const V2_FROZEN = envelope(2);
/** This device's per-device file. */
const V3_MINE = envelope(3, { instance: MINE, backupCreatedAt: 1_000 });
/** The other install's per-device file, written later. */
const V3_THEIRS = envelope(3, { instance: THEIRS, backupCreatedAt: 2_000 });
const V1_LEGACY = envelope(1);

// --- react-native: platform, iCloud bridge, SAF bridge ----------------------

const mockPlatform = { OS: 'android' as 'ios' | 'android' };
const mockGetICloudDocumentsPath = jest.fn();
const mockSafFiles = new Map<string, string>();
const mockSaf = {
    takePersistablePermission: jest.fn(),
    listBackups: jest.fn(async () => [...mockSafFiles.keys()]),
    readBackupNamed: jest.fn(async (_tree: string, name: string) => mockSafFiles.get(name) ?? null),
    writeBackupNamed: jest.fn(async (tree: string, name: string, content: string) => {
        mockSafFiles.set(name, content);
        return `${tree}/document/${name}`;
    }),
    deleteBackupNamed: jest.fn(async (_tree: string, name: string) => {
        mockSafFiles.delete(name);
    }),
};

jest.mock('react-native', () => ({
    __esModule: true,
    get Platform() {
        return mockPlatform;
    },
    NativeModules: {
        get CypherCloudStorage() {
            return { getICloudDocumentsPath: mockGetICloudDocumentsPath };
        },
        get ArkSafBackup() {
            return mockSaf;
        },
    },
}));

// --- react-native-fs: an in-memory filesystem --------------------------------

const mockFs = new Map<string, string>();
const mockRNFS = {
    DocumentDirectoryPath: '/docs',
    CachesDirectoryPath: '/caches',
    exists: jest.fn(async (p: string) => mockFs.has(p)),
    readFile: jest.fn(async (p: string) => {
        const v = mockFs.get(p);
        if (v === undefined) throw new Error(`ENOENT: ${p}`);
        return v;
    }),
    writeFile: jest.fn(async (p: string, contents: string) => {
        mockFs.set(p, contents);
    }),
    moveFile: jest.fn(async (from: string, to: string) => {
        const v = mockFs.get(from);
        if (v === undefined) throw new Error(`ENOENT: ${from}`);
        mockFs.delete(from);
        mockFs.set(to, v);
    }),
    copyFile: jest.fn(async (from: string, to: string) => {
        const v = mockFs.get(from);
        if (v === undefined) throw new Error(`ENOENT: ${from}`);
        mockFs.set(to, v);
    }),
    unlink: jest.fn(async (p: string) => {
        mockFs.delete(p);
    }),
    mkdir: jest.fn(async () => undefined),
    readDir: jest.fn(async (dir: string) =>
        [...mockFs.keys()]
            .filter(p => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
            .map(p => ({
                name: p.slice(dir.length + 1),
                path: p,
                size: mockFs.get(p)!.length,
                isFile: () => true,
                isDirectory: () => false,
            })),
    ),
};
jest.mock('react-native-fs', () => ({ __esModule: true, default: mockRNFS }));

// --- crypto, storage and the rest of the Ark module graph --------------------

jest.mock('react-native-aes-crypto', () => ({
    __esModule: true,
    default: {
        pbkdf2: jest.fn().mockResolvedValue('00'.repeat(32)),
        randomKey: jest.fn().mockResolvedValue('11'.repeat(16)),
        encrypt: jest.fn().mockResolvedValue('CIPHERTEXT'),
        // Any envelope "decrypts" to a one-file manifest: these tests are about
        // which file is read, not about the cipher.
        decrypt: jest.fn().mockResolvedValue(
            JSON.stringify({ version: 2, createdAt: 1, files: [{ path: 'db.sqlite', data: 'ZGF0YQ==' }] }),
        ),
    },
}));

/** This install's persisted instance id. */
jest.mock('@Cypher/stores/storageService', () => ({
    __esModule: true,
    getItem: jest.fn(async () => '1111aaaa'),
    setItem: jest.fn(async () => undefined),
}));

/** The SAF folder the user picked, as safFolderBackup reads it from AsyncStorage. */
const mockSafTree: { value: string | null } = { value: null };
jest.mock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: {
        getItem: jest.fn(async () => mockSafTree.value),
        setItem: jest.fn(async () => undefined),
        removeItem: jest.fn(async () => undefined),
    },
}));

jest.mock('react-native-document-picker', () => ({ __esModule: true, default: {} }));

jest.mock('@react-native-google-signin/google-signin', () => ({
    __esModule: true,
    GoogleSignin: {
        hasPreviousSignIn: () => true,
        getTokens: async () => ({ accessToken: 'unit-test-token' }),
    },
}));

jest.mock('../../src/services/ark/backupFingerprint', () => ({
    __esModule: true,
    deriveBackupFingerprint: jest.fn().mockResolvedValue('d8f74ce1'),
    normalizeMnemonic: (m: string) => m.trim(),
}));

jest.mock('../../src/services/ark/datadir', () => ({
    __esModule: true,
    ARK_DATADIR: '/datadir',
    ensureArkDatadir: jest.fn().mockResolvedValue('/datadir'),
}));

jest.mock('../../src/services/ark/walletHandle', () => ({
    __esModule: true,
    clearArkWalletHandle: jest.fn(),
}));

jest.mock('../../src/services/ark/restore', () => ({
    __esModule: true,
    openArkWalletWithRotation: jest.fn(),
}));

// --- Drive appDataFolder: the REST calls googleDrive.ts makes ----------------

const mockDrive = new Map<string, { id: string; content: string }>();
let mockDriveNextId = 0;

function driveResponse(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
}

const driveFetch = jest.fn(async (input: string, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
        const q = new URL(url).searchParams.get('q');
        const byName = q ? /^name='(.*)'$/.exec(q)?.[1] : undefined;
        const files = [...mockDrive.entries()]
            .filter(([name]) => byName === undefined || name === byName)
            .map(([name, f]) => ({ id: f.id, name, size: String(f.content.length) }));
        return driveResponse(200, { files });
    }
    const download = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/?]+)\?alt=media$/.exec(url);
    if (method === 'GET' && download) {
        const file = [...mockDrive.values()].find(f => f.id === download[1]);
        return file ? driveResponse(200, file.content) : driveResponse(404, 'not found');
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
        // multipart/related: metadata JSON part, then the blob part.
        const parts = String(init?.body).split(/\r\n--cypherbox-\d+(?:--)?\r?\n?/);
        const metadata = JSON.parse(parts[0].split('\r\n\r\n')[1]);
        const content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n');
        const patchId = /\/files\/([^/?]+)\?uploadType=multipart$/.exec(url)?.[1];
        if (method === 'PATCH' && patchId) {
            const entry = [...mockDrive.entries()].find(([, f]) => f.id === patchId);
            if (!entry) return driveResponse(404, 'not found');
            mockDrive.set(entry[0], { id: patchId, content });
            return driveResponse(200, { id: patchId });
        }
        const id = `drive-${++mockDriveNextId}`;
        mockDrive.set(metadata.name, { id, content });
        return driveResponse(200, { id });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
});

import {
    lookupArkBackupInLocalDocuments,
    lookupArkBackupInSafFolder,
    lookupArkBackupOnDrive,
} from '../../src/services/ark/findBackup';
import { writeAndVerifyArkBackup } from '../../src/services/ark/backup';
import { __resetArkBackupInstanceIdCacheForTests } from '../../src/services/ark/backupInstance';

const realFetch = global.fetch;

beforeEach(() => {
    jest.clearAllMocks();
    __resetArkBackupInstanceIdCacheForTests();
    mockPlatform.OS = 'android';
    mockGetICloudDocumentsPath.mockResolvedValue(null);
    mockFs.clear();
    mockSafFiles.clear();
    mockSafTree.value = null;
    mockDrive.clear();
    mockDriveNextId = 0;
    (global as any).fetch = driveFetch;
});

afterAll(() => {
    (global as any).fetch = realFetch;
});

describe('local Documents', () => {
    it('restores the per-device file, not the file frozen at the upgrade', async () => {
        mockFs.set(`/docs/ark-backup-${FP}.cbark`, V2_FROZEN);
        mockFs.set(`/docs/ark-backup-${FP}-${MINE}.cbark`, V3_MINE);
        await expect(lookupArkBackupInLocalDocuments(FP)).resolves.toEqual({
            kind: 'matched',
            blob: V3_MINE,
        });
    });

    it('still restores a v2 file when it is the only one', async () => {
        mockFs.set(`/docs/ark-backup-${FP}.cbark`, V2_FROZEN);
        await expect(lookupArkBackupInLocalDocuments(FP)).resolves.toEqual({
            kind: 'matched',
            blob: V2_FROZEN,
        });
    });

    it('still offers a v1 file for the seed to try', async () => {
        mockFs.set('/docs/ark-backup.cbark', V1_LEGACY);
        await expect(lookupArkBackupInLocalDocuments(FP)).resolves.toEqual({
            kind: 'legacy-v1-candidate',
            blob: V1_LEGACY,
        });
    });
});

describe('iCloud container', () => {
    beforeEach(() => {
        mockPlatform.OS = 'ios';
        mockGetICloudDocumentsPath.mockResolvedValue('/icloud');
    });

    it('ranks the per-device files above the file frozen at the upgrade', async () => {
        mockFs.set(`/icloud/ark-backup-${FP}.cbark`, V2_FROZEN);
        mockFs.set(`/icloud/ark-backup-${FP}-${MINE}.cbark`, V3_MINE);
        mockFs.set(`/icloud/ark-backup-${FP}-${THEIRS}.cbark`, V3_THEIRS);
        await expect(lookupArkBackupInLocalDocuments(FP)).resolves.toEqual({
            kind: 'matched',
            blob: V3_THEIRS,
        });
    });

    it('finds a backup written by the other install', async () => {
        mockFs.set(`/icloud/ark-backup-${FP}-${THEIRS}.cbark`, V3_THEIRS);
        await expect(lookupArkBackupInLocalDocuments(FP)).resolves.toEqual({
            kind: 'matched',
            blob: V3_THEIRS,
        });
    });
});

describe('Drive appDataFolder', () => {
    it('ranks the per-device files above the file frozen at the upgrade', async () => {
        mockDrive.set(`ark-backup-${FP}.cbark`, { id: 'v2', content: V2_FROZEN });
        mockDrive.set(`ark-backup-${FP}-${THEIRS}.cbark`, { id: 'theirs', content: V3_THEIRS });
        await expect(lookupArkBackupOnDrive(FP)).resolves.toEqual({
            kind: 'matched',
            blob: V3_THEIRS,
        });
    });

    it('still restores a v2 file when it is the only one', async () => {
        mockDrive.set(`ark-backup-${FP}.cbark`, { id: 'v2', content: V2_FROZEN });
        await expect(lookupArkBackupOnDrive(FP)).resolves.toEqual({
            kind: 'matched',
            blob: V2_FROZEN,
        });
    });
});

describe('SAF folder', () => {
    beforeEach(() => {
        mockSafTree.value = SAF_TREE;
    });

    it('ranks the per-device files above the file frozen at the upgrade', async () => {
        mockSafFiles.set(`ark-backup-${FP}.cbark`, V2_FROZEN);
        mockSafFiles.set(`ark-backup-${FP}-${MINE}.cbark`, V3_MINE);
        mockSafFiles.set(`ark-backup-${FP}-${THEIRS}.cbark`, V3_THEIRS);
        await expect(lookupArkBackupInSafFolder(FP)).resolves.toEqual({
            kind: 'matched',
            blob: V3_THEIRS,
        });
    });

    it('finds a backup written by the other install', async () => {
        mockSafFiles.set(`ark-backup-${FP}-${THEIRS}.cbark`, V3_THEIRS);
        await expect(lookupArkBackupInSafFolder(FP)).resolves.toEqual({
            kind: 'matched',
            blob: V3_THEIRS,
        });
    });
});

describe('writeAndVerifyArkBackup reads back what it wrote', () => {
    beforeEach(() => {
        mockFs.set('/datadir/db.sqlite', 'ZGF0YQ==');
    });

    it('verifies a fresh Drive upload, where no older file exists', async () => {
        const result = await writeAndVerifyArkBackup(MNEMONIC);
        expect(result.drive).toEqual({ kind: 'uploaded-and-verified', fileId: 'drive-1' });
        expect([...mockDrive.keys()]).toEqual([`ark-backup-${FP}-${MINE}.cbark`]);
    });

    it('verifies the new Drive file, not the one frozen at the upgrade', async () => {
        mockDrive.set(`ark-backup-${FP}.cbark`, { id: 'v2', content: V2_FROZEN });
        const result = await writeAndVerifyArkBackup(MNEMONIC);
        expect(result.drive).toEqual({ kind: 'uploaded-and-verified', fileId: 'drive-1' });
        const downloads = driveFetch.mock.calls.map(c => String(c[0])).filter(u => u.endsWith('?alt=media'));
        expect(downloads).toEqual(['https://www.googleapis.com/drive/v3/files/drive-1?alt=media']);
        // The old file is left exactly as it was.
        expect(mockDrive.get(`ark-backup-${FP}.cbark`)).toEqual({ id: 'v2', content: V2_FROZEN });
    });

    it('verifies a fresh SAF write, where no older file exists', async () => {
        mockSafTree.value = SAF_TREE;
        const result = await writeAndVerifyArkBackup(MNEMONIC);
        expect(result.saf.kind).toBe('written-and-verified');
        expect(mockSaf.readBackupNamed).toHaveBeenCalledWith(SAF_TREE, `ark-backup-${FP}-${MINE}.cbark`);
        expect(mockSaf.readBackupNamed).not.toHaveBeenCalledWith(SAF_TREE, `ark-backup-${FP}.cbark`);
    });
});

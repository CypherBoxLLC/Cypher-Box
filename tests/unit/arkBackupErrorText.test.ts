/**
 * A backup file that can't be restored is reported inside "Backup file is corrupt: {error}". backup.ts throws in
 * English, which the logs keep, and RecoverArkScreen translates at display. These run the real restore up to the
 * error and check each message it throws is one the screen knows, so an English reason never lands in an Arabic
 * sentence (the wrong-seed case did: "Decryption failed. The seed may not match this backup.").
 */

// The modules under test are imported after the mocks below.
/* eslint-disable import/first */

const mockDecrypt = jest.fn();

jest.mock('../../loc', () => ({
  __esModule: true,
  default: {
    formatString: (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_: string, key: string) => values[key]),
    cypherbox: {
      services: {
        ark_backup: {
          not_valid_json: 'ar: not json',
          seed_mismatch: 'ar: seed mismatch',
          manifest_corrupted: 'ar: manifest not json',
          malformed: 'ar: malformed',
          unsupported_version: 'ar: version {version}, reads v{oldest} to v{newest}',
          missing_ciphertext: 'ar: no ciphertext',
          decrypt_failed: 'ar: decryption failed',
          no_files: 'ar: no files',
          entry_wrong_shape: 'ar: wrong shape',
          unsafe_path: 'ar: unsafe path {path}',
        },
      },
    },
  },
}));
jest.mock('react-native-aes-crypto', () => ({
  __esModule: true,
  default: { pbkdf2: jest.fn().mockResolvedValue('00'.repeat(32)), decrypt: (...args: unknown[]) => mockDecrypt(...args) },
}));
jest.mock('../../src/services/ark/backupFingerprint', () => ({
  __esModule: true,
  deriveBackupFingerprint: jest.fn(),
  normalizeMnemonic: (m: string) => m.trim(),
}));
jest.mock('../../src/services/ark/datadir', () => ({ __esModule: true, ARK_DATADIR: '/datadir', ensureArkDatadir: jest.fn() }));
jest.mock('../../src/services/ark/googleDrive', () => ({ __esModule: true }));
jest.mock('../../src/services/ark/safFolderBackup', () => ({ __esModule: true }));
jest.mock('../../src/services/ark/walletHandle', () => ({ __esModule: true, clearArkWalletHandle: jest.fn() }));
jest.mock('../../src/services/ark/restore', () => ({ __esModule: true, openArkWalletWithRotation: jest.fn() }));

import { restoreArkBackupBlob } from '../../src/services/ark/backup';
import backupErrorText from '../../src/screens/Account/RecoverArkScreen/backupErrorText';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const sealed = JSON.stringify({ v: 3, iv: '00'.repeat(16), ct: 'CIPHERTEXT' });

// what restoring this file throws, as the recovery screen shows it
async function shown(blob: string): Promise<string> {
  try {
    await restoreArkBackupBlob(blob, MNEMONIC);
  } catch (err: any) {
    return backupErrorText(err.message);
  }
  throw new Error('the restore did not fail');
}

beforeEach(() => {
  mockDecrypt.mockReset();
});

it('translates a file that is not a backup envelope', async () => {
  await expect(shown('null')).resolves.toBe('ar: malformed');
  await expect(shown(JSON.stringify({ v: 3 }))).resolves.toBe('ar: no ciphertext');
});

it('translates a backup from a newer version, keeping the numbers', async () => {
  await expect(shown(JSON.stringify({ v: 9, iv: '', ct: '' }))).resolves.toBe('ar: version 9, reads v1 to v3');
});

it('translates the wrong-seed case', async () => {
  mockDecrypt.mockRejectedValue(new Error('bad decrypt'));
  await expect(shown(sealed)).resolves.toBe('ar: decryption failed');
});

it('translates a decrypted manifest that lists no files, or bad ones', async () => {
  mockDecrypt.mockResolvedValue('{}');
  await expect(shown(sealed)).resolves.toBe('ar: no files');

  mockDecrypt.mockResolvedValue(JSON.stringify({ files: [{ path: 1, b64: '' }] }));
  await expect(shown(sealed)).resolves.toBe('ar: wrong shape');

  mockDecrypt.mockResolvedValue(JSON.stringify({ files: [{ path: '../keys', b64: '' }] }));
  await expect(shown(sealed)).resolves.toBe('ar: unsafe path ../keys');
});

it('leaves messages already translated where they are thrown as they are', async () => {
  await expect(shown('not json')).resolves.toBe('ar: not json');
  mockDecrypt.mockResolvedValue('');
  await expect(shown(sealed)).resolves.toBe('ar: seed mismatch');
});

it('returns a message it does not know unchanged', () => {
  expect(backupErrorText('BarkError.ServerConnection')).toBe('BarkError.ServerConnection');
});

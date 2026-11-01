import RNFS from 'react-native-fs';
import DocumentPicker from 'react-native-document-picker';

jest.mock('react-native-document-picker', () => ({
  pickSingle: jest.fn(),
  isCancel: jest.fn(() => false),
  types: { allFiles: '*/*' },
}));
jest.mock('react-native-share', () => ({}));
jest.mock('react-native-image-picker', () => ({}));
jest.mock('@flyskywhy/react-native-qrcode-local-image', () => ({}));
jest.mock('../../components/Alert', () => jest.fn());

const fs = require('../../blue_modules/fs');
const alert = require('../../components/Alert');

// only the file plumbing is under test here, so any hex text stands in for a .txn file's contents
const SIGNED_TX_HEX = '02000000' + 'ab'.repeat(60) + '00000000';

const pickSingle = DocumentPicker.pickSingle as jest.Mock;
const readFile = jest.fn();

describe('fs.pickedFilePath', () => {
  it('decodes iOS file URLs and leaves Android content URIs alone', () => {
    expect(fs.pickedFilePath('file:///tmp/Signed%20psbt%20ready.txn')).toBe('file:///tmp/Signed psbt ready.txn');
    expect(fs.pickedFilePath('content://x/document/primary%3ADownload%2Ftx.txn')).toBe('content://x/document/primary%3ADownload%2Ftx.txn');
  });
});

describe('fs.openSignedTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (RNFS as any).readFile = readFile;
    // the real RNFS returns base64 of the file's bytes when asked for 'base64'
    readFile.mockImplementation(async (_path: string, encoding: string) =>
      encoding === 'base64' ? Buffer.from(SIGNED_TX_HEX).toString('base64') : SIGNED_TX_HEX,
    );
  });

  it('reads an iOS file whose name has spaces', async () => {
    pickSingle.mockResolvedValue({ uri: 'file:///private/var/mobile/tmp/app-Inbox/Signed%20psbt%20ready.txn' });

    await expect(fs.openSignedTransaction()).resolves.toBe(SIGNED_TX_HEX);
    expect(readFile.mock.calls[0][0]).toBe('file:///private/var/mobile/tmp/app-Inbox/Signed psbt ready.txn');
    expect(alert).not.toHaveBeenCalled();
  });

  it('decodes characters decodeURI would leave encoded, like #', async () => {
    pickSingle.mockResolvedValue({ uri: 'file:///tmp/tx%231.txn' });

    await fs.openSignedTransaction();
    expect(readFile.mock.calls[0][0]).toBe('file:///tmp/tx#1.txn');
  });

  it('leaves Android content:// URIs encoded', async () => {
    const uri = 'content://com.android.externalstorage.documents/document/primary%3ADownload%2Ftx.txn';
    pickSingle.mockResolvedValue({ uri });

    await fs.openSignedTransaction();
    expect(readFile.mock.calls[0][0]).toBe(uri);
  });

  it('returns a binary PSBT as base64', async () => {
    const binaryPsbt = Buffer.concat([Buffer.from('psbt'), Buffer.from([0xff, 0x01, 0x00])]);
    readFile.mockResolvedValue(binaryPsbt.toString('base64'));
    pickSingle.mockResolvedValue({ uri: 'file:///tmp/signed.psbt' });

    await expect(fs.openSignedTransaction()).resolves.toBe(binaryPsbt.toString('base64'));
  });

  it('alerts and returns false when the file cannot be read', async () => {
    pickSingle.mockResolvedValue({ uri: 'file:///tmp/missing.txn' });
    readFile.mockRejectedValue(new Error('ENOENT'));

    await expect(fs.openSignedTransaction()).resolves.toBe(false);
    expect(alert).toHaveBeenCalledTimes(1);
  });
});

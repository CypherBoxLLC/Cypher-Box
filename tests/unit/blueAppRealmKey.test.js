/**
 * The wallet-transactions Realm cache used to be encrypted with a key derived
 * from a hardcoded literal that ships in the public source, so the file's key
 * was effectively public. It now uses a device-random secret held in the
 * Keychain (getDefaultRealmSecret), minted once and never re-minted over a
 * possibly-present key. These tests pin that behaviour and pin the legacy file
 * path so the one-time migration deletes the right (public-key) file.
 */

const mockGetGenericPassword = jest.fn();
const mockSetGenericPassword = jest.fn();

jest.mock('react-native-keychain', () => ({
  __esModule: true,
  getGenericPassword: mockGetGenericPassword,
  setGenericPassword: mockSetGenericPassword,
  resetGenericPassword: jest.fn(),
  getAllGenericPasswordServices: jest.fn(async () => []),
  ACCESSIBLE: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
    AFTER_FIRST_UNLOCK: 'afterFirstUnlock',
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
  },
}));

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));

const createHash = require('create-hash');
const BlueApp = require('../../BlueApp');
const AppStorage = BlueApp.AppStorage;

beforeEach(() => {
  mockGetGenericPassword.mockReset();
  mockSetGenericPassword.mockReset().mockResolvedValue();
});

describe('getDefaultRealmSecret (wallettransactions.realm key)', () => {
  it('mints a device-random 64-hex key on genuine absence, readable after first unlock on this device only', async () => {
    mockGetGenericPassword.mockResolvedValue(false); // no entry
    const app = new AppStorage();

    const secret = await app.getDefaultRealmSecret();

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(mockSetGenericPassword).toHaveBeenCalledTimes(1);
    const opts = mockSetGenericPassword.mock.calls[0][2];
    expect(opts.service).toBe('wallettransactions_realm_key');
    // a background launch on a locked phone has to read it
    expect(opts.accessible).toBe('afterFirstUnlockThisDeviceOnly');
  });

  it('returns an existing key without minting', async () => {
    mockGetGenericPassword.mockResolvedValue({ password: 'ab'.repeat(32) });
    const app = new AppStorage();

    const secret = await app.getDefaultRealmSecret();

    expect(secret).toBe('ab'.repeat(32));
    expect(mockSetGenericPassword).not.toHaveBeenCalled();
  });

  it('caches: a second call does not re-read the keychain', async () => {
    mockGetGenericPassword.mockResolvedValue({ password: 'cd'.repeat(32) });
    const app = new AppStorage();

    await app.getDefaultRealmSecret();
    await app.getDefaultRealmSecret();

    expect(mockGetGenericPassword).toHaveBeenCalledTimes(1);
  });

  it('refuses to mint on a keychain READ error (throws, no write)', async () => {
    mockGetGenericPassword.mockRejectedValue(new Error('keychain locked'));
    const app = new AppStorage();

    await expect(app.getDefaultRealmSecret()).rejects.toThrow(/refusing to mint/);
    expect(mockSetGenericPassword).not.toHaveBeenCalled();
  });
});

describe('openRealmKeyValue (keyvalue.realm, the fallback copy of the wallet list)', () => {
  it('mints its key readable after first unlock, as before, so a locked background launch can still load the wallets', async () => {
    mockGetGenericPassword.mockResolvedValue(false); // fresh install
    const app = new AppStorage();

    await app.openRealmKeyValue();

    expect(mockSetGenericPassword).toHaveBeenCalledTimes(1);
    const [user, password, opts] = mockSetGenericPassword.mock.calls[0];
    expect(user).toBe('realm_encryption_key');
    expect(password).toMatch(/^[0-9a-f]{128}$/);
    expect(opts.service).toBe('realm_encryption_key');
    expect(opts.accessible).toBe('afterFirstUnlock');
  });

  it('opens an existing key without minting', async () => {
    mockGetGenericPassword.mockResolvedValue({ password: 'ef'.repeat(64) });
    const app = new AppStorage();

    await app.openRealmKeyValue();

    expect(mockSetGenericPassword).not.toHaveBeenCalled();
  });

  it('refuses to mint on a keychain READ error, which would orphan the existing copy', async () => {
    mockGetGenericPassword.mockRejectedValue(new Error('keychain locked'));
    const app = new AppStorage();

    await expect(app.openRealmKeyValue()).rejects.toThrow(/refusing to mint/);
    expect(mockSetGenericPassword).not.toHaveBeenCalled();
  });
});

describe('legacy wallettransactions.realm path (migration target)', () => {
  it('matches the pre-fix deterministic path for the hardcoded literal', () => {
    const app = new AppStorage();
    const h = s => createHash('sha256').update(s).digest().toString('hex');

    // what migrateLegacyWalletTransactionsRealm computes:
    const legacyPassword = app.hashIt('fyegjitkyf[eqjnc.lf');
    const legacyPath = app.hashIt(app.hashIt(legacyPassword)) + '-wallettransactions.realm';

    // what the OLD getRealm produced for cachedPassword === false:
    const expected = h(h(h('fyegjitkyf[eqjnc.lf'))) + '-wallettransactions.realm';

    expect(legacyPath).toBe(expected);
  });
});

import { MMKV } from 'react-native-mmkv';
import * as Keychain from 'react-native-keychain';
import { getItem, removeItem, setItem } from '../../src/stores/storageService';

// Deterministic RNG so the test does not need the native module.
jest.mock('../../class/rng', () => ({
  randomBytes: async (n: number) => Buffer.alloc(n, 7),
}));

jest.mock('react-native-keychain', () => {
  const vault = new Map<string, string>();
  return {
    __vault: vault,
    ACCESSIBLE: {
      WHEN_UNLOCKED: 'WHEN_UNLOCKED',
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
      WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY',
    },
    getGenericPassword: async (options?: { service?: string }) => {
      const service = options && options.service;
      if (service && vault.has(service)) {
        return { username: service, password: vault.get(service), service };
      }
      return false;
    },
    setGenericPassword: async (username: string, password: string, options?: { service?: string }) => {
      const service = (options && options.service) || username;
      vault.set(service, password);
      return { service };
    },
    resetGenericPassword: async (options?: { service?: string }) => {
      if (options && options.service) vault.delete(options.service);
      return true;
    },
  };
});

const mmkvStores = () => (MMKV as unknown as { __stores: Map<string, Map<string, string>> }).__stores;
const keychainVault = () => (jest.requireMock('react-native-keychain') as { __vault: Map<string, string> }).__vault;

// NOTE: storageService lazily builds its store on first access and caches it
// module-internally, so the migration test must run before any other access.
describe('storageService (secure MMKV with keychain-held device key)', () => {
  it('migrates v2 (public-key) data into v3 and clears the legacy store', async () => {
    const legacy = new MMKV({ id: 'cypherbox-secure', encryptionKey: 'cypherbox-mmkv-v1' });
    legacy.set('auth', JSON.stringify({ token: 'coinos-token-123' }));

    expect(await getItem('auth')).toEqual({ token: 'coinos-token-123' });

    // legacy cleared, v3 holds the migrated value
    expect(legacy.getAllKeys()).toEqual([]);
    const v3 = new MMKV({ id: 'cypherbox-secure-v3', encryptionKey: 'irrelevant-for-mock' });
    expect(JSON.parse(v3.getString('auth') as string)).toEqual({ token: 'coinos-token-123' });

    // the device key lives in the keychain and is NOT the old public constant
    const creds: any = await Keychain.getGenericPassword({ service: 'cypherbox.mmkv.v3.key' });
    expect(creds).toBeTruthy();
    expect(creds.password).not.toBe('cypherbox-mmkv-v1');
    expect(creds.password.length).toBe(64); // 32 random bytes as hex
  });

  it('keeps one stable device key across writes', async () => {
    await setItem('a', 1);
    const first: any = await Keychain.getGenericPassword({ service: 'cypherbox.mmkv.v3.key' });
    await setItem('b', 2);
    const second: any = await Keychain.getGenericPassword({ service: 'cypherbox.mmkv.v3.key' });
    expect(first.password).toBeTruthy();
    expect(first.password).toBe(second.password);
  });

  it('round-trips values and returns null for missing keys', async () => {
    await setItem('k', { a: 1 });
    expect(await getItem('k')).toEqual({ a: 1 });
    await removeItem('k');
    expect(await getItem('k')).toBeNull();
    expect(await getItem('never-set')).toBeNull();
  });
});

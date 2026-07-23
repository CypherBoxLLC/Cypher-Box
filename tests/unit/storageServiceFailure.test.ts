import { getItem, setItem } from '../../src/stores/storageService';

// Controllable keychain mock. State lives INSIDE the factory (hoisting-safe)
// and the tests toggle it via jest.requireMock().__state. `react-native-mmkv`
// is auto-mocked from __mocks__/, and rng is stubbed deterministically.
jest.mock('react-native-keychain', () => {
  const state = {
    readMode: 'throw' as 'throw' | 'normal',
    mints: 0,
    vault: new Map<string, string>(),
  };
  return {
    __state: state,
    ACCESSIBLE: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    },
    getGenericPassword: async (o?: { service?: string }) => {
      if (state.readMode === 'throw') {
        throw new Error('keystore temporarily unavailable');
      }
      const service = o?.service ?? '';
      return state.vault.has(service)
        ? { username: service, password: state.vault.get(service), service }
        : false;
    },
    setGenericPassword: async (u: string, p: string, o?: { service?: string }) => {
      state.mints += 1;
      state.vault.set(o?.service ?? u, p);
      return { service: o?.service ?? u };
    },
  };
});

jest.mock('../../class/rng', () => ({
  randomBytes: async (n: number) => Buffer.alloc(n, 7),
}));

const kc = jest.requireMock('react-native-keychain') as {
  __state: { readMode: 'throw' | 'normal'; mints: number; vault: Map<string, string> };
};

describe('storageService failure handling', () => {
  it('does not mint a replacement key on a keychain READ error, and retries after recovery', async () => {
    // A read error means the key may exist but be unreadable (locked keystore,
    // transient failure). Minting a fresh key here would open the existing v3
    // store with the wrong key and, after migrateInto() clears the legacy
    // stores, permanently orphan the encrypted tokens.
    kc.__state.readMode = 'throw';
    await expect(setItem('k', 1)).rejects.toThrow(/keychain read failed/);
    expect(kc.__state.mints).toBe(0); // never minted over a possibly-existing key
    expect(await getItem('k')).toBeNull(); // read also fails safe

    // The rejection must NOT be cached: once the keychain recovers, the next
    // access retries and succeeds (a genuine first-run mint this time).
    kc.__state.readMode = 'normal';
    await setItem('k', 2);
    expect(kc.__state.mints).toBe(1);
    expect(await getItem('k')).toBe(2);
  });
});

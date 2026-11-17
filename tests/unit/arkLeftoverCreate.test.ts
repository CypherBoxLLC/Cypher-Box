/**
 * Creating a Bark vault over a leftover from an interrupted create.
 *
 * A create that dies after Wallet.create wrote the datadir but before the vault was recorded (an app crash during the
 * backup step, or Android killing the app while Google sign-in or the folder picker is open) leaves the datadir with no
 * vault in the app. The one-vault refusal then blocked every later create with "Delete it in Vault settings", and there
 * was no vault to delete. The seed screen now offers its Reset & retry for that leftover, and only for a leftover.
 */

import RNFS from 'react-native-fs';

import { ARK_VAULT_EXISTS, offersArkReset } from '../../src/services/ark/createErrors';
import { createArkWallet } from '../../src/services/ark/walletHandle';

jest.mock('@secondts/bark-react-native', () => ({
  __esModule: true,
  uniffiInitAsync: jest.fn(async () => undefined),
  Network: { Bitcoin: 'bitcoin' },
  Config: { create: jest.fn((o: unknown) => o) },
  OnchainWallet: { default_: jest.fn() },
  Wallet: { open: jest.fn(), create: jest.fn() },
  WalletOpenArgs: { create: jest.fn((o: unknown) => o) },
}));

jest.mock('../../src/stores/index', () => ({
  __esModule: true,
  zustandStorage: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const vaultExists = Object.assign(new Error('A Bark Vault already exists on this device.'), { code: ARK_VAULT_EXISTS });
const leftover = { handleOpen: false, storeLoaded: true, isArkAuth: false };

describe('which create failures the seed screen offers Reset & retry for', () => {
  it('offers it for the one-vault refusal when the datadir is a leftover', () => {
    expect(offersArkReset(vaultExists, leftover)).toBe(true);
  });

  it('keeps refusing when a vault is recorded in the app', () => {
    expect(offersArkReset(vaultExists, { ...leftover, isArkAuth: true })).toBe(false);
  });

  it('keeps refusing while a wallet handle is open', () => {
    expect(offersArkReset(vaultExists, { ...leftover, handleOpen: true })).toBe(false);
  });

  it('keeps refusing before the store has loaded, when no vault recorded proves nothing', () => {
    expect(offersArkReset(vaultExists, { ...leftover, storeLoaded: false })).toBe(false);
  });

  it("still offers it for bark's stale-datadir errors, whatever the app state", () => {
    for (const message of ['Internal error', 'Database is locked', 'InvalidMnemonic', 'incorrect mnemonic']) {
      expect(offersArkReset(new Error(message), { ...leftover, isArkAuth: true })).toBe(true);
    }
  });

  it('does not offer it for anything else', () => {
    expect(offersArkReset(new Error('Network request failed'), leftover)).toBe(false);
    expect(offersArkReset(undefined, leftover)).toBe(false);
    expect(offersArkReset({ code: 'SOMETHING_ELSE' }, leftover)).toBe(false);
  });
});

describe('the refusal itself', () => {
  it('carries the code the seed screen checks', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    (RNFS.readDir as jest.Mock).mockResolvedValue([{ name: 'db.sqlite' }]);

    await expect(createArkWallet(MNEMONIC)).rejects.toMatchObject({ code: ARK_VAULT_EXISTS });
  });
});

/**
 * Loading capsules must not derive private keys, and private keys must not be saved with the wallet.
 *
 * fetchUtxo used to put a WIF on every UTXO, and every WIF re-ran the BIP39 seed (PBKDF2, 2048 rounds of
 * HMAC-SHA512 in JS): seconds of frozen JS thread per address holding a capsule, so a restored Hot Vault with 31
 * capsule addresses froze the app for almost two minutes. The keys then went into the wallet store through
 * `_address_to_wif_cache` and each UTXO's `wif`.
 *
 * Now keys are derived only to sign, from account nodes worked out once per wallet per session, and anything an
 * older version stored is dropped on load and before every save. These tests pin that down, and check that the
 * signatures are still made with exactly the keys the old derivation produced.
 */
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import BIP47Factory from '@spsina/bip47';
import { ECPairFactory } from 'ecpair';
import * as bitcoin from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { HDSegwitBech32Wallet, MultisigHDWallet } from '../../class';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetUtxoByAddress: jest.fn(),
  estimateCurrentBlockheight: jest.fn(() => 900_000),
}));

const BlueElectrum = require('../../blue_modules/BlueElectrum');
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

// public test vectors, never funded on purpose
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_2 = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const BIP47_ALICE = 'response seminar brave tip suit recall often sound stick owner lottery motion';
const BIP47_BOB = 'reward upper indicate eight swift arch injury crystal super wrestle already dentist';
const DESTINATION = 'bc1qtmcfj7lvgjp866w8lytdpap82u7eege58jy52hp4ctk0hsncegyqel8prp';
const MULTISIG_PATH = "m/48'/0'/0'/2'";

// reference keys the old way (root from the seed, whole path), worked out before any spy is installed
const referenceRoot = bip32.fromSeed(bip39.mnemonicToSeedSync(MNEMONIC));
const referenceWif = (chain: 0 | 1, index: number) => referenceRoot.derivePath(`m/84'/0'/0'/${chain}/${index}`).toWIF();
const referenceMultisigRoots = [MNEMONIC, MNEMONIC_2].map(m => bip32.fromSeed(bip39.mnemonicToSeedSync(m)));
const referenceMultisigXpubs = [MNEMONIC, MNEMONIC_2].map(m => MultisigHDWallet.seedToXpub(m, MULTISIG_PATH));

const txid = (n: number) => n.toString(16).padStart(64, '0');

/** What BlueApp.saveToDisk writes for one wallet (minus the transactions it offloads to Realm). */
function saveLikeAppStorage(wallet: any): string {
  wallet.prepareForSerialization();
  const clone: any = Object.assign({}, wallet);
  if (wallet._txs_by_external_index) {
    clone._txs_by_external_index = {};
    clone._txs_by_internal_index = {};
  }
  delete clone._bip47_instance;
  return JSON.stringify({ ...clone, type: clone.type });
}

// receive addresses holding capsules, change addresses holding capsules (the latter unconfirmed)
const FUNDED_RECEIVE = [0, 2, 5];
const FUNDED_CHANGE = [1, 3];

/** A Hot Vault as it comes back from the store: zpub and balances known, nothing derived in this session. */
function storedHotVault(): string {
  const w: any = new HDSegwitBech32Wallet();
  w.setSecret(MNEMONIC);
  w.getXpub();
  w.next_free_address_index = 6;
  w.next_free_change_address_index = 4;
  for (const c of FUNDED_RECEIVE) w._balances_by_external_index[c] = { c: 10_000 * (c + 1), u: 0 };
  for (const c of FUNDED_CHANGE) w._balances_by_internal_index[c] = { c: 0, u: 7_000 * (c + 1) };
  return saveLikeAppStorage(w);
}

const loadHotVault = (json = storedHotVault()): any => HDSegwitBech32Wallet.fromJson(json);

function electrumReturnsOneCapsulePerAddress() {
  BlueElectrum.multiGetUtxoByAddress.mockImplementation(async (addresses: string[]) => {
    const ret: Record<string, any[]> = {};
    addresses.forEach((address, i) => {
      ret[address] = [{ height: 850_000 + i, value: 20_000 + i, address, txId: txid(i + 1), vout: i % 2 }];
    });
    return ret;
  });
}

/** address -> [chain, index] for the first addresses of both chains (public derivation, no seed) */
function addressBook(w: any): Map<string, [0 | 1, number]> {
  const book = new Map<string, [0 | 1, number]>();
  for (let i = 0; i < 10; i++) {
    book.set(w._getExternalAddressByIndex(i), [0, i]);
    book.set(w._getInternalAddressByIndex(i), [1, i]);
  }
  return book;
}

/** the same transaction, signed input by input with the reference keys */
function signWithReferenceKeys(w: any, utxos: any[], changeAddress: string): string {
  const { psbt } = w.createTransaction(utxos, [{ address: DESTINATION }], 2, changeAddress, 0, true, 0);
  const book = addressBook(w);
  psbt.txInputs.forEach((input: any, i: number) => {
    const hash = Buffer.from(input.hash).reverse().toString('hex');
    const utxo = utxos.find(u => u.txid === hash && u.vout === input.index);
    const [chain, index] = book.get(utxo.address)!;
    psbt.signInput(i, ECPair.fromWIF(referenceWif(chain, index)));
  });
  return psbt.finalizeAllInputs().extractTransaction().toHex();
}

beforeEach(() => {
  BlueElectrum.estimateCurrentBlockheight.mockReturnValue(900_000);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Hot Vault: loading capsules derives no private key', () => {
  it('fetchUtxo on a freshly loaded wallet runs no PBKDF2 and puts no key on any capsule', async () => {
    const w = loadHotVault();
    electrumReturnsOneCapsulePerAddress();
    const pbkdf2 = jest.spyOn(bip39, 'mnemonicToSeedSync');
    const getSeed = jest.spyOn(w, '_getSeed');
    const wifByIndex = jest.spyOn(w, '_getWIFByIndex');

    await w.fetchUtxo();

    const utxos = w.getUtxo();
    expect(utxos).toHaveLength(FUNDED_RECEIVE.length + FUNDED_CHANGE.length);
    expect(pbkdf2).not.toHaveBeenCalled();
    expect(getSeed).not.toHaveBeenCalled();
    expect(wifByIndex).not.toHaveBeenCalled();
    for (const u of utxos) expect(u).not.toHaveProperty('wif');
  });

  it('capsules worked out from stored transactions (no UTXO fetched yet) carry no key either', () => {
    const w = loadHotVault();
    const receive = w._getExternalAddressByIndex(2);
    const change = w._getInternalAddressByIndex(1);
    jest.spyOn(w, 'getTransactions').mockReturnValue([
      {
        txid: txid(9),
        confirmations: 3,
        inputs: [],
        outputs: [
          { n: 0, value: 0.0001, scriptPubKey: { addresses: [receive] } },
          { n: 1, value: 0.0002, scriptPubKey: { addresses: [change] } },
        ],
      },
    ]);
    const pbkdf2 = jest.spyOn(bip39, 'mnemonicToSeedSync');
    const getSeed = jest.spyOn(w, '_getSeed');

    const utxos = w.getUtxo();

    expect(utxos.map((u: any) => u.address).sort()).toEqual([receive, change].sort());
    expect(pbkdf2).not.toHaveBeenCalled();
    expect(getSeed).not.toHaveBeenCalled();
    for (const u of utxos) expect(u).not.toHaveProperty('wif');
  });
});

describe('Hot Vault: signing', () => {
  it('derives the same keys as before for receive and change addresses', () => {
    const w = loadHotVault();
    for (let i = 0; i < 8; i++) {
      expect(w._getExternalWIFByIndex(i)).toBe(referenceWif(0, i));
      expect(w._getInternalWIFByIndex(i)).toBe(referenceWif(1, i));
      expect(w._getWifForAddress(w._getExternalAddressByIndex(i))).toBe(referenceWif(0, i));
      expect(w._getWifForAddress(w._getInternalAddressByIndex(i))).toBe(referenceWif(1, i));
    }
    expect(w._getExternalWIFByIndex(0)).toBe('KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d');
  });

  it('signs capsules on receive and change addresses with one PBKDF2 per session, same transaction as the old keys', async () => {
    const w = loadHotVault();
    electrumReturnsOneCapsulePerAddress();
    await w.fetchUtxo();
    const utxos = w.getUtxo();
    const changeAddress = w._getInternalAddressByIndex(4);
    const expectedHex = signWithReferenceKeys(loadHotVault(), utxos, changeAddress);
    const pbkdf2 = jest.spyOn(bip39, 'mnemonicToSeedSync');

    const { tx, psbt } = w.createTransaction(utxos, [{ address: DESTINATION }], 2, changeAddress, 0, false, 0);

    expect(psbt.txInputs).toHaveLength(utxos.length); // spends receive and change capsules alike
    expect(tx.toHex()).toBe(expectedHex);
    expect(pbkdf2).toHaveBeenCalledTimes(1);

    // a second send in the same session reuses the account nodes
    const again = w.createTransaction(utxos.slice(0, 2), [{ address: DESTINATION }], 3, changeAddress, 0, false, 0);
    expect(again.tx).toBeTruthy();
    expect(pbkdf2).toHaveBeenCalledTimes(1);
  });

  it('follows a change of passphrase or derivation path instead of signing with stale keys', () => {
    const w = loadHotVault();
    const before = w._getExternalWIFByIndex(0);

    w.setPassphrase('extra word');
    const withPassphrase = bip32.fromSeed(bip39.mnemonicToSeedSync(MNEMONIC, 'extra word'));
    expect(w._getExternalWIFByIndex(0)).toBe(withPassphrase.derivePath("m/84'/0'/0'/0/0").toWIF());

    w.setPassphrase(undefined);
    w.setDerivationPath("m/84'/0'/1'");
    expect(w._getExternalWIFByIndex(0)).toBe(referenceRoot.derivePath("m/84'/0'/1'/0/0").toWIF());

    w.setDerivationPath("m/84'/0'/0'");
    expect(w._getExternalWIFByIndex(0)).toBe(before);
  });

  it('cosigning a PSBT with an unknown fingerprint runs PBKDF2 once, not once per input', async () => {
    const watcher = loadHotVault();
    electrumReturnsOneCapsulePerAddress();
    await watcher.fetchUtxo();
    const changeAddress = watcher._getInternalAddressByIndex(4);
    // fingerprint 0 (00000000): the signer can't match it, so it falls back to each input's /chain/index
    const { psbt } = watcher.createTransaction(watcher.getUtxo(), [{ address: DESTINATION }], 2, changeAddress, 0, true, 0);
    const expectedHex = signWithReferenceKeys(loadHotVault(), watcher.getUtxo(), changeAddress);
    const signer = loadHotVault();
    const pbkdf2 = jest.spyOn(bip39, 'mnemonicToSeedSync');

    const { tx } = signer.cosignPsbt(psbt);

    expect(tx && tx.toHex()).toBe(expectedHex);
    expect(pbkdf2).toHaveBeenCalledTimes(1);
  });

  it('signs a BIP47 capsule after a reload, although no WIF cache was saved', () => {
    const bob: any = new HDSegwitBech32Wallet();
    bob.setSecret(BIP47_BOB);
    bob.switchBIP47(true);
    bob.getXpub();
    const alice = BIP47Factory(ecc).fromBip39Seed(BIP47_ALICE);
    const alicePaymentCode = alice.getSerializedPaymentCode();
    bob._sender_payment_codes = [alicePaymentCode];
    bob._next_free_payment_code_address_index[alicePaymentCode] = 2;
    bob._balances_by_payment_code_index[alicePaymentCode] = { c: 50_000, u: 0 };
    const addresses = [0, 1].map(i => bob._getBIP47Address(alicePaymentCode, i));

    const saved = saveLikeAppStorage(bob);
    expect(saved).not.toContain('_address_to_wif_cache');
    const loaded: any = HDSegwitBech32Wallet.fromJson(saved);

    // the key behind each address is the one Alice pays to (her side, from Bob's public payment code only)
    const bobPublic = BIP47Factory(ecc).fromPaymentCode(bob.getBIP47PaymentCode());
    addresses.forEach((address, i) => {
      const key = ECPair.fromWIF(loaded._getWifForAddress(address));
      expect(bitcoin.payments.p2wpkh({ pubkey: key.publicKey }).address).toBe(address);
      expect(bitcoin.payments.p2pkh({ pubkey: key.publicKey }).address).toBe(alice.getPaymentAddress(bobPublic.getPaymentCodeNode(), i));
    });

    const capsule = { height: 1, value: 50_000, address: addresses[1], txId: txid(77), txid: txid(77), vout: 0 };
    const { tx } = loaded.createTransaction([capsule], [{ address: DESTINATION }], 2, loaded._getInternalAddressByIndex(0), 0, false, 0);
    expect(tx).toBeTruthy();

    const savedAgain = saveLikeAppStorage(loaded);
    for (const address of addresses) expect(savedAgain).not.toContain(loaded._getWifForAddress(address));
  });
});

describe('Hot Vault: no private key is saved', () => {
  it('after loading capsules and signing, the saved wallet holds no WIF of any capsule address', async () => {
    const w = loadHotVault();
    electrumReturnsOneCapsulePerAddress();
    await w.fetchUtxo();
    const utxos = w.getUtxo();
    w.createTransaction(utxos, [{ address: DESTINATION }], 2, w._getInternalAddressByIndex(4), 0, false, 0);

    const saved = saveLikeAppStorage(w);

    const book = addressBook(w);
    for (const u of utxos) {
      const [chain, index] = book.get(u.address)!;
      expect(saved).not.toContain(referenceWif(chain, index));
      expect(saved).not.toContain(referenceRoot.derivePath(`m/84'/0'/0'/${chain}/${index}`).privateKey!.toString('hex'));
    }
    expect(saved).not.toContain('_address_to_wif_cache');
    expect(saved).not.toMatch(/"wif"/);
    expect(saved).not.toMatch(/xprv/);
    // still a working wallet: the next load signs again
    expect(loadHotVault(saved)._getExternalWIFByIndex(0)).toBe(referenceWif(0, 0));
  });

  it('a wallet saved by an older version loses its stored keys on load, and still signs', () => {
    const old = JSON.parse(storedHotVault());
    const address = loadHotVault()._getExternalAddressByIndex(2);
    const wif = referenceWif(0, 2);
    const capsule = { height: 850_000, value: 30_000, address, txId: txid(5), txid: txid(5), vout: 0, amount: 30_000 };
    old._address_to_wif_cache = { [address]: wif, [loadHotVault()._getInternalAddressByIndex(1)]: referenceWif(1, 1) };
    old._utxo = [{ ...capsule, wif }];
    old.utxo = [{ ...capsule, wif }];

    const w = loadHotVault(JSON.stringify(old));

    expect(w).not.toHaveProperty('_address_to_wif_cache');
    expect(w._utxo[0]).not.toHaveProperty('wif');
    expect(w.utxo[0]).not.toHaveProperty('wif');
    const { tx } = w.createTransaction(w.getUtxo(), [{ address: DESTINATION }], 2, w._getInternalAddressByIndex(4), 0, false, 0);
    expect(tx).toBeTruthy();
    const saved = saveLikeAppStorage(w);
    expect(saved).not.toContain(wif);
    expect(saved).not.toContain(referenceWif(1, 1));
  });

  it('a key put on a capsule in memory is stripped before saving', () => {
    const w = loadHotVault();
    const address = w._getExternalAddressByIndex(0);
    w._utxo = [{ height: 1, value: 1000, address, txId: txid(3), txid: txid(3), vout: 0, wif: referenceWif(0, 0) }];
    w.utxo = w._utxo;

    expect(saveLikeAppStorage(w)).not.toContain(referenceWif(0, 0));
  });
});

describe('Multisig: one PBKDF2 per cosigner, not per input and cosigner', () => {
  function storedMultisig(): string {
    const w: any = new MultisigHDWallet();
    w.addCosigner(MNEMONIC);
    w.addCosigner(MNEMONIC_2);
    w.setDerivationPath(MULTISIG_PATH);
    w.setM(2);
    return saveLikeAppStorage(w);
  }

  /** three capsules on three receive addresses, each in its own previous transaction (needed for native segwit) */
  function capsules(w: any) {
    return [0, 1, 2].map(i => {
      const address = w._getExternalAddressByIndex(i);
      const prev = new bitcoin.Transaction();
      prev.addInput(Buffer.alloc(32, i + 1), 0);
      prev.addOutput(bitcoin.address.toOutputScript(address), 30_000 + i);
      return { height: 1, value: 30_000 + i, address, txId: prev.getId(), txid: prev.getId(), vout: 0, txhex: prev.toHex() };
    });
  }

  it('builds and signs a 2-of-2 spend of three capsules, same transaction as the reference keys', () => {
    const reference: any = MultisigHDWallet.fromJson(storedMultisig());
    const referenceChange = reference._getInternalAddressByIndex(0);
    const { psbt: unsigned } = reference.createTransaction(capsules(reference), [{ address: DESTINATION }], 2, referenceChange, 0, true, 0);
    for (let i = 0; i < unsigned.inputCount; i++) for (const root of referenceMultisigRoots) unsigned.signInputHD(i, root);
    const expectedHex = unsigned.finalizeAllInputs().extractTransaction().toHex();

    const w: any = MultisigHDWallet.fromJson(storedMultisig());
    const pbkdf2 = jest.spyOn(bip39, 'mnemonicToSeedSync');
    const change = w._getInternalAddressByIndex(0);
    const { tx } = w.createTransaction(capsules(w), [{ address: DESTINATION }], 2, change, 0, false, 0);

    expect(tx.toHex()).toBe(expectedHex);
    expect(pbkdf2).toHaveBeenCalledTimes(2); // one per cosigner, for addresses, inputs and signatures together
    expect([MNEMONIC, MNEMONIC_2].map(m => w._getXpubFromCosigner(m))).toEqual(referenceMultisigXpubs.map(xpub => w._zpubToXpub(xpub)));
  });

  it('cosigning reuses the same roots', () => {
    const coordinator: any = MultisigHDWallet.fromJson(storedMultisig());
    const change = coordinator._getInternalAddressByIndex(0);
    const { psbt } = coordinator.createTransaction(capsules(coordinator), [{ address: DESTINATION }], 2, change, 0, true, 0);
    const w: any = MultisigHDWallet.fromJson(storedMultisig());
    const pbkdf2 = jest.spyOn(bip39, 'mnemonicToSeedSync');

    const { tx } = w.cosignPsbt(psbt);

    expect(tx).toBeTruthy();
    expect(pbkdf2).toHaveBeenCalledTimes(2);
  });
});

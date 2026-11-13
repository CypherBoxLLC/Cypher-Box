import { LegacyWallet } from './legacy-wallet';
import type { AbstractWallet } from './abstract-wallet';
import * as bip39 from 'bip39';
import { BIP32Interface } from 'bip32';
import * as bip39custom from '../../blue_modules/bip39';
import BlueElectrum from '../../blue_modules/BlueElectrum';
import { Transaction } from './types';

type AbstractHDWalletStatics = {
  derivationPath?: string;
};

/*
 * Each wallet's seed, worked out once. bip39's PBKDF2 (2048 rounds of HMAC-SHA512 in JS) takes seconds on a phone, and
 * every capsule address's key, the fingerprint and each signature redid it: restoring a wallet with many capsule
 * addresses froze the app for minutes. Kept outside the wallet object, so it's never serialized with the wallet and
 * goes when the wallet does, and redone if the words or the passphrase change. Callers get a copy.
 */
const seedCache = new WeakMap<object, { mnemonic: string; passphrase: string | undefined; seed: Buffer }>();

/**
 * @deprecated
 */
export class AbstractHDWallet extends LegacyWallet {
  static type = 'abstract';
  static typeReadable = 'abstract';

  next_free_address_index: number;
  next_free_change_address_index: number;
  internal_addresses_cache: Record<number, string>;
  external_addresses_cache: Record<number, string>;
  _xpub: string;
  usedAddresses: string[];
  gap_limit: number;
  passphrase?: string;
  _node0?: BIP32Interface;
  _node1?: BIP32Interface;

  constructor() {
    super();
    const Constructor = this.constructor as unknown as AbstractHDWalletStatics;
    this.next_free_address_index = 0;
    this.next_free_change_address_index = 0;
    this.internal_addresses_cache = {}; // index => address
    this.external_addresses_cache = {}; // index => address
    this._xpub = ''; // cache
    this.usedAddresses = [];
    this.gap_limit = 20;
    this._derivationPath = Constructor.derivationPath;
  }

  getNextFreeAddressIndex(): number {
    return this.next_free_address_index;
  }

  getNextFreeChangeAddressIndex(): number {
    return this.next_free_change_address_index;
  }

  static fromJson(obj: string): AbstractWallet {
    const wallet = super.fromJson(obj) as AbstractHDWallet;
    wallet._forgetStoredKeys();
    return wallet;
  }

  prepareForSerialization(): void {
    // deleting structures that cant be serialized
    delete this._node0;
    delete this._node1;
    this._forgetStoredKeys();
  }

  /**
   * Older versions derived the private key (WIF) of every address holding a UTXO while fetching UTXOs, kept the keys
   * in `_address_to_wif_cache` and on each UTXO's `wif`, and saved them with the wallet. Keys are now derived only
   * when signing, so whatever an older version stored is dropped: when the wallet is loaded, and before every save.
   */
  _forgetStoredKeys(): void {
    const self = this as unknown as { _address_to_wif_cache?: unknown; utxo?: unknown; _utxo?: unknown };
    delete self._address_to_wif_cache;
    for (const list of [self.utxo, self._utxo]) {
      if (!Array.isArray(list)) continue;
      for (const utxo of list) {
        if (utxo && typeof utxo === 'object') delete utxo.wif;
      }
    }
  }

  generate(): Promise<void> {
    throw new Error('Not implemented');
  }

  allowSend(): boolean {
    return false;
  }

  getTransactions(): Transaction[] {
    throw new Error('Not implemented');
  }

  /**
   * @return {Buffer} wallet seed
   */
  _getSeed(): Buffer {
    const mnemonic = this.secret;
    const passphrase = this.passphrase;
    const cached = seedCache.get(this);
    if (cached && cached.mnemonic === mnemonic && cached.passphrase === passphrase) return Buffer.from(cached.seed);
    const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase);
    seedCache.set(this, { mnemonic, passphrase, seed: Buffer.from(seed) });
    return seed;
  }

  setSecret(newSecret: string): this {
    // first, checking if it's a SeedQR:
    try {
      // compact seedQR should be between 32 - 64 chars long in hex format
      if (newSecret.length === 64 || newSecret.length === 32) {
        // not supported as mobile scanners dont recognize such QRs at all.
        // nop
      } else if (newSecret.length === 96 || newSecret.length === 48) {
        // standard seedQR
        const wordlist = bip39.wordlists[bip39.getDefaultWordlist()];
        const words = newSecret.match(/[\d]{4}/g);

        if (words) {
          newSecret = words.map(num => wordlist[parseInt(num, 10)]).join(' ');
        }
      }
    } catch (e) {}
    // end SeedQR

    this.secret = newSecret.trim().toLowerCase();
    this.secret = this.secret.replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, ' ');

    // Try to match words to the default bip39 wordlist and complete partial words
    const wordlist = bip39.wordlists[bip39.getDefaultWordlist()];
    const lookupMap = wordlist.reduce((map, word) => {
      const prefix3 = word.substr(0, 3);
      const prefix4 = word.substr(0, 4);

      map.set(prefix3, !map.has(prefix3) ? word : false);
      map.set(prefix4, !map.has(prefix4) ? word : false);

      return map;
    }, new Map<string, string | false>());

    this.secret = this.secret
      .split(' ')
      .map(word => lookupMap.get(word) || word)
      .join(' ');

    return this;
  }

  setPassphrase(passphrase: string): void {
    this.passphrase = passphrase;
  }

  getPassphrase(): string | undefined {
    return this.passphrase;
  }

  /**
   * @return {Boolean} is mnemonic in `this.secret` valid
   */
  validateMnemonic(): boolean {
    return bip39custom.validateMnemonic(this.secret);
  }

  /**
   * Derives from hierarchy, returns next free address
   * (the one that has no transactions). Looks for several,
   * gives up if none found, and returns the used one
   *
   * @return {Promise.<string>}
   */
  async getAddressAsync(): Promise<string> {
    // looking for free external address
    let freeAddress = '';
    let c;
    for (c = 0; c < this.gap_limit + 1; c++) {
      if (this.next_free_address_index + c < 0) continue;
      const address = this._getExternalAddressByIndex(this.next_free_address_index + c);
      this.external_addresses_cache[this.next_free_address_index + c] = address; // updating cache just for any case
      let txs = [];
      try {
        txs = await BlueElectrum.getTransactionsByAddress(address);
      } catch (Err: any) {
        console.warn('BlueElectrum.getTransactionsByAddress()', Err.message);
      }
      if (txs.length === 0) {
        // found free address
        freeAddress = address;
        this.next_free_address_index += c; // now points to _this one_
        break;
      }
    }

    if (!freeAddress) {
      // could not find in cycle above, give up
      freeAddress = this._getExternalAddressByIndex(this.next_free_address_index + c); // we didnt check this one, maybe its free
      this.next_free_address_index += c; // now points to this one
    }
    this._address = freeAddress;
    return freeAddress;
  }

  /**
   * Derives from hierarchy, returns next free CHANGE address
   * (the one that has no transactions). Looks for several,
   * gives up if none found, and returns the used one
   *
   * @return {Promise.<string>}
   */
  async getChangeAddressAsync(): Promise<string> {
    // looking for free internal address
    let freeAddress = '';
    let c;
    for (c = 0; c < this.gap_limit + 1; c++) {
      if (this.next_free_change_address_index + c < 0) continue;
      const address = this._getInternalAddressByIndex(this.next_free_change_address_index + c);
      this.internal_addresses_cache[this.next_free_change_address_index + c] = address; // updating cache just for any case
      let txs = [];
      try {
        txs = await BlueElectrum.getTransactionsByAddress(address);
      } catch (Err: any) {
        console.warn('BlueElectrum.getTransactionsByAddress()', Err.message);
      }
      if (txs.length === 0) {
        // found free address
        freeAddress = address;
        this.next_free_change_address_index += c; // now points to _this one_
        break;
      }
    }

    if (!freeAddress) {
      // could not find in cycle above, give up
      freeAddress = this._getInternalAddressByIndex(this.next_free_change_address_index + c); // we didnt check this one, maybe its free
      this.next_free_change_address_index += c; // now points to this one
    }
    this._address = freeAddress;
    return freeAddress;
  }

  /**
   * Should not be used in HD wallets
   *
   * @deprecated
   * @return {string}
   */
  getAddress(): string | false {
    return this._address;
  }

  _getExternalWIFByIndex(index: number): string | false {
    throw new Error('Not implemented');
  }

  _getInternalWIFByIndex(index: number): string | false {
    throw new Error('Not implemented');
  }

  _getExternalAddressByIndex(index: number): string {
    throw new Error('Not implemented');
  }

  _getInternalAddressByIndex(index: number): string {
    throw new Error('Not implemented');
  }

  getXpub(): string {
    throw new Error('Not implemented');
  }

  /**
   * Async function to fetch all transactions. Use getter to get actual txs.
   * Also, sets internals:
   *  `this.internal_addresses_cache`
   *  `this.external_addresses_cache`
   *
   * @returns {Promise<void>}
   */
  async fetchTransactions(): Promise<void> {
    throw new Error('not implemented');
  }

  /**
   * Given that `address` is in our HD hierarchy, try to find
   * corresponding WIF. Derived on every call and not kept: only signing needs it.
   *
   * @param address {String} In our HD hierarchy
   * @return {String} WIF if found
   */
  _getWifForAddress(address: string): string {
    // fast approach, first lets iterate over all addressess we have in cache
    for (const indexStr of Object.keys(this.internal_addresses_cache)) {
      const index = parseInt(indexStr, 10);
      if (this._getInternalAddressByIndex(index) === address) {
        return <string>this._getInternalWIFByIndex(index);
      }
    }

    for (const indexStr of Object.keys(this.external_addresses_cache)) {
      const index = parseInt(indexStr, 10);
      if (this._getExternalAddressByIndex(index) === address) {
        return <string>this._getExternalWIFByIndex(index);
      }
    }

    // no luck - lets iterate over all addresses we have up to first unused address index
    for (let c = 0; c <= this.next_free_change_address_index + this.gap_limit; c++) {
      const possibleAddress = this._getInternalAddressByIndex(c);
      if (possibleAddress === address) {
        return <string>this._getInternalWIFByIndex(c);
      }
    }

    for (let c = 0; c <= this.next_free_address_index + this.gap_limit; c++) {
      const possibleAddress = this._getExternalAddressByIndex(c);
      if (possibleAddress === address) {
        return <string>this._getExternalWIFByIndex(c);
      }
    }

    throw new Error('Could not find WIF for ' + address);
  }

  async fetchBalance(): Promise<void> {
    throw new Error('Not implemented');
  }

  /**
   * @inheritDoc
   */
  async fetchUtxo(): Promise<void> {
    throw new Error('Not implemented');
  }

  _getDerivationPathByAddress(address: string): string | false {
    throw new Error('Not implemented');
  }

  _getNodePubkeyByIndex(node: number, index: number): Buffer | undefined {
    throw new Error('Not implemented');
  }

  /**
   * @returns {string} Root derivation path for wallet if any
   */
  getDerivationPath() {
    return this._derivationPath;
  }

  /*
   * Set derivation path for the wallet
   *
   * @param {String} path - path
   */
  setDerivationPath(path: string) {
    this._derivationPath = path;
  }
}

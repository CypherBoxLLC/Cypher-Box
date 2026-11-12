import { HDSegwitBech32Wallet, WatchOnlyWallet } from '../../class';
import {
  MAX_CAPSULE_LABEL_LENGTH,
  capsulePresetLabels,
  cleanCapsuleLabel,
  labelHasPreset,
  saveCapsuleLabel,
  togglePresetLabel,
} from '../../src/helpers/capsuleLabels';

const en = require('../../loc/en.json');
const ar = require('../../loc/ar.json');

const TXID = 'f'.repeat(64);
// the zpub the watch-only wallet tests use, standing in for a Cold Vault
const ZPUB = 'zpub6rFDtF1nuXZ9PUL4XzKURh3vJBW6Kj6TUrYL4qPtFNtDXtcTVfiqjQDyrZNwjwzt5HS14qdqo3Co2282Lv3Re6Y5wFZxAVuMEpeygnnDwfx';

describe('capsule label presets', () => {
  it('offers KYC, KYC-free, P2P, Exchange, Income and Gift, with KYC and KYC-free excluding each other', () => {
    const presets = capsulePresetLabels();
    expect(presets.map(p => p.text)).toEqual(['KYC', 'KYC-free', 'P2P', 'Exchange', 'Income', 'Gift']);
    expect(presets.find(p => p.key === 'kyc')?.excludes).toEqual(['KYC-free']);
    expect(presets.find(p => p.key === 'kyc_free')?.excludes).toEqual(['KYC']);
  });

  it('adds a preset, adds more after it, and takes one out when tapped again', () => {
    expect(togglePresetLabel('', 'P2P')).toBe('P2P');
    expect(togglePresetLabel('P2P', 'Gift')).toBe('P2P, Gift');
    expect(togglePresetLabel('P2P, Gift', 'P2P')).toBe('Gift');
    expect(togglePresetLabel('Bought from Sam', 'KYC-free')).toBe('Bought from Sam, KYC-free');
  });

  it('never keeps KYC and KYC-free together', () => {
    expect(togglePresetLabel('KYC, Exchange', 'KYC-free', ['KYC'])).toBe('Exchange, KYC-free');
    expect(togglePresetLabel('kyc-free', 'KYC', ['KYC-free'])).toBe('KYC');
  });

  it('matches presets whatever the case and with Arabic commas', () => {
    expect(labelHasPreset('kyc, p2p', 'KYC')).toBe(true);
    expect(labelHasPreset('KYC-free', 'KYC')).toBe(false);
    expect(labelHasPreset('دون هوية، هدية', 'هدية')).toBe(true);
    expect(togglePresetLabel('دون هوية، هدية', 'دخل', [], '، ')).toBe('دون هوية، هدية، دخل');
  });

  it('cleans a label before saving it', () => {
    expect(cleanCapsuleLabel('  KYC-free,   P2P ,  ')).toBe('KYC-free, P2P');
    expect(cleanCapsuleLabel(' ، , ')).toBe('');
    expect(cleanCapsuleLabel('x'.repeat(80))).toHaveLength(MAX_CAPSULE_LABEL_LENGTH);
  });

  it('fits every preset at once in both languages', () => {
    for (const lang of [en, ar]) {
      const presets = lang.cypherbox.components.capsule_received.presets;
      const all = Object.values(presets).join(lang.cypherbox.components.capsule_received.label_separator);
      expect(all.length).toBeLessThanOrEqual(MAX_CAPSULE_LABEL_LENGTH);
    }
  });
});

describe('the popup strings', () => {
  const keys = (obj: any, prefix = ''): string[] =>
    Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

  it('exist in English and Arabic, with no em dash in the English copy', () => {
    const enStrings = en.cypherbox.components.capsule_received;
    const arStrings = ar.cypherbox.components.capsule_received;
    expect(keys(arStrings).sort()).toEqual(keys(enStrings).sort());
    expect(JSON.stringify(enStrings)).not.toContain('—');
  });
});

describe('saveCapsuleLabel', () => {
  it('stores the label as the capsule memo of a Hot Vault, which survives a save and load', async () => {
    const hot = new HDSegwitBech32Wallet();
    const saveToDisk = jest.fn(async () => {});
    await expect(saveCapsuleLabel(hot, TXID, 1, '  KYC-free,  P2P ', saveToDisk)).resolves.toBe('KYC-free, P2P');
    expect(hot.getUTXOMetadata(TXID, 1).memo).toBe('KYC-free, P2P');
    expect(saveToDisk).toHaveBeenCalledTimes(1);

    const loaded = HDSegwitBech32Wallet.fromJson(JSON.stringify(hot));
    expect(loaded.getUTXOMetadata(TXID, 1).memo).toBe('KYC-free, P2P');
  });

  it('keeps a frozen capsule frozen', async () => {
    const hot = new HDSegwitBech32Wallet();
    hot.setUTXOMetadata(TXID, 0, { frozen: true });
    await saveCapsuleLabel(hot, TXID, 0, 'Gift', async () => {});
    expect(hot.getUTXOMetadata(TXID, 0)).toEqual({ frozen: true, memo: 'Gift' });
  });

  it('stores the label on a watch-only Cold Vault, which survives the way the app saves and loads wallets', async () => {
    const cold = new WatchOnlyWallet();
    cold.setSecret(ZPUB);
    cold.init();
    await saveCapsuleLabel(cold, TXID, 2, 'KYC', async () => {});
    expect(cold.getUTXOMetadata(TXID, 2).memo).toBe('KYC');

    // as BlueApp.saveToDisk and loadFromDisk do
    cold.prepareForSerialization();
    const loaded = WatchOnlyWallet.fromJson(JSON.stringify(cold)) as WatchOnlyWallet;
    loaded.init();
    expect(loaded.getUTXOMetadata(TXID, 2).memo).toBe('KYC');
  });

  it('refuses an empty label and saves nothing', async () => {
    const hot = new HDSegwitBech32Wallet();
    const saveToDisk = jest.fn(async () => {});
    await expect(saveCapsuleLabel(hot, TXID, 0, ' , ', saveToDisk)).rejects.toThrow();
    expect(hot.getUTXOMetadata(TXID, 0)).toEqual({});
    expect(saveToDisk).not.toHaveBeenCalled();
  });

  it('passes on a failed save, so the popup can say so', async () => {
    const hot = new HDSegwitBech32Wallet();
    await expect(
      saveCapsuleLabel(hot, TXID, 0, 'Income', async () => {
        throw new Error('disk full');
      }),
    ).rejects.toThrow('disk full');
  });
});

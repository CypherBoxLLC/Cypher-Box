/**
 * The BIP39 seed made natively when the phone can (react-native-aes-crypto's PBKDF2), else by bip39. The stand-in
 * native module below is Node's own PBKDF2, so the expected seeds come from code that isn't the app's; BIP39's
 * published vector anchors the passphrase case.
 */

import crypto from 'crypto';
import * as bip39 from 'bip39';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// BIP39's published seed for ABANDON with the passphrase TREZOR
const TREZOR_SEED =
    'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04';
const LEGAL = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

// PBKDF2 as the native module does it: UTF-8 bytes in, length in bits, lower-case hex out
const nodePbkdf2 = (password: string, salt: string, cost: number, bits: number, algorithm: string) =>
    crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(salt, 'utf8'), cost, bits / 8, algorithm).toString('hex');

const load = (pbkdf2?: (...args: any[]) => any) => {
    let mod: typeof import('../../src/helpers/seedFromWords');
    let native: jest.Mock | undefined;
    let bip39Spy: jest.SpyInstance;
    // each case starts with a fresh known-answer check, so with its own modules: the native module and bip39 are set
    // up on the copies the helper sees
    jest.isolateModules(() => {
        const { NativeModules } = require('react-native');
        native = pbkdf2 ? jest.fn(pbkdf2) : undefined;
        if (native) NativeModules.Aes = { pbkdf2: native };
        else delete NativeModules.Aes;
        bip39Spy = jest.spyOn(require('bip39'), 'mnemonicToSeedSync');
        mod = require('../../src/helpers/seedFromWords');
    });
    return { mod: mod!, native, bip39Spy: bip39Spy! };
};

const jsSeed = (m: string, p = '') => crypto.pbkdf2Sync(Buffer.from(m.normalize('NFKD'), 'utf8'),
    Buffer.from(`mnemonic${p.normalize('NFKD')}`, 'utf8'), 2048, 64, 'sha512').toString('hex');


describe('seedFromMnemonic', () => {
    it("gives BIP39's seed with bip39's own function when there's no native module", async () => {
        const { mod, bip39Spy } = load();
        expect((await mod.seedFromMnemonic(ABANDON, 'TREZOR')).toString('hex')).toBe(TREZOR_SEED);
        expect((await mod.seedFromMnemonic(LEGAL)).toString('hex')).toBe(jsSeed(LEGAL));
        expect(bip39Spy).toHaveBeenCalledTimes(2);
    });

    it('uses a native PBKDF2 that gives the known answers, and not bip39', async () => {
        const { mod, native, bip39Spy } = load((...a: any[]) => Promise.resolve(nodePbkdf2(...(a as [string, string, number, number, string]))));
        expect((await mod.seedFromMnemonic(ABANDON, 'TREZOR')).toString('hex')).toBe(TREZOR_SEED);
        expect((await mod.seedFromMnemonic(LEGAL)).toString('hex')).toBe(jsSeed(LEGAL));
        expect(bip39Spy).not.toHaveBeenCalled();
        // two known answers, asked once, then one call per seed
        expect(native).toHaveBeenCalledTimes(4);
        expect(native!.mock.calls[2]).toEqual([ABANDON, 'mnemonicTREZOR', 2048, 512, 'sha512']);
    });

    it('hands the native PBKDF2 the NFKD forms, as bip39 does', async () => {
        const { mod, native } = load((...a: any[]) => Promise.resolve(nodePbkdf2(...(a as [string, string, number, number, string]))));
        const composed = 'Ünïcödé ₿ 🔑'.normalize('NFC');
        const seed = (await mod.seedFromMnemonic(ABANDON, composed)).toString('hex');
        expect(seed).toBe(bip39.mnemonicToSeedSync(ABANDON, composed).toString('hex'));
        expect(seed).toBe(jsSeed(ABANDON, composed));
        expect(native!.mock.calls[2][1]).toBe(`mnemonic${composed.normalize('NFKD')}`);
    });

    it("falls back to bip39 when the native PBKDF2 gets the known answers wrong, and doesn't ask it again", async () => {
        // SHA-256 instead of SHA-512: well-formed, wrong
        const { mod, native, bip39Spy } = load((p: string, s: string, c: number) => Promise.resolve(nodePbkdf2(p, s, c, 512, 'sha256')));
        expect((await mod.seedFromMnemonic(ABANDON, 'TREZOR')).toString('hex')).toBe(TREZOR_SEED);
        expect((await mod.seedFromMnemonic(LEGAL)).toString('hex')).toBe(jsSeed(LEGAL));
        expect(native).toHaveBeenCalledTimes(2);
        expect(bip39Spy).toHaveBeenCalledTimes(2);
    });

    it('falls back to bip39 when the native PBKDF2 throws or gives back something that is not a seed', async () => {
        const throws = load(() => Promise.reject(new Error('Key generation failed')));
        expect((await throws.mod.seedFromMnemonic(LEGAL)).toString('hex')).toBe(jsSeed(LEGAL));

        // passes the known answers, then gives back a short value for the real seed
        let calls = 0;
        const short = load((...a: any[]) => {
            calls += 1;
            const hex = nodePbkdf2(...(a as [string, string, number, number, string]));
            return Promise.resolve(calls > 2 ? hex.slice(0, 64) : hex);
        });
        expect((await short.mod.seedFromMnemonic(LEGAL)).toString('hex')).toBe(jsSeed(LEGAL));
        expect(throws.bip39Spy).toHaveBeenCalledTimes(1);
        expect(short.bip39Spy).toHaveBeenCalledTimes(1);
    });

    it('keeps text that encodes differently in Java or iOS (a lone surrogate) away from the native PBKDF2', async () => {
        const { mod, native } = load((...a: any[]) => Promise.resolve(nodePbkdf2(...(a as [string, string, number, number, string]))));
        const odd = 'pass\ud800word';
        expect((await mod.seedFromMnemonic(ABANDON, odd)).toString('hex')).toBe(bip39.mnemonicToSeedSync(ABANDON, odd).toString('hex'));
        expect(native).not.toHaveBeenCalled();
    });

    it("falls back to bip39 when the native PBKDF2 never answers", async () => {
        jest.useFakeTimers();
        try {
            const { mod, bip39Spy } = load(() => new Promise(() => {}));
            const seed = mod.seedFromMnemonic(LEGAL);
            await jest.advanceTimersByTimeAsync(5000);
            expect((await seed).toString('hex')).toBe(jsSeed(LEGAL));
            expect(bip39Spy).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('makes the root key of that seed', async () => {
        const { mod } = load();
        const root = await mod.rootFromMnemonic(ABANDON);
        expect(Buffer.from(root.fingerprint).toString('hex')).toBe('73c5da0a');
    });
});

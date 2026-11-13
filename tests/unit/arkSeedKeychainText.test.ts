/**
 * The Ark seed's copy in the phone's secure store must be described truthfully
 * on each platform.
 *
 * iOS keeps it as an iPhone Keychain item behind Face ID or the passcode.
 * Android keeps it encrypted with an Android Keystore key that only a
 * fingerprint (strong biometric) unlocks, with no PIN or passcode fallback, and
 * deletes it when the app is uninstalled. Until this test, Android showed
 * Apple's words: "Unlock with Touch ID", "in this device's Keychain", "via
 * Touch ID / passcode".
 */

import fs from 'fs';
import path from 'path';

import { arkSeedKeychainText } from '../../src/helpers/arkSeedKeychainText';

// The helper takes the strings as an argument here, so the real loc module
// (and its async language set-up) never loads. jest hoists this above the
// imports.
jest.mock('../../loc', () => ({ __esModule: true, default: {} }));

const REPO_ROOT = path.resolve(__dirname, '../..');
const readLoc = (lang: string) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'loc', `${lang}.json`), 'utf8'));
const LANGS: Record<string, any> = { en: readLoc('en'), ar: readLoc('ar') };

// The loc sections the helper reads, as they're written in the helper.
const SECTIONS: Record<string, (l: any) => Record<string, string>> = {
    'account.common': l => l.cypherbox.account.common,
    'account.create_ark': l => l.cypherbox.account.create_ark,
    'account.ark_seed': l => l.cypherbox.account.ark_seed,
    'account.recover_ark': l => l.cypherbox.account.recover_ark,
    'strike.ark_settings': l => l.cypherbox.strike.ark_settings,
};

type Text = ReturnType<typeof arkSeedKeychainText>;

/** Same placeholder rule as loc.formatString; an unknown placeholder stays visible. */
const fill = (template: string, values: Record<string, string>) =>
    template.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? values[key] : whole));

/**
 * Every sentence the user can see, with its placeholders filled the way the
 * screens fill them. The wallet fingerprint, reason and error are made up.
 */
const rendered = (os: string, text: Text): [string, string][] => {
    const values = {
        keychain: text.keychain,
        store: text.store,
        biometric: text.biometric,
        cloud: os === 'ios' ? 'iCloud Drive' : 'Google Drive',
        fingerprint: '1a2b3c4d',
        reason: 'read failed',
        error: 'bad tag',
    };
    const out: [string, string][] = [];
    for (const [group, strings] of Object.entries(text)) {
        if (typeof strings === 'string') continue; // the placeholder values
        for (const [name, template] of Object.entries(strings as Record<string, string>)) {
            out.push([`${group}.${name}`, typeof template === 'string' ? fill(template, values) : (template as any)]);
        }
    }
    return out;
};

const ARABIC = /[؀-ۿ]/;
const EM_DASH = '—';
const APPLE_WORDS = /iPhone|iCloud|Face ?ID|Touch ?ID|Keychain|passcode|رمز المرور/i;

describe.each(Object.keys(LANGS))('ark seed keychain text (%s)', lang => {
    const l = LANGS[lang];
    const ios = arkSeedKeychainText('ios', l);
    const android = arkSeedKeychainText('android', l);
    const iosText = rendered('ios', ios);
    const androidText = rendered('android', android);
    const fingerprintWord = lang === 'ar' ? /بصمة/ : /fingerprint/i;

    it('has every string on both platforms, with every placeholder filled', () => {
        for (const [name, value] of [...iosText, ...androidText]) {
            expect([name, typeof value]).toEqual([name, 'string']);
            expect([name, value.trim().length > 0]).toEqual([name, true]);
            expect([name, /[{}]/.test(value)]).toEqual([name, false]);
        }
    });

    it('names the unlock method and the store for each platform', () => {
        expect([ios.keychain, ios.store, ios.biometric]).toEqual(['Keychain', 'iPhone Keychain', 'Face ID']);
        expect([android.keychain, android.store]).toEqual(['Keystore', 'Android Keystore']);
        expect(android.biometric).toBe(l.cypherbox.account.common.fingerprint);
        expect(android.biometric).toMatch(fingerprintWord);
    });

    it('gives Android its own text for every string', () => {
        const iosByName = Object.fromEntries(iosText);
        for (const [name, value] of androidText) {
            expect([name, value === iosByName[name]]).toEqual([name, false]);
        }
    });

    it('never shows Keychain, Face ID, Touch ID, passcode, iPhone or iCloud on Android', () => {
        for (const [name, value] of androidText) {
            expect([name, value]).not.toEqual([name, expect.stringMatching(APPLE_WORDS)]);
        }
        expect(android.biometric).not.toMatch(APPLE_WORDS);
    });

    it('names the Keystore wherever iOS names the Keychain, and the fingerprint wherever iOS says Face ID', () => {
        const androidByName = Object.fromEntries(androidText);
        for (const [name, value] of iosText) {
            if (/Keychain/.test(value)) {
                expect([name, androidByName[name]]).toEqual([name, expect.stringContaining('Keystore')]);
            }
            if (/Face ID/.test(value)) {
                expect([name, androidByName[name]]).toEqual([name, expect.stringMatching(fingerprintWord)]);
            }
        }
    });

    it('says the Android copy kept on delete is gone after an uninstall, and never that it outlives one', () => {
        const androidByName = Object.fromEntries(androidText);
        expect(androidByName['settings.keepSeedOnDevice']).toMatch(lang === 'ar' ? /إلغاء تثبيت/ : /uninstall/);
        for (const [name, value] of androidText) {
            expect([name, value]).not.toEqual([name, expect.stringMatching(lang === 'ar' ? /إعادة تثبيت|تبقى بعد/ : /survives|reinstall/i)]);
        }
    });

    it('quotes the unlock button exactly where it tells the user to tap it', () => {
        for (const [os, text] of [['ios', ios], ['android', android]] as const) {
            const byName = Object.fromEntries(rendered(os, text));
            expect([os, byName['recover.tapUnlockFirst']]).toEqual([os, expect.stringContaining(byName['recover.unlockWith'])]);
        }
    });

    it('keeps the iOS text', () => {
        const byName = Object.fromEntries(iosText);
        if (lang === 'en') {
            expect(byName['recover.unlockWith']).toBe('Unlock with Face ID');
            expect(byName['seed.saveTo']).toBe('Save to iPhone Keychain (Face ID)');
            expect(byName['conflict.keepOld']).toBe('Keep old seed in Keychain');
            expect(byName['recover.chooseBody']).toContain("in this device's Keychain");
            expect(byName['recover.chooseBody']).toContain('Face ID / passcode');
            expect(byName['create.resetBody']).toContain('from your Keychain');
            expect(byName['settings.keepSeedOnDevice']).toBe('Keep seed phrase stored on device for future Face ID recovery');
        } else {
            expect(byName['recover.unlockWith']).toBe('فتح القفل عبر Face ID');
            expect(byName['recover.chooseBody']).toContain('Face ID أو رمز المرور');
        }
        // the iOS strings are the keys without the suffix, untouched
        expect(ios.recover.chooseBody).toBe(l.cypherbox.account.recover_ark.choose_body);
        expect(ios.conflict.different).toBe(l.cypherbox.account.common.keychain_conflict_different);
        expect(ios.settings.keepSeedOnDevice).toBe(l.cypherbox.strike.ark_settings.keep_seed_on_device);
    });

    if (lang === 'ar') {
        it('is translated, not copied from English', () => {
            for (const [name, value] of androidText) {
                expect([name, ARABIC.test(value)]).toEqual([name, true]);
            }
        });

        it('joins بـ to an Arabic word instead of leaving it apart', () => {
            // "محمية بـ {biometric}" is right for Face ID but reads "بـ بصمة"
            // with the Arabic word, which is why Android has its own sentence.
            for (const [name, value] of androidText) {
                expect([name, /بـ\s*[؀-ۿ]/.test(value)]).toEqual([name, false]);
            }
        });
    } else {
        it('has no em dash in the English copy', () => {
            for (const [name, value] of [...iosText, ...androidText]) {
                expect([name, value.includes(EM_DASH)]).toEqual([name, false]);
            }
        });

        it('starts every Android sentence with a capital letter or a symbol', () => {
            // "{biometric} was declined" with "fingerprint" put a lower-case
            // word first, which is why that one has its own Android sentence.
            for (const [name, value] of androidText) {
                expect([name, /^[a-z]/.test(value)]).toEqual([name, false]);
            }
        });
    }
});

describe('ark seed keychain loc keys', () => {
    // Every key the helper reads, as written in its source.
    const helperSource = fs.readFileSync(path.join(REPO_ROOT, 'src/helpers/arkSeedKeychainText.ts'), 'utf8');
    const helperKeys = [...new Set(helperSource.match(/loc\.cypherbox\.[\w.]+/g) ?? [])];
    const androidKeys = helperKeys.filter(key => key.endsWith('_android'));
    const parentAndName = (l: any, key: string): [Record<string, string>, string] => {
        const parts = key.replace(/^loc\./, '').split('.');
        const name = parts.pop() as string;
        return [parts.reduce((o, k) => o?.[k], l), name];
    };

    it('has the same Android keys in Arabic as in English', () => {
        for (const [section, get] of Object.entries(SECTIONS)) {
            const pick = (lang: string) =>
                Object.keys(get(LANGS[lang]))
                    .filter(k => k.endsWith('_android'))
                    .sort();
            expect([section, pick('ar')]).toEqual([section, pick('en')]);
        }
    });

    it('keeps each Android key next to its iOS key, with only placeholders the iOS key has', () => {
        expect(androidKeys.length).toBe(12);
        for (const lang of Object.keys(LANGS)) {
            for (const key of androidKeys) {
                const [strings, name] = parentAndName(LANGS[lang], key);
                const iosName = name.replace(/_android$/, '');
                const keys = Object.keys(strings ?? {});
                expect([lang, key, typeof strings?.[name], typeof strings?.[iosName]]).toEqual([lang, key, 'string', 'string']);
                expect([lang, key, keys[keys.indexOf(name) - 1]]).toEqual([lang, key, iosName]);
                // An Android sentence may drop a store or biometric placeholder,
                // but must not bring one the screen doesn't fill.
                const placeholders = (s: string) => new Set(s.match(/\{\w+\}/g) ?? []);
                const iosPlaceholders = placeholders(strings[iosName]);
                for (const p of placeholders(strings[name])) {
                    expect([lang, key, p, iosPlaceholders.has(p)]).toEqual([lang, key, p, true]);
                }
            }
        }
    });

    it('leaves no Ark screen reading this text directly or naming Touch ID', () => {
        // A screen that reads a key itself, or picks its own label, can show the
        // iPhone text on Android again. Screens go through
        // helpers/arkSeedKeychainText.
        const owned = helperKeys
            .filter(key => key !== 'loc.cypherbox.account.common.fingerprint')
            .map(key => key.replace(/_android$/, ''));
        expect(owned.length).toBeGreaterThan(15);
        const screens = [
            'src/screens/Account/RecoverArkScreen/index.tsx',
            'src/screens/Account/ArkSeedPhraseScreen/index.tsx',
            'src/screens/Account/CreateArkScreen/index.tsx',
            'src/screens/Strike/CheckingAccountNew/Settings.tsx',
        ];
        const offenders: string[] = [];
        for (const rel of screens) {
            const body = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
            // code only: comments may still name Touch ID when they mean iPhones
            const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
            for (const key of owned) {
                // a whole key only: keychain_save_failed must not match keychain_save_failed_android
                if (new RegExp(`${key.replace(/\./g, '\\.')}(?![A-Za-z0-9_])`).test(code)) {
                    offenders.push(`${rel}: ${key}`);
                }
            }
            if (/Touch ?ID/.test(code)) offenders.push(`${rel}: names Touch ID`);
            if (/'(iPhone Keychain|Android Keystore)'/.test(code)) offenders.push(`${rel}: hard-coded store name`);
            if (/\?\s*'Face ID'/.test(code)) offenders.push(`${rel}: picks its own biometric label`);
        }
        expect(offenders).toEqual([]);
    });
});

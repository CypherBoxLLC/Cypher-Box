/**
 * The Hot Vault's optional seed copy must be described truthfully on each
 * platform.
 *
 * iOS keeps it as an iPhone Keychain item behind Face ID / passcode, and it
 * survives an app reinstall. Android keeps it encrypted with an Android
 * Keystore key that only a fingerprint (strong biometric) unlocks, and Android
 * deletes that key and the app's data on uninstall, so the copy does NOT
 * survive a reinstall. Until this test, Android showed the iPhone text,
 * including "Survives app reinstall".
 */

import fs from 'fs';
import path from 'path';

import { hotVaultKeychainText } from '../../src/helpers/hotVaultKeychainText';

// The helper takes the strings as an argument here, so the real loc module
// (and its async language set-up) never loads. jest hoists this above the
// imports.
jest.mock('../../loc', () => ({ __esModule: true, default: {} }));

const REPO_ROOT = path.resolve(__dirname, '../..');
const readLoc = (lang: string) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'loc', `${lang}.json`), 'utf8'));
const LANGS: Record<string, any> = { en: readLoc('en'), ar: readLoc('ar') };

const SECTIONS: Record<string, (l: any) => Record<string, string>> = {
    saving_vault: l => l.cypherbox.vault.saving_vault,
    recover_saving_vault: l => l.cypherbox.vault.recover_saving_vault,
    'storage_vault.settings': l => l.cypherbox.vault.storage_vault.settings,
};

const flatten = (text: ReturnType<typeof hotVaultKeychainText>): [string, unknown][] =>
    Object.entries(text).flatMap(([group, strings]) =>
        Object.entries(strings).map(([name, value]): [string, unknown] => [`${group}.${name}`, value]),
    );

const ARABIC = /[؀-ۿ]/;
const EM_DASH = '—';

describe.each(Object.keys(LANGS))('hot vault keychain text (%s)', lang => {
    const l = LANGS[lang];
    const ios = hotVaultKeychainText('ios', l);
    const android = hotVaultKeychainText('android', l);

    it('has every string on both platforms, with no unfilled placeholder', () => {
        for (const text of [ios, android]) {
            for (const [name, value] of flatten(text)) {
                expect([name, typeof value]).toEqual([name, 'string']);
                expect([name, (value as string).trim().length > 0]).toEqual([name, true]);
                expect([name, /[{}]/.test(value as string)]).toEqual([name, false]);
            }
        }
    });

    it('gives Android its own text for every string', () => {
        const iosFlat = Object.fromEntries(flatten(ios));
        for (const [name, value] of flatten(android)) {
            expect([name, value === iosFlat[name]]).toEqual([name, false]);
        }
    });

    it('never shows iPhone, iCloud, Face ID or passcode wording on Android', () => {
        for (const [name, value] of flatten(android)) {
            expect([name, value]).not.toEqual([name, expect.stringMatching(/iPhone|iCloud|Face ?ID|Touch ?ID|Keychain|passcode|رمز المرور/i)]);
        }
    });

    it('names the Android Keystore wherever iOS names the Keychain', () => {
        const iosFlat = Object.fromEntries(flatten(ios));
        for (const [name, value] of flatten(android)) {
            if (/Keychain/.test(iosFlat[name] as string)) {
                expect([name, value]).toEqual([name, expect.stringContaining('Keystore')]);
            }
        }
    });

    it('says the Android copy is unlocked by fingerprint and deleted on uninstall', () => {
        const fingerprint = lang === 'ar' ? /بصمة/ : /fingerprint/i;
        const uninstall = lang === 'ar' ? /إلغاء تثبيت/ : /uninstall/i;
        expect(android.create.sub).toMatch(fingerprint);
        expect(android.create.sub).toMatch(uninstall);
        expect(android.recover.tapToUnlock).toMatch(fingerprint);
        // the no-backup line is what a reinstalled Android user sees, so it says why
        expect(android.recover.noBackup).toMatch(uninstall);
        // and nothing on Android claims the copy outlives a reinstall
        for (const [name, value] of flatten(android)) {
            expect([name, value]).not.toEqual([name, expect.stringMatching(lang === 'ar' ? /إعادة تثبيت|تبقى بعد/ : /survives|reinstall/i)]);
        }
    });

    it('keeps the iOS text, with Face ID spelled the way Apple spells it', () => {
        expect(ios.create.label).toBe(SECTIONS.saving_vault(l).keychain_label);
        expect(ios.create.label).toContain('iPhone');
        expect(ios.create.sub).toContain('Face ID');
        expect(ios.create.sub).toContain('iCloud');
        expect(ios.recover.tapToUnlock).toContain('Face ID');
        for (const [name, value] of flatten(ios)) {
            expect([name, value]).not.toEqual([name, expect.stringContaining('FaceID')]);
        }
    });

    it('has the fingerprint toasts from the Keystore check as strings', () => {
        for (const value of [
            SECTIONS.saving_vault(l).keychain_no_fingerprint,
            SECTIONS['storage_vault.settings'](l).keychain_no_fingerprint,
        ]) {
            expect(typeof value).toBe('string');
            expect(value).toMatch(lang === 'ar' ? /بصمة/ : /fingerprint/);
        }
    });

    if (lang === 'ar') {
        it('is translated, not copied from English', () => {
            for (const [name, value] of flatten(android)) {
                expect([name, ARABIC.test(value as string)]).toEqual([name, true]);
            }
            expect(SECTIONS.saving_vault(l).keychain_no_fingerprint).toMatch(ARABIC);
            expect(SECTIONS['storage_vault.settings'](l).keychain_no_fingerprint).toMatch(ARABIC);
        });
    } else {
        it('has no em dash in the English copy', () => {
            for (const text of [ios, android]) {
                for (const [name, value] of flatten(text)) {
                    expect([name, (value as string).includes(EM_DASH)]).toEqual([name, false]);
                }
            }
            expect(SECTIONS.saving_vault(l).keychain_no_fingerprint).not.toContain(EM_DASH);
            expect(SECTIONS['storage_vault.settings'](l).keychain_no_fingerprint).not.toContain(EM_DASH);
        });
    }
});

describe('hot vault keychain loc keys', () => {
    it('has the same Android and fingerprint keys in Arabic as in English', () => {
        for (const [section, get] of Object.entries(SECTIONS)) {
            const pick = (lang: string) =>
                Object.keys(get(LANGS[lang]))
                    .filter(k => k.endsWith('_android') || k === 'keychain_no_fingerprint')
                    .sort();
            expect([section, pick('ar')]).toEqual([section, pick('en')]);
        }
    });

    it('leaves no screen using a platform-blind keychain string directly', () => {
        // A screen reading the iOS key itself would show the iPhone text on
        // Android again. Screens go through helpers/hotVaultKeychainText.
        const twinned: string[] = [];
        for (const [section, get] of Object.entries(SECTIONS)) {
            for (const key of Object.keys(get(LANGS.en))) {
                if (key.endsWith('_android')) {
                    twinned.push(`loc.cypherbox.vault.${section}.${key.replace(/_android$/, '')}`);
                }
            }
        }
        const screens = [
            'src/screens/SavingVault/index.tsx',
            'src/screens/RecoverSavingVault/index.tsx',
            'src/screens/HotStorageVault/Settings.tsx',
        ];
        const offenders: string[] = [];
        for (const rel of screens) {
            const body = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
            for (const key of twinned) {
                // a whole key only: keychain_saved must not match keychain_saved_remove
                if (new RegExp(`${key.replace(/\./g, '\\.')}(?![A-Za-z0-9_])`).test(body)) {
                    offenders.push(`${rel}: ${key}`);
                }
            }
            if (body.includes('This phone has no fingerprint set up')) {
                offenders.push(`${rel}: hard-coded English fingerprint toast`);
            }
        }
        expect(offenders).toEqual([]);
    });
});

import { NativeModules } from 'react-native';
import * as bip39 from 'bip39';
import BIP32Factory, { BIP32Interface } from 'bip32';

import ecc from '../../blue_modules/noble_ecc';

/**
 * A recovery phrase's BIP39 seed, made natively when the phone can. The seed is PBKDF2-HMAC-SHA512 over 2,048 rounds,
 * and bip39's JavaScript version holds the JS thread for several seconds on a slow phone (the "freeze" after Generate
 * or after scanning a SeedQR). react-native-aes-crypto, which the app already ships for its Ark backups, does the same
 * computation natively in a few milliseconds, off the JS thread.
 *
 * The native result is only used once the phone's native PBKDF2 has given back two known answers, and only for text
 * that encodes to UTF-8 the same way in both. Anything else, including a missing module (tests, a build without it),
 * uses bip39's own function, which gives the same seed, just more slowly.
 */

const bip32 = BIP32Factory(ecc);

type Pbkdf2 = (password: string, salt: string, cost: number, bits: number, algorithm: 'sha512') => Promise<string>;

// a native call that never comes back leaves the JavaScript one to do the work
const NATIVE_TIMEOUT_MS = 5000;

const withTimeout = <T,>(promise: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('native PBKDF2 timed out')), NATIVE_TIMEOUT_MS);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            e => {
                clearTimeout(timer);
                reject(e);
            },
        );
    });

/** react-native-aes-crypto's PBKDF2 (UTF-8 text in, length in bits, hex out), called on its module, if it's there. */
const nativePbkdf2 = (): Pbkdf2 | undefined => {
    const aes = NativeModules?.Aes;
    if (typeof aes?.pbkdf2 !== 'function') return undefined;
    return (password, salt, cost, bits, algorithm) => withTimeout(Promise.resolve(aes.pbkdf2(password, salt, cost, bits, algorithm)));
};

const KNOWN_ANSWERS = [
    // BIP39's published test vector: "abandon … about" with the passphrase TREZOR
    {
        password: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        salt: 'mnemonicTREZOR',
        seed: 'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
    },
    // a passphrase with 2-, 3- and 4-byte UTF-8 characters ("Ünïcödé ₿ 🔑" in NFKD form), worked out with Node's
    // own PBKDF2 and checked against bip39
    {
        password: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        salt: 'mnemonicU\u0308ni\u0308co\u0308de\u0301 \u20bf \ud83d\udd11',
        seed: 'd1c41d7da754aebd4b57c69b6c3fe49fc6e4cd098561329d30604e949560d6bff1ad01f77c62bd9665254d12bbfbab4ea2770600434df538f375aafa0ec905c2',
    },
];

let nativeChecked: Promise<boolean> | null = null;

/** Whether this phone's native PBKDF2 gives the known answers. Asked once per launch. */
function nativeGivesKnownAnswers(pbkdf2: Pbkdf2): Promise<boolean> {
    if (!nativeChecked) {
        nativeChecked = Promise.all(KNOWN_ANSWERS.map(k => pbkdf2(k.password, k.salt, 2048, 512, 'sha512')))
            .then(out => out.every((hex, i) => String(hex).toLowerCase() === KNOWN_ANSWERS[i].seed))
            .catch(() => false);
    }
    return nativeChecked;
}

// text with a lone surrogate encodes differently in JavaScript (U+FFFD) and in Java or iOS
const sameInUtf8 = (text: string) => Buffer.from(text, 'utf8').toString('utf8') === text;

export async function seedFromMnemonic(mnemonic: string, passphrase = ''): Promise<Buffer> {
    // what bip39 hashes: the NFKD forms, as UTF-8, with "mnemonic" before the passphrase
    const password = (mnemonic || '').normalize('NFKD');
    const salt = `mnemonic${(passphrase || '').normalize('NFKD')}`;
    const pbkdf2 = nativePbkdf2();
    if (pbkdf2 && sameInUtf8(password) && sameInUtf8(salt) && (await nativeGivesKnownAnswers(pbkdf2))) {
        try {
            const hex = await pbkdf2(password, salt, 2048, 512, 'sha512');
            if (/^[0-9a-f]{128}$/i.test(String(hex))) return Buffer.from(String(hex), 'hex');
        } catch (_) {
            // bip39's own function below
        }
    }
    return bip39.mnemonicToSeedSync(mnemonic, passphrase);
}

export async function rootFromMnemonic(mnemonic: string, passphrase = ''): Promise<BIP32Interface> {
    return bip32.fromSeed(await seedFromMnemonic(mnemonic, passphrase));
}

/** Lets a slow step's busy indicator reach the screen before the work starts. */
export const nextFrame = () => new Promise<void>(resolve => setTimeout(resolve, 32));

/**
 * The native seed step, held to bip39's.
 *
 * What this protects: the app derives the Tron account with the phone's native
 * PBKDF2 instead of bip39's JavaScript, because the JavaScript froze the app for
 * 5.3 seconds a screen. One byte of difference in what goes in would give a
 * different address that still looks valid, which is where the user's dollars
 * would then be sent and where no recovery would look. So the native path is
 * held byte for byte to bip39 and to BIP39's published vectors, including
 * input that only matches after NFKD normalization, and a native answer that
 * is not a full seed is refused rather than used.
 */

import * as bip39 from 'bip39';
import Aes from 'react-native-aes-crypto';

import {
    deriveTronAccount,
    deriveTronAccountNative,
    mnemonicToSeedNative,
    withTronPrivateKey,
    withTronPrivateKeyNative,
} from '../../src/services/tron/keys';
import { signUsdtTransfer, signUsdtTransferNative } from '../../src/services/tron/transaction';

// The phone's native PBKDF2, computed by Node's for real rather than stubbed.
jest.mock('react-native-aes-crypto', () => {
    const { pbkdf2Sync } = jest.requireActual<typeof import('crypto')>('crypto');
    return {
        __esModule: true,
        default: {
            pbkdf2: jest.fn(async (password: string, salt: string, cost: number, bits: number, hash: string) =>
                pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(salt, 'utf8'), cost, bits / 8, hash).toString('hex'),
            ),
        },
    };
});

const nativePbkdf2 = Aes.pbkdf2 as jest.Mock;

const MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** BIP39's published seeds for MNEMONIC, without a passphrase and with "TREZOR". */
const PLAIN_SEED =
    '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4';
const TREZOR_SEED =
    'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04';

/** Full-width letters, a precomposed é, a squared-unit sign and a ligature: NFKD changes all four. */
const UNNORMALIZED_PASSPHRASE = 'Ｃａｆé ㍍ ﬁ';

describe('mnemonicToSeedNative', () => {
    it("gives BIP39's published seeds", async () => {
        expect((await mnemonicToSeedNative(MNEMONIC)).toString('hex')).toBe(PLAIN_SEED);
        expect((await mnemonicToSeedNative(MNEMONIC, 'TREZOR')).toString('hex')).toBe(TREZOR_SEED);
    });

    it('agrees with bip39 where only NFKD normalization makes the inputs match', async () => {
        expect(UNNORMALIZED_PASSPHRASE).not.toBe(UNNORMALIZED_PASSPHRASE.normalize('NFKD'));
        expect(await mnemonicToSeedNative(MNEMONIC, UNNORMALIZED_PASSPHRASE)).toEqual(
            bip39.mnemonicToSeedSync(MNEMONIC, UNNORMALIZED_PASSPHRASE),
        );
        // Ideographic spaces between the words normalize to plain ones.
        const ideographic = MNEMONIC.replace(/ /g, '　');
        expect(await mnemonicToSeedNative(ideographic)).toEqual(bip39.mnemonicToSeedSync(ideographic));
    });

    it('hands the native call the normalized phrase and salt, not the raw ones', async () => {
        await mnemonicToSeedNative(MNEMONIC, UNNORMALIZED_PASSPHRASE);
        expect(nativePbkdf2).toHaveBeenLastCalledWith(
            MNEMONIC,
            `mnemonic${UNNORMALIZED_PASSPHRASE.normalize('NFKD')}`,
            2048,
            512,
            'sha512',
        );
    });

    it('refuses a native answer that is not a full 64-byte seed', async () => {
        // iOS answers a parameter error with an empty string, not an error.
        for (const answer of ['', 'ab'.repeat(63), 'zz'.repeat(64), undefined]) {
            nativePbkdf2.mockResolvedValueOnce(answer);
            await expect(mnemonicToSeedNative(MNEMONIC)).rejects.toThrow(/Could not derive the wallet seed/);
        }
    });
});

describe('the native derivation', () => {
    it('gives the same account as the JavaScript one, with and without a passphrase', async () => {
        expect(await deriveTronAccountNative(MNEMONIC)).toEqual(deriveTronAccount(MNEMONIC));
        expect(await deriveTronAccountNative(MNEMONIC, 0, 0, UNNORMALIZED_PASSPHRASE)).toEqual(
            deriveTronAccount(MNEMONIC, 0, 0, UNNORMALIZED_PASSPHRASE),
        );
    });

    it('refuses an invalid phrase before asking for a seed', async () => {
        nativePbkdf2.mockClear();
        await expect(deriveTronAccountNative('clearly not a valid bip39 phrase')).rejects.toThrow(
            /Invalid recovery phrase/,
        );
        expect(nativePbkdf2).not.toHaveBeenCalled();
    });

    it('lends the same private key, and wipes it once the call returns', async () => {
        let lent: Buffer | undefined;
        const nativeHex = await withTronPrivateKeyNative(MNEMONIC, key => {
            lent = key;
            return key.toString('hex');
        });
        expect(nativeHex).toBe(withTronPrivateKey(MNEMONIC, key => key.toString('hex')));
        expect(lent?.every(byte => byte === 0)).toBe(true);
    });

    it('signs the same bytes as the JavaScript path', async () => {
        const request = {
            from: deriveTronAccount(MNEMONIC).address,
            to: 'TEERhoTJ3Rn6bKrWDYqdnuPaZ8kZf31YAS',
            amountUnits: '1000000',
            referenceBlock: {
                number: 86344053,
                id: '000000000525817508010f219354e9e406f715ba528e60226ecb4223a807067c',
                timestamp: 1789704360000,
            },
            createdAtMs: 1789704415000,
        };
        expect(await signUsdtTransferNative(request, MNEMONIC)).toEqual(signUsdtTransfer(request, MNEMONIC));
    });
});

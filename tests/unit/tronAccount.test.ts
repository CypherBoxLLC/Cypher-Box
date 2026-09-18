/**
 * Wiring the Tron account to the Hot Vault.
 *
 * The failure that matters here is deriving the wrong address and showing it as
 * a receive address, which sends the user's dollars somewhere no recovery finds.
 * Two ways that happens: ignoring the wallet's BIP39 passphrase, and reading a
 * secret that is not a mnemonic at all.
 */

import { deriveTronAccount } from '../../src/services/tron/keys';
import {
    deriveTronAccountFromWallet,
    resolveHotVaultTronAccount,
    tronTransferSignerForWallet,
} from '../../src/services/tron/account';
import { recoverTronSigner } from '../../src/services/tron/transaction';

const MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const hotVault = (over: Record<string, unknown> = {}) => ({
    getID: () => 'hot-vault-1',
    getSecret: () => MNEMONIC,
    getPassphrase: () => undefined,
    ...over,
});

describe('deriveTronAccountFromWallet', () => {
    it('derives the same account the phrase alone would', () => {
        expect(deriveTronAccountFromWallet(hotVault())).toEqual(deriveTronAccount(MNEMONIC));
    });

    it('includes the passphrase, without which the address is wrong and empty', () => {
        const withPassphrase = deriveTronAccountFromWallet(hotVault({ getPassphrase: () => 'grandma' }));
        expect(withPassphrase).toEqual(deriveTronAccount(MNEMONIC, 0, 0, 'grandma'));
        expect(withPassphrase?.address).not.toBe(deriveTronAccount(MNEMONIC).address);
    });

    it('treats an empty passphrase as none, as the wallet classes do', () => {
        expect(deriveTronAccountFromWallet(hotVault({ getPassphrase: () => '' }))?.address).toBe(
            deriveTronAccount(MNEMONIC).address,
        );
    });

    it('tolerates a phrase stored with odd whitespace', () => {
        const messy = `  ${MNEMONIC.replace(/ /g, '  ')}\n`;
        expect(deriveTronAccountFromWallet(hotVault({ getSecret: () => messy }))?.address).toBe(
            deriveTronAccount(MNEMONIC).address,
        );
    });

    it('returns null for a wallet that holds no seed', () => {
        expect(deriveTronAccountFromWallet(null)).toBeNull();
        expect(deriveTronAccountFromWallet({})).toBeNull();
        expect(deriveTronAccountFromWallet(hotVault({ getSecret: () => '' }))).toBeNull();
        // A WIF or xpub wallet: one token, not a phrase.
        expect(deriveTronAccountFromWallet(hotVault({ getSecret: () => 'zpub6rFR7y4Q2AijBE' }))).toBeNull();
    });

    it('throws when the secret looks like a phrase but is not one', () => {
        expect(() =>
            deriveTronAccountFromWallet(hotVault({ getSecret: () => 'clearly not a valid bip39 phrase' })),
        ).toThrow(/Invalid recovery phrase/);
    });
});

describe('resolveHotVaultTronAccount', () => {
    const wallets = [
        { getID: () => 'cold-1', getSecret: () => 'zpub6rFR7y4Q2AijBE' },
        hotVault(),
        { getID: () => 'other-1', getSecret: () => MNEMONIC },
    ];

    it('picks the wallet the app considers the Hot Vault', () => {
        expect(resolveHotVaultTronAccount(wallets, 'hot-vault-1')?.address).toBe(
            deriveTronAccount(MNEMONIC).address,
        );
    });

    it('returns null when there is no Hot Vault yet', () => {
        expect(resolveHotVaultTronAccount(wallets, undefined)).toBeNull();
        expect(resolveHotVaultTronAccount([], 'hot-vault-1')).toBeNull();
        expect(resolveHotVaultTronAccount(wallets, 'missing-id')).toBeNull();
    });

    it('returns null when the Hot Vault id points at a watch-only wallet', () => {
        expect(resolveHotVaultTronAccount(wallets, 'cold-1')).toBeNull();
    });
});

describe('tronTransferSignerForWallet', () => {
    const request = (from: string) => ({
        from,
        to: 'TEERhoTJ3Rn6bKrWDYqdnuPaZ8kZf31YAS',
        amountUnits: '1000000',
        referenceBlock: {
            number: 86344053,
            id: '000000000525817508010f219354e9e406f715ba528e60226ecb4223a807067c',
            timestamp: 1789704360000,
        },
        createdAtMs: 1789704415000,
    });

    it('signs as the account the wallet derives, passphrase included', () => {
        const wallet = hotVault({ getPassphrase: () => 'grandma' });
        const account = deriveTronAccountFromWallet(wallet);
        const signed = tronTransferSignerForWallet(wallet)?.(request(account!.address));
        expect(recoverTronSigner(signed!.txID, signed!.signature)).toBe(account!.address);
    });

    it('cannot sign for the address the phrase gives without its passphrase', () => {
        const wallet = hotVault({ getPassphrase: () => 'grandma' });
        const withoutPassphrase = deriveTronAccount(MNEMONIC).address;
        expect(() => tronTransferSignerForWallet(wallet)?.(request(withoutPassphrase))).toThrow(/cannot sign/);
    });

    it('returns null for a wallet that holds no phrase', () => {
        expect(tronTransferSignerForWallet(null)).toBeNull();
        expect(tronTransferSignerForWallet({})).toBeNull();
        expect(tronTransferSignerForWallet(hotVault({ getSecret: () => 'zpub6rFR7y4Q2AijBE' }))).toBeNull();
    });

    it('reads the phrase when it signs, and keeps no copy of it', () => {
        let secret = MNEMONIC;
        const signer = tronTransferSignerForWallet(hotVault({ getSecret: () => secret }));
        secret = '';
        expect(() => signer?.(request(deriveTronAccount(MNEMONIC).address))).toThrow(/no longer holds/);
    });
});

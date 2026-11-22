/**
 * Recover Hot Vault with several iPhone Keychain / Android Keystore backups on the phone.
 *
 * A tap on a backup used to restore it straight after Face ID, with every row spinning and the screen unable to
 * scroll past the list. Now only the tapped row unlocks, and its check shows the vault's master fingerprint, first
 * receive address and balance under it. Nothing is restored until "Restore this vault", and then exactly the checked
 * words are imported. The words come from public BIP39 test phrases; Electrum is never reached.
 */

import React from 'react';
import { ActivityIndicator, Text as RNText, TextInput, TouchableOpacity, View } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import RecoverSavingVault, { scanBackupBalance } from '../../src/screens/RecoverSavingVault';
import { HDSegwitBech32Wallet } from '../../class';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import loc, { formatBalance } from '../../loc';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import {
    getHotVaultSeedFromKeychain,
    listHotVaultKeychainBackupsWithMeta,
} from '../../src/services/hotVaultKeychain';
import { dispatchReset } from '../../src/helpers/navigation';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/storage-context', () => {
    const React = require('react');
    return { BlueStorageContext: React.createContext({ addAndSaveWallet: () => {}, wallets: [] }) };
});
jest.mock('../../blue_modules/hapticFeedback', () => ({
    __esModule: true,
    default: jest.fn(),
    HapticFeedbackTypes: { ImpactLight: 'impactLight', NotificationSuccess: 'notificationSuccess' },
}));
const mockSetWalletID = jest.fn();
const mockSetHotVaultKeychainBackup = jest.fn();
jest.mock('../../src/stores/authStore', () => ({
    __esModule: true,
    default: () => ({ setWalletID: mockSetWalletID, setHotVaultKeychainBackup: mockSetHotVaultKeychainBackup }),
}));
jest.mock('../../src/stores/eventLogStore', () => ({ recordEvent: jest.fn() }));
jest.mock('../../src/helpers/navigation', () => ({ dispatchReset: jest.fn() }));
jest.mock('../../src/services/hotVaultKeychain', () => ({
    getHotVaultSeedFromKeychain: jest.fn(),
    listHotVaultKeychainBackupsWithMeta: jest.fn(),
    resetHotVaultBackupFully: jest.fn().mockResolvedValue(true),
}));
const mockScreenLayout = jest.fn();
jest.mock('@Cypher/component-library', () => {
    const React = require('react');
    const { Text, TextInput: Input, TouchableOpacity: Touch } = require('react-native');
    return {
        ScreenLayout: (props: any) => {
            mockScreenLayout(props);
            return props.children;
        },
        Text,
        Input: React.forwardRef((props: any, ref: any) => <Input ref={ref} value={props.value} onChangeText={props.onChange} />),
        Button: (props: any) => (
            <Touch onPress={props.onPress}>
                <Text>{props.text}</Text>
            </Touch>
        ),
    };
});

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const LEGAL = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const ID_C = 'c'.repeat(64);
const text = loc.cypherbox.vault.recover_saving_vault;

const seeds: Record<string, string> = { [ID_A]: ABANDON, [ID_B]: LEGAL, [ID_C]: ABANDON };

const deferred = <T,>() => {
    let settle!: (v: T) => void;
    let fail!: (e: any) => void;
    const promise = new Promise<T>((resolve, reject) => {
        settle = resolve;
        fail = reject;
    });
    return { promise, resolve: settle, reject: fail };
};

const textOf = (node: renderer.ReactTestInstance) =>
    node
        .findAllByType(RNText)
        .map(t => [].concat(t.props.children).filter(c => typeof c === 'string').join(''))
        .join('\n');

let addAndSaveWallet: jest.Mock;

const open = async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
        tree = renderer.create(
            <BlueStorageContext.Provider value={{ addAndSaveWallet, wallets: [] } as any}>
                <RecoverSavingVault route={{}} />
            </BlueStorageContext.Provider>,
        );
    });
    return tree.root;
};

const rows = (root: renderer.ReactTestInstance) =>
    root.findAllByType(TouchableOpacity).filter(n => n.props.testID === 'keychainBackupRow');

const pressNode = async (node: renderer.ReactTestInstance) => {
    await act(async () => {
        await node.props.onPress();
    });
};

const byTestID = (root: renderer.ReactTestInstance, id: string) =>
    root.findAllByType(TouchableOpacity).filter(n => n.props.testID === id);

const panel = (root: renderer.ReactTestInstance) => root.findAllByType(View).filter(n => n.props.testID === 'keychainBackupCheck');

// the whole of a wallet's public facts, worked out the way the screen does
const facts = (words: string) => {
    const w = new HDSegwitBech32Wallet();
    w.setSecret(words);
    return { fingerprint: w.getMasterFingerprintHex().toUpperCase(), firstAddress: w._getExternalAddressByIndex(0), id: w.getID() };
};

beforeEach(() => {
    jest.clearAllMocks();
    addAndSaveWallet = jest.fn();
    (listHotVaultKeychainBackupsWithMeta as jest.Mock).mockResolvedValue([
        { ref: ID_A, meta: { createdAt: Date.UTC(2026, 9, 3) } },
        { ref: ID_B, meta: { createdAt: Date.UTC(2026, 8, 27) } },
        { ref: ID_C, meta: null },
    ]);
    (getHotVaultSeedFromKeychain as jest.Mock).mockImplementation(async (id: string) => ({ ok: true, mnemonic: seeds[id], walletID: id }));
    jest.spyOn(HDSegwitBech32Wallet.prototype, '_binarySearchIterationForInternalAddress').mockResolvedValue(0);
    jest.spyOn(HDSegwitBech32Wallet.prototype, '_binarySearchIterationForExternalAddress').mockResolvedValue(3);
    jest.spyOn(HDSegwitBech32Wallet.prototype, '_fetchBalance').mockResolvedValue(undefined);
    jest.spyOn(HDSegwitBech32Wallet.prototype, 'getBalance').mockReturnValue(12345);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('Recover Hot Vault with several Keychain backups', () => {
    test('the screen scrolls, so every backup and the 12-word boxes can be reached', async () => {
        await open();
        const props = mockScreenLayout.mock.calls[mockScreenLayout.mock.calls.length - 1][0];
        expect(props.keyboardAware).toBe(true);
        expect(props.disableScroll).toBeFalsy();
    });

    test('a tap unlocks only that backup, and checks it without restoring anything', async () => {
        const seed = deferred<any>();
        (getHotVaultSeedFromKeychain as jest.Mock).mockReturnValueOnce(seed.promise);
        const root = await open();
        expect(rows(root)).toHaveLength(3);
        rows(root).forEach(r => expect(textOf(r)).toContain(text.check));

        act(() => {
            rows(root)[1].props.onPress();
        });
        // only the tapped row spins; the others wait and can't be tapped
        expect(rows(root)[1].findAllByType(ActivityIndicator)).toHaveLength(1);
        expect(rows(root)[0].findAllByType(ActivityIndicator)).toHaveLength(0);
        expect(rows(root)[2].findAllByType(ActivityIndicator)).toHaveLength(0);
        expect(rows(root)[0].props.disabled).toBe(true);
        expect(rows(root)[2].props.disabled).toBe(true);
        expect(getHotVaultSeedFromKeychain).toHaveBeenCalledWith(ID_B);

        await act(async () => {
            seed.resolve({ ok: true, mnemonic: LEGAL });
            await new Promise(resolve => setTimeout(resolve, 80));
        });

        const legal = facts(LEGAL);
        const shown = textOf(panel(root)[0]);
        expect(shown).toContain(legal.fingerprint);
        expect(shown).toContain(legal.firstAddress);
        expect(shown).toContain(String(loc.formatString(text.check_balance, { amount: formatBalance(12345, BitcoinUnit.SATS, true) })));
        expect(shown).not.toContain(text.check_never_used); // receive index 3: used before
        // nothing restored, and no words anywhere on screen
        expect(addAndSaveWallet).not.toHaveBeenCalled();
        expect(dispatchReset).not.toHaveBeenCalled();
        expect(textOf(root)).not.toContain('legal winner');
        root.findAllByType(TextInput).forEach(input => expect(input.props.value ?? '').toBe(''));
    });

    test('Restore this vault imports exactly the checked words, then goes Home', async () => {
        const root = await open();
        await pressNode(rows(root)[1]);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 80));
        });
        await pressNode(byTestID(root, 'keychainBackupRestore')[0]);

        expect(addAndSaveWallet).toHaveBeenCalledTimes(1);
        const restored = addAndSaveWallet.mock.calls[0][0];
        expect(restored.getSecret()).toBe(LEGAL);
        expect(mockSetWalletID).toHaveBeenCalledWith(facts(LEGAL).id);
        // the backup's id differs from the words' own (as for a passphrase vault), so it isn't marked as backed up
        expect(mockSetHotVaultKeychainBackup).not.toHaveBeenCalled();
        expect(dispatchReset).toHaveBeenCalledWith('HomeScreen');
    });

    test('two backups of the same words show the same fingerprint', async () => {
        const root = await open();
        await pressNode(rows(root)[0]);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 80));
        });
        const first = textOf(panel(root)[0]);
        await pressNode(byTestID(root, 'keychainBackupClose')[0]);
        await pressNode(rows(root)[2]);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 80));
        });
        const third = textOf(panel(root)[0]);
        expect(first).toContain(facts(ABANDON).fingerprint);
        expect(third).toContain(facts(ABANDON).fingerprint);
        expect(addAndSaveWallet).not.toHaveBeenCalled();
    });

    test('Close drops the check and restores nothing', async () => {
        const root = await open();
        await pressNode(rows(root)[0]);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 80));
        });
        expect(panel(root)).toHaveLength(1);
        await pressNode(byTestID(root, 'keychainBackupClose')[0]);
        expect(panel(root)).toHaveLength(0);
        expect(addAndSaveWallet).not.toHaveBeenCalled();
    });

    test('a balance that cannot be checked says so, and the vault can still be restored', async () => {
        (HDSegwitBech32Wallet.prototype._binarySearchIterationForInternalAddress as jest.Mock).mockRejectedValue(
            new Error('Electrum client is not connected'),
        );
        const root = await open();
        await pressNode(rows(root)[0]);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 80));
        });
        const shown = textOf(panel(root)[0]);
        expect(shown).toContain(text.check_balance_failed);
        expect(shown).not.toContain(String(loc.formatString(text.check_balance, { amount: formatBalance(0, BitcoinUnit.SATS, true) })));
        await pressNode(byTestID(root, 'keychainBackupRestore')[0]);
        expect(addAndSaveWallet).toHaveBeenCalledTimes(1);
        expect(addAndSaveWallet.mock.calls[0][0].getSecret()).toBe(ABANDON);
    });

    test('a vault never used says so', async () => {
        (HDSegwitBech32Wallet.prototype._binarySearchIterationForExternalAddress as jest.Mock).mockResolvedValue(0);
        (HDSegwitBech32Wallet.prototype.getBalance as jest.Mock).mockReturnValue(0);
        const root = await open();
        await pressNode(rows(root)[0]);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 80));
        });
        expect(textOf(panel(root)[0])).toContain(text.check_never_used);
    });

    test('a balance arriving after its check was closed is dropped, even when the same backup is checked again', async () => {
        const slow = deferred<void>();
        let firstWallet: any = null;
        (HDSegwitBech32Wallet.prototype._fetchBalance as jest.Mock).mockImplementationOnce(function (this: any) {
            firstWallet = this;
            return slow.promise;
        });
        // the first, stale check would read 111; the second reads 777
        (HDSegwitBech32Wallet.prototype.getBalance as jest.Mock).mockImplementation(function (this: any) {
            return this === firstWallet ? 111 : 777;
        });
        const root = await open();
        // its balance hangs, so the tap's own promise isn't awaited
        let firstCheck: Promise<void> = Promise.resolve();
        await act(async () => {
            firstCheck = rows(root)[0].props.onPress();
            await new Promise(resolve => setTimeout(resolve, 80));
        });
        expect(textOf(panel(root)[0])).toContain(text.check_balance_checking);

        await pressNode(byTestID(root, 'keychainBackupClose')[0]);
        await pressNode(rows(root)[0]); // the same backup, checked again
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 80));
        });
        await act(async () => {
            slow.resolve();
            await firstCheck;
        });
        const amount = (sats: number) => String(loc.formatString(text.check_balance, { amount: formatBalance(sats, BitcoinUnit.SATS, true) }));
        const shown = textOf(panel(root)[0]);
        expect(shown).toContain(amount(777));
        expect(shown).not.toContain(amount(111));
        expect(panel(root)).toHaveLength(1);
    });

    test('checking another backup replaces the open check', async () => {
        const root = await open();
        await pressNode(rows(root)[0]);
        await pressNode(rows(root)[1]);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 80));
        });
        expect(panel(root)).toHaveLength(1);
        const shown = textOf(panel(root)[0]);
        expect(shown).toContain(facts(LEGAL).fingerprint);
        expect(shown).not.toContain(facts(ABANDON).fingerprint);
    });
});

describe('scanBackupBalance', () => {
    test('throws when the server fails, instead of reading 0 sats', async () => {
        jest.spyOn(HDSegwitBech32Wallet.prototype, '_binarySearchIterationForInternalAddress').mockRejectedValue(new Error('down'));
        const w = new HDSegwitBech32Wallet();
        w.setSecret(ABANDON);
        await expect(scanBackupBalance(w)).rejects.toThrow('down');
    });

    test('reports the balance and whether any address was used', async () => {
        const w = new HDSegwitBech32Wallet();
        w.setSecret(ABANDON);
        await expect(scanBackupBalance(w)).resolves.toEqual({ balance: 12345, used: true });
        expect(w.next_free_address_index).toBe(3);
        expect(w.next_free_change_address_index).toBe(0);
    });
});

/**
 * The signer's home without a Hot Vault. The seed is never kept, so once this phone has shown a seed's public key,
 * remembers one, has a multisig wallet or has signed, the home leads with signing (the Hot Vault's "Sign a transaction
 * (.PSBT)" icon on its big card) instead of offering to make a seed again; a seed just made and backed up is mentioned
 * once when the home comes back, and the public keys it remembers are listed to show again.
 */

import React from 'react';
import { Text as RNText, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import SigningHome from '../../src/screens/SigningHome';
import { noteSeedBackedUp, takeSeedBackedUp } from '../../src/screens/SigningHome/seedSigner';
import { startSigning } from '../../src/screens/SignOnce/start';
import useAuthStore from '../../src/stores/authStore';

jest.mock('../../src/stores/index', () => ({
    __esModule: true,
    zustandStorage: {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
    },
}));
jest.mock('@Cypher/component-library', () => {
    const { Text } = require('react-native');
    return { ScreenLayout: ({ children }: any) => children, Text };
});
jest.mock('react-native-device-info', () => ({ getVersion: () => '0.1.14', getBuildNumber: () => '1' }));
// icons draw nothing here, so their glyphs stay out of the labels read below; their names are still checked
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => () => null);
// the wallets as loaded, with no Hot Vault, and without the app's storage and Electrum behind them
jest.mock('../../blue_modules/storage-context', () => ({
    BlueStorageContext: require('react').createContext({ wallets: [], walletsInitialized: true }),
}));
jest.mock('../../src/custom-hooks/useElectrumConnection', () => () => 'no-answer');
jest.mock('../../src/screens/HotStorageVault/Settings', () => () => null);
jest.mock('../../src/screens/SigningHome/Signer', () => () => null);
jest.mock('../../src/screens/SignOnce/start', () => ({ startSigning: jest.fn() }));
// the home is focused while it's mounted
jest.mock('@react-navigation/native', () => {
    const { useEffect } = require('react');
    return {
        ...jest.requireActual('@react-navigation/native'),
        useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
    };
});

const textOf = (node: renderer.ReactTestInstance) =>
    node.findAllByType(RNText).map(t => [].concat(t.props.children).filter(c => typeof c === 'string').join('')).join('\n');

// the big card is the one button with a line under its name (its accessibility hint)
const isCard = (b: renderer.ReactTestInstance) => b.props.accessibilityHint !== undefined;
const card = (root: renderer.ReactTestInstance) => root.findAllByType(TouchableOpacity).find(isCard)!;
const buttonLabels = (root: renderer.ReactTestInstance) =>
    root.findAllByType(TouchableOpacity).filter(b => !isCard(b)).map(b => textOf(b));
const icons = (node: renderer.ReactTestInstance) => node.findAll(n => typeof n.props.name === 'string' && !!n.props.size).map(n => n.props.name);

let navigate: jest.SpyInstance;
let tree: renderer.ReactTestRenderer | undefined;

const open = () => {
    act(() => {
        tree = renderer.create(<SigningHome />);
    });
    return tree!.root;
};

const press = (node: renderer.ReactTestInstance) => act(() => node.props.onPress());

beforeEach(() => {
    useAuthStore.setState({ signedOnThisPhone: false, signerKeyShown: false, signerAccounts: {}, signerWallets: {} });
    takeSeedBackedUp();
    (startSigning as jest.Mock).mockClear();
    navigate = jest.spyOn(require('../../src/helpers/navigation'), 'default').mockImplementation(() => {});
});
afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
    jest.restoreAllMocks();
});

describe("the signer's home", () => {
    it("leads with making a seed on a phone that hasn't shown a key or signed", () => {
        const root = open();
        expect(card(root).props.accessibilityLabel).toBe('Create a Seed');
        expect(textOf(card(root))).toContain('12 new words, backed up on paper and as a SeedQR');
        expect(icons(card(root))).toEqual(['seed-outline']);
        expect(textOf(root)).toContain('Create a seed and back it up as a SeedQR');
        expect(buttonLabels(root)).toEqual([
            'Sign a Transaction (.PSBT)',
            "Show a Seed's Public Key",
            'Receive - Check Address',
            'Multisig Wallets',
            'Signing Safely',
            'App Settings',
        ]);
        expect(textOf(root)).not.toContain('Public keys this phone remembers');
        press(card(root));
        expect(navigate).toHaveBeenCalledWith('CreateSignerSeed');
    });

    it("leads with signing once a seed's public key was shown here, and still makes another seed", () => {
        useAuthStore.setState({ signerKeyShown: true });
        const root = open();
        expect(card(root).props.accessibilityLabel).toBe('Sign a Transaction (.PSBT)');
        expect(textOf(card(root))).toContain('Scan or open it, check it, then scan your SeedQR');
        // the Hot Vault's "Sign a transaction (.PSBT)" icon
        expect(icons(card(root))).toEqual(['file-sign']);
        expect(textOf(root)).toContain("This phone doesn't keep your seed: it lives on your backup.");
        expect(textOf(root)).not.toContain('Create a seed and back it up');
        expect(buttonLabels(root)).toEqual([
            "Show a Seed's Public Key",
            'Receive - Check Address',
            'Multisig Wallets',
            'Create Another Seed',
            'Signing Safely',
            'App Settings',
        ]);
        press(card(root));
        expect(startSigning).toHaveBeenCalledTimes(1);
        expect(navigate).not.toHaveBeenCalled();

        const buttons = root.findAllByType(TouchableOpacity);
        press(buttons.find(b => textOf(b) === 'Create Another Seed')!);
        expect(navigate).toHaveBeenLastCalledWith('CreateSignerSeed');
        press(buttons.find(b => textOf(b) === "Show a Seed's Public Key")!);
        expect(navigate).toHaveBeenLastCalledWith('CreateSignerSeed', { mode: 'show' });
    });

    it('leads with signing on a phone that has signed, with a seed made elsewhere', () => {
        useAuthStore.setState({ signedOnThisPhone: true });
        expect(card(open()).props.accessibilityLabel).toBe('Sign a Transaction (.PSBT)');
    });

    it('leads with signing on a phone that has a multisig wallet', () => {
        useAuthStore.setState({ signerWallets: { w1: {} as any } });
        const root = open();
        expect(card(root).props.accessibilityLabel).toBe('Sign a Transaction (.PSBT)');
        expect(buttonLabels(root)).toContain('Multisig Wallets (1)');
    });

    it('lists the public keys it remembers, oldest first, each shown again without the SeedQR', () => {
        useAuthStore.setState({
            signerAccounts: {
                b4e3f5ed: { fingerprint: 'b4e3f5ed', path: "m/84'/0'/0'", xpub: 'xpub-b', addedAt: 2 },
                '73c5da0a': { fingerprint: '73c5da0a', path: "m/84'/0'/0'", xpub: 'xpub-a', addedAt: 1 },
            },
        });
        const root = open();
        // a remembered key is enough to put signing first
        expect(card(root).props.accessibilityLabel).toBe('Sign a Transaction (.PSBT)');
        expect(textOf(root)).toContain('Public keys this phone remembers');
        expect(buttonLabels(root).slice(0, 2)).toEqual(['73C5DA0A', 'B4E3F5ED']);
        press(root.findAllByType(TouchableOpacity).find(b => textOf(b) === '73C5DA0A')!);
        expect(navigate).toHaveBeenLastCalledWith('CreateSignerSeed', { mode: 'remembered', fingerprint: '73c5da0a' });
    });

    it('says once that a seed just made is backed up', () => {
        useAuthStore.setState({ signerKeyShown: true });
        noteSeedBackedUp('73C5DA0A');
        const root = open();
        expect(textOf(root)).toContain('Seed 73C5DA0A was created and backed up.');
        expect(icons(root)).toContain('check-circle');

        // gone once the user has moved on and come back
        act(() => tree!.unmount());
        expect(textOf(open())).not.toContain('was created and backed up');
    });
});

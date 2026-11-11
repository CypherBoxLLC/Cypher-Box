/**
 * Adding a multisig wallet on the Offline Seed-Signer, through the screen: the wallet file is scanned, its keys and
 * first address shown, the seed's SeedQR (typed words here) confirms its key is in it, and only then is the wallet
 * stored, with no words left on screen. A file that lists the seed's fingerprint with someone else's key is refused
 * and nothing is stored. Keys and addresses come from fixtures/multisig-signer (rust-miniscript), all from public
 * BIP39 test phrases.
 */

import React from 'react';
import { Text as RNText, TextInput, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import RegisterSignerWallet from '../../src/screens/RegisterSignerWallet';
import useAuthStore from '../../src/stores/authStore';
import { OWN_KEY_DIFFERENT, WALLET_FILE_NOT_P2WSH } from '../../src/helpers/multisigPolicy';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
// the encrypted store's backend: what gets written is checked below
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
jest.mock('@Cypher/components/OfflineSeedWarning', () => () => null);
jest.mock('../../src/custom-hooks/useProtectSecret', () => () => {});
jest.mock('../../src/custom-hooks/useElectrumConnection', () => () => 'no-answer');
jest.mock('../../helpers/scan-qr', () => ({ requestCameraAuthorization: () => Promise.resolve() }));

const fixtures = require('./fixtures/multisig-signer/fixtures.json');
const K = fixtures.keys;
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const walletFile = (keys: any[]) =>
    ['# Exported from Nunchuk', 'Name: Family vault', 'Policy: 2 of 3', 'Format: P2WSH', '']
        .concat(keys.flatMap(k => [`Derivation: ${k.path}`, `${k.fingerprint.toUpperCase()}: ${k.xpub}`, '']))
        .join('\n');

const textOf = (root: renderer.ReactTestInstance) =>
    root.findAllByType(RNText).map(t => [].concat(t.props.children).filter(c => typeof c === 'string').join('')).join('\n');

const press = async (root: renderer.ReactTestInstance, label: RegExp) => {
    const button = root.findAllByType(TouchableOpacity).find(b => label.test(textOf(b)));
    if (!button) throw new Error(`no button ${label}`);
    await act(async () => {
        await button.props.onPress();
    });
};

const open = () => {
    let onScanned: ((ret: any) => void) | null = null;
    const navigation = {
        navigate: (_: string, params: any) => {
            onScanned = params.params.onBarScanned;
        },
        getParent: () => ({ pop: () => {} }),
        goBack: jest.fn(),
    };
    let tree: renderer.ReactTestRenderer;
    act(() => {
        tree = renderer.create(<RegisterSignerWallet navigation={navigation} />);
    });
    const root = tree!.root;
    const scan = async (data: string) => {
        await press(root, /^Scan QR$/);
        await act(async () => onScanned!({ data }));
    };
    const typeWords = (words: string) => {
        const input = root.findAllByType(TextInput).find(i => /12 or 24 words/.test(i.props.placeholder))!;
        act(() => input.props.onChangeText(words));
    };
    return { root, scan, typeWords, navigation };
};

beforeEach(() => {
    act(() => useAuthStore.setState({ signerWallets: {} }));
});

describe('adding a multisig wallet', () => {
    it('shows the wallet, confirms the key with the seed and stores only public keys', async () => {
        const { root, scan, typeWords } = open();
        await scan(walletFile([K.abandon, K.legal, K.letter]));
        const review = textOf(root);
        expect(review).toContain('Check this wallet');
        expect(review).toContain('Family vault');
        expect(review).toContain('2 of 3 multisig');
        for (const k of [K.abandon, K.legal, K.letter]) expect(review).toContain(k.fingerprint);
        expect(review).toContain(fixtures.wallets.w1.addresses.receive0);
        expect(Object.keys(useAuthStore.getState().signerWallets)).toHaveLength(0);

        await press(root, /Confirm with your SeedQR/);
        typeWords(ABANDON);
        await press(root, /^Continue$/);
        expect(textOf(root)).toContain('Wallet added');
        expect(textOf(root)).toContain('Key 1 · this seed');

        const stored = Object.values(useAuthStore.getState().signerWallets);
        expect(stored).toHaveLength(1);
        expect(stored[0].ownFingerprint).toBe('73c5da0a');
        expect(stored[0].keys).toEqual([K.abandon, K.legal, K.letter]);
        expect(JSON.stringify(stored[0])).not.toMatch(/abandon|prv/);
        // persisted to the encrypted store, public keys only
        const { zustandStorage } = require('../../src/stores/index');
        const written = (zustandStorage.setItem as jest.Mock).mock.calls.map(c => String(c[1])).filter(v => v.includes(stored[0].id));
        expect(written.length).toBeGreaterThan(0);
        expect(written.every(v => !/abandon|prv/.test(v))).toBe(true);
        // the words are gone from the screen
        expect(root.findAllByType(TextInput).every(i => !i.props.value)).toBe(true);
    });

    it("refuses a file that lists this seed's fingerprint with someone else's key, and stores nothing", async () => {
        const { root, scan, typeWords } = open();
        await scan(walletFile([{ ...K.ozone, fingerprint: K.abandon.fingerprint }, K.legal, K.letter]));
        await press(root, /Confirm with your SeedQR/);
        typeWords(ABANDON);
        await press(root, /^Continue$/);
        expect(textOf(root)).toContain(OWN_KEY_DIFFERENT);
        expect(useAuthStore.getState().signerWallets).toEqual({});
    });

    it('says why a wallet it does not sign for is refused', async () => {
        const { root, scan } = open();
        await scan(walletFile([K.abandon, K.legal, K.letter]).replace('P2WSH', 'P2TR'));
        expect(textOf(root)).toContain(WALLET_FILE_NOT_P2WSH);
        expect(textOf(root)).not.toContain('Check this wallet');
    });

    it('does not add the same wallet twice', async () => {
        const first = open();
        await first.scan(walletFile([K.abandon, K.legal, K.letter]));
        await press(first.root, /Confirm with your SeedQR/);
        first.typeWords(ABANDON);
        await press(first.root, /^Continue$/);

        const again = open();
        // the same keys in another order are the same wallet
        await again.scan(walletFile([K.letter, K.abandon, K.legal]));
        expect(textOf(again.root)).toContain('already on this phone, as Family vault');
        expect(again.root.findAllByType(TouchableOpacity).some(b => /Confirm with your SeedQR/.test(textOf(b)))).toBe(false);
    });
});

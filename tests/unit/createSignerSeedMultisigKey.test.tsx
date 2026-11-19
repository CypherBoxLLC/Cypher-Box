/**
 * The seed-signer's key screen offers the seed's multisig key for a coordinator such as Nunchuk or Sparrow, behind a
 * link, without changing the single-key public key above it. Expected keys were computed with @scure/bip32 and @scure/bip39 from a public BIP39
 * test mnemonic.
 */

import React from 'react';
import { Text as RNText, TextInput, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import CreateSignerSeed from '../../src/screens/CreateSignerSeed';

// the screen remembers a shown public key in the persisted store; its storage isn't part of these tests
jest.mock('../../src/stores/index', () => ({
    zustandStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}));
jest.mock('@Cypher/component-library', () => {
    const { Text } = require('react-native');
    return { ScreenLayout: ({ children }: any) => children, Text };
});
jest.mock('@Cypher/components/OfflineSeedWarning', () => () => null);
jest.mock('@Cypher/components/SeedQRGrid', () => () => null);
jest.mock('@Cypher/components/ScannableQR', () => {
    const { View } = require('react-native');
    return () => <View />;
});
jest.mock('../../src/custom-hooks/useProtectSecret', () => () => {});
jest.mock('../../src/custom-hooks/useElectrumConnection', () => () => 'no-answer');
jest.mock('../../src/custom-hooks/useSeedQRCheck', () => () => ({ result: 'idle', scan: () => {} }));
jest.mock('../../helpers/scan-qr', () => ({ requestCameraAuthorization: () => Promise.resolve() }));
jest.mock('react-native-simple-toast', () => ({ show: () => {}, SHORT: 0 }));

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MULTISIG_KEY =
    '[73c5da0a/48h/0h/0h/2h]xpub6DkFAXWQ2dHxq2vatrt9qyA3bXYU4ToWQwCHbf5XB2mSTexcHZCeKS1VZYcPoBd5X8yVcbXFHJR9R8UCVpt82VX1VhR28mCyxUFL4r6KFrf';
const MULTISIG_KEY_TREZOR =
    '[b4e3f5ed/48h/0h/0h/2h]xpub6EvUNn2FJ1EvJtzDBLGqky8EypxyrcqzPGtLvXrYGMvJXB1DsJnDkSK9hmrJJbC1hXJhQxdarj4ELYX7YY5QSwVwe3PxQrkfMuXy9nFcKrg';
// BIP84's published account key for the same mnemonic: the single-key public key the screen already shows
const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
// as the screen hands it out since the fingerprint fix: with its origin
const ZPUB_KEY = `[73c5da0a/84h/0h/0h]${ZPUB}`;

const textOf = (root: renderer.ReactTestInstance) =>
    root.findAllByType(RNText).map(t => [].concat(t.props.children).filter(c => typeof c === 'string').join('')).join('\n');

// the key is worked out after a frame, so a press waits for whatever it started
const press = async (root: renderer.ReactTestInstance, label: RegExp) => {
    const button = root.findAllByType(TouchableOpacity).find(b => label.test(textOf(b)));
    if (!button) throw new Error(`no button ${label}`);
    await act(async () => {
        await button.props.onPress();
    });
};

// what each QR on the screen encodes (the mocked ScannableQR, found by its type)
const qrValues = (root: renderer.ReactTestInstance) =>
    root.findAllByType(require('@Cypher/components/ScannableQR')).map(n => n.props.value);

const showKey = async (words: string, passphrase = '') => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
        tree = renderer.create(<CreateSignerSeed route={{ params: { mode: 'show' } }} navigation={{ goBack: () => {} }} />);
    });
    const root = tree!.root;
    const inputs = root.findAllByType(TextInput);
    const field = (placeholder: RegExp) => inputs.find(i => placeholder.test(i.props.placeholder))!;
    act(() => field(/^Passphrase/).props.onChangeText(passphrase));
    act(() => field(/12 or 24 words/).props.onChangeText(words));
    await press(root, /^Continue$/);
    return root;
};

describe("the key screen's multisig key", () => {
    it('is hidden at first, and the single-key public key is unchanged', async () => {
        const root = await showKey(ABANDON);
        const text = textOf(root);
        expect(text).toContain(ZPUB);
        expect(text).not.toContain(MULTISIG_KEY);
        expect(qrValues(root)).toEqual([ZPUB_KEY]);
    });

    it('shows the m/48 key with its origin as text and as a QR', async () => {
        const root = await showKey(ABANDON);
        await press(root, /one key of a multisig\?/);
        const text = textOf(root);
        expect(text).toContain('Multisig key');
        expect(text).toContain('Nunchuk, Sparrow, BlueWallet');
        expect(text).toContain(MULTISIG_KEY);
        expect(qrValues(root)).toEqual([ZPUB_KEY, MULTISIG_KEY]);
        await press(root, /Hide the multisig key/);
        expect(textOf(root)).not.toContain(MULTISIG_KEY);
    });

    it('uses the passphrase typed for this seed', async () => {
        const root = await showKey(ABANDON, 'TREZOR');
        await press(root, /one key of a multisig\?/);
        expect(textOf(root)).toContain(MULTISIG_KEY_TREZOR);
        expect(textOf(root)).not.toContain(MULTISIG_KEY);
    });
});

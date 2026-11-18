/**
 * Multisig Wallets on the seed-signer: a registered wallet's transaction can be signed from here, not only from the
 * home screen. Wallet from public BIP39 test keys (the multisig-signer fixtures).
 */

import React from 'react';
import { Text as RNText, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import SignerWallets from '../../src/screens/SignerWallets';
import useAuthStore from '../../src/stores/authStore';
import { parseWalletFile } from '../../src/helpers/multisigPolicy';
import { startSigning } from '../../src/screens/SignOnce/start';

jest.mock('../../src/stores/index', () => ({
    zustandStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}));
jest.mock('@Cypher/component-library', () => {
    const { Text } = require('react-native');
    return { ScreenLayout: ({ children }: any) => children, Text };
});
jest.mock('../../src/screens/SignOnce/start', () => ({ startSigning: jest.fn() }));
jest.mock('react-native-simple-toast', () => ({ show: () => {}, SHORT: 0 }));

const fixtures = require('./fixtures/multisig-signer/fixtures.json');
const W1 = { ...parseWalletFile(fixtures.wallets.w1.descriptor), name: 'Family vault', ownFingerprint: '73c5da0a', addedAt: 0 };

// a button's label, then its chevron icon's glyph
const textOf = (node: renderer.ReactTestInstance) =>
    node.findAllByType(RNText).map(t => [].concat(t.props.children).filter(c => typeof c === 'string').join('')).join('\n');

const render = () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
        tree = renderer.create(<SignerWallets navigation={{ navigate: jest.fn() }} />);
    });
    return tree!.root;
};

describe('Multisig Wallets', () => {
    it('signs a transaction from here once a wallet is registered', () => {
        act(() => useAuthStore.setState({ signerWallets: { [W1.id]: W1 } }));
        const root = render();
        const button = root.findAllByType(TouchableOpacity).find(b => textOf(b).startsWith('Sign a Multisig Transaction'));
        expect(button).toBeTruthy();
        act(() => button!.props.onPress());
        expect(startSigning).toHaveBeenCalledWith();
    });

    it('has nothing to sign before a wallet is registered', () => {
        act(() => useAuthStore.setState({ signerWallets: {} }));
        const root = render();
        expect(root.findAllByType(TouchableOpacity).some(b => textOf(b).startsWith('Sign a Multisig Transaction'))).toBe(false);
        expect(root.findAllByType(TouchableOpacity).some(b => textOf(b).startsWith('Add a Multisig Wallet'))).toBe(true);
    });
});

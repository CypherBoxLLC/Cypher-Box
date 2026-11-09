/**
 * The signing screen in Offline Seed-Signer mode with a multisig spend: refused as soon as it's scanned when its wallet
 * isn't registered (no SeedQR is asked for), otherwise signed from the backup, with the wallet named in the review,
 * change shown as change, and the other keys mentioned after signing. The transaction comes from
 * fixtures/multisig-signer (rust-miniscript); the signer's seed is the public "abandon ... about" phrase.
 */

import React from 'react';
import { Text as RNText, TextInput, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import * as bitcoin from 'bitcoinjs-lib';

import SignOnce from '../../src/screens/SignOnce';
import useAuthStore from '../../src/stores/authStore';
import { parseWalletFile } from '../../src/helpers/multisigPolicy';
import { SIGN_UNKNOWN_MULTISIG } from '../../src/helpers/signOnce';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../src/stores/index', () => ({
    __esModule: true,
    zustandStorage: {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
    },
}));
jest.mock('../../blue_modules/storage-context', () => {
    const { createContext } = require('react');
    return { BlueStorageContext: createContext({ wallets: [] }) };
});
jest.mock('@Cypher/component-library', () => {
    const { Text } = require('react-native');
    return { ScreenLayout: ({ children }: any) => children, Text };
});
jest.mock('@Cypher/components/OfflineSeedWarning', () => () => null);
jest.mock('@Cypher/components/SigningPhoneStatus', () => () => null);
jest.mock('../../components/DynamicQRCode', () => ({ DynamicQRCode: () => null }));
jest.mock('../../src/custom-hooks/useProtectSecret', () => () => {});
jest.mock('../../src/custom-hooks/useElectrumConnection', () => () => 'no-answer');
jest.mock('../../helpers/scan-qr', () => ({ requestCameraAuthorization: () => Promise.resolve() }));
jest.mock('react-native-simple-toast', () => ({ show: () => {}, SHORT: 0 }));

const fixtures = require('./fixtures/multisig-signer/fixtures.json');
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const W1 = { ...parseWalletFile(fixtures.wallets.w1.descriptor), name: 'Family vault', ownFingerprint: '73c5da0a', addedAt: 0 };
const W1_SPEND = bitcoin.Psbt.fromHex(fixtures.psbts.w1Spend.unsignedHex).toBase64();

const textOf = (root: renderer.ReactTestInstance) =>
    root.findAllByType(RNText).map(t => [].concat(t.props.children).filter(c => typeof c === 'string').join('')).join('\n');

const press = async (root: renderer.ReactTestInstance, label: RegExp) => {
    const button = root.findAllByType(TouchableOpacity).find(b => label.test(textOf(b)));
    if (!button) throw new Error(`no button ${label}`);
    await act(async () => {
        await button.props.onPress();
    });
};

const open = (psbt: string) => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
        tree = renderer.create(<SignOnce route={{ params: { psbt } }} navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
    });
    return tree!.root;
};

beforeEach(() => {
    act(() => useAuthStore.setState({ signingMode: true, signerWallets: {}, walletID: '' }));
});

describe('signing a multisig spend on the signer', () => {
    it("refuses a wallet that isn't registered before asking for the SeedQR", () => {
        const root = open(W1_SPEND);
        expect(textOf(root)).toContain(SIGN_UNKNOWN_MULTISIG);
        expect(root.findAllByType(TextInput)).toHaveLength(0);
    });

    it('names the registered wallet, shows the change, and mentions the other keys after signing', async () => {
        act(() => useAuthStore.setState({ signerWallets: { [W1.id]: W1 } }));
        const root = open(W1_SPEND);
        const words = root.findAllByType(TextInput).find(i => /12 or 24 words/.test(i.props.placeholder))!;
        act(() => words.props.onChangeText(ABANDON));
        await press(root, /^Continue$/);

        const review = textOf(root);
        expect(review).toContain('From Family vault, a 2 of 3 multisig wallet.');
        expect(review).toContain('Back to your wallet');
        expect(review).toContain(fixtures.wallets.w1.addresses.change5);
        expect(review).toContain('120,000 sats');
        expect(review).toContain('600 sats');

        await press(root, /^Sign$/);
        const signed = textOf(root);
        expect(signed).toContain('Signed');
        expect(signed).toContain('once 2 of the 3 keys have signed');
    });
});

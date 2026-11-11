/**
 * "Receive - Check Address" on the seed-signer: a multisig address is looked for in the registered wallets, a
 * single-key one in the seed whose SeedQR or words are given (and not kept). Public BIP39 test phrases and BIP84's
 * published addresses only.
 */

import React from 'react';
import { Alert, Text as RNText, TextInput, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';
// the app loads BlueWallet's wallet classes, which set bitcoinjs up for Taproot addresses
import '../../class';

import CheckSignerAddress from '../../src/screens/CheckSignerAddress';
import useAuthStore from '../../src/stores/authStore';
import { parseWalletFile } from '../../src/helpers/multisigPolicy';
import { signerAccountOf, signerPublicKey } from '../../src/helpers/signerPublicKey';
import { rootFromBackup } from '../../src/helpers/signOnce';

jest.mock('../../src/stores/index', () => ({
    zustandStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}));
jest.mock('@Cypher/component-library', () => {
    const { Text } = require('react-native');
    return { ScreenLayout: ({ children }: any) => children, Text };
});
jest.mock('@Cypher/components/OfflineSeedWarning', () => () => null);
jest.mock('../../src/custom-hooks/useProtectSecret', () => () => {});
let mockConnection = 'no-answer';
jest.mock('../../src/custom-hooks/useElectrumConnection', () => () => mockConnection);
jest.mock('../../helpers/scan-qr', () => ({ requestCameraAuthorization: () => Promise.resolve() }));

const fixtures = require('./fixtures/multisig-signer/fixtures.json');
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const LEGAL = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const BIP84_RECEIVE_1 = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
const W1 = { ...parseWalletFile(fixtures.wallets.w1.descriptor), name: 'Family vault', ownFingerprint: '73c5da0a', addedAt: 0 };

const textOf = (node: renderer.ReactTestInstance) =>
    node.findAllByType(RNText).map(t => [].concat(t.props.children).filter(c => typeof c === 'string').join('')).join('\n');

const press = async (root: renderer.ReactTestInstance, label: RegExp) => {
    const button = root.findAllByType(TouchableOpacity).find(b => label.test(textOf(b)));
    if (!button) throw new Error(`no button ${label}`);
    await act(async () => {
        await button.props.onPress();
    });
};

const type = (root: renderer.ReactTestInstance, placeholder: RegExp, text: string) => {
    const input = root.findAllByType(TextInput).find(i => placeholder.test(i.props.placeholder));
    if (!input) throw new Error(`no field ${placeholder}`);
    act(() => input.props.onChangeText(text));
};

const open = () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
        tree = renderer.create(<CheckSignerAddress navigation={{ navigate: jest.fn(), getParent: () => ({ pop: jest.fn() }) }} />);
    });
    return tree!.root;
};

const checkAddress = async (root: renderer.ReactTestInstance, address: string) => {
    type(root, /type or paste the address/, address);
    await press(root, /^Check$/);
};

const remembered = (phrase: string) => signerAccountOf(signerPublicKey(rootFromBackup(phrase)));

beforeEach(() => {
    mockConnection = 'no-answer';
    act(() => useAuthStore.setState({ signerWallets: {}, signerAccounts: {} }));
});

describe('Receive - Check Address', () => {
    it("asks for the seed of a single-key address, then says which of its addresses it is", async () => {
        const root = open();
        await checkAddress(root, `bitcoin:${BIP84_RECEIVE_1.toUpperCase()}?amount=0.0002`);
        expect(textOf(root)).toContain('Single-key address');
        type(root, /12 or 24 words/, ABANDON);
        await press(root, /^Check with These Words$/);
        const text = textOf(root);
        expect(text).toContain('Receive address #1 of this seed');
        expect(text).toContain('Seed fingerprint 73C5DA0A');
        // the words are gone once the seed is made
        expect(root.findAllByType(TextInput).every(i => !i.props.value || !/abandon/.test(i.props.value))).toBe(true);
        // and its public key is remembered for next time, listed to forget
        expect(text).toContain("Its public key is now remembered on this phone, so the next check won't need the SeedQR.");
        expect(Object.keys(useAuthStore.getState().signerAccounts)).toEqual(['73c5da0a']);
        expect(textOf(root)).toContain('Single key · fingerprint 73C5DA0A');
    });

    it("checks against a remembered public key without the SeedQR", async () => {
        act(() => useAuthStore.setState({ signerAccounts: { '73c5da0a': remembered(ABANDON) } }));
        const root = open();
        await checkAddress(root, BIP84_RECEIVE_1);
        const text = textOf(root);
        expect(text).toContain('Receive address #1 of this seed');
        expect(text).toContain('Checked against its public key remembered on this phone.');
        expect(root.findAllByType(TextInput).some(i => /12 or 24 words/.test(i.props.placeholder))).toBe(false);
    });

    it("offers the SeedQR for an address that isn't a remembered key's, then remembers that seed too", async () => {
        act(() => useAuthStore.setState({ signerAccounts: { b8688df1: remembered(LEGAL) } }));
        const root = open();
        await checkAddress(root, BIP84_RECEIVE_1);
        expect(textOf(root)).toContain('Not in the first 1,000 receive and change addresses of the keys remembered on this phone');
        await press(root, /^Check with a SeedQR$/);
        type(root, /12 or 24 words/, ABANDON);
        await press(root, /^Check with These Words$/);
        expect(textOf(root)).toContain('Receive address #1 of this seed');
        expect(Object.keys(useAuthStore.getState().signerAccounts).sort()).toEqual(['73c5da0a', 'b8688df1']);
    });

    it("doesn't remember a seed checked with a passphrase", async () => {
        const root = open();
        await checkAddress(root, BIP84_RECEIVE_1);
        type(root, /^Passphrase/, 'TREZOR');
        type(root, /12 or 24 words/, ABANDON);
        await press(root, /^Check with These Words$/);
        expect(textOf(root)).toContain("Its public key isn't remembered, because of the passphrase.");
        expect(useAuthStore.getState().signerAccounts).toEqual({});
    });

    it('forgets a remembered key after a reminder about the SeedQR', async () => {
        act(() => useAuthStore.setState({ signerAccounts: { '73c5da0a': remembered(ABANDON) } }));
        const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        const root = open();
        await press(root, /^Forget$/);
        const [title, message, buttons] = alert.mock.calls[0] as any[];
        expect(title).toBe('Forget this public key?');
        expect(message).toContain('will need its SeedQR again');
        expect(message).toContain('security sensitive');
        expect(buttons[0].style).toBe('cancel');
        act(() => buttons[1].onPress());
        expect(useAuthStore.getState().signerAccounts).toEqual({});
        expect(textOf(root)).not.toContain('Public keys remembered on this phone');
        alert.mockRestore();
    });

    it("says when a single-key address isn't the given seed's", async () => {
        const root = open();
        await checkAddress(root, BIP84_RECEIVE_1);
        type(root, /12 or 24 words/, LEGAL);
        await press(root, /^Check with These Words$/);
        expect(textOf(root)).toContain('Not in the first 1,000 receive and change addresses of this seed');
        expect(textOf(root)).toContain('Seed fingerprint B8688DF1');
    });

    it("doesn't load a seed on a phone that's online", async () => {
        mockConnection = 'answers';
        const root = open();
        await checkAddress(root, BIP84_RECEIVE_1);
        type(root, /12 or 24 words/, ABANDON);
        await press(root, /^Check with These Words$/);
        expect(textOf(root)).toContain('This phone is online.');
        expect(textOf(root)).not.toContain('of this seed');
    });

    it('finds a multisig address in a registered wallet, and says when there is none', async () => {
        let root = open();
        await checkAddress(root, fixtures.wallets.w1.receiveFirst20[3]);
        expect(textOf(root)).toContain("There's no multisig wallet on this phone to check it against");

        act(() => useAuthStore.setState({ signerWallets: { [W1.id]: W1 } }));
        root = open();
        await checkAddress(root, fixtures.wallets.w1.receiveFirst20[3]);
        expect(textOf(root)).toContain('Receive address #3 in Family vault');
    });

    it("refuses address kinds the signer never signs for, and text that isn't an address", async () => {
        const root = open();
        // BIP86's and BIP49's first receive addresses for "abandon … about", and the genesis block's
        for (const other of ['bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr', '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa']) {
            await checkAddress(root, other);
            expect(textOf(root)).toContain("This signer doesn't sign for this kind of address");
        }
        await checkAddress(root, 'not an address');
        expect(textOf(root)).toContain("That isn't a Bitcoin address.");
    });
});

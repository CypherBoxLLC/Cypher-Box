/**
 * Making a seed on the signer: Generate shows the backup at once (words and SeedQR as two tabs of one screen), then
 * "Seed-Signer created!" with what's next, the last warnings and the check of the copy; only a copy that checks out
 * leads to the public key, worked out once. The back arrow steps back from "created" and asks before dropping a seed
 * that's being backed up. Expected keys: BIP84's published vectors for the public "abandon … about" phrase.
 */

import React from 'react';
import { Alert, Text as RNText, TextInput, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import * as bip39 from 'bip39';

import CreateSignerSeed from '../../src/screens/CreateSignerSeed';
import { takeSeedBackedUp } from '../../src/screens/SigningHome/seedSigner';
import { mnemonicToSeedQR, seedQRGrid } from '../../src/helpers/seedQR';
import useAuthStore from '../../src/stores/authStore';
import { randomBytes } from '../../class/rng';

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
jest.mock('@Cypher/components/SeedQRGrid', () => {
    const { View } = require('react-native');
    return (props: any) => <View testID="seedqr-grid" {...props} />;
});
jest.mock('@Cypher/components/ScannableQR', () => {
    const { View } = require('react-native');
    return () => <View />;
});
jest.mock('../../src/custom-hooks/useProtectSecret', () => () => {});
jest.mock('../../src/custom-hooks/useElectrumConnection', () => () => 'no-answer');
jest.mock('../../helpers/scan-qr', () => ({ requestCameraAuthorization: () => Promise.resolve() }));
jest.mock('react-native-simple-toast', () => ({ show: () => {}, SHORT: 0 }));
// the phone's randomness, made predictable: sixteen zero bytes are the public "abandon … about" phrase
jest.mock('../../class/rng', () => ({ randomBytes: jest.fn(async (size: number) => Buffer.alloc(size, 0)) }));
// the real SeedQR check, with the scanner it opens stood in for by the test
const mockNavigation: any = {};
jest.mock('@react-navigation/native', () => ({
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => mockNavigation,
}));

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const BIP84_RECEIVE_0 = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const LEGAL = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

const textOf = (node: renderer.ReactTestInstance) =>
    node.findAllByType(RNText).map(t => [].concat(t.props.children).filter(c => typeof c === 'string').join('')).join('\n');

const buttonFor = (root: renderer.ReactTestInstance, label: RegExp) =>
    root.findAllByType(TouchableOpacity).find(b => label.test(textOf(b)));

const press = async (root: renderer.ReactTestInstance, label: RegExp) => {
    const button = buttonFor(root, label);
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

let beforeRemove: ((e: any) => void) | undefined;
let scanned: ((ret: any) => void) | undefined;

const open = (params?: any) => {
    beforeRemove = undefined;
    scanned = undefined;
    Object.assign(mockNavigation, {
        goBack: jest.fn(),
        dispatch: jest.fn(),
        getParent: () => ({ pop: jest.fn() }),
        navigate: jest.fn((_route: string, opts: any) => {
            scanned = opts?.params?.onBarScanned;
        }),
        addListener: jest.fn((event: string, handler: (e: any) => void) => {
            if (event === 'beforeRemove') beforeRemove = handler;
            return () => {};
        }),
    });
    let tree: renderer.ReactTestRenderer;
    act(() => {
        tree = renderer.create(<CreateSignerSeed route={{ params }} navigation={mockNavigation} />);
    });
    return tree!.root;
};

// what the back arrow, a swipe or Android's back button sends
const goBack = (actionType = 'GO_BACK') => {
    const e = { data: { action: { type: actionType } }, preventDefault: jest.fn() };
    act(() => beforeRemove!(e));
    return e;
};

let seedSpy: jest.SpyInstance;
beforeEach(() => {
    seedSpy = jest.spyOn(bip39, 'mnemonicToSeedSync');
    (randomBytes as jest.Mock).mockClear();
    useAuthStore.setState({ signerKeyShown: false });
    takeSeedBackedUp();
});
afterEach(() => {
    seedSpy.mockRestore();
    jest.restoreAllMocks();
});

const generated = async (passphrase = '') => {
    const root = open();
    if (passphrase) {
        const toggle = root.findByType(require('react-native').Switch);
        act(() => toggle.props.onValueChange(true));
        type(root, /^Passphrase$/, passphrase);
        type(root, /^Passphrase again$/, passphrase);
    }
    await press(root, /^Generate Seed$/);
    return root;
};

describe('Create a Seed', () => {
    it('shows the backup straight after Generate, without making the seed', async () => {
        const root = await generated();
        const text = textOf(root);
        expect(text).toContain('Back up your seed');
        expect(text).toContain('Tap to reveal your seed phrase');
        // 128 bits from the phone's generator
        expect(randomBytes).toHaveBeenCalledWith(16);
        // the slow step waits for the checked copy
        expect(seedSpy).not.toHaveBeenCalled();
        // hidden until View, and nothing to go on with yet
        expect(text).not.toContain('1. abandon');
        expect(buttonFor(root, /I've backed it up/)!.props.disabled).toBe(true);
    });

    it('has the words and the SeedQR as two tabs of the same screen', async () => {
        const root = await generated();
        expect(buttonFor(root, /^12 words$/)).toBeTruthy();
        expect(buttonFor(root, /^SeedQR$/)).toBeTruthy();
        await press(root, /^View$/);
        let text = textOf(root);
        expect(text).toContain('1. abandon');
        expect(text).toContain('12. about');
        expect(root.findAllByProps({ testID: 'seedqr-grid' })).toHaveLength(0);

        await press(root, /^SeedQR$/);
        text = textOf(root);
        expect(text).not.toContain('1. abandon');
        const grid = root.findAllByProps({ testID: 'seedqr-grid' })[0];
        expect(grid.props.grid).toEqual(seedQRGrid(mnemonicToSeedQR(ABANDON)));
        expect(textOf(root)).toContain('Back up your seed');

        await press(root, /^12 words$/);
        expect(textOf(root)).toContain('1. abandon');
        expect(buttonFor(root, /I've backed it up/)!.props.disabled).toBe(false);
    });

    it('then says the seed-signer is made, what comes next and the last warnings, before any public key', async () => {
        const root = await generated();
        await press(root, /^View$/);
        await press(root, /I've backed it up/);
        const text = textOf(root);
        expect(text).toContain('Seed-Signer created!');
        for (const line of ["What's next", 'Check your backup', 'Set up your watch-only wallet', 'Sign by scanning', 'Before you go']) {
            expect(text).toContain(line);
        }
        expect(text).toContain("This phone doesn't keep your seed.");
        expect(text).toContain('Anyone who sees your words or SeedQR can take the coins.');
        expect(text).not.toContain('passphrase');
        expect(buttonFor(root, /Scan my SeedQR copy/)).toBeTruthy();
        expect(text).not.toContain(ZPUB);
        expect(seedSpy).not.toHaveBeenCalled();
    });

    it('checks typed words, then works out the public key once', async () => {
        const root = await generated();
        await press(root, /^View$/);
        await press(root, /I've backed it up/);

        type(root, /Type your 12 words/, LEGAL);
        await press(root, /^Check the words$/);
        expect(textOf(root)).toContain("That isn't the same phrase.");
        expect(textOf(root)).toContain('Seed-Signer created!');

        type(root, /Type your 12 words/, ABANDON.toUpperCase());
        await press(root, /^Check the words$/);
        const text = textOf(root);
        expect(text).toContain('Your seed is backed up');
        expect(text).toContain(`[73c5da0a/84h/0h/0h]${ZPUB}`);
        expect(text).toContain('73C5DA0A');
        expect(text).toContain(BIP84_RECEIVE_0);
        expect(seedSpy).toHaveBeenCalledTimes(1);
    });

    it('checks a scanned SeedQR copy, and refuses one of another seed', async () => {
        const root = await generated();
        await press(root, /^View$/);
        await press(root, /I've backed it up/);

        await press(root, /Scan my SeedQR copy/);
        await act(async () => scanned!({ data: mnemonicToSeedQR(LEGAL) }));
        expect(textOf(root)).toContain('That copy gives a different seed.');
        expect(seedSpy).not.toHaveBeenCalled();

        await press(root, /Scan my SeedQR copy/);
        await act(async () => {
            scanned!({ data: mnemonicToSeedQR(ABANDON) });
            await new Promise(resolve => setTimeout(resolve, 100));
        });
        expect(textOf(root)).toContain(`[73c5da0a/84h/0h/0h]${ZPUB}`);
        expect(seedSpy).toHaveBeenCalledTimes(1);
    });

    it('uses the passphrase for the key and reminds about it', async () => {
        const root = await generated('TREZOR');
        expect(textOf(root)).toContain("Your passphrase isn't part of this backup.");
        await press(root, /^View$/);
        await press(root, /I've backed it up/);
        expect(textOf(root)).toContain("Your passphrase isn't in the words or the SeedQR.");
        type(root, /Type your 12 words/, ABANDON);
        await press(root, /^Check the words$/);
        expect(seedSpy).toHaveBeenCalledWith(ABANDON, 'TREZOR');
        expect(textOf(root)).not.toContain(ZPUB);
        expect(textOf(root)).not.toContain('73C5DA0A');
    });

    it('takes dice rolls as the entropy', async () => {
        const root = open();
        const navigation = require('../../src/helpers/navigation');
        const dispatch = jest.spyOn(navigation, 'default').mockImplementation((_route: any, params: any) => {
            params.onGenerated(Buffer.alloc(16, 0));
        });
        await press(root, /Add your own dice rolls/);
        expect(dispatch).toHaveBeenCalledWith('ProvideEntropy', expect.objectContaining({ minBits: 128, mixWithRng: true }));
        await press(root, /^Generate Seed$/);
        expect(randomBytes).not.toHaveBeenCalled();
        await press(root, /^View$/);
        // sixteen zero bytes are "abandon … about"
        expect(textOf(root)).toContain('12. about');
    });
});

describe('Create a Seed, going back', () => {
    it('goes back from "created" to the backup', async () => {
        const root = await generated();
        await press(root, /^View$/);
        await press(root, /I've backed it up/);
        const e = goBack();
        expect(e.preventDefault).toHaveBeenCalled();
        expect(textOf(root)).toContain('Back up your seed');
        expect(textOf(root)).toContain('1. abandon');
    });

    it('asks before leaving the backup, and leaves only on Leave', async () => {
        const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        const root = await generated();
        const e = goBack('POP');
        expect(e.preventDefault).toHaveBeenCalled();
        expect(alert).toHaveBeenCalledTimes(1);
        const [title, message, buttons] = alert.mock.calls[0] as any[];
        expect(title).toBe('Leave without finishing?');
        expect(message).toContain("isn't saved anywhere");
        expect(textOf(root)).toContain('Back up your seed');

        // Stay does nothing; Leave sends the same back again, and that one goes through
        expect(buttons[0].style).toBe('cancel');
        act(() => buttons[1].onPress());
        expect(mockNavigation.dispatch).toHaveBeenCalledWith(e.data.action);
        expect(goBack().preventDefault).not.toHaveBeenCalled();
    });

    it("doesn't hold up anything but a back, or a back from the first and last steps", async () => {
        const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        open();
        expect(goBack().preventDefault).not.toHaveBeenCalled();

        const root = await generated();
        expect(goBack('RESET').preventDefault).not.toHaveBeenCalled();
        expect(goBack('NAVIGATE').preventDefault).not.toHaveBeenCalled();
        expect(alert).not.toHaveBeenCalled();

        await press(root, /^View$/);
        await press(root, /I've backed it up/);
        type(root, /Type your 12 words/, ABANDON);
        await press(root, /^Check the words$/);
        expect(goBack().preventDefault).not.toHaveBeenCalled();
    });

    it('drops the words with Done', async () => {
        const root = await generated();
        await press(root, /^View$/);
        await press(root, /I've backed it up/);
        type(root, /Type your 12 words/, ABANDON);
        await press(root, /^Check the words$/);
        await press(root, /^Done$/);
        expect(mockNavigation.goBack).toHaveBeenCalled();
        expect(textOf(root)).not.toContain('abandon');
    });
});

describe("Create a Seed, for the signer's home", () => {
    it('notes only once the copy checks out that a key was shown, and which seed was backed up', async () => {
        const root = await generated();
        await press(root, /^View$/);
        await press(root, /I've backed it up/);
        type(root, /Type your 12 words/, LEGAL);
        await press(root, /^Check the words$/);
        expect(useAuthStore.getState().signerKeyShown).toBe(false);
        expect(takeSeedBackedUp()).toBeNull();

        type(root, /Type your 12 words/, ABANDON);
        await press(root, /^Check the words$/);
        expect(useAuthStore.getState().signerKeyShown).toBe(true);
        // for one line on the home, then gone
        expect(takeSeedBackedUp()).toBe('73C5DA0A');
        expect(takeSeedBackedUp()).toBeNull();
    });

    it("tells the user to sign from the home's Sign a Transaction", async () => {
        const root = await generated();
        await press(root, /^View$/);
        await press(root, /I've backed it up/);
        expect(textOf(root)).toContain("To sign, tap Sign a Transaction on this phone's home");
    });

    it('notes that a key was shown when a seed is loaded, but not that one was made', async () => {
        const root = open({ mode: 'show' });
        type(root, /12 or 24 words/, ABANDON);
        await press(root, /^Continue$/);
        expect(useAuthStore.getState().signerKeyShown).toBe(true);
        expect(takeSeedBackedUp()).toBeNull();
    });
});

describe('Show a Seed\'s Public Key', () => {
    it('works out the key once from typed words', async () => {
        const root = open({ mode: 'show' });
        type(root, /12 or 24 words/, ABANDON);
        await press(root, /^Continue$/);
        expect(textOf(root)).toContain(`[73c5da0a/84h/0h/0h]${ZPUB}`);
        expect(seedSpy).toHaveBeenCalledTimes(1);
        expect(goBack().preventDefault).not.toHaveBeenCalled();
    });

    it('uses the passphrase typed with the words', async () => {
        const root = open({ mode: 'show' });
        type(root, /^Passphrase/, 'TREZOR');
        type(root, /12 or 24 words/, ABANDON);
        await press(root, /^Continue$/);
        expect(seedSpy).toHaveBeenCalledWith(ABANDON, 'TREZOR');
        expect(textOf(root)).toContain("This seed's public key");
        expect(textOf(root)).not.toContain(ZPUB);
        // nothing of it is kept for later
        expect(textOf(root)).toContain("The seed isn't kept on this phone.");
    });

    it('stays on the form with the reason when the words are wrong', async () => {
        const root = open({ mode: 'show' });
        type(root, /12 or 24 words/, 'abandon abandon');
        await press(root, /^Continue$/);
        expect(textOf(root)).toContain("Show a Seed's Public Key");
        expect(seedSpy).not.toHaveBeenCalled();
    });
});

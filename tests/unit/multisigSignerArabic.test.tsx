/**
 * The Offline Seed-Signer's multisig screens in Arabic: Multisig Wallets, Add a Multisig Wallet and Check a Receive
 * Address, with their dialogs, toasts and the wallet file errors. As in seedSignerArabic, nothing a user reads may still
 * be English: only names (SeedQR, Nunchuk, Sparrow, BlueWallet, SegWit, P2WSH, BSMS...) and the wallets' own data
 * (fingerprints, paths, keys, addresses, descriptors) stay in Latin letters. Keys come from fixtures/multisig-signer,
 * all from public BIP39 test phrases.
 */

import fs from 'fs';
import path from 'path';
import React from 'react';
import { Alert, Text as RNText, TextInput, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import loc from '../../loc';
import * as policy from '../../src/helpers/multisigPolicy';
import { signerPublicKey } from '../../src/helpers/signerPublicKey';
import { rootFromBackup } from '../../src/helpers/signOnce';
import CheckSignerAddress from '../../src/screens/CheckSignerAddress';
import RegisterSignerWallet from '../../src/screens/RegisterSignerWallet';
import walletErrorText, { WALLET_FILE_NOT_READ, WALLET_FILE_TOO_BIG, walletName } from '../../src/screens/RegisterSignerWallet/errorText';
import SignerWallets from '../../src/screens/SignerWallets';
import useAuthStore from '../../src/stores/authStore';

jest.mock('../../src/stores/index', () => ({
    __esModule: true,
    zustandStorage: {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
    },
}));
jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('@Cypher/component-library', () => {
    const { createElement, Fragment } = require('react');
    const { Text } = require('react-native');
    return {
        ScreenLayout: ({ children, title }: any) => createElement(Fragment, null, title ? createElement(Text, null, title) : null, children),
        Text,
    };
});
jest.mock('@Cypher/components/OfflineSeedWarning', () => () => null);
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => () => null);
const mockShown: string[] = [];
jest.mock('react-native-simple-toast', () => ({ show: (text: string) => mockShown.push(text), SHORT: 0, LONG: 1 }));
jest.mock('@react-native-clipboard/clipboard', () => ({ setString: jest.fn() }));
jest.mock('../../src/custom-hooks/useElectrumConnection', () => () => 'no-answer');
jest.mock('../../src/custom-hooks/useProtectSecret', () => () => {});
jest.mock('../../helpers/scan-qr', () => ({ requestCameraAuthorization: () => Promise.resolve() }));
jest.mock('../../src/screens/SignOnce/start', () => ({ startSigning: jest.fn() }));

const fixtures = require('./fixtures/multisig-signer/fixtures.json');
const K = fixtures.keys;
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ARABIC_NAME = 'محفظة العائلة';
const W1 = { ...policy.parseWalletFile(fixtures.wallets.w1.descriptor), name: ARABIC_NAME, ownFingerprint: '73c5da0a', addedAt: 0 };
// no name in its file, so it has the default one
const W2 = { ...policy.parseWalletFile(fixtures.wallets.w2.descriptor), name: policy.DEFAULT_WALLET_NAME, ownFingerprint: '73c5da0a', addedAt: 1 };

const LATIN_NAMES = new Set(['SeedQR', 'Nunchuk', 'Sparrow', 'BlueWallet', 'SegWit', 'P', 'WSH', 'sortedmulti', 'BSMS', 'QR', 'Wi', 'Fi',
    'Bluetooth', 'bc', 'q', 'm']);
// a wallet's own data, on a line of its own: a fingerprint, a path, a short key, an address or a descriptor
const isData = (line: string) =>
    /^([0-9a-fA-F]{8}|m\/[0-9'h/]+‎?|xpub\w+…\w+|bc1[a-z0-9]+|[13][1-9A-HJ-NP-Za-km-z]{25,34}|wsh\(.+)$/.test(line);
const englishIn = (lines: string[]) =>
    lines
        .filter(line => !isData(line))
        .flatMap(line => (line.replace(/\b[0-9A-Fa-f]{8}\b/g, '').match(/[A-Za-z]+/g) ?? []).filter(w => !LATIN_NAMES.has(w)));

const ownText = (node: renderer.ReactTestInstance) =>
    [].concat(node.props.children).filter(c => typeof c === 'string' || typeof c === 'number').join('');
const textOf = (node: renderer.ReactTestInstance) => node.findAllByType(RNText).map(ownText).join('\n');

// everything a user reads: text, placeholders, accessibility labels, dialogs and toasts
let dialogs: string[] = [];
let lastButtons: any[] = [];
const read = (root: renderer.ReactTestInstance) => {
    const lines: string[] = root.findAllByType(RNText).map(ownText).filter(s => s.trim());
    root.findAll(n => typeof n.type !== 'string').forEach(n => {
        for (const prop of ['placeholder', 'accessibilityLabel']) {
            if (typeof n.props[prop] === 'string') lines.push(n.props[prop]);
        }
    });
    const out = [...lines, ...dialogs, ...mockShown].filter(Boolean);
    dialogs = [];
    mockShown.length = 0;
    return out;
};

let trees: renderer.ReactTestRenderer[] = [];
const draw = async (element: React.ReactElement) => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
        tree = renderer.create(element);
        await new Promise(resolve => setTimeout(resolve, 20));
    });
    trees.push(tree!);
    return tree!.root;
};
const press = async (root: renderer.ReactTestInstance, label: string) => {
    const button = root.findAllByType(TouchableOpacity).find(b => textOf(b).trim() === label);
    if (!button) throw new Error(`no button "${label}"`);
    await act(async () => {
        await button.props.onPress();
        await new Promise(resolve => setTimeout(resolve, 20));
    });
};
const type = (root: renderer.ReactTestInstance, placeholder: string, text: string) => {
    const input = root.findAllByType(TextInput).find(i => i.props.placeholder === placeholder);
    if (!input) throw new Error(`no field "${placeholder}"`);
    act(() => input.props.onChangeText(text));
};

const m = () => loc.cypherbox.seed_signer.multisig;
let onScanned: ((ret: any) => void) | null = null;
const navigation: any = {
    navigate: (_: string, params: any) => {
        onScanned = params?.params?.onBarScanned ?? null;
    },
    getParent: () => ({ pop: () => {} }),
    goBack: jest.fn(),
};

beforeAll(async () => {
    // after loc's own start-up, which sets a language once
    await new Promise(resolve => setTimeout(resolve, 50));
    loc.setLanguage('ar');
});
afterAll(() => loc.setLanguage('en'));
beforeEach(() => {
    act(() => useAuthStore.setState({ signingMode: true, signerWallets: {}, signerAccounts: {} } as any));
    jest.spyOn(Alert, 'alert').mockImplementation((title: any, message?: any, buttons?: any) => {
        dialogs.push(title, message ?? '', ...(buttons ?? []).map((b: any) => b.text));
        lastButtons = buttons ?? [];
    });
});
afterEach(() => {
    trees.forEach(tree => act(() => tree.unmount()));
    trees = [];
    jest.restoreAllMocks();
});

describe('the multisig screens in Arabic', () => {
    it('lists the multisig wallets, the descriptor and the remove dialog in Arabic', async () => {
        expect(englishIn(read(await draw(<SignerWallets navigation={navigation} />)))).toEqual([]);

        act(() => useAuthStore.setState({ signerWallets: { [W1.id]: W1, [W2.id]: W2 } }));
        const root = await draw(<SignerWallets navigation={navigation} />);
        const lines = read(root);
        expect(lines).toContain(ARABIC_NAME);
        // a wallet whose file had no name is named in Arabic too
        expect(lines).toContain(m().default_name);
        expect(englishIn(lines)).toEqual([]);

        const show = root.findAllByType(TouchableOpacity).find(b => textOf(b) === m().wallets.show_descriptor)!;
        await act(async () => show.props.onPress());
        await press(root, m().wallets.copy_descriptor);
        expect(englishIn(read(root))).toEqual([]);

        const remove = root.findAllByType(TouchableOpacity).find(b => textOf(b) === m().wallets.remove_link)!;
        await act(async () => remove.props.onPress());
        expect(lastButtons.map(b => b.text)).toEqual([loc._.cancel, m().wallets.remove]);
        expect(englishIn(read(root))).toEqual([]);
    });

    it('adds a wallet in Arabic, its errors too', async () => {
        const root = await draw(<RegisterSignerWallet navigation={navigation} />);
        expect(englishIn(read(root))).toEqual([]);

        // a single-key descriptor is refused, in Arabic
        await press(root, loc.cypherbox.sign_once.scan_qr);
        await act(async () => onScanned!({ data: `wpkh([73c5da0a/84h/0h/0h]${K.abandon.xpub}/0/*)` }));
        expect(read(root)).toContain(m().wallet_file.single_key);

        const file = [`Name: ${ARABIC_NAME}`, 'Policy: 2 of 3', 'Format: P2WSH', '']
            .concat([K.abandon, K.legal, K.letter].flatMap((k: any) => [`Derivation: ${k.path}`, `${k.fingerprint.toUpperCase()}: ${k.xpub}`, '']))
            .join('\n');
        await press(root, loc.cypherbox.sign_once.scan_qr);
        await act(async () => onScanned!({ data: file }));
        const review = read(root);
        expect(review).toContain(m().register.review_title);
        expect(englishIn(review)).toEqual([]);

        await press(root, m().register.confirm);
        expect(englishIn(read(root))).toEqual([]);
        // a mistyped word is named in Arabic
        type(root, loc.cypherbox.sign_once.words_placeholder, 'abandon nothere');
        await press(root, loc._.continue);
        const mistyped = read(root);
        expect(mistyped).toContain(String(loc.formatString(loc.cypherbox.sign_once.errors.unknown_word, { word: 'nothere' })));
        expect(englishIn(mistyped.filter(line => !line.includes('nothere')))).toEqual([]);

        type(root, loc.cypherbox.sign_once.words_placeholder, ABANDON);
        await press(root, loc._.continue);
        const saved = read(root);
        expect(saved).toContain(m().register.saved_title);
        expect(englishIn(saved)).toEqual([]);
    });

    it('checks an address in Arabic, whatever the result', async () => {
        act(() => useAuthStore.setState({ signerWallets: { [W1.id]: W1 } }));
        const root = await draw(<CheckSignerAddress navigation={navigation} />);
        expect(englishIn(read(root))).toEqual([]);
        const check = async (address: string) => {
            type(root, m().check.address_placeholder, address);
            await press(root, m().check.check);
            const lines = read(root);
            expect(englishIn(lines)).toEqual([]);
            return lines;
        };

        const found = await check(fixtures.wallets.w1.addresses.receive0);
        expect(found).toContain(String(loc.formatString(m().check.found_receive, { index: 0, name: ARABIC_NAME })));
        expect(await check('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toContain(m().check.unsupported);
        expect(await check('nonsense')).toContain(m().wallet_file.not_an_address);

        // a single-key address with no key remembered: the SeedQR is asked for, in Arabic
        const single = await check(signerPublicKey(rootFromBackup(ABANDON)).addresses[1]);
        expect(single).toContain(m().check.single_title);
        type(root, loc.cypherbox.sign_once.words_placeholder, ABANDON);
        await press(root, m().check.check_with_words);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 200));
        });
        const checked = read(root);
        expect(checked).toContain(String(loc.formatString(m().check.found_single_receive, { index: 1 })));
        expect(englishIn(checked)).toEqual([]);

        // the key is remembered now, and listed with its forget dialog
        const forget = root.findAllByType(TouchableOpacity).find(b => textOf(b) === m().check.forget)!;
        await act(async () => forget.props.onPress());
        expect(lastButtons.map(b => b.text)).toEqual([loc._.cancel, m().check.forget]);
        expect(englishIn(read(root))).toEqual([]);
    });

    it('turns every wallet file and address error into Arabic', () => {
        const thrown = [
            ...Object.entries(policy)
                .filter(([name, value]) => /^(WALLET_FILE_|OWN_KEY_|NOT_AN_ADDRESS)/.test(name) && typeof value === 'string')
                .map(([, value]) => value as string),
            policy.walletFileBadKey(2),
            policy.walletFileKeyCount(2, 3, 1),
            policy.walletFileKeyCount(2, 3, 4),
            policy.walletFileSize(1),
            policy.walletFileSize(16),
            policy.walletFileThreshold(4, 3),
            policy.walletFileSameFingerprint('73c5da0a'),
            policy.ownKeyMissing('73C5DA0A'),
            WALLET_FILE_TOO_BIG,
            WALLET_FILE_NOT_READ,
        ];
        expect(thrown.length).toBeGreaterThan(25);
        for (const message of thrown) {
            const arabic = walletErrorText(message);
            expect([message, /[؀-ۿ]/.test(arabic)]).toEqual([message, true]);
            expect([message, englishIn([arabic.replace(/Format: P2WSH|Policy: 2 of 3|BSMS 1\.0|\/[01]\/\*/g, '')])]).toEqual([message, []]);
        }
        expect(walletName(policy.DEFAULT_WALLET_NAME)).toBe(m().default_name);
        expect(walletName(ARABIC_NAME)).toBe(ARABIC_NAME);
    });

    it('reads, in English, as the helpers throw', () => {
        loc.setLanguage('en');
        try {
            for (const message of [policy.WALLET_FILE_PATHS, policy.walletFileKeyCount(2, 3, 1), policy.walletFileSize(16), policy.ownKeyMissing('73C5DA0A')]) {
                expect(walletErrorText(message)).toBe(message);
            }
            expect(walletName(policy.DEFAULT_WALLET_NAME)).toBe(policy.DEFAULT_WALLET_NAME);
        } finally {
            loc.setLanguage('ar');
        }
    });

    it('knows the file errors blue_modules/fs throws', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../blue_modules/fs.ts'), 'utf8');
        expect(source).toContain(JSON.stringify(WALLET_FILE_TOO_BIG));
        expect(source).toContain(JSON.stringify(WALLET_FILE_NOT_READ));
    });
});

/**
 * The Offline Seed-Signer in Arabic. Its screens showed English in a mirrored layout until their text moved to loc
 * (cypherbox.seed_signer, with the signing screen's and the Hot Vault's own keys where the words are the same). Each
 * screen is drawn here in Arabic, and nothing a user reads may still be English: only names (Cypher Box, SeedQR,
 * Sparrow...), the word typed to turn the mode on and the seed's own data (words, keys, fingerprints, addresses) are
 * left in Latin letters.
 */

import fs from 'fs';
import path from 'path';
import React from 'react';
import { Alert, Platform, Switch, Text as RNText, TextInput, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import loc from '../../loc';
import CreateSignerSeed from '../../src/screens/CreateSignerSeed';
import SigningHome from '../../src/screens/SigningHome';
import SeedSignerGate from '../../src/screens/SeedSignerGate';
import AppSettings from '../../screen/settings/settings';
import { noteSeedBackedUp, takeSeedBackedUp } from '../../src/screens/SigningHome/seedSigner';
import useAuthStore from '../../src/stores/authStore';

jest.mock('../../src/stores/index', () => ({
    __esModule: true,
    zustandStorage: {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
    },
}));
jest.mock('../../blue_modules/BlueElectrum', () => ({
    connectMain: jest.fn(),
    getConfig: jest.fn().mockResolvedValue({ connected: 0 }),
    isPublicServer: jest.fn(() => true),
}));
// the title as a line of text, so it's read with the rest
jest.mock('@Cypher/component-library', () => {
    const { createElement, Fragment } = require('react');
    const { Text } = require('react-native');
    return {
        ScreenLayout: ({ children, title }: any) => createElement(Fragment, null, title ? createElement(Text, null, title) : null, children),
        Text,
    };
});
jest.mock('@Cypher/components', () => ({ PrivateKeyGenerater: () => null, Tips: () => null }));
jest.mock('@Cypher/components/OfflineSeedWarning', () => () => null);
jest.mock('@Cypher/components/SeedQRGrid', () => () => null);
jest.mock('@Cypher/components/ScannableQR', () => () => null);
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => () => null);
jest.mock('react-native-device-info', () => ({ getVersion: () => '0.1.13', getBuildNumber: () => '1' }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
const mockShown: string[] = [];
jest.mock('react-native-simple-toast', () => ({ show: (text: string) => mockShown.push(text), SHORT: 0, LONG: 1 }));
const mockPhone = { connection: 'no-answer' };
jest.mock('../../src/custom-hooks/useElectrumConnection', () => () => mockPhone.connection);
jest.mock('../../src/custom-hooks/useProtectSecret', () => () => {});
jest.mock('../../helpers/scan-qr', () => ({ requestCameraAuthorization: () => Promise.resolve() }));
// sixteen zero bytes, the public "abandon … about" phrase, which the seed check would refuse
jest.mock('../../class/rng', () => ({ randomBytes: jest.fn(async (size: number) => Buffer.alloc(size, 0)) }));
jest.mock('../../class/seedHealth', () => ({ ...jest.requireActual('../../class/seedHealth'), assertMnemonicHealthy: jest.fn() }));
jest.mock('../../class/rngHealth', () => ({ ...jest.requireActual('../../class/rngHealth'), assertNativeRngHealthy: jest.fn(async () => {}) }));
// what the Hot Vault's settings reach, which the signer's home shows under the signer
jest.mock('../../src/screens/HotStorageVault/SignButton', () => () => null);
jest.mock('../../src/screens/HotStorageVault/useImportTransaction', () => () => ({ importFromFile: jest.fn(), importFromQr: jest.fn() }));
jest.mock('../../src/screens/SignOnce/start', () => ({ startSigning: jest.fn() }));
jest.mock('../../class/wallets/abstract-hd-electrum-wallet', () => ({ AbstractHDElectrumWallet: class {} }));
jest.mock('../../class', () => ({ WatchOnlyWallet: { type: 'watchOnly' } }));
jest.mock('../../class/deeplink-schema-match', () => ({ decodeBitcoinUri: jest.fn() }));
jest.mock('../../class/biometrics', () => ({
    __esModule: true,
    default: { isBiometricUseCapableAndEnabled: jest.fn(async () => false), unlockWithBiometrics: jest.fn(async () => true) },
}));
jest.mock('../../blue_modules/hapticFeedback', () => ({ __esModule: true, default: jest.fn(), HapticFeedbackTypes: {} }));
jest.mock('../../blue_modules/notifications', () => ({ __esModule: true, default: { unsubscribe: jest.fn() } }));
jest.mock('../../src/helpers/prompt', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../src/stores/eventLogStore', () => ({ recordEvent: jest.fn() }));
// a copy of the seed in the Keychain from before, which the signer offers to remove, and which won't go
jest.mock('../../src/services/hotVaultKeychain', () => ({
    backupHotVaultSeedWithMeta: jest.fn(),
    listHotVaultKeychainBackups: jest.fn(async () => ['w1']),
    resetHotVaultBackupFully: jest.fn(async () => true),
    resetHotVaultKeychainBackup: jest.fn(async () => false),
    resetHotVaultMeta: jest.fn(async () => true),
}));
jest.mock('../../src/helpers/navigation', () => ({ __esModule: true, default: jest.fn(), dispatchReset: jest.fn(), resetAndNavigate: jest.fn() }));
const mockNavigation: any = {};
jest.mock('@react-navigation/native', () => {
    const { useEffect } = require('react');
    return {
        ...jest.requireActual('@react-navigation/native'),
        useNavigation: () => mockNavigation,
        useRoute: () => ({ name: 'HomeScreen', params: {} }),
        useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
    };
});
jest.mock('../../BlueComponents', () => ({ BlueHeaderDefaultSub: () => null }));
jest.mock('../../helpers/prompt', () => jest.fn());
jest.mock('../../blue_modules/storage-context', () => {
    const value: any = {
        wallets: [],
        walletsInitialized: true,
        isAdvancedModeEnabled: async () => false,
        saveToDisk: jest.fn(),
        deleteWallet: jest.fn(),
        isStorageEncrypted: () => Promise.resolve(false),
        language: 'ar',
    };
    return { BlueStorageContext: require('react').createContext(value), mockStorage: value };
});

const storage = require('../../blue_modules/storage-context').mockStorage;
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const t = () => loc.cypherbox.seed_signer;

// a Hot Vault that can sign, as the signer's home is given one
const hotVault: any = {
    getID: () => 'w1',
    getHideTransactionsInWalletsList: () => false,
    isBIP47Enabled: () => false,
    getDerivationPath: () => "m/84'/0'/0'",
    allowMasterFingerprint: () => true,
    getMasterFingerprintHex: () => '73c5da0a',
    typeReadable: '',
    getTransactions: () => [],
    allowXpub: () => true,
    allowCosignPsbt: () => true,
    cosignPsbt: () => {},
    getBalance: () => 0,
    getAllExternalAddresses: () => [],
};

// names, the confirm word, and the version's "(build 1)" as Settings > Info has it
const LATIN_NAMES = new Set(['Cypher', 'Box', 'SeedQR', 'PSBT', 'xpub', 'Sparrow', 'Pixel', 'Strike', 'CoinOS', 'Bark',
    'Wi', 'Fi', 'Bluetooth', 'SEED', 'SIGNER', 'iPhone', 'Keychain', 'Keystore', 'build']);
// the seed's own data: a word pill, an address line, the key with its origin, the path, a fingerprint
const isData = (line: string) =>
    /^(\d+\. [a-z]+|\d+ {2}bc1[a-z0-9]+|\[[0-9a-f]{8}\/[0-9h/]+\]zpub\w+|m\/[0-9'/]+‎?|[0-9A-F]{8})$/.test(line);
const englishIn = (lines: string[]) =>
    lines
        .filter(line => !isData(line))
        // a fingerprint inside a sentence ("… 73C5DA0A …") is data too
        .flatMap(line => (line.replace(/\b[0-9A-F]{8}\b/g, '').match(/[A-Za-z]+/g) ?? []).filter(w => !LATIN_NAMES.has(w)));

const ownText = (node: renderer.ReactTestInstance) =>
    [].concat(node.props.children).filter(c => typeof c === 'string' || typeof c === 'number').join('');
const textOf = (node: renderer.ReactTestInstance) => node.findAllByType(RNText).map(ownText).join('\n');

// everything a user reads or hears: text, placeholders, accessibility labels and hints, dialogs and toasts
let dialogs: string[] = [];
let lastButtons: any[] = [];
const read = (root: renderer.ReactTestInstance) => {
    const lines: string[] = root.findAllByType(RNText).map(ownText).filter(s => s.trim() && !/^[-]+$/.test(s));
    root.findAll(n => typeof n.type !== 'string').forEach(n => {
        for (const prop of ['placeholder', 'accessibilityLabel', 'accessibilityHint']) {
            if (typeof n.props[prop] === 'string') lines.push(n.props[prop]);
        }
        if (n.props.testID === 'SeedSignerMode') lines.push(n.props.title, n.props.rightTitle ?? '');
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

beforeAll(async () => {
    // after loc's own start-up, which sets a language once
    await new Promise(resolve => setTimeout(resolve, 50));
    loc.setLanguage('ar');
});
beforeEach(() => {
    mockPhone.connection = 'no-answer';
    storage.wallets = [];
    useAuthStore.setState({
        signingMode: true,
        signerKeyShown: false,
        signedOnThisPhone: false,
        walletID: undefined,
        coldStorageWalletID: undefined,
        isAuth: false,
        isStrikeAuth: false,
        isArkAuth: false,
        vaultTab: false,
        hotVaultKeychainBackups: {},
    } as any);
    takeSeedBackedUp();
    Object.assign(mockNavigation, {
        goBack: jest.fn(),
        dispatch: jest.fn(),
        navigate: jest.fn(),
        getParent: () => ({ pop: jest.fn() }),
        addListener: jest.fn(() => () => {}),
    });
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

describe('the Offline Seed-Signer in Arabic', () => {
    it('has each of its strings in both languages, with the same placeholders', () => {
        const readLoc = (lang: string) => JSON.parse(fs.readFileSync(path.join(__dirname, `../../loc/${lang}.json`), 'utf8'));
        const flat = (o: any, at = ''): Record<string, string> =>
            Object.entries(o).reduce((all, [k, v]) => ({ ...all, ...(typeof v === 'object' ? flat(v, `${at}${k}.`) : { [`${at}${k}`]: v as string }) }), {});
        const en = flat(readLoc('en').cypherbox.seed_signer);
        const ar = flat(readLoc('ar').cypherbox.seed_signer);
        expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
        const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
        for (const key of Object.keys(en)) {
            expect([key, placeholders(ar[key])]).toEqual([key, placeholders(en[key])]);
            expect([key, /[؀-ۿ]/.test(ar[key])]).toEqual([key, true]);
            expect([key, en[key].includes('—')]).toEqual([key, false]);
        }
    });

    it('shows the home without a Hot Vault in Arabic, before and after a key was shown', async () => {
        expect(englishIn(read(await draw(<SigningHome />)))).toEqual([]);
        useAuthStore.setState({ signerKeyShown: true });
        noteSeedBackedUp('73C5DA0A');
        mockPhone.connection = 'connected';
        const lines = read(await draw(<SigningHome />));
        expect(lines).toContain(String(loc.formatString(t().home.backed_up, { fingerprint: '73C5DA0A' })));
        expect(lines).toContain(loc.cypherbox.components.signing_phone_status.connected);
        expect(englishIn(lines)).toEqual([]);
    });

    for (const os of ['ios', 'android']) {
        it(`shows the home with a Hot Vault in Arabic on ${os}, the wipe dialogs too`, async () => {
            const was = Platform.OS;
            (Platform as any).OS = os;
            try {
                storage.wallets = [hotVault];
                useAuthStore.setState({ walletID: 'w1' } as any);
                const root = await draw(<SigningHome />);
                const lines = read(root);
                expect(lines).toContain(t().title);
                // the Keychain copy's row names the store this phone really has
                const keychainRow = os === 'android'
                    ? loc.cypherbox.vault.storage_vault.settings.keychain_signer_remove_android
                    : loc.cypherbox.vault.storage_vault.settings.keychain_signer_remove;
                expect(lines).toContain(keychainRow);
                if (os === 'android') expect(lines.join('\n')).not.toMatch(/Keychain|iPhone/);
                expect(englishIn(lines)).toEqual([]);

                await press(root, t().vault.wipe);
                await act(async () => {
                    await lastButtons[1].onPress();
                });
                // the Keychain copy wouldn't go, so the seed stays and the user is told
                const wipe = read(root).slice(-6);
                expect(wipe).toEqual(expect.arrayContaining([t().vault.wipe_title, t().vault.wipe_failed_title]));
                expect(englishIn(wipe)).toEqual([]);
            } finally {
                (Platform as any).OS = was;
            }
        });
    }

    it('shows the one-way gate in Arabic, and lists what an app already holds the Arabic way', async () => {
        for (const connection of ['checking', 'connected', 'no-answer']) {
            mockPhone.connection = connection;
            expect(englishIn(read(await draw(<SeedSignerGate />)))).toEqual([]);
        }
        storage.wallets = [{}, {}, {}];
        useAuthStore.setState({ isStrikeAuth: true, isArkAuth: true } as any);
        const lines = read(await draw(<SeedSignerGate />));
        expect(lines.join('\n')).toContain('3 من المحافظ أو الخزائن، وحساب Strike أو CoinOS، وخزنة Bark.');
        expect(englishIn(lines)).toEqual([]);
    });

    it('shows making a seed, its backup and its public key in Arabic', async () => {
        const root = await draw(<CreateSignerSeed route={{}} navigation={mockNavigation} />);
        act(() => root.findByType(Switch).props.onValueChange(true));
        type(root, t().create.passphrase, 'TREZOR');
        type(root, t().create.passphrase_again, 'TREZOR');
        expect(englishIn(read(root))).toEqual([]);
        await press(root, t().create.generate);
        expect(englishIn(read(root))).toEqual([]);
        await press(root, loc.cypherbox.components.private_key_generator.view);
        expect(englishIn(read(root))).toEqual([]);
        await press(root, t().create.backed_up);
        type(root, t().create.type_words, 'abandon abandon');
        await press(root, t().create.check_words);
        const created = read(root);
        expect(created).toContain(String(loc.formatString(loc.cypherbox.sign_once.errors.word_count, { count: 2 })));
        expect(englishIn(created)).toEqual([]);
        type(root, t().create.type_words, ABANDON);
        await press(root, t().create.check_words);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 200));
        });
        const key = read(root);
        expect(key).toContain(t().create.key_title_created);
        // the path's closing ' stays on it after the Arabic label
        expect(key).toContain("m/84'/0'/0'‎");
        expect(englishIn(key)).toEqual([]);
    });

    it("shows a seed's public key from a backup in Arabic", async () => {
        const root = await draw(<CreateSignerSeed route={{ params: { mode: 'show' } }} navigation={mockNavigation} />);
        expect(englishIn(read(root))).toEqual([]);
        type(root, loc.cypherbox.sign_once.words_placeholder, 'abandon nothere');
        await press(root, loc._.continue);
        const lines = read(root);
        expect(lines).toContain(String(loc.formatString(loc.cypherbox.sign_once.errors.unknown_word, { word: 'nothere' })));
        expect(englishIn(lines.filter(line => !line.includes('nothere')))).toEqual([]);
    });

    it("names the mode in Arabic on Settings' row", async () => {
        const lines = read(await draw(<AppSettings navigation={{ reset: jest.fn() }} />));
        expect(lines).toEqual(expect.arrayContaining([t().mode, t().mode_on]));
    });
});

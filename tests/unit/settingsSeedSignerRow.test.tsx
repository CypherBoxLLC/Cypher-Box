/**
 * Settings' Offline Seed-Signer mode row. The mode can't be turned off, so the row isn't a switch: in a normal app it
 * opens the mode's one-way setup, the same gate the welcome screen opens, and once the mode is on it only says so.
 */

import React from 'react';
import { Switch, Text as RNText, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import Settings from '../../screen/settings/settings';
import { SEED_SIGNER_MODE } from '../../src/screens/SigningHome/seedSigner';
import useAuthStore from '../../src/stores/authStore';

jest.mock('../../src/stores/index', () => ({
    __esModule: true,
    zustandStorage: {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
    },
}));
// the Network row's mark reads the app's own connection only; not connected here
jest.mock('../../blue_modules/BlueElectrum', () => ({
    getConfig: jest.fn().mockResolvedValue({ connected: 0 }),
    isPublicServer: jest.fn(() => true),
}));
jest.mock('../../blue_modules/storage-context', () => ({
    BlueStorageContext: require('react').createContext({
        isStorageEncrypted: () => Promise.resolve(false),
        encryptStorage: () => Promise.resolve(),
        decryptStorage: () => Promise.resolve(),
        saveToDisk: () => Promise.resolve(),
        language: 'en',
    }),
}));
jest.mock('../../BlueComponents', () => ({ BlueHeaderDefaultSub: () => null }));
jest.mock('../../helpers/prompt', () => jest.fn());
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => () => null);
jest.mock('@react-navigation/native', () => {
    const { useEffect } = require('react');
    return {
        ...jest.requireActual('@react-navigation/native'),
        useNavigation: () => ({ navigate: jest.fn(), popToTop: jest.fn() }),
        useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
    };
});

// the row's words, without the chevron, which is an icon font glyph (a private-use character)
const linesOf = (node: renderer.ReactTestInstance) =>
    node
        .findAllByType(RNText)
        .map(t => [].concat(t.props.children).filter(c => typeof c === 'string').join(''))
        .filter(s => s.trim() && !/[-]|[\uDB80-\uDBFF]/.test(s));

let navigate: jest.SpyInstance;
let tree: renderer.ReactTestRenderer | undefined;

const open = async () => {
    // async: the screen reads whether storage is encrypted as it opens
    await act(async () => {
        tree = renderer.create(<Settings navigation={{ reset: jest.fn() }} />);
    });
    const root = tree!.root;
    // the app's ListItem is a memo, so it's found by its props rather than its type
    const [row] = root.findAll(node => node.props.title === SEED_SIGNER_MODE && node.props.testID === 'SeedSignerMode');
    if (!row) throw new Error('no Offline Seed-Signer mode row');
    return { root, row };
};

beforeEach(() => {
    navigate = jest.spyOn(require('../../src/helpers/navigation'), 'default').mockImplementation(() => {});
});

afterEach(() => {
    // stops the Network row's once-a-second check
    act(() => tree?.unmount());
    tree = undefined;
    navigate.mockRestore();
});

describe("Settings' Offline Seed-Signer mode row", () => {
    it('opens the one-way setup in a normal app, with no switch to flip', async () => {
        act(() => useAuthStore.setState({ signingMode: false }));
        const { root, row } = await open();
        expect(root.findAllByType(Switch)).toHaveLength(0);
        expect(row.props.switch).toBeUndefined();
        expect(row.props.chevron).toBe(true);
        expect(linesOf(row)).toEqual([SEED_SIGNER_MODE]);

        // a tap on the row itself, as on the phone
        act(() => row.findAllByType(TouchableOpacity)[0].props.onPress());
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('SeedSignerGate');
    });

    it('only says the mode is on once it is: nothing to tap or turn off', async () => {
        act(() => useAuthStore.setState({ signingMode: true }));
        const { root, row } = await open();
        expect(root.findAllByType(Switch)).toHaveLength(0);
        expect(row.props.switch).toBeUndefined();
        expect(row.props.chevron).toBeFalsy();
        expect(row.props.onPress).toBeUndefined();
        expect(linesOf(row)).toEqual([SEED_SIGNER_MODE, 'On']);
        expect(row.findAllByType(TouchableOpacity)).toHaveLength(0);
        expect(navigate).not.toHaveBeenCalled();
    });
});

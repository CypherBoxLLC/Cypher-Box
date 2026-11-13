/**
 * The stuck-capsule rescue's Strike and CoinOS rails follow the region gate
 * and the sign-in flags while the screen is open.
 *
 * The screen can open at cold launch from its notification, before the auth
 * store has loaded and before the App Store storefront has been read. It
 * decided once, at mount, which rails could take the funds, so a rail that
 * was disabled then stayed disabled for the screen's whole life, just when
 * the capsules were about to expire.
 */

import React from 'react';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';
import ArkStuckCapsuleScreen from '../../src/screens/Ark/ArkStuckCapsuleScreen';
import useAuthStore from '../../src/stores/authStore';

// The first render loads React Native's components, which can take several
// seconds when this suite runs alongside others.
jest.setTimeout(30 * 1000);

/** Stands in for featureFlags: whether the region allows the rails, and its change signal. */
const mockGate = { allowed: false, version: 0, listeners: new Set<() => void>() };

jest.mock('@Cypher/services/featureFlags', () => ({
    subscribeRegionGate: (listener: () => void) => {
        mockGate.listeners.add(listener);
        return () => mockGate.listeners.delete(listener);
    },
    getRegionGateVersion: () => mockGate.version,
}));

jest.mock('../../src/stores/authStore', () => {
    const { create } = require('zustand');
    return {
        __esModule: true,
        default: create(() => ({
            // One capsule about 17 hours from expiry, so the rails are listed.
            arkVtxos: [{ id: 'vtxo-1', state: 'Spendable', expiryHeight: 800_100, sats: 50_000 }],
            arkChainTipHeight: 800_000,
            walletID: null,
            coldStorageWalletID: null,
            isStrikeAuth: false,
            isAuth: false,
            arkRefreshStuck: null,
            setArkRefreshStuck: () => undefined,
        })),
    };
});

// Like the real providers: signed in, and allowed in this region.
jest.mock('@Cypher/services/lightningSwap', () => {
    const store = require('../../src/stores/authStore').default;
    const rail = (id: string, signedIn: 'isStrikeAuth' | 'isAuth') => ({
        id,
        isAvailable: () => Boolean(store.getState()[signedIn]) && mockGate.allowed,
    });
    return {
        listLightningSwapProviders: () => [rail('strike', 'isStrikeAuth'), rail('coinos', 'isAuth')],
        estimateSwapFee: jest.fn(),
        swap: jest.fn(),
    };
});

jest.mock('@Cypher/services/ark', () => ({
    AVG_BLOCK_MINUTES: 10,
    cancelArkPendingRound: jest.fn(),
    estimateArkOffboardFee: jest.fn(),
    fetchArkBalance: jest.fn(),
    fetchArkVtxos: jest.fn(),
    getArkCancelling: () => false,
    offboardArkVtxos: jest.fn(),
    setArkCancelling: jest.fn(),
    syncArkWallet: jest.fn(),
}));
jest.mock('@Cypher/services/ark/vtxos', () => ({ recordServerSpentFromError: jest.fn() }));
jest.mock('@Cypher/services/ark/vtxoSpendState', () => ({ notSpendableMessage: jest.fn() }));
jest.mock('@Cypher/helpers', () => ({ dispatchNavigate: jest.fn() }));
jest.mock('@Cypher/component-library', () => {
    const { createElement } = require('react');
    const { Text, View } = require('react-native');
    return { ScreenLayout: ({ children }: { children: React.ReactNode }) => createElement(View, null, children), Text };
});
jest.mock('@Cypher/style-guide', () => ({
    colors: { ark: { light: '#7FDBFF' }, pink: { default: '#FF5A9F' }, green: '#2ECC40', redLight: '#FF4136' },
    rtl: {},
}));
jest.mock('../../blue_modules/storage-context', () => ({
    BlueStorageContext: require('react').createContext({ wallets: [] }),
}));
jest.mock('../../loc', () => ({
    __esModule: true,
    default: {
        formatString: (text: string) => text,
        cypherbox: { ark: { stuck_capsule: new Proxy({}, { get: (_target: object, key: string | symbol) => String(key) }) } },
    },
}));

function disabled(tree: ReactTestRenderer, label: string): boolean {
    const [rail] = tree.root.findAll(node => node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel === label);
    return rail.props.disabled;
}

async function open(): Promise<ReactTestRenderer> {
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
        tree = renderer.create(<ArkStuckCapsuleScreen />);
    });
    return tree as ReactTestRenderer;
}

beforeEach(() => {
    mockGate.allowed = false;
    mockGate.version = 0;
    mockGate.listeners.clear();
    useAuthStore.setState({ isStrikeAuth: false, isAuth: false });
});

describe('the stuck-capsule rescue rails', () => {
    it('enable when the storefront is read after the screen opened', async () => {
        useAuthStore.setState({ isStrikeAuth: true, isAuth: true });
        const tree = await open();
        expect(disabled(tree, 'Strike')).toBe(true);
        expect(disabled(tree, 'Coinos')).toBe(true);

        await act(async () => {
            mockGate.allowed = true;
            mockGate.version += 1;
            mockGate.listeners.forEach(listener => listener());
        });
        expect(disabled(tree, 'Strike')).toBe(false);
        expect(disabled(tree, 'Coinos')).toBe(false);
    });

    it('enable when the auth store loads after the screen opened', async () => {
        mockGate.allowed = true;
        const tree = await open();
        expect(disabled(tree, 'Strike')).toBe(true);

        await act(async () => {
            useAuthStore.setState({ isStrikeAuth: true });
        });
        expect(disabled(tree, 'Strike')).toBe(false);
        expect(disabled(tree, 'Coinos')).toBe(true);

        await act(async () => {
            useAuthStore.setState({ isAuth: true });
        });
        expect(disabled(tree, 'Coinos')).toBe(false);
    });

    it('disable again when the region stops allowing them', async () => {
        mockGate.allowed = true;
        useAuthStore.setState({ isStrikeAuth: true, isAuth: true });
        const tree = await open();
        expect(disabled(tree, 'Strike')).toBe(false);

        await act(async () => {
            mockGate.allowed = false;
            mockGate.version += 1;
            mockGate.listeners.forEach(listener => listener());
        });
        expect(disabled(tree, 'Strike')).toBe(true);
        expect(disabled(tree, 'Coinos')).toBe(true);
    });
});

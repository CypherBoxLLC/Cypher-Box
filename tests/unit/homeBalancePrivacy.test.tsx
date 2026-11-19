/**
 * Home shows its balances by default. The CypherBox logo button on the total balance card hides them behind ***: the
 * total, the Hot and Cold Vault cards' amounts and capsules, and the Bark, Strike and CoinOS cards' amounts. The choice
 * is saved with the auth store, so it stays as the user left it across the background and a relaunch, and the
 * balances count as hidden until that store has loaded. The vault cards show their largest five capsules.
 */

import React from 'react';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { AppState, I18nManager, StyleSheet } from 'react-native';
import BalanceView from '../../src/screens/HomeScreen/BalanceView';
import SavingVault from '../../src/components/SavingVault';
import Card from '../../src/components/Card';
import useAuthStore from '../../src/stores/authStore';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { HIDDEN_LINE, LOGO_EYES_OPEN, LOGO_EYES_SHUT } from '../../src/components/BalancePrivacyButton';

jest.mock('react-native-svg', () => {
    const { createElement } = require('react');
    const part = (name: string) => (props: Record<string, unknown>) => createElement(name, props, props.children as React.ReactNode);
    return { __esModule: true, default: part('Svg'), Svg: part('Svg'), G: part('G'), Path: part('Path'), Circle: part('Circle') };
});
jest.mock('react-native-linear-gradient', () => 'LinearGradient');
jest.mock('react-native-elements', () => ({ Icon: 'Icon' }));
jest.mock('@Cypher/component-library', () => ({ Text: require('react-native').Text }));
jest.mock('@Cypher/components', () => ({ GradientView: require('react-native').View }));
jest.mock('@Cypher/helpers', () => ({
    dispatchNavigate: jest.fn(),
    calculatePercentage: () => 50,
    calculateBalancePercentage: (balance: number, threshold: number, reserve: number) =>
        (threshold + reserve > 0 ? (balance / (threshold + reserve)) * 100 : 0),
}));
jest.mock('@Cypher/assets/images', () => ({}));
jest.mock('@Cypher/custom-hooks', () => ({
    CarouselPageVisibilityContext: require('react').createContext(true),
    useEasedProgress: () => ({ value: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('react-native-reanimated', () => {
    const { View } = require('react-native');
    return { __esModule: true, default: { View }, useAnimatedStyle: () => ({}) };
});
jest.mock('@react-native-masked-view/masked-view', () => 'MaskedView');
jest.mock('react-native-vector-icons/Ionicons', () => 'Ionicons');
jest.mock('../../src/components/GradientButtonWithShadow', () => 'GradientButtonWithShadow');
jest.mock('../../src/components/ProgressBar', () => 'ProgressBar');
jest.mock('../../src/components/VaultCapsules', () => {
    const { createElement } = require('react');
    return (props: Record<string, unknown>) => createElement('VaultCapsules', props);
});
jest.mock('../../blue_modules/storage-context', () => {
    const { createContext } = require('react');
    return { BlueStorageContext: createContext({ wallets: [] }) };
});
jest.mock('../../loc', () => ({
    __esModule: true,
    default: {
        formatString: (text: string, values: Record<string, string>) =>
            text.replace(/\{(\w+)\}/g, (_: string, key: string) => values[key]),
        units: { BTC: 'BTC', sats: 'sats' },
        receive: { header: 'Receive' },
        send: { header: 'Send' },
        cypherbox: {
            home: { add_wallet: 'Add wallet', show_balances: 'Show balances', hide_balances: 'Hide balances' },
            components: {
                saving_vault: { savings_vault: 'Savings Vault', bitcoin_network: 'Bitcoin Network' },
                card: {
                    lightning_account: 'Lightning Account',
                    refreshing_amount: '+ Refreshing {amount}',
                    connected: 'Connected',
                    connection_slow: 'Connection slow',
                    offline: 'Offline',
                },
            },
        },
    },
}));

// The AppState listeners registered so far (React Native's Jest setup mocks AppState).
const appStateChange = (state: string) => (AppState.addEventListener as unknown as jest.Mock).mock.calls
    .filter(([type]) => type === 'change')
    .forEach(([, listener]) => listener(state));

const capsule = (txid: string, amount: number, height = 800_000) => ({ txid, vout: 0, height, value: amount, amount });
const UTXOS = [
    capsule('a', 1_000), capsule('b', 900_000), capsule('c', 50_000, 0), capsule('d', 2_000_000),
    capsule('e', 5_000), capsule('f', 300_000), capsule('g', 120_000),
];
const wallet = { getID: () => 'hot', getUtxo: () => UTXOS };

let tree: ReactTestRenderer | null = null;
let storeLoaded: jest.SpyInstance;
afterEach(() => {
    act(() => tree?.unmount());
    tree = null;
    storeLoaded.mockRestore();
});

// Host text nodes only: each Text is also a composite node above its host one.
const texts = () => tree!.root
    .findAll((n) => typeof n.type === 'string'
        && (typeof n.props.children === 'string' || (Array.isArray(n.props.children) && n.props.children.every((c: unknown) => typeof c === 'string'))))
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children));
const privacyButton = () =>
    tree!.root.findAll((n) => n.props.testID === 'home-balance-privacy' && typeof n.props.onPress === 'function')[0];
const svgPaths = () => tree!.root.findAll((n) => n.type === ('Path' as never)).map((n) => n.props.d as string);

function renderTotal() {
    act(() => {
        tree = renderer.create(<BalanceView balance="0.01234567 BTC" convertedRate="$1,234.56" />);
    });
}

function renderVaultCard(hideWithBalances = true) {
    act(() => {
        tree = renderer.create(
            <BlueStorageContext.Provider value={{ wallets: [wallet] } as never}>
                <SavingVault isVault={false} title="Hot Vault" bitcoinValue="0.03376 BTC" inDollars="$3,376.00" hideWithBalances={hideWithBalances} />
            </BlueStorageContext.Provider>,
        );
    });
}

const LIGHTNING = { balance: 1_430_000, convertedRate: 845.8, currency: 'USD', matchedRate: 59_000, withdrawThreshold: 2_000_000, reserveAmount: 100_000 };
function renderLightningCard(props: Record<string, unknown> = {}) {
    act(() => {
        tree = renderer.create(<Card {...LIGHTNING} {...props} />);
    });
}
const hostStyles = () => tree!.root.findAll((n) => typeof n.type === 'string').map((n) => StyleSheet.flatten(n.props.style) ?? {});
// The threshold bar's pink fill: minWidth 6 keeps a sliver of it for any balance.
const thresholdFills = () => hostStyles().filter((s) => s.minWidth === 6);
// The pink glow once the balance reaches the threshold.
const thresholdGlows = () => hostStyles().filter((s) => s.shadowColor === '#e84393');

const hideBalances = () => act(() => useAuthStore.setState({ balancesHidden: true }));

beforeEach(() => {
    // The saved auth store has loaded; one test below covers the moment before.
    storeLoaded = jest.spyOn(useAuthStore.persist, 'hasHydrated').mockReturnValue(true);
    act(() => useAuthStore.setState({ balancesHidden: false, walletID: 'hot', coldStorageWalletID: 'cold', vaultTab: false }));
});

it('shows the balances by default', () => {
    expect(useAuthStore.getInitialState().balancesHidden).toBe(false);
    renderTotal();
    expect(texts()).toEqual(expect.arrayContaining(['0.01234567 BTC', '$1,234.56']));
    expect(privacyButton().props.accessibilityLabel).toBe('Hide balances');
});

it('the logo button hides the total behind ***, units kept, and shows it again', () => {
    renderTotal();
    act(() => privacyButton().props.onPress());
    expect(texts()).toEqual(expect.arrayContaining(['*** BTC', '$***']));
    expect(texts().join(' ')).not.toMatch(/\d/);
    expect(privacyButton().props.accessibilityLabel).toBe('Show balances');

    act(() => privacyButton().props.onPress());
    expect(texts()).toEqual(expect.arrayContaining(['0.01234567 BTC', '$1,234.56']));
});

it('the logo\'s eyes are open while the balances show, filled white and struck through while hidden', () => {
    renderTotal();
    expect(svgPaths()).toContain(LOGO_EYES_OPEN);
    expect(svgPaths()).not.toContain(LOGO_EYES_SHUT);
    expect(svgPaths()).not.toContain(HIDDEN_LINE);
    const logo = tree!.root.findAll((n) => n.type === ('Path' as never) && n.props.d === LOGO_EYES_OPEN)[0];
    expect(logo.props).toMatchObject({ fill: '#FFFFFF', fillRule: 'evenodd' });

    act(() => privacyButton().props.onPress());
    expect(svgPaths()).toEqual(expect.arrayContaining([LOGO_EYES_SHUT, HIDDEN_LINE]));
    expect(svgPaths()).not.toContain(LOGO_EYES_OPEN);
    const line = tree!.root.findAll((n) => n.type === ('Path' as never) && n.props.d === HIDDEN_LINE)[0];
    expect(line.props.stroke).toBe('#000000');
});

it('is a round button with no glow', () => {
    renderTotal();
    const style = StyleSheet.flatten(privacyButton().props.style({ pressed: false })) as {
        width: number;
        height: number;
        borderRadius: number;
        shadowOpacity?: number;
    };
    expect(style.borderRadius).toBe(style.width / 2);
    expect(style.width).toBe(style.height);
    expect(style.shadowOpacity ?? 0).toBe(0);
    expect(tree!.root.findAll((n) => n.type === ('Circle' as never))).toHaveLength(1);
});

it('saves the choice with the auth store, so a relaunch keeps it', () => {
    renderTotal();
    act(() => privacyButton().props.onPress());
    expect(useAuthStore.getState().balancesHidden).toBe(true);

    const options = useAuthStore.persist.getOptions();
    const partialize = options.partialize ?? ((state: unknown) => state);
    // What goes to storage, read back into a freshly started store.
    const saved = JSON.parse(JSON.stringify(partialize(useAuthStore.getState())));
    expect(saved.balancesHidden).toBe(true);
    expect(options.merge!(saved, useAuthStore.getInitialState()).balancesHidden).toBe(true);
    // Saved before there was a choice: shown.
    expect(options.merge!({}, useAuthStore.getInitialState()).balancesHidden).toBe(false);
});

it('counts the balances as hidden until the saved choice has loaded', () => {
    storeLoaded.mockReturnValue(false);
    let finishLoading: (() => void) | undefined;
    const onLoaded = jest.spyOn(useAuthStore.persist, 'onFinishHydration').mockImplementation((listener) => {
        finishLoading = () => listener(useAuthStore.getState());
        return () => undefined;
    });
    renderTotal();
    expect(texts()).toEqual(expect.arrayContaining(['*** BTC', '$***']));

    storeLoaded.mockReturnValue(true);
    act(() => finishLoading!());
    expect(texts()).toEqual(expect.arrayContaining(['0.01234567 BTC', '$1,234.56']));
    onLoaded.mockRestore();
});

it('hides the Home vault card amounts and capsules, all five slots alike', () => {
    hideBalances();
    renderVaultCard();
    expect(texts()).toEqual(expect.arrayContaining(['*** BTC ']));
    expect(texts().some((t) => t.includes('~ $***'))).toBe(true);
    expect(texts().join(' ')).not.toMatch(/\d/);
    expect(tree!.root.findAll((n) => n.type === ('VaultCapsules' as never))).toHaveLength(0);
    const hiddenRow = tree!.root.findAll((n) => n.props.testID === 'vault-capsules-hidden');
    expect(hiddenRow.length).toBeGreaterThan(0);
    expect(texts().filter((t) => t === '***')).toHaveLength(5);
});

it('shows the vault card\'s largest five capsules, largest first, while the balances show', () => {
    renderVaultCard();
    const shown = tree!.root.findAll((n) => n.type === ('VaultCapsules' as never)).map((n) => n.props.item);
    expect(shown).toEqual([2_000_000, 900_000, 300_000, 120_000, 50_000]);
    // the unconfirmed 50k one still glows as pending
    const pending = tree!.root.findAll((n) => n.type === ('VaultCapsules' as never)).map((n) => n.props.isPending);
    expect(pending).toEqual([false, false, false, false, true]);
    expect(texts()).toEqual(expect.arrayContaining(['0.03376 BTC ']));
});

describe('the ~ between a vault card\'s BTC and dollar amounts', () => {
    const realRTL = I18nManager.isRTL;
    afterEach(() => {
        (I18nManager as any).isRTL = realRTL;
    });

    it('comes before the dollars in English', () => {
        (I18nManager as any).isRTL = false;
        renderVaultCard();
        expect(texts()).toContain('\u200E~ $3,376.00\u00A0');
    });

    it('comes after the dollars in Arabic, where the dollars sit left of the BTC amount', () => {
        (I18nManager as any).isRTL = true;
        renderVaultCard();
        expect(texts()).toContain('\u200E$3,376.00 ~\u00A0');
    });

    it('stays between them while the amounts are hidden', () => {
        (I18nManager as any).isRTL = true;
        hideBalances();
        renderVaultCard();
        expect(texts()).toContain('\u200E$*** ~\u00A0');
    });
});

it('leaves vault cards outside Home alone', () => {
    hideBalances();
    renderVaultCard(false);
    expect(texts()).toEqual(expect.arrayContaining(['0.03376 BTC ']));
    expect(tree!.root.findAll((n) => n.type === ('VaultCapsules' as never))).toHaveLength(5);
});

describe('the Bark and CoinOS cards on Home', () => {
    it('show their amounts and threshold fill while the balances show', () => {
        renderLightningCard({ hideWithBalances: true });
        expect(texts()).toEqual(expect.arrayContaining(['1.43M sats ~ $845.80', '2.1M sats']));
        expect(thresholdFills()).toHaveLength(1);
    });

    it('hide every figure, the K or M with it, and the threshold fill', () => {
        hideBalances();
        renderLightningCard({ hideWithBalances: true });
        expect(texts()).toEqual(expect.arrayContaining(['*** sats ~ $***', '*** sats']));
        expect(texts().join(' ')).not.toMatch(/\d/);
        expect(thresholdFills()).toHaveLength(0);
    });

    it('drop the glow that says the balance has reached the threshold', () => {
        renderLightningCard({ hideWithBalances: true, balance: 2_500_000 });
        expect(thresholdGlows()).toHaveLength(1);
        act(() => tree!.unmount());

        hideBalances();
        renderLightningCard({ hideWithBalances: true, balance: 2_500_000 });
        expect(thresholdGlows()).toHaveLength(0);
    });

    it('hide the Bark card\'s refreshing amount too', () => {
        hideBalances();
        renderLightningCard({ hideWithBalances: true, wallet: 'ARK', balance: 50_000, refreshingInfo: { count: 2, sats: 120_000 } });
        expect(texts()).toEqual(expect.arrayContaining(['*** sats ~ $***', '+ Refreshing *** sats']));
        expect(texts().join(' ')).not.toMatch(/\d/);
    });

    it('leave the Lightning account screens alone', () => {
        hideBalances();
        renderLightningCard();
        expect(texts()).toEqual(expect.arrayContaining(['1.43M sats ~ $845.80', '2.1M sats']));
    });
});

it('leaves the balances as they were when the app goes to the background and comes back', () => {
    const awayAndBack = () => ['inactive', 'background', 'active'].forEach((state) => act(() => appStateChange(state)));

    awayAndBack();
    expect(useAuthStore.getState().balancesHidden).toBe(false);

    hideBalances();
    awayAndBack();
    expect(useAuthStore.getState().balancesHidden).toBe(true);
});

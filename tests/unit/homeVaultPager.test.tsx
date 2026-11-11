/**
 * The home's vault pager has to open on the saved tab, in right-to-left too.
 *
 * Arabic on iOS, 2026-11-11: with Cold Vault as the last tab, the app reopened on the Hot Vault card with the Cold
 * tab lit; with Hot Vault as the last tab, it opened on the Cold Vault card and saved Cold. BottomBar had mapped
 * initialScrollIndex for iOS right-to-left, but FlatList already takes the tab index there and finds the page
 * itself, and it does no initial scroll for index 0. Scroll offsets are measured from the left on both platforms,
 * so only those are mapped back to the tab.
 */

import React from 'react';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { I18nManager, Platform, ScrollView } from 'react-native';
import BottomBar from '../../src/screens/HomeScreen/BottomBar';
import TabBar from '../../src/screens/HomeScreen/TabBar';
import useAuthStore from '../../src/stores/authStore';

jest.mock('@Cypher/component-library', () => ({ Text: require('react-native').Text }));
jest.mock('../../loc', () => ({
  __esModule: true,
  default: { cypherbox: { home: new Proxy({}, { get: (_target: object, key: string | symbol) => String(key) }) } },
}));
jest.mock('@Cypher/components', () => {
  const { createElement } = require('react');
  const { Text, View } = require('react-native');
  return {
    GradientView: ({ children }: any) => createElement(View, null, children),
    SavingVault: ({ title }: any) => createElement(Text, null, title),
  };
});
jest.mock('@Cypher/helpers', () => ({ dispatchNavigate: jest.fn() }));
jest.mock('@Cypher/helpers/coinosHelper', () => ({ btc: (sats: number) => sats, SATS: 100000000 }));
jest.mock('@Cypher/services/featureFlags', () => ({
  isCoinosAllowed: () => true,
  isStrikeAllowed: () => true,
  // useRegionGate() subscribes through these two
  subscribeRegionGate: () => () => {},
  getRegionGateVersion: () => 0,
}));
jest.mock('@Cypher/style-guide/screenWidth', () => ({ __esModule: true, default: 400 }));
jest.mock('react-native-linear-gradient', () => ({ __esModule: true, default: 'LinearGradient' }));
jest.mock('react-native-simple-toast', () => ({ show: jest.fn(), SHORT: 0 }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../../src/screens/SignOnce/start', () => ({ startSigning: jest.fn() }));
jest.mock('../../src/screens/HomeScreen/BottomBar/UnlockHotVaultCard', () => ({ __esModule: true, default: () => null }));
jest.mock('../../src/screens/HomeScreen/TabBar', () => ({ __esModule: true, default: jest.fn(() => null) }));
jest.mock('../../src/stores/authStore', () => {
  const state: any = {
    isAuth: false,
    isStrikeAuth: false,
    isArkAuth: false,
    strikeUser: null,
    withdrawStrikeThreshold: 0,
    withdrawThreshold: 0,
    reserveAmount: 0,
    reserveStrikeAmount: 0,
    vaultTab: false,
  };
  state.setVaultTab = jest.fn((value: boolean) => {
    state.vaultTab = value;
  });
  const useStore: any = (select: (s: any) => any) => select(state);
  useStore.getState = () => state;
  return { __esModule: true, default: useStore };
});

// the mocked screen width: each page of the pager is one screen wide
const WIDTH = 400;

const props = {
  balance: 0,
  wallet: { id: 'hot' },
  currency: 'USD',
  matchedRate: 0,
  matchedRateBTC: 0,
  balanceVault: '0',
  hasSavingVault: true,
  balanceWithoutSuffix: 0,
  hasColdStorage: true,
  coldStorageWallet: { id: 'cold' },
  coldStorageAddress: '',
  coldStorageBalanceVault: '0',
  coldStorageBalanceWithoutSuffix: 0,
  vaultAddress: '',
  recommendedFee: 0,
  refWithdrawRBSheet: { current: null },
  refTopupRBSheet: { current: null },
  currencyStrike: 'USD',
  matchedRateStrike: 0,
};

const store = () => useAuthStore.getState() as any;
// the jest preset's ScrollView keeps scrollTo on its prototype
const scrollTo = (ScrollView.prototype as any).scrollTo as jest.Mock;
const tabBarShowsCold = () => {
  const calls = (TabBar as unknown as jest.Mock).mock.calls;
  return calls[calls.length - 1][0].isVault;
};

let tree: ReactTestRenderer | null = null;

// Opens the home with this tab saved, then lays the pager out the way the native side reports it: one screen wide,
// with two pages of content.
function openHome(savedTab: 'hot' | 'cold') {
  store().vaultTab = savedTab === 'cold';
  act(() => {
    tree = renderer.create(<BottomBar {...props} />);
  });
  const pager = tree!.root.findByType(ScrollView);
  act(() => {
    pager.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: WIDTH, height: 150 } } });
    pager.props.onContentSizeChange(2 * WIDTH, 150);
  });
  return pager;
}

// a scroll that settled at this offset, which the native side measures from the left in both directions
function settleAt(pager: any, x: number) {
  act(() => {
    pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x, y: 0 } } });
  });
}

const realRTL = I18nManager.isRTL;
const realOS = Platform.OS;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = null;
  (I18nManager as any).isRTL = realRTL;
  (Platform as any).OS = realOS;
  jest.clearAllMocks();
});

describe.each(['ios', 'android'])('right-to-left on %s', os => {
  beforeEach(() => {
    (I18nManager as any).isRTL = true;
    (Platform as any).OS = os;
  });

  it('opens on the saved Cold Vault tab', () => {
    openHome('cold');
    // right-to-left puts the Cold Vault page on the left, at offset 0
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ animated: false, x: 0 });
    expect(tabBarShowsCold()).toBe(true);
  });

  it('opens on the saved Hot Vault tab without scrolling, since it is the first page', () => {
    openHome('hot');
    expect(scrollTo).not.toHaveBeenCalled();
    expect(tabBarShowsCold()).toBe(false);
    expect(store().setVaultTab).not.toHaveBeenCalled();
  });

  it('reads the tab back from offsets measured from the left', () => {
    const pager = openHome('hot');

    settleAt(pager, 0);
    expect(tabBarShowsCold()).toBe(true);
    expect(store().setVaultTab).toHaveBeenLastCalledWith(true);

    settleAt(pager, WIDTH);
    expect(tabBarShowsCold()).toBe(false);
    expect(store().setVaultTab).toHaveBeenLastCalledWith(false);
  });
});

describe('left-to-right', () => {
  beforeEach(() => {
    (I18nManager as any).isRTL = false;
  });

  it('opens on the saved Cold Vault tab, the right-hand page', () => {
    openHome('cold');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ animated: false, x: WIDTH });
    expect(tabBarShowsCold()).toBe(true);
  });

  it('opens on the saved Hot Vault tab without scrolling', () => {
    openHome('hot');
    expect(scrollTo).not.toHaveBeenCalled();
    expect(tabBarShowsCold()).toBe(false);
  });

  it('reads the tab from the offset', () => {
    const pager = openHome('hot');

    settleAt(pager, WIDTH);
    expect(tabBarShowsCold()).toBe(true);
    expect(store().setVaultTab).toHaveBeenLastCalledWith(true);

    settleAt(pager, 0);
    expect(tabBarShowsCold()).toBe(false);
    expect(store().setVaultTab).toHaveBeenLastCalledWith(false);
  });
});

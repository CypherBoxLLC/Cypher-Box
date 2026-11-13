/**
 * The home's wallet carousel has to follow the card on screen in right-to-left too.
 *
 * Arabic, 2026-11-12: the carousel read its page straight from the scroll offset, which both platforms measure from
 * the left, while right-to-left lays the cards out from the right. The dots lit the mirrored card, the shared
 * Receive/Send row and the Bark nudges under it faded in and took taps over the wrong card. Offsets are mapped to the
 * tab the way the vault pager maps them (homeVaultPager.test.tsx); the tab index FlatList is given stays as it is.
 */

import React from 'react';
import renderer, { act, ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';
import { FlatList, I18nManager, Platform } from 'react-native';
import WalletsView from '../../src/screens/HomeScreen/WalletsView';
import useAuthStore from '../../src/stores/authStore';

jest.mock('@Cypher/component-library', () => ({ Text: require('react-native').Text }));
jest.mock('../../loc', () => ({
  __esModule: true,
  default: {
    formatString: (text: string) => text,
    getLanguage: () => 'en',
    cypherbox: { home_lists: { wallets_view: new Proxy({}, { get: (_target: object, key: string | symbol) => String(key) }) } },
  },
}));
jest.mock('@Cypher/components', () => {
  const { createElement } = require('react');
  const { Text } = require('react-native');
  const card = (name: string) => () => createElement(Text, null, name);
  return {
    ArkWallet: card('ark card'),
    CircularView: card('circular card'),
    CoinosWallet: card('coinos card'),
    StrikeDollarWallet: card('fiat card'),
    StrikeWallet: card('strike card'),
    GradientButtonWithShadow: ({ title }: any) => createElement(Text, null, title),
  };
});
jest.mock('@Cypher/components/RefreshWaitBanner', () => ({ __esModule: true, default: () => null }));
jest.mock('@Cypher/services/ark', () => ({
  ARK_REFRESH_MIN_SATS: 500,
  FEATURE_ARK_ENABLED: true,
  // never settles, so the notifications probe doesn't set state after a test
  areBgNotificationsEnabled: () => new Promise(() => {}),
  blocksToDays: (blocks: number) => blocks / 144,
  cancelArkPendingRound: jest.fn(),
  isVtxoMidRound: () => false,
  sumMidRoundVtxos: () => ({ count: 0, sats: 0 }),
}));
jest.mock('@Cypher/services/ark/chainTipFreshness', () => ({ deriveVaultConnectivity: () => ({ level: 'green' }) }));
jest.mock('@Cypher/helpers', () => ({ dispatchNavigate: jest.fn() }));
jest.mock('@Cypher/custom-hooks', () => ({ CarouselPageVisibilityContext: require('react').createContext(true) }));
jest.mock('@Cypher/style-guide/screenWidth', () => ({ __esModule: true, default: 400 }));
jest.mock('react-native-simple-toast', () => ({ show: jest.fn(), SHORT: 0 }));
// the home is the focused screen: its focus effect runs whenever the callback changes, as React Navigation runs it
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('../../src/stores/authStore', () => {
  const state: any = {
    // Strike and Ark: a fiat card, the Strike card and the Bark card, with the shared row under the last two
    allBTCWallets: ['STRIKE', 'ARK'],
    isAuth: false,
    isStrikeAuth: true,
    isArkAuth: true,
    arkVtxos: null,
    arkChainTipHeight: null,
    arkRefreshingVtxoIds: [],
    arkPendingRoundFirstSeen: {},
    arkBalanceDetail: null,
    arkIosBackupReminderActive: false,
    // a wedged refresh, so the Bark card's nudge shows under the shared row
    arkRefreshStuck: { nearExpiry: false, stuckSats: 1000, stuckRoundIds: [] },
    arkExitFeeReserveSats: 0,
    arkExitRecommendedReserveSats: 0,
    setWalletTab: jest.fn(),
    setArkPendingOnchainRecoverOpen: jest.fn(),
    setArkExitFeeReserveSats: jest.fn(),
  };
  const useStore: any = (select?: (s: any) => any) => (select ? select(state) : state);
  useStore.getState = () => state;
  return { __esModule: true, default: useStore };
});

// the mocked screen width: each card is one screen wide
const WIDTH = 400;
const KINDS = ['fiat', 'lightning', 'ark'];
const FIAT = 0;
const STRIKE = 1;
const ARK = 2;

const props = {
  balance: 0,
  wallet: null,
  coldStorageWallet: null,
  isLoading: false,
  matchedRate: 0,
  currency: 'USD',
  convertedRate: 0,
  refRBSheet: { current: null },
  refSendRBSheet: { current: null },
  refSwapRBSheet: { current: null },
  setReceiveType: jest.fn(),
  strikeBalance: 0,
};

const onPageChange = jest.fn();
const store = () => useAuthStore.getState() as any;
let tree: ReactTestRenderer | null = null;

// Opens the home on Strike and Ark. It lands on the Strike card, the first Lightning one.
function openHome() {
  act(() => {
    tree = renderer.create(<WalletsView {...props} onPageChange={onPageChange} />);
  });
  return tree!.root.findByType(FlatList);
}

// a swipe that settled at this offset, which the native side measures from the left in both directions
function settleAt(carousel: ReactTestInstance, x: number) {
  act(() => {
    carousel.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x, y: 0 } } });
  });
}

// The Animated.Views laid over the bottom of the cards, found by what they hold. Their styles still carry the
// scroll-driven values, which read the current scrollX.
const overlayHolding = (text: string) => {
  const found = tree!.root.findAll(
    node =>
      typeof node.props.style?.opacity?.__getValue === 'function' &&
      node.findAll(child => child.props.children === text).length > 0,
  );
  expect(found).toHaveLength(1);
  return found[0];
};
const sharedRow = () => overlayHolding('receive');
const barkNudge = () => overlayHolding('refresh_stuck');
const opacity = (overlay: ReactTestInstance) => overlay.props.style.opacity.__getValue();
const translateX = (overlay: ReactTestInstance) => overlay.props.style.transform[0].translateX.__getValue();
const lastPage = () => onPageChange.mock.calls[onPageChange.mock.calls.length - 1];

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

// What every direction must show for each card.
function expectStrikeCard() {
  expect(lastPage()).toEqual([STRIKE, 3, KINDS]);
  expect(sharedRow().props.pointerEvents).toBe('auto');
  expect(opacity(sharedRow())).toBe(1);
  expect(translateX(sharedRow())).toBe(0);
  expect(barkNudge().props.pointerEvents).toBe('none');
  expect(opacity(barkNudge())).toBe(0);
}

function expectBarkCard() {
  expect(lastPage()).toEqual([ARK, 3, KINDS]);
  expect(sharedRow().props.pointerEvents).toBe('auto');
  expect(opacity(sharedRow())).toBe(1);
  expect(translateX(sharedRow())).toBe(0);
  expect(barkNudge().props.pointerEvents).toBe('auto');
  expect(opacity(barkNudge())).toBe(1);
  expect(store().setWalletTab).toHaveBeenLastCalledWith(false);
}

// the fiat card has no Receive/Send: the row waits off screen where the Strike card is, and takes no taps
function expectFiatCard(rowSide: number) {
  expect(lastPage()).toEqual([FIAT, 3, KINDS]);
  expect(sharedRow().props.pointerEvents).toBe('none');
  expect(opacity(sharedRow())).toBe(0);
  expect(translateX(sharedRow())).toBe(rowSide);
  expect(barkNudge().props.pointerEvents).toBe('none');
  expect(opacity(barkNudge())).toBe(0);
}

describe.each(['ios', 'android'])('right-to-left on %s', os => {
  beforeEach(() => {
    (I18nManager as any).isRTL = true;
    (Platform as any).OS = os;
  });

  it('opens on the Strike card, passing FlatList the tab index', () => {
    const carousel = openHome();
    // FlatList finds the page for the tab index itself, in right-to-left too
    expect(carousel.props.initialScrollIndex).toBe(STRIKE);
    expectStrikeCard();
  });

  it('reads the card from offsets measured from the left, where the last card is', () => {
    const carousel = openHome();

    // right-to-left puts the Bark card on the left, at offset 0
    settleAt(carousel, 0);
    expectBarkCard();

    // and the fiat card on the right; the Strike card waits to its left
    settleAt(carousel, 2 * WIDTH);
    expectFiatCard(-WIDTH);

    settleAt(carousel, WIDTH);
    expectStrikeCard();
  });
});

describe('left-to-right', () => {
  beforeEach(() => {
    (I18nManager as any).isRTL = false;
  });

  it('opens on the Strike card', () => {
    const carousel = openHome();
    expect(carousel.props.initialScrollIndex).toBe(STRIKE);
    expectStrikeCard();
  });

  it('reads the card from the offset', () => {
    const carousel = openHome();

    settleAt(carousel, 2 * WIDTH);
    expectBarkCard();

    // the Strike card waits to the right of the fiat card
    settleAt(carousel, 0);
    expectFiatCard(WIDTH);

    settleAt(carousel, WIDTH);
    expectStrikeCard();
  });
});

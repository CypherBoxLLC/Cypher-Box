/**
 * The vault's History tab shows what a slow fetch brings, even after it stopped waiting for it.
 *
 * Heavy-wallet test, 2026-11-12: History gave up on a fetch after 20 s and said the network was slow, and when the fetch
 * finished in the background its result was dropped, neither shown nor saved. Pulling to refresh meanwhile started
 * another fetch next to the first. Now there's one fetch per wallet at a time: pulling again, or opening History again,
 * waits for it, and its result lands in the list whenever it comes.
 */

import React from 'react';
import { RefreshControl, Text } from 'react-native';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';

import History from '../../src/screens/HotStorageVault/History';
import { BlueStorageContext } from '../../blue_modules/storage-context';

jest.mock('@Cypher/component-library', () => ({ Text: require('react-native').Text }));
jest.mock('@Cypher/style-guide', () => ({ colors: { white: '#fff' } }));
jest.mock('../../src/screens/HotStorageVault/styles', () => ({ __esModule: true, default: {} }));
jest.mock('@Cypher/style-guide/screenHeight', () => ({ __esModule: true, default: 800 }));
jest.mock('@Cypher/helpers', () => ({ dispatchNavigate: jest.fn() }));
jest.mock('../../blue_modules/storage-context', () => ({
  BlueStorageContext: require('react').createContext({}),
  WalletTransactionsStatus: { NONE: false, ALL: true },
}));
jest.mock('../../src/screens/HotStorageVault/Items', () => ({
  __esModule: true,
  default: ({ item }: { item: { txid: string } }) => require('react').createElement(require('react-native').Text, null, `tx ${item.txid}`),
}));
jest.mock('../../src/screens/HotStorageVault/Header', () => ({ __esModule: true, default: () => null }));
jest.mock('../../src/screens/HotStorageVault/cpfpDetection', () => ({
  detectCpfpRelations: () => ({ accelerators: new Map(), suppressedChildIds: new Set() }),
}));
// the English copy, for the History that takes its words from loc
jest.mock('../../loc', () => ({
  __esModule: true,
  default: {
    cypherbox: {
      vault: {
        storage_vault: {
          history: {
            empty: 'No Transactions History',
            network_slow: 'Network slow. Pull down to retry.',
            loading: 'Loading transactions...',
          },
        },
      },
    },
  },
}));

const NETWORK_SLOW = 'Network slow. Pull down to retry.';
const NO_HISTORY = 'No Transactions History';
const LOADING = 'Loading transactions...';

type Tx = { txid: string; received: number; confirmations: number };

// a wallet whose transaction fetch ends when the test says so
function slowWallet() {
  let txs: Tx[] = [];
  let finish: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const wallet = {
    getID: () => 'hot',
    getLabel: () => 'Hot Vault',
    getTransactions: () => txs,
    getPreferredBalanceUnit: () => 'BTC',
    allowBIP47: () => false,
    isBIP47Enabled: () => false,
    getBalance: () => 0,
    fetchBalance: jest.fn(async () => {}),
    fetchTransactions: jest.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = () => {
            txs = [
              { txid: 'aa', received: Date.parse('2026-11-10T10:00:00Z'), confirmations: 20 },
              { txid: 'bb', received: Date.parse('2026-11-11T10:00:00Z'), confirmations: 9 },
            ];
            resolve();
          };
          fail = reject;
        }),
    ),
  };
  return { wallet, finish: () => finish(), fail: (error: Error) => fail(error) };
}

function shownTexts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).flatMap(node => [].concat(node.props.children).filter(c => typeof c === 'string'));
}

function render(wallet: object, saveToDisk: () => Promise<void>) {
  const context = {
    wallets: [],
    saveToDisk,
    setSelectedWalletID: jest.fn(),
    walletTransactionUpdateStatus: false,
    isElectrumDisabled: false,
  };
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(
      <BlueStorageContext.Provider value={context}>
        <History wallet={wallet} matchedRate="1" vaultTab={false} />
      </BlueStorageContext.Provider>,
    );
  });
  return tree as ReactTestRenderer;
}

let consoleLog: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  consoleLog.mockRestore();
});

it('shows and saves a result that lands after the 20 s cutoff', async () => {
  const { wallet, finish } = slowWallet();
  const saveToDisk = jest.fn(async () => {});
  const tree = render(wallet, saveToDisk);
  expect(shownTexts(tree)).toContain(LOADING);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(20000);
  });
  expect(shownTexts(tree)).toContain(NETWORK_SLOW);

  await act(async () => {
    await jest.advanceTimersByTimeAsync(40000);
    finish();
  });
  const shown = shownTexts(tree);
  expect(shown).toEqual(expect.arrayContaining(['tx aa', 'tx bb']));
  expect(shown).not.toContain(NETWORK_SLOW);
  expect(saveToDisk).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

it('pulling to refresh while a fetch runs waits for it instead of starting another', async () => {
  const { wallet, finish } = slowWallet();
  const saveToDisk = jest.fn(async () => {});
  const tree = render(wallet, saveToDisk);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(20000);
  });
  // pulled twice, after the cutoff
  for (let pull = 0; pull < 2; pull++) {
    await act(async () => {
      tree.root.findByType(RefreshControl).props.onRefresh();
      await jest.advanceTimersByTimeAsync(5000);
    });
  }
  expect(wallet.fetchBalance).toHaveBeenCalledTimes(1);
  expect(wallet.fetchTransactions).toHaveBeenCalledTimes(1);
  expect(shownTexts(tree)).toContain(LOADING);

  await act(async () => {
    finish();
  });
  expect(shownTexts(tree)).toEqual(expect.arrayContaining(['tx aa', 'tx bb']));
  expect(saveToDisk).toHaveBeenCalledTimes(1);

  // done: the next pull fetches again
  await act(async () => {
    tree.root.findByType(RefreshControl).props.onRefresh();
  });
  expect(wallet.fetchTransactions).toHaveBeenCalledTimes(2);
  act(() => tree.unmount());
});

it('a History opened again while the fetch runs waits for it and shows its result', async () => {
  const { wallet, finish } = slowWallet();
  const saveToDisk = jest.fn(async () => {});
  const first = render(wallet, saveToDisk);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(20000);
  });
  act(() => first.unmount());

  // back to the History tab
  const again = render(wallet, saveToDisk);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1000);
  });
  expect(wallet.fetchTransactions).toHaveBeenCalledTimes(1);

  await act(async () => {
    finish();
  });
  expect(shownTexts(again)).toEqual(expect.arrayContaining(['tx aa', 'tx bb']));
  expect(saveToDisk).toHaveBeenCalledTimes(1);
  act(() => again.unmount());
});

it('a fetch that finishes in time shows its result as before, and leaves no timer behind', async () => {
  const { wallet, finish } = slowWallet();
  const saveToDisk = jest.fn(async () => {});
  const tree = render(wallet, saveToDisk);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
    finish();
  });
  const shown = shownTexts(tree);
  expect(shown).toEqual(expect.arrayContaining(['tx aa', 'tx bb']));
  expect(shown).not.toContain(NETWORK_SLOW);
  expect(saveToDisk).toHaveBeenCalledTimes(1);
  // the list's own rendering timers are done within a second
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1000);
  });
  expect(jest.getTimerCount()).toBe(0);
  act(() => tree.unmount());
});

it('a fetch that fails says to pull again, not that the wallet has no history', async () => {
  const { wallet, fail } = slowWallet();
  const saveToDisk = jest.fn(async () => {});
  const tree = render(wallet, saveToDisk);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(2000);
    fail(new Error('close connect'));
  });
  const shown = shownTexts(tree);
  expect(shown).toContain(NETWORK_SLOW);
  expect(shown).not.toContain(NO_HISTORY);
  expect(saveToDisk).not.toHaveBeenCalled();

  // pulling again starts a new fetch
  await act(async () => {
    tree.root.findByType(RefreshControl).props.onRefresh();
  });
  expect(wallet.fetchTransactions).toHaveBeenCalledTimes(2);
  act(() => tree.unmount());
});

it('what was fetched is shown even when saving it fails', async () => {
  const { wallet, finish } = slowWallet();
  const saveToDisk = jest.fn(async () => {
    throw new Error('disk full');
  });
  const tree = render(wallet, saveToDisk);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
    finish();
  });
  expect(shownTexts(tree)).toEqual(expect.arrayContaining(['tx aa', 'tx bb']));
  expect(saveToDisk).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

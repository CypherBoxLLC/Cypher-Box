// The capsule-received queue: which capsules pop up, once each, and that the
// queue and the per-vault record survive an app restart.

// In-memory stand-in for the encrypted MMKV store. It lives in this file's
// scope, so it outlives jest.resetModules(), like the real store outlives a restart.
const mockDisk = new Map<string, string>();
jest.mock('../../src/stores/storageService', () => ({
  getItem: async (key: string) => (mockDisk.has(key) ? JSON.parse(mockDisk.get(key) as string) : null),
  setItem: async (key: string, value: unknown) => {
    mockDisk.set(key, JSON.stringify(value));
  },
  removeItem: async (key: string) => {
    mockDisk.delete(key);
  },
}));

// Electrum: the chain tip, and transactions by id (verbose, as BlueElectrum returns them).
let mockTip = 900_000;
const mockChain = new Map<string, any>();
let mockChainDown = false;
jest.mock('../../blue_modules/BlueElectrum', () => ({
  estimateCurrentBlockheight: () => mockTip,
  multiGetTransactionByTxid: jest.fn(async (txids: string[]) => {
    if (mockChainDown) throw new Error('Electrum client is not connected');
    const found: Record<string, any> = {};
    for (const txid of txids) if (mockChain.has(txid)) found[txid] = mockChain.get(txid);
    return found;
  }),
}));

type StoreModule = typeof import('../../src/stores/capsuleReceivedStore');
type ServiceModule = typeof import('../../src/services/capsuleReceived');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const electrum = () => jest.requireMock('../../blue_modules/BlueElectrum') as { multiGetTransactionByTxid: jest.Mock };

// Loads the store and service as a fresh app start would.
function loadModules(): { store: StoreModule; service: ServiceModule } {
  jest.resetModules();
  const store: StoreModule = require('../../src/stores/capsuleReceivedStore');
  const service: ServiceModule = require('../../src/services/capsuleReceived');
  return { store, service };
}

// A fresh app start that reached the foreground with the wallets unlocked, so the
// store has read what the last run saved.
async function startApp(): Promise<{ store: StoreModule; service: ServiceModule }> {
  const modules = loadModules();
  await modules.store.hydrateCapsuleStore();
  expect(modules.store.isCapsuleStoreHydrated()).toBe(true);
  return modules;
}

const TXID_A = 'a'.repeat(64);
const TXID_B = 'b'.repeat(64);
const TXID_C = 'c'.repeat(64);
const TXID_D = 'd'.repeat(64);
const TXID_E = 'e'.repeat(64);

// Puts a transaction on the mock chain, each input spending an output that paid `address`.
function onChain(txid: string, inputAddresses: string[]) {
  mockChain.set(txid, {
    txid,
    vin: inputAddresses.map((_, i) => ({ txid: `${txid.slice(0, 60)}f${i}00`, vout: 1 })),
    vout: [],
  });
  inputAddresses.forEach((address, i) => {
    const previous = `${txid.slice(0, 60)}f${i}00`;
    mockChain.set(previous, {
      txid: previous,
      vin: [],
      vout: [
        { n: 0, scriptPubKey: { addresses: ['bc1qunrelated'] } },
        { n: 1, scriptPubKey: { addresses: [address] } },
      ],
    });
  });
}

type FakeUtxo = { txid: string; vout: number; value: number; height: number; address: string };

// A vault wallet as BlueWallet's HD and watch-only wallets look to the service.
function fakeVault(id: string) {
  const state = {
    utxos: [] as FakeUtxo[],
    cachedTxs: [] as Array<{ txid: string; inputs: Array<{ addresses?: string[]; address?: string }> }>,
    own: new Set<string>(['bc1qown-receive', 'bc1qown-change']),
    change: new Set<string>(['bc1qown-change']),
    electrumDown: false,
  };
  const wallet = {
    state,
    _utxo: [] as any[],
    getID: () => id,
    // like BlueWallet: fetchBalance swallows Electrum errors, fetchUtxo throws them
    fetchBalance: jest.fn(async () => {}),
    fetchUtxo: jest.fn(async () => {
      if (state.electrumDown) throw new Error('Electrum client is not connected');
      wallet._utxo = state.utxos.map(u => ({ ...u, txId: u.txid, amount: u.value }));
    }),
    getUtxo: (_respectFrozen?: boolean) => wallet._utxo,
    getTransactions: () => state.cachedTxs,
    weOwnAddress: (address: string) => state.own.has(address),
    addressIsChange: (address: string) => state.change.has(address),
  };
  return wallet;
}

beforeEach(() => {
  mockDisk.clear();
  mockChain.clear();
  mockChainDown = false;
  mockTip = 900_000;
});

describe('diffCapsules', () => {
  let service: ServiceModule;
  beforeEach(async () => {
    ({ service } = await startApp());
  });

  const utxo = (txid: string, vout: number, value: number, height: number): FakeUtxo => ({
    txid,
    vout,
    value,
    height,
    address: 'bc1qown-receive',
  });
  const base = { walletId: 'hot-1', vault: 'hot' as const, tipHeight: 900_000, now: 1, isOwnSpend: () => false };

  it('records what is already there on the first look and announces nothing', () => {
    const { cursor, announce } = service.diffCapsules({
      ...base,
      cursor: undefined,
      utxos: [utxo(TXID_A, 0, 5_000, 899_000), utxo(TXID_B, 1, 7_000, 0)],
    });
    expect(announce).toEqual([]);
    // the pending one stays out of the record, so it can pop up once it confirms
    expect(cursor.seen).toEqual([`${TXID_A}:0`]);
    expect(cursor.baseHeight).toBe(900_000 - 12);
  });

  it('announces a newly confirmed capsule once, and not while it is pending', () => {
    const first = service.diffCapsules({ ...base, cursor: undefined, utxos: [] });

    const pending = service.diffCapsules({ ...base, cursor: first.cursor, utxos: [utxo(TXID_A, 0, 120_000, 0)] });
    expect(pending.announce).toEqual([]);
    expect(pending.cursor.seen).toEqual([]);

    const confirmed = service.diffCapsules({ ...base, cursor: pending.cursor, now: 42, utxos: [utxo(TXID_A, 0, 120_000, 900_001)] });
    expect(confirmed.announce).toEqual([
      { id: `${TXID_A}:0`, vault: 'hot', walletId: 'hot-1', txid: TXID_A, vout: 0, sats: 120_000, height: 900_001, seenAt: 42 },
    ]);

    const again = service.diffCapsules({ ...base, cursor: confirmed.cursor, utxos: [utxo(TXID_A, 0, 120_000, 900_001)] });
    expect(again.announce).toEqual([]);
  });

  it('skips change and consolidations, and older coins found late', () => {
    const first = service.diffCapsules({ ...base, cursor: undefined, utxos: [] });
    const result = service.diffCapsules({
      ...base,
      cursor: first.cursor,
      isOwnSpend: u => u.txid === TXID_B,
      utxos: [
        utxo(TXID_A, 0, 1_000, 850_000), // confirmed long before the first look
        utxo(TXID_B, 1, 2_000, 900_002), // made by spending this vault's coins
        utxo(TXID_C, 0, 3_000, 900_003), // a real receive
      ],
    });
    expect(result.announce.map(c => c.id)).toEqual([`${TXID_C}:0`]);
    // all three are handled, so none of them comes back later
    expect(result.cursor.seen.sort()).toEqual([`${TXID_A}:0`, `${TXID_B}:1`, `${TXID_C}:0`].sort());
  });

  it('lists several new capsules oldest first', () => {
    const first = service.diffCapsules({ ...base, cursor: undefined, utxos: [] });
    const { announce } = service.diffCapsules({
      ...base,
      cursor: first.cursor,
      utxos: [utxo(TXID_B, 0, 1, 900_010), utxo(TXID_A, 1, 1, 900_005), utxo(TXID_A, 0, 1, 900_005)],
    });
    expect(announce.map(c => c.id)).toEqual([`${TXID_A}:0`, `${TXID_A}:1`, `${TXID_B}:0`]);
  });
});

describe('telling change and consolidations from receives', () => {
  const at = (txid: string, address = 'bc1qown-receive') => ({ txid, vout: 0, value: 1, height: 1, address });

  it('looks at the addresses the transaction spends from', async () => {
    const { service } = await startApp();
    const wallet = fakeVault('hot-1');
    expect(service.isOwnSpend(wallet, at(TXID_A), ['bc1qsomeone-else', 'bc1qown-change'])).toBe(true);
    expect(service.isOwnSpend(wallet, at(TXID_A), ['bc1qsomeone-else'])).toBe(false);
    expect(service.isOwnSpend(wallet, at(TXID_A), [])).toBe(false); // a coinbase
    // addresses unknown: only a change address gives it away
    expect(service.isOwnSpend(wallet, at(TXID_A, 'bc1qown-change'), null)).toBe(true);
    expect(service.isOwnSpend(wallet, at(TXID_A), null)).toBe(false);
  });

  it("reads them from the wallet's cached copy, else asks Electrum for just that transaction and its inputs", async () => {
    const { service } = await startApp();
    const wallet = fakeVault('hot-1');
    wallet.state.cachedTxs = [{ txid: TXID_A, inputs: [{ addresses: ['bc1qown-receive'] }, { address: 'bc1qother' }] }];
    expect(await service.spentAddresses(wallet, TXID_A)).toEqual(['bc1qown-receive', 'bc1qother']);
    expect(electrum().multiGetTransactionByTxid).not.toHaveBeenCalled();

    onChain(TXID_B, ['bc1qsomeone-else', 'bc1qown-change']);
    expect(await service.spentAddresses(wallet, TXID_B)).toEqual(['bc1qsomeone-else', 'bc1qown-change']);
    expect(electrum().multiGetTransactionByTxid).toHaveBeenCalledTimes(2);

    mockChain.set(TXID_C, { txid: TXID_C, vin: [{ coinbase: '03a0bb0d' }], vout: [] });
    expect(await service.spentAddresses(wallet, TXID_C)).toEqual([]);

    expect(await service.spentAddresses(wallet, TXID_D)).toBeNull(); // Electrum doesn't know it
    mockChainDown = true;
    expect(await service.spentAddresses(wallet, TXID_B)).toBeNull();
  });
});

describe('checkWalletForNewCapsules', () => {
  it('queues a confirmed receive once, skips change, and drops a capsule spent before it was seen', async () => {
    const { store, service } = await startApp();
    const hot = fakeVault('hot-1');
    hot.state.utxos = [{ txid: TXID_A, vout: 0, value: 50_000, height: 899_500, address: 'bc1qown-receive' }];

    // first look after the update: the existing capsule never pops up
    await service.checkWalletForNewCapsules(hot, 'hot');
    expect(store.default.getState().queue).toEqual([]);
    expect(store.default.getState().cursors['hot-1'].seen).toEqual([`${TXID_A}:0`]);

    // someone pays the vault; it shows only once confirmed
    onChain(TXID_B, ['bc1qsomeone-else']);
    hot.state.utxos.push({ txid: TXID_B, vout: 1, value: 2_500_000, height: 0, address: 'bc1qown-receive' });
    await service.checkWalletForNewCapsules(hot, 'hot');
    expect(store.default.getState().queue).toEqual([]);

    hot.state.utxos[1].height = 900_001;
    await service.checkWalletForNewCapsules(hot, 'hot');
    await service.checkWalletForNewCapsules(hot, 'hot');
    expect(store.default.getState().queue.map(c => [c.vault, c.walletId, c.id, c.sats])).toEqual([
      ['hot', 'hot-1', `${TXID_B}:1`, 2_500_000],
    ]);
    // only the new capsule's transaction was looked up, not the wallet's history
    const looked = electrum()
      .multiGetTransactionByTxid.mock.calls.map(([txids]) => txids)
      .flat();
    expect(looked).toContain(TXID_B);
    expect(looked).not.toContain(TXID_A);

    // change from a send never pops up
    onChain(TXID_C, ['bc1qown-receive']);
    hot.state.utxos.push({ txid: TXID_C, vout: 1, value: 9_000, height: 900_002, address: 'bc1qown-receive' });
    await service.checkWalletForNewCapsules(hot, 'hot');
    expect(store.default.getState().queue.map(c => c.id)).toEqual([`${TXID_B}:1`]);

    // the queued capsule is spent before the user saw it: nothing left to label
    hot.state.utxos = hot.state.utxos.filter(u => u.txid !== TXID_B);
    await service.checkWalletForNewCapsules(hot, 'hot');
    expect(store.default.getState().queue).toEqual([]);
  });

  it('announces a move from the other vault in the vault that receives it', async () => {
    const { store, service } = await startApp();
    const cold = fakeVault('cold-1');
    await service.checkWalletForNewCapsules(cold, 'cold');
    // the move spends Hot Vault coins, which the Cold Vault doesn't own
    onChain(TXID_D, ['bc1qhot-vault']);
    cold.state.utxos = [{ txid: TXID_D, vout: 0, value: 30_000_000, height: 900_003, address: 'bc1qown-receive' }];
    await service.checkWalletForNewCapsules(cold, 'cold');
    expect(store.default.getState().queue.map(c => [c.vault, c.walletId, c.id])).toEqual([['cold', 'cold-1', `${TXID_D}:0`]]);
  });

  it("falls back to the change address when Electrum can't give the transaction", async () => {
    const { store, service } = await startApp();
    const hot = fakeVault('hot-1');
    await service.checkWalletForNewCapsules(hot, 'hot');
    hot.state.utxos = [
      { txid: TXID_D, vout: 0, value: 5_000, height: 900_004, address: 'bc1qown-change' },
      { txid: TXID_E, vout: 0, value: 6_000, height: 900_004, address: 'bc1qown-receive' },
    ];
    await service.checkWalletForNewCapsules(hot, 'hot');
    expect(store.default.getState().queue.map(c => c.id)).toEqual([`${TXID_E}:0`]);
  });

  it('changes nothing when Electrum is down', async () => {
    const { store, service } = await startApp();
    const hot = fakeVault('hot-1');
    hot.state.utxos = [{ txid: TXID_A, vout: 0, value: 1_000, height: 899_000, address: 'bc1qown-receive' }];
    await service.checkWalletForNewCapsules(hot, 'hot');
    store.default
      .getState()
      .enqueue([{ id: `${TXID_A}:0`, vault: 'hot', walletId: 'hot-1', txid: TXID_A, vout: 0, sats: 1_000, height: 899_000, seenAt: 1 }]);
    const before = JSON.stringify(store.default.getState());

    hot.state.electrumDown = true;
    await expect(service.checkWalletForNewCapsules(hot, 'hot')).rejects.toThrow('not connected');
    // nothing recorded, and the queued capsule isn't taken for spent
    expect(JSON.stringify(store.default.getState())).toBe(before);
  });

  it("reads an empty fetch as no capsules, not BlueWallet's guess from cached transactions", async () => {
    const { service } = await startApp();
    const hot = fakeVault('hot-1');
    hot.getUtxo = () => [{ txid: TXID_A, vout: 0, value: 1, height: 899_000 }];
    hot._utxo = [];
    expect(service.fetchedUtxos(hot)).toEqual([]);
  });
});

describe('the queue', () => {
  const capsule = (id: string, walletId = 'hot-1') => ({
    id,
    vault: 'hot' as const,
    walletId,
    txid: id.split(':')[0],
    vout: Number(id.split(':')[1]),
    sats: 1_000,
    height: 900_001,
    seenAt: 1,
  });

  it('holds each capsule once and lets it go when labeled or ignored', async () => {
    const { store } = await startApp();
    const state = () => store.default.getState();
    state().enqueue([capsule(`${TXID_A}:0`), capsule(`${TXID_A}:0`), capsule(`${TXID_B}:0`)]);
    state().enqueue([capsule(`${TXID_A}:0`)]);
    // the same outpoint in another wallet is a different capsule
    state().enqueue([capsule(`${TXID_A}:0`, 'cold-1')]);
    expect(state().queue.map(c => `${c.walletId}/${c.id}`)).toEqual([`hot-1/${TXID_A}:0`, `hot-1/${TXID_B}:0`, `cold-1/${TXID_A}:0`]);
    state().dequeue('hot-1', `${TXID_A}:0`);
    expect(state().queue.map(c => `${c.walletId}/${c.id}`)).toEqual([`hot-1/${TXID_B}:0`, `cold-1/${TXID_A}:0`]);
    state().clearQueue();
    expect(state().queue).toEqual([]);
  });

  it('survives an app restart, with the record of handled capsules', async () => {
    const first = await startApp();
    first.store.default.getState().enqueue([capsule(`${TXID_A}:0`), capsule(`${TXID_B}:1`)]);
    first.store.default.getState().setCursor('hot-1', { seen: [`${TXID_A}:0`, `${TXID_B}:1`], baseHeight: 899_988 });
    await flush();

    const second = await startApp();
    expect(second.store.default.getState().queue.map(c => c.id)).toEqual([`${TXID_A}:0`, `${TXID_B}:1`]);
    expect(second.store.default.getState().cursors['hot-1']).toEqual({ seen: [`${TXID_A}:0`, `${TXID_B}:1`], baseHeight: 899_988 });

    // a capsule that arrived while the app was closed pops up on the next open, once
    const hot = fakeVault('hot-1');
    onChain(TXID_C, ['bc1qsomeone-else']);
    hot.state.utxos = [
      { txid: TXID_A, vout: 0, value: 1_000, height: 900_001, address: 'bc1qown-receive' },
      { txid: TXID_B, vout: 1, value: 1_000, height: 900_001, address: 'bc1qown-receive' },
      { txid: TXID_C, vout: 0, value: 77_000, height: 900_020, address: 'bc1qown-receive' },
    ];
    await second.service.checkWalletForNewCapsules(hot, 'hot');
    expect(second.store.default.getState().queue.map(c => c.id)).toEqual([`${TXID_A}:0`, `${TXID_B}:1`, `${TXID_C}:0`]);
    await flush();

    const third = await startApp();
    expect(third.store.default.getState().queue.map(c => c.id)).toEqual([`${TXID_A}:0`, `${TXID_B}:1`, `${TXID_C}:0`]);
  });
});

describe('loading the saved queue', () => {
  it('waits to be asked, and checks nothing before', async () => {
    mockDisk.set(
      'capsule-received-store',
      JSON.stringify(JSON.stringify({ state: { queue: [], cursors: { 'hot-1': { seen: [], baseHeight: 1 } } }, version: 0 })),
    );
    const { store, service } = loadModules();
    await flush();
    // the app's JS may start in the background with the phone locked: nothing read yet
    expect(store.isCapsuleStoreHydrated()).toBe(false);
    expect(store.default.getState().cursors).toEqual({});

    const hot = fakeVault('hot-1');
    await service.checkVaultsForNewCapsules(() => [{ wallet: hot, vault: 'hot' }]);
    expect(hot.fetchBalance).not.toHaveBeenCalled();

    await store.hydrateCapsuleStore();
    expect(store.default.getState().cursors).toEqual({ 'hot-1': { seen: [], baseHeight: 1 } });
  });
});

describe('checkVaultsForNewCapsules', () => {
  const hanging = () => {
    let release: () => void = () => {};
    const promise = new Promise<void>(resolve => {
      release = () => resolve();
    });
    return { promise, release: () => release() };
  };

  it('runs one check at a time and goes round once more for requests made meanwhile', async () => {
    const { service } = await startApp();
    const hot = fakeVault('hot-1');
    const slow = hanging();
    hot.fetchBalance.mockImplementationOnce(() => slow.promise);
    const targets = () => [{ wallet: hot, vault: 'hot' as const }];

    const run = service.checkVaultsForNewCapsules(targets);
    service.checkVaultsForNewCapsules(targets);
    service.checkVaultsForNewCapsules(targets);
    slow.release();
    await run;
    expect(hot.fetchBalance).toHaveBeenCalledTimes(2);
  });

  it('never starts a second check of a vault while one that timed out is still going', async () => {
    const { service } = await startApp();
    const hot = fakeVault('hot-1');
    const slow = hanging();
    hot.fetchBalance.mockImplementationOnce(() => slow.promise);
    const targets = () => [{ wallet: hot, vault: 'hot' as const }];

    await service.checkVaultsForNewCapsules(targets, 10); // gives up waiting after 10 ms
    await service.checkVaultsForNewCapsules(targets, 10);
    expect(hot.fetchBalance).toHaveBeenCalledTimes(1);

    slow.release();
    await flush();
    await service.checkVaultsForNewCapsules(targets, 10);
    expect(hot.fetchBalance).toHaveBeenCalledTimes(2);
  });

  it('keeps going when one vault fails', async () => {
    const { store, service } = await startApp();
    const hot = fakeVault('hot-1');
    hot.state.electrumDown = true;
    const cold = fakeVault('cold-1');
    await service.checkVaultsForNewCapsules(() => [
      { wallet: hot, vault: 'hot' },
      { wallet: cold, vault: 'cold' },
    ]);
    expect(store.default.getState().cursors['cold-1']).toBeDefined();
  });
});

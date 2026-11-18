// The Activity log's Hot Vault receive detection: each on-chain receive is
// logged once, after it confirms, including one first seen while pending.

// In-memory stand-in for the encrypted MMKV store the activity cursors live in.
import { processHotVaultTxsForActivity } from '../../src/services/hotVaultActivityDiff';
import { getHotVaultSeenTxids } from '../../src/services/activityCursors';

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

const mockRecordEvent = jest.fn();
jest.mock('../../src/stores/eventLogStore', () => ({
  recordEvent: (event: unknown) => mockRecordEvent(event),
}));

const TXID_A = 'a'.repeat(64);
const TXID_B = 'b'.repeat(64);
const TXID_C = 'c'.repeat(64);
const TXID_D = 'd'.repeat(64);

const tx = (txid: string, value: number, confirmations: number, received = 1_000) => ({ txid, value, confirmations, received });
const refresh = (txs: ReturnType<typeof tx>[]) => processHotVaultTxsForActivity({ getTransactions: () => txs });
const logged = () => mockRecordEvent.mock.calls.map(([event]) => event);
const received = (sats: number) => ({ kind: 'onchain-received', wallet: 'hot-vault', sats });

beforeEach(() => {
  mockDisk.clear();
  mockRecordEvent.mockClear();
});

describe('processHotVaultTxsForActivity', () => {
  it('logs nothing on the first look', async () => {
    await refresh([tx(TXID_A, 5_000, 3)]);
    expect(logged()).toEqual([]);
    expect(await getHotVaultSeenTxids()).toEqual([TXID_A]);
  });

  it('logs a receive first seen pending once, after it confirms', async () => {
    await refresh([tx(TXID_A, 5_000, 3)]);

    await refresh([tx(TXID_A, 5_000, 3), tx(TXID_B, 2_500, 0)]);
    expect(logged()).toEqual([]);
    // still pending, so not taken for seen
    expect(await getHotVaultSeenTxids()).toEqual([TXID_A]);

    await refresh([tx(TXID_A, 5_000, 4), tx(TXID_B, 2_500, 1)]);
    expect(logged()).toEqual([received(2_500)]);

    await refresh([tx(TXID_A, 5_000, 5), tx(TXID_B, 2_500, 2)]);
    expect(logged()).toEqual([received(2_500)]);
  });

  it('logs a receive that was still pending on the first look, once it confirms', async () => {
    await refresh([tx(TXID_A, 5_000, 3), tx(TXID_B, 7_000, 0)]);
    expect(logged()).toEqual([]);

    await refresh([tx(TXID_A, 5_000, 4), tx(TXID_B, 7_000, 1)]);
    expect(logged()).toEqual([received(7_000)]);
  });

  it('logs a receive seen already confirmed once', async () => {
    await refresh([tx(TXID_A, 5_000, 3)]);
    await refresh([tx(TXID_A, 5_000, 9), tx(TXID_C, 300, 6)]);
    await refresh([tx(TXID_A, 5_000, 9), tx(TXID_C, 300, 7)]);
    expect(logged()).toEqual([received(300)]);
  });

  it('never logs a payment out, pending or confirmed', async () => {
    await refresh([tx(TXID_A, 5_000, 3)]);
    await refresh([tx(TXID_A, 5_000, 3), tx(TXID_D, -4_000, 0)]);
    await refresh([tx(TXID_A, 5_000, 4), tx(TXID_D, -4_000, 1)]);
    expect(logged()).toEqual([]);
    expect(await getHotVaultSeenTxids()).toEqual([TXID_A, TXID_D]);
  });

  it('never logs a pending receive that is dropped or replaced', async () => {
    await refresh([tx(TXID_A, 5_000, 3)]);
    await refresh([tx(TXID_A, 5_000, 3), tx(TXID_B, 2_500, 0)]);
    // replaced (RBF) by TXID_C, which confirms
    await refresh([tx(TXID_A, 5_000, 4), tx(TXID_C, 2_400, 1)]);
    expect(logged()).toEqual([received(2_400)]);
    expect(await getHotVaultSeenTxids()).toEqual([TXID_A, TXID_C]);
  });

  it('logs several new receives oldest first', async () => {
    await refresh([tx(TXID_A, 5_000, 3)]);
    await refresh([tx(TXID_A, 5_000, 3), tx(TXID_C, 300, 1, 2_000), tx(TXID_B, 200, 2, 1_500)]);
    expect(logged()).toEqual([received(200), received(300)]);
  });

  it('waits for a wallet with transactions before taking the first look', async () => {
    await refresh([]);
    expect(await getHotVaultSeenTxids()).toBeNull();
    await processHotVaultTxsForActivity(null);
    expect(await getHotVaultSeenTxids()).toBeNull();
  });
});

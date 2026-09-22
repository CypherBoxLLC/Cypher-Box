/**
 * Running a USDT swap outside any screen: record, pay, follow, and pick up
 * after a restart.
 *
 * What this protects:
 *   - The swap is written down before anything is signed, and every transfer
 *     is on record before it is posted.
 *   - No second swap starts while a deposit could still land: while sending,
 *     while checking, and while the outcome is unknown.
 *   - After a restart mid-send, the chain decides what happened, newest
 *     transfer first. Nothing is signed again, and a transfer that landed is
 *     followed rather than repeated.
 *   - Only a send the send module settled as "nothing moved" is shown as
 *     not sent. An indeterminate one, or anything unexpected after a
 *     signature, is shown as unconfirmed.
 *   - The order is followed until it ends, a read failure keeps the swap, and
 *     a swap is forgotten only when nothing it signed can still land.
 *
 * The store is a plain object and the conversion calls are scripted, so the
 * runner's own rules are what is under test.
 */

import { asset, type ChainSwapOrder, type ChainSwapPollResult, type ChainSwapQuote } from '../../src/services/chainSwap';
import { USDT_ON_TRON } from '../../src/services/tron/conversion';
import { TronSendError, type UsdtTransferFate } from '../../src/services/tron/send';
import {
    createUsdtSwapRunner,
    fromStoredOrder,
    toStoredOrder,
    type UsdtSwapRecord,
    type UsdtSwapRecordStore,
    type UsdtSwapRunnerDeps,
    type UsdtSwapStart,
} from '../../src/services/tron/swapRun';

const T0 = 1789704360000;
const ACCOUNT = { address: 'TNrDPeCdW8CFQqkM6uJxT381MhJyusgaJq', publicKey: '02'.padEnd(66, '1') };
const LIGHTNING = asset('btc', 'lightning');

const quote: ChainSwapQuote = {
    id: 'q_swap_0001',
    depositAsset: USDT_ON_TRON,
    settleAsset: LIGHTNING,
    depositAmount: '150',
    settleAmount: '0.00140000',
    expiresAt: new Date(T0 + 120_000),
    settleAmountIsFirm: false,
    minSettleAmount: null,
    depositAddress: 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs',
    allInCostFraction: null,
};

const order: ChainSwapOrder = {
    id: quote.id,
    status: 'awaiting_deposit',
    depositAddress: quote.depositAddress ?? null,
    depositAsset: USDT_ON_TRON,
    settleAsset: LIGHTNING,
    depositAmount: '150',
    settleAmount: '0.00140000',
    settleAddress: 'satoshi@strike.me',
    refundAddress: ACCOUNT.address,
    createdAt: new Date(T0),
    expiresAt: new Date(T0 + 120_000),
    statusChangedAt: new Date(T0),
};

const startInput = (): UsdtSwapStart => ({
    prepared: { ready: true, quote, order, confirmBy: new Date(T0 + 60_000) },
    account: ACCOUNT,
    sign: () => {
        throw new Error('the runner never signs by itself');
    },
    request: { usdtAmount: '150', destination: 'satoshi@strike.me' },
});

function memoryStore(initial: UsdtSwapRecord | null = null): UsdtSwapRecordStore & { writes: (UsdtSwapRecord | null)[] } {
    let record = initial;
    const writes: (UsdtSwapRecord | null)[] = [];
    return {
        writes,
        get: () => record,
        set: next => {
            record = next;
            writes.push(next);
        },
    };
}

/** A promise with its resolvers, to hold a scripted call open. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });
    return { promise, resolve, reject };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/** A transfer the chain reports in a block, its call done. */
const LANDED: UsdtTransferFate = { status: 'succeeded', blockNumber: 86344060, energyUsed: 130285, trxBurnedSun: 0 };

function scriptedDeps(over: Partial<UsdtSwapRunnerDeps> = {}): jest.Mocked<UsdtSwapRunnerDeps> {
    let clock = T0;
    return {
        pay: jest.fn(),
        follow: jest.fn(),
        settleTransfer: jest.fn(),
        now: jest.fn(() => (clock += 1000)),
        ...over,
    } as jest.Mocked<UsdtSwapRunnerDeps>;
}

const settled = (o: ChainSwapOrder): ChainSwapPollResult => ({
    order: { ...o, status: 'settled', settleTxId: 'preimage-or-hash' },
    stall: 'none',
});

describe('starting a swap', () => {
    it('writes the swap down before anything is signed, and refuses a second one', async () => {
        const store = memoryStore();
        const pay = deferred<ChainSwapOrder>();
        const deps = scriptedDeps({ pay: jest.fn(() => pay.promise) });
        const runner = createUsdtSwapRunner(store, deps);

        runner.start(startInput());

        const record = store.get();
        expect(record).toMatchObject({
            id: 'q_swap_0001',
            phase: 'sending',
            transfers: [],
            request: { usdtAmount: '150', destination: 'satoshi@strike.me' },
            quote: { depositAmount: '150', settleAmount: '0.00140000', settleAmountIsFirm: false, minSettleAmount: null },
        });
        expect(runner.canStart()).toBe(false);
        expect(() => runner.start(startInput())).toThrow('A swap is already under way');
        expect(runner.dismiss()).toBe(false);
        expect(store.get()?.phase).toBe('sending');
    });

    it('has each transfer on record before it is posted', async () => {
        const store = memoryStore();
        let seenAtPost: UsdtSwapRecord | null = null;
        const deps = scriptedDeps({
            pay: jest.fn(async payment => {
                payment.onSubmit?.({ txID: 'tx_a', expirationMs: T0 + 60_000 });
                // What posting would see: the record already names the transfer.
                seenAtPost = store.get();
                return { ...payment.order, depositTxId: 'tx_a', statusChangedAt: new Date(T0 + 30_000) };
            }),
            follow: jest.fn(async o => settled(o)),
        });
        createUsdtSwapRunner(store, deps).start(startInput());
        await flush();

        expect(seenAtPost).toMatchObject({ transfers: [{ txID: 'tx_a', expirationMs: T0 + 60_000 }] });
    });

    it('follows the order once the deposit lands, writing every reading, and finishes when it ends', async () => {
        const store = memoryStore();
        const paid = { ...order, depositTxId: 'tx_a', statusChangedAt: new Date(T0 + 30_000) };
        const deps = scriptedDeps({
            pay: jest.fn(async () => paid),
            follow: jest.fn(async (o, options) => {
                expect(o).toEqual(paid);
                options.onUpdate?.({ order: { ...o, id: 'ord_1', status: 'processing', venueStatus: 'swapping' }, stall: 'none' });
                expect(store.get()).toMatchObject({ phase: 'following', order: { id: 'ord_1', status: 'processing' } });
                options.onUpdate?.({ order: { ...o, id: 'ord_1', status: 'settling' }, stall: 'slow' });
                expect(store.get()?.stall).toBe('slow');
                return settled({ ...o, id: 'ord_1' });
            }),
        });
        const runner = createUsdtSwapRunner(store, deps);
        runner.start(startInput());
        await flush();

        expect(store.get()).toMatchObject({
            phase: 'finished',
            stall: 'none',
            order: { id: 'ord_1', status: 'settled', depositTxId: 'tx_a' },
        });
        expect(runner.canStart()).toBe(true);
        expect(runner.dismiss()).toBe(true);
        expect(store.get()).toBeNull();
    });
});

describe('a send that fails', () => {
    it('shows a settled refusal as not sent, with the send module message', async () => {
        const store = memoryStore();
        const refusal = new TronSendError('QUOTE_EXPIRING', 'requote', 'This quote expires too soon to pay into. Nothing was sent.');
        const deps = scriptedDeps({ pay: jest.fn(async () => Promise.reject(refusal)) });
        const runner = createUsdtSwapRunner(store, deps);
        runner.start(startInput());
        await flush();

        expect(store.get()).toMatchObject({
            phase: 'not_sent',
            sendError: { code: 'QUOTE_EXPIRING', remedy: 'requote', message: refusal.message },
        });
        expect(deps.follow).not.toHaveBeenCalled();
        expect(runner.canStart()).toBe(true);
    });

    it('keeps an indeterminate send unconfirmed, blocking a new swap and dismissal', async () => {
        const store = memoryStore();
        const unknown = new TronSendError('OUTCOME_UNKNOWN', 'check_status', 'Could not confirm.', { txID: 'tx_a' });
        const deps = scriptedDeps({
            pay: jest.fn(async payment => {
                payment.onSubmit?.({ txID: 'tx_a', expirationMs: T0 + 60_000 });
                throw unknown;
            }),
        });
        const runner = createUsdtSwapRunner(store, deps);
        runner.start(startInput());
        await flush();

        expect(store.get()).toMatchObject({ phase: 'unconfirmed', sendError: { code: 'OUTCOME_UNKNOWN', remedy: 'check_status' } });
        expect(runner.canStart()).toBe(false);
        expect(runner.dismiss()).toBe(false);
    });

    it('treats an unexpected error after a signature as unconfirmed, and before one as not sent', async () => {
        const after = memoryStore();
        createUsdtSwapRunner(
            after,
            scriptedDeps({
                pay: jest.fn(async payment => {
                    payment.onSubmit?.({ txID: 'tx_a', expirationMs: T0 + 60_000 });
                    throw new Error('socket closed');
                }),
            }),
        ).start(startInput());

        const before = memoryStore();
        createUsdtSwapRunner(
            before,
            scriptedDeps({ pay: jest.fn(async () => Promise.reject(new Error('no phrase'))) }),
        ).start(startInput());
        await flush();

        expect(after.get()).toMatchObject({ phase: 'unconfirmed', sendError: { code: 'OUTCOME_UNKNOWN' } });
        expect(before.get()).toMatchObject({ phase: 'not_sent', sendError: { code: 'NOT_SENT', remedy: 'none' } });
    });
});

describe('after a restart', () => {
    /** The record a killed app leaves: sending, with the transfers it had signed. */
    const interrupted = (transfers: UsdtSwapRecord['transfers']): UsdtSwapRecord => ({
        id: quote.id,
        phase: 'sending',
        startedAtMs: T0,
        updatedAtMs: T0,
        request: { usdtAmount: '150', destination: 'satoshi@strike.me' },
        quote: { depositAmount: '150', settleAmount: '0.0014', settleAmountIsFirm: false, minSettleAmount: null },
        order: toStoredOrder(order),
        transfers,
        stall: 'none',
    });

    it('settles the transfers newest first, follows the one that landed, and signs nothing', async () => {
        const store = memoryStore(
            interrupted([
                { txID: 'tx_old', expirationMs: T0 + 60_000 },
                { txID: 'tx_new', expirationMs: T0 + 90_000 },
            ]),
        );
        const fates: Record<string, UsdtTransferFate> = {
            tx_new: { status: 'dropped' },
            tx_old: LANDED,
        };
        const deps = scriptedDeps({
            settleTransfer: jest.fn(async txID => fates[txID]),
            follow: jest.fn(async o => {
                expect(o.depositTxId).toBe('tx_old');
                return settled(o);
            }),
        });
        const runner = createUsdtSwapRunner(store, deps);
        runner.resume();
        expect(store.get()?.phase).toBe('checking');
        expect(runner.canStart()).toBe(false);
        await flush();

        expect(deps.settleTransfer.mock.calls.map(call => call[0])).toEqual(['tx_new', 'tx_old']);
        expect(deps.pay).not.toHaveBeenCalled();
        expect(store.get()).toMatchObject({ phase: 'finished', order: { depositTxId: 'tx_old', status: 'settled' } });
    });

    it('calls a swap not sent when none of its transfers landed', async () => {
        const store = memoryStore(interrupted([{ txID: 'tx_a', expirationMs: T0 + 60_000 }]));
        const deps = scriptedDeps({ settleTransfer: jest.fn(async () => ({ status: 'dropped' }) as UsdtTransferFate) });
        createUsdtSwapRunner(store, deps).resume();
        await flush();

        expect(store.get()).toMatchObject({
            phase: 'not_sent',
            sendError: { message: 'The deposit did not go out, so no USDT moved.' },
        });
        expect(deps.follow).not.toHaveBeenCalled();
    });

    it('says nothing was sent when the app stopped before signing', async () => {
        const store = memoryStore(interrupted([]));
        const deps = scriptedDeps();
        createUsdtSwapRunner(store, deps).resume();
        await flush();

        expect(store.get()).toMatchObject({ phase: 'not_sent', sendError: { message: 'Nothing was sent.' } });
        expect(deps.settleTransfer).not.toHaveBeenCalled();
    });

    it('stays unconfirmed while the chain cannot be read, and settles on a later check', async () => {
        const store = memoryStore(interrupted([{ txID: 'tx_a', expirationMs: T0 + 60_000 }]));
        const unreadable = new TronSendError('OUTCOME_UNKNOWN', 'check_status', 'Could not confirm.');
        const settleTransfer = jest
            .fn()
            .mockRejectedValueOnce(unreadable)
            .mockResolvedValueOnce(LANDED);
        const deps = scriptedDeps({ settleTransfer, follow: jest.fn(async o => settled(o)) });
        const runner = createUsdtSwapRunner(store, deps);

        runner.resume();
        await flush();
        expect(store.get()?.phase).toBe('unconfirmed');
        expect(runner.dismiss()).toBe(false);

        runner.resume();
        await flush();
        expect(store.get()).toMatchObject({ phase: 'finished', order: { depositTxId: 'tx_a' } });
    });

    it('does nothing to a swap whose send is still running in this session', async () => {
        const store = memoryStore();
        const pay = deferred<ChainSwapOrder>();
        const deps = scriptedDeps({ pay: jest.fn(() => pay.promise), follow: jest.fn(async o => settled(o)) });
        const runner = createUsdtSwapRunner(store, deps);
        runner.start(startInput());
        runner.resume();
        await flush();

        expect(deps.settleTransfer).not.toHaveBeenCalled();
        expect(store.get()?.phase).toBe('sending');

        pay.resolve({ ...order, depositTxId: 'tx_a' });
        await flush();
        expect(store.get()?.phase).toBe('finished');
    });
});

describe('following', () => {
    const landed = (): UsdtSwapRecord => ({
        id: quote.id,
        phase: 'following',
        startedAtMs: T0,
        updatedAtMs: T0,
        request: { usdtAmount: '150', destination: 'satoshi@strike.me' },
        quote: { depositAmount: '150', settleAmount: '0.0014', settleAmountIsFirm: false, minSettleAmount: null },
        order: toStoredOrder({ ...order, depositTxId: 'tx_a' }),
        transfers: [{ txID: 'tx_a', expirationMs: T0 + 60_000 }],
        stall: 'none',
    });

    it('keeps the swap when the order cannot be read, and follows it again on resume', async () => {
        const store = memoryStore(landed());
        const venueDown = Object.assign(new Error('down'), { name: 'VenueUnavailableError' });
        const follow = jest
            .fn()
            .mockRejectedValueOnce(venueDown)
            .mockImplementationOnce(async (o: ChainSwapOrder) => settled(o));
        const runner = createUsdtSwapRunner(store, scriptedDeps({ follow }));

        runner.resume();
        await flush();
        expect(store.get()).toMatchObject({
            phase: 'following',
            followError: 'Flashnet is not answering right now. The swap carries on without the app.',
        });

        runner.resume();
        await flush();
        expect(store.get()).toMatchObject({ phase: 'finished' });
        expect(store.get()?.followError).toBeUndefined();
    });

    it('follows once however often it is resumed', async () => {
        const store = memoryStore(landed());
        const held = deferred<ChainSwapPollResult>();
        const follow = jest.fn(() => held.promise);
        const runner = createUsdtSwapRunner(store, scriptedDeps({ follow }));

        runner.resume();
        runner.resume();
        runner.resume();
        expect(follow).toHaveBeenCalledTimes(1);

        held.resolve(settled(fromStoredOrder(landed().order)));
        await flush();
    });

    it('can be dismissed once the deposit landed, which stops following and is not undone by a late reading', async () => {
        const store = memoryStore(landed());
        let signal: AbortSignal | undefined;
        let onUpdate: ((r: ChainSwapPollResult) => void) | undefined;
        const held = deferred<ChainSwapPollResult>();
        const follow = jest.fn((_o: ChainSwapOrder, options: { signal?: AbortSignal; onUpdate?: (r: ChainSwapPollResult) => void }) => {
            signal = options.signal;
            onUpdate = options.onUpdate;
            return held.promise;
        });
        const runner = createUsdtSwapRunner(store, scriptedDeps({ follow }));
        runner.resume();

        expect(runner.canStart()).toBe(false);
        expect(runner.dismiss()).toBe(true);
        expect(signal?.aborted).toBe(true);
        expect(store.get()).toBeNull();

        onUpdate?.({ order: { ...order, status: 'processing' }, stall: 'none' });
        held.resolve(settled(order));
        await flush();
        expect(store.get()).toBeNull();
        expect(runner.canStart()).toBe(true);
    });
});

describe('stored orders', () => {
    it('round-trip through JSON with their dates', () => {
        const withTx = { ...order, depositTxId: 'tx_a', issue: 'held for review' };
        const stored = JSON.parse(JSON.stringify(toStoredOrder(withTx)));
        expect(fromStoredOrder(stored)).toEqual(withTx);
    });
});

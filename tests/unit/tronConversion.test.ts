/**
 * Converting USDT on Tron to bitcoin: prepare, pay, follow.
 *
 * What this protects:
 *   - A quote always refunds to the account that pays it, which is the only
 *     deposit our backend will pay the network fee for.
 *   - Nothing is booked for a wallet that cannot pay now, and on exact-out the
 *     quoted deposit is checked against the balance before anything is paid.
 *   - A quote the wallet could not pay, one needing a memo or with nowhere to
 *     deposit, never reaches the confirm step.
 *   - Paying returns only once the deposit is in a block, and the order it
 *     returns carries the deposit and starts its clock there.
 *   - Following runs until the order ends, survives a brief venue outage, and
 *     stops when told to.
 *   - Nothing is logged.
 *
 * The Tron and Flashnet API modules are mocked, so the chain, our backend and
 * the venue are scripted per test. The deposit is signed for real.
 */

import * as flashnetAPIs from '../../src/api/flashnetAPIs';
import * as tronAPIs from '../../src/api/tronAPIs';
import { TronApiError, type TronAccountState, type TronSendAnswer } from '../../src/api/tronAPIs';
import {
    AmountOutOfRangeError,
    ChainSwapError,
    VenueUnavailableError,
    asset,
    type ChainSwapOrder,
    type ChainSwapQuote,
} from '../../src/services/chainSwap';
import {
    USDT_ON_TRON,
    followUsdtConversion,
    payUsdtConversion,
    prepareUsdtConversion,
} from '../../src/services/tron/conversion';
import { deriveTronAccount } from '../../src/services/tron/keys';
import { CONVERSION_SEND_MARGIN_MS, TronSendError } from '../../src/services/tron/send';
import {
    type SignedUsdtTransfer,
    type TronReferenceBlock,
    type UsdtTransferRequest,
    signUsdtTransfer,
} from '../../src/services/tron/transaction';

// Hoisted above the imports by the test runner.
jest.mock('../../src/api/tronAPIs', () => {
    const actual = jest.requireActual('../../src/api/tronAPIs');
    return {
        ...actual,
        getTronReferenceBlock: jest.fn(),
        postTronSend: jest.fn(),
        getTronTransactionOutcome: jest.fn(),
        getTronAccountState: jest.fn(),
        getTronUsdtBalance: jest.fn(),
    };
});
jest.mock('../../src/api/flashnetAPIs', () => {
    const actual = jest.requireActual('../../src/api/flashnetAPIs');
    return { ...actual, requestFlashnetQuote: jest.fn(), getFlashnetOrder: jest.fn() };
});

const getBlock = tronAPIs.getTronReferenceBlock as jest.MockedFunction<typeof tronAPIs.getTronReferenceBlock>;
const post = tronAPIs.postTronSend as jest.MockedFunction<typeof tronAPIs.postTronSend>;
const outcome = tronAPIs.getTronTransactionOutcome as jest.MockedFunction<typeof tronAPIs.getTronTransactionOutcome>;
const accountState = tronAPIs.getTronAccountState as jest.MockedFunction<typeof tronAPIs.getTronAccountState>;
const usdtBalance = tronAPIs.getTronUsdtBalance as jest.MockedFunction<typeof tronAPIs.getTronUsdtBalance>;
const requestQuote = flashnetAPIs.requestFlashnetQuote as jest.MockedFunction<typeof flashnetAPIs.requestFlashnetQuote>;
const getOrder = flashnetAPIs.getFlashnetOrder as jest.MockedFunction<typeof flashnetAPIs.getFlashnetOrder>;

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FROM = deriveTronAccount(MNEMONIC);
const DEPOSIT = 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs';
const BTC = asset('btc', 'bitcoin');
const LIGHTNING = asset('btc', 'lightning');
const SETTLE_ADDRESS = 'bc1q-placeholder-settle';

const BASE_HEIGHT = 86344053;
const BASE_TIME = 1789704360000;
const block = (offset: number): TronReferenceBlock => ({
    number: BASE_HEIGHT + offset,
    id: (BASE_HEIGHT + offset).toString(16).padStart(16, '0') + '08010f219354e9e406f715ba528e60226ecb4223a807067c',
    timestamp: BASE_TIME + offset * 3000,
});

const state = (over: Partial<TronAccountState> = {}): TronAccountState => ({
    activated: true,
    trxBalance: '0',
    energyAvailable: 0,
    bandwidthAvailable: 600,
    freeBandwidth: 600,
    stakedBandwidth: 0,
    freeBandwidthUsed: 0,
    freeBandwidthLimit: 600,
    lastFreeBandwidthUseMs: 0,
    ...over,
});
/** One transfer just used 345 of the 600 free bandwidth. */
const spentBandwidth = state({ freeBandwidth: 255, freeBandwidthUsed: 345, lastFreeBandwidthUseMs: BASE_TIME });

const quoteFor = (over: Partial<ChainSwapQuote> = {}): ChainSwapQuote => ({
    id: 'q_test_0001',
    depositAsset: USDT_ON_TRON,
    settleAsset: BTC,
    depositAmount: '25',
    settleAmount: '0.00032',
    expiresAt: new Date(BASE_TIME + 120_000),
    settleAmountIsFirm: false,
    minSettleAmount: null,
    depositAddress: DEPOSIT,
    allInCostFraction: null,
    ...over,
});

const makeClock = (start = BASE_TIME) => {
    let t = start;
    return {
        now: () => t,
        sleep: jest.fn(async (ms: number) => {
            t += ms;
        }),
    };
};

let clock: ReturnType<typeof makeClock>;
let sign: jest.Mock<SignedUsdtTransfer, [UsdtTransferRequest]>;
let logSpies: jest.SpyInstance[];

const lastSigned = () => sign.mock.results[sign.mock.results.length - 1].value as SignedUsdtTransfer;
const sentFor = (txID: string): TronSendAnswer => ({ outcome: 'sent', txID, energyRented: 130285, activated: false });

beforeEach(() => {
    jest.resetAllMocks();
    clock = makeClock();
    sign = jest.fn((request: UsdtTransferRequest) => signUsdtTransfer(request, MNEMONIC));
    logSpies = (['log', 'warn', 'error'] as const).map(k => jest.spyOn(console, k).mockImplementation(() => undefined));
});

afterEach(() => {
    for (const spy of logSpies) {
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    }
});

const request = (over: Partial<Parameters<typeof prepareUsdtConversion>[0]> = {}) => ({
    account: FROM,
    settle: BTC,
    settleAddress: SETTLE_ADDRESS,
    amount: '25',
    ...over,
});

describe('prepareUsdtConversion', () => {
    it('books a quote that refunds to the paying account, and says when to confirm by', async () => {
        usdtBalance.mockResolvedValue('100');
        accountState.mockResolvedValue(state());
        requestQuote.mockResolvedValue(quoteFor());

        const prepared = await prepareUsdtConversion(request(), clock);

        expect(requestQuote).toHaveBeenCalledWith(
            USDT_ON_TRON,
            BTC,
            '25',
            { settleAddress: SETTLE_ADDRESS, refundAddress: FROM.address },
            'exact_in',
        );
        if (!prepared.ready) throw new Error('expected a prepared conversion');
        expect(prepared.order).toMatchObject({
            id: 'q_test_0001',
            status: 'awaiting_deposit',
            depositAddress: DEPOSIT,
            depositAmount: '25',
            settleAddress: SETTLE_ADDRESS,
            refundAddress: FROM.address,
        });
        expect(prepared.confirmBy.getTime()).toBe(BASE_TIME + 120_000 - CONVERSION_SEND_MARGIN_MS);
    });

    it('books nothing for a wallet short of USDT or of bandwidth', async () => {
        accountState.mockResolvedValue(state());
        usdtBalance.mockResolvedValue('24.99');
        expect(await prepareUsdtConversion(request(), clock)).toEqual({ ready: false, code: 'INSUFFICIENT_USDT' });

        usdtBalance.mockResolvedValue('100');
        accountState.mockResolvedValue(spentBandwidth);
        expect(await prepareUsdtConversion(request(), clock)).toEqual({
            ready: false,
            code: 'BANDWIDTH_UNAVAILABLE',
            retryAfterSeconds: 22543,
        });

        expect(requestQuote).not.toHaveBeenCalled();
    });

    it('on exact-out checks bandwidth before quoting and the quoted deposit after', async () => {
        accountState.mockResolvedValue(spentBandwidth);
        usdtBalance.mockResolvedValue('0');
        const invoice = { settle: LIGHTNING, settleAddress: 'lnbc-placeholder', amount: '0.00032', mode: 'exact_out' as const };

        // Out of bandwidth: nothing booked, whatever the balance.
        expect((await prepareUsdtConversion(request(invoice), clock)).ready).toBe(false);
        expect(requestQuote).not.toHaveBeenCalled();

        // Bandwidth fine: the quote works out a deposit of 25, and the wallet holds 20.
        accountState.mockResolvedValue(state());
        usdtBalance.mockResolvedValue('20');
        requestQuote.mockResolvedValue(quoteFor({ settleAsset: LIGHTNING, amountMode: 'exact_out' }));
        expect(await prepareUsdtConversion(request(invoice), clock)).toEqual({ ready: false, code: 'INSUFFICIENT_USDT' });
        expect(requestQuote).toHaveBeenCalledWith(
            USDT_ON_TRON,
            LIGHTNING,
            '0.00032',
            { settleAddress: 'lnbc-placeholder', refundAddress: FROM.address },
            'exact_out',
        );
    });

    it('never hands on a quote it could not pay', async () => {
        usdtBalance.mockResolvedValue('100');
        accountState.mockResolvedValue(state());

        requestQuote.mockResolvedValueOnce(quoteFor({ depositMemo: '12345' }));
        await expect(prepareUsdtConversion(request(), clock)).rejects.toThrow(/memo/);

        requestQuote.mockResolvedValueOnce(quoteFor({ depositAddress: null }));
        await expect(prepareUsdtConversion(request(), clock)).rejects.toBeInstanceOf(ChainSwapError);
    });

    it('passes the venue and chain errors through', async () => {
        usdtBalance.mockResolvedValue('100');
        accountState.mockResolvedValue(state());
        requestQuote.mockRejectedValueOnce(new AmountOutOfRangeError('25', '30', undefined));
        await expect(prepareUsdtConversion(request(), clock)).rejects.toBeInstanceOf(AmountOutOfRangeError);

        usdtBalance.mockRejectedValueOnce(new TronApiError('Could not reach the Tron network, check your connection'));
        await expect(prepareUsdtConversion(request(), clock)).rejects.toMatchObject({ code: 'TRON_UNREACHABLE' });
    });
});

describe('payUsdtConversion', () => {
    const prepared = async (): Promise<ChainSwapOrder> => {
        usdtBalance.mockResolvedValue('100');
        accountState.mockResolvedValue(state());
        requestQuote.mockResolvedValue(quoteFor());
        const result = await prepareUsdtConversion(request(), clock);
        if (!result.ready) throw new Error('expected a prepared conversion');
        return result.order;
    };

    it('sends the quoted deposit, reports it sent, and returns the order once it lands', async () => {
        const order = await prepared();
        getBlock.mockResolvedValueOnce(block(0));
        post.mockImplementationOnce(async () => sentFor(lastSigned().txID));
        outcome.mockResolvedValueOnce({ status: 'unknown' }).mockResolvedValueOnce({
            status: 'succeeded',
            blockNumber: BASE_HEIGHT + 2,
            energyUsed: 130285,
            trxBurnedSun: 0,
        });
        getBlock.mockResolvedValueOnce(block(1));
        const onSent = jest.fn();

        const paid = await payUsdtConversion({ order, account: FROM, sign, onSent }, clock);

        expect(sign.mock.calls[0][0]).toMatchObject({ from: FROM.address, to: DEPOSIT, amountUnits: '25000000' });
        expect(onSent).toHaveBeenCalledWith(expect.objectContaining({ txID: lastSigned().txID }));
        expect(paid).toMatchObject({ id: order.id, status: 'awaiting_deposit', depositTxId: lastSigned().txID });
        // The clock restarts at the landing, so a deposit never picked up escalates from there.
        expect(paid.statusChangedAt.getTime()).toBe(clock.now());
    });

    it('reports a deposit that landed but failed, and one that never landed', async () => {
        const order = await prepared();
        getBlock.mockResolvedValueOnce(block(0));
        post.mockImplementationOnce(async () => sentFor(lastSigned().txID));
        outcome.mockResolvedValueOnce({
            status: 'failed',
            blockNumber: BASE_HEIGHT + 2,
            reason: 'OUT_OF_ENERGY',
            energyUsed: 20000,
            trxBurnedSun: 0,
        });
        await expect(payUsdtConversion({ order, account: FROM, sign }, clock)).rejects.toMatchObject({
            code: 'FAILED_ON_CHAIN',
            remedy: 'retry',
        });

        getBlock.mockResolvedValueOnce(block(0));
        post.mockImplementationOnce(async () => sentFor(lastSigned().txID));
        outcome.mockResolvedValue({ status: 'unknown' });
        getBlock.mockResolvedValueOnce(block(24)).mockResolvedValueOnce(block(25));
        const dropped = await payUsdtConversion({ order, account: FROM, sign }, clock).catch((e: unknown) => e);
        expect(dropped).toBeInstanceOf(TronSendError);
        expect(dropped).toMatchObject({ code: 'NOT_SENT', remedy: 'retry', detail: { reason: 'dropped' } });
    });
});

describe('followUsdtConversion', () => {
    const paidOrder = (over: Partial<ChainSwapOrder> = {}): ChainSwapOrder => ({
        id: 'q_test_0001',
        status: 'awaiting_deposit',
        depositAddress: DEPOSIT,
        depositAsset: USDT_ON_TRON,
        settleAsset: BTC,
        depositAmount: '25',
        settleAmount: '0.00032',
        settleAddress: SETTLE_ADDRESS,
        refundAddress: FROM.address,
        depositTxId: 'ab'.repeat(32),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        statusChangedAt: new Date(),
        ...over,
    });

    it('reads the order until it ends, reporting each reading', async () => {
        const start = paidOrder();
        getOrder
            .mockResolvedValueOnce(start)
            .mockResolvedValueOnce({ ...start, id: 'ord_test', status: 'processing' })
            .mockResolvedValueOnce({ ...start, id: 'ord_test', status: 'settled' });
        const onUpdate = jest.fn();

        const last = await followUsdtConversion(start, { onUpdate }, clock);

        expect(last.order.status).toBe('settled');
        expect(onUpdate).toHaveBeenCalledTimes(3);
        expect(clock.sleep).toHaveBeenCalledTimes(2);
        // Each read builds on the one before.
        expect(getOrder.mock.calls[2][0].id).toBe('ord_test');
    });

    it('keeps going through a brief venue outage, and stops on anything else', async () => {
        const start = paidOrder();
        getOrder
            .mockRejectedValueOnce(new VenueUnavailableError('flashnet', true, 'Flashnet is not responding, try again shortly'))
            .mockResolvedValueOnce({ ...start, status: 'refunded' });
        expect((await followUsdtConversion(start, {}, clock)).order.status).toBe('refunded');

        getOrder.mockRejectedValueOnce(new ChainSwapError('Flashnet returned a different order than was requested'));
        await expect(followUsdtConversion(start, {}, clock)).rejects.toThrow(/different order/);
    });

    it('stops when told to, with the last reading', async () => {
        const start = paidOrder();
        const controller = new AbortController();
        getOrder.mockImplementation(async previous => {
            controller.abort();
            return { ...previous, status: 'processing' };
        });

        const last = await followUsdtConversion(start, { signal: controller.signal }, clock);

        expect(last.order.status).toBe('processing');
        expect(getOrder).toHaveBeenCalledTimes(1);
    });
});

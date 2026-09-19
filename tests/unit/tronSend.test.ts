/**
 * Sending USDT through the backend: signing, posting, and what happens when an
 * answer is missing or says to sign again.
 *
 * What this protects:
 *   - One send never becomes two payments. A new signature is made only when
 *     the backend says the last transfer did not go out and every request for
 *     it was answered, or when the chain shows it past its expiry in no block.
 *   - An unanswered request is repeated with the same bytes, not a new
 *     signature.
 *   - When nothing can say whether a transfer went out, the error is
 *     indeterminate and never claims the money did not move.
 *   - A conversion deposit goes to the quoted address, for exactly the quoted
 *     amount, and only while the quote has time left by the network's clock.
 *   - Every refusal reaches the caller with a remedy it can act on.
 *   - Nothing is logged.
 *
 * The Tron API module is mocked, so the chain and the backend are scripted per
 * test. Transfers are signed for real, by the app's own signer.
 */

import * as tronAPIs from '../../src/api/tronAPIs';
import {
    TronApiError,
    type TronAccountState,
    type TronSendAnswer,
    type TronSendRefusalCode,
    type TronTransactionOutcome,
} from '../../src/api/tronAPIs';
import { asset, type ChainSwapOrder } from '../../src/services/chainSwap/types';
import { tronTransferSignerForWallet } from '../../src/services/tron/account';
import { deriveTronAccount } from '../../src/services/tron/keys';
import {
    CONVERSION_SEND_MARGIN_MS,
    TronSendError,
    type TronSendRemedy,
    awaitUsdtTransferOutcome,
    checkUsdtSendReadiness,
    sendUsdt,
    sendUsdtConversionDeposit,
} from '../../src/services/tron/send';
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

const getBlock = tronAPIs.getTronReferenceBlock as jest.MockedFunction<typeof tronAPIs.getTronReferenceBlock>;
const post = tronAPIs.postTronSend as jest.MockedFunction<typeof tronAPIs.postTronSend>;
const outcome = tronAPIs.getTronTransactionOutcome as jest.MockedFunction<typeof tronAPIs.getTronTransactionOutcome>;
const accountState = tronAPIs.getTronAccountState as jest.MockedFunction<typeof tronAPIs.getTronAccountState>;
const usdtBalance = tronAPIs.getTronUsdtBalance as jest.MockedFunction<typeof tronAPIs.getTronUsdtBalance>;

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FROM = deriveTronAccount(MNEMONIC);
const OTHER = deriveTronAccount(MNEMONIC, 0, 1);
const TO = 'TEERhoTJ3Rn6bKrWDYqdnuPaZ8kZf31YAS';
const DEPOSIT = 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs';

/** Block 86344053 and the ones after it, three seconds apart, with ids that start with their height. */
const BASE_HEIGHT = 86344053;
const BASE_TIME = 1789704360000;
const block = (offset: number): TronReferenceBlock => ({
    number: BASE_HEIGHT + offset,
    id: (BASE_HEIGHT + offset).toString(16).padStart(16, '0') + '08010f219354e9e406f715ba528e60226ecb4223a807067c',
    timestamp: BASE_TIME + offset * 3000,
});
/** A transfer signed against block(0) expires at block(20); the margin runs to block(23). */
const EXPIRY = BASE_TIME + 60_000;

const sentFor = (txID: string): TronSendAnswer => ({ outcome: 'sent', txID, energyRented: 130285, activated: false });
const refused = (code: TronSendRefusalCode, retryAfterSeconds?: number): TronSendAnswer => ({
    outcome: 'refused',
    code,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
});
const unanswered = (reason = 'timed out'): TronSendAnswer => ({ outcome: 'unknown', reason });
const SUCCEEDED: TronTransactionOutcome = { status: 'succeeded', blockNumber: BASE_HEIGHT + 2, energyUsed: 130285, trxBurnedSun: 0 };
const NOT_IN_A_BLOCK: TronTransactionOutcome = { status: 'unknown' };

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

/** A clock whose sleeps pass instantly and move time on. */
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

/** The transfers signed so far, in order. */
const signedAll = () => sign.mock.results.map(r => r.value as SignedUsdtTransfer);
const lastSigned = () => signedAll()[signedAll().length - 1];
/** Answer the next post with a success for whatever was signed last. */
const answerSent = () => post.mockImplementationOnce(async () => sentFor(lastSigned().txID));

const params = (over: Partial<Parameters<typeof sendUsdt>[0]> = {}) => ({
    from: FROM,
    to: TO,
    amountUnits: '25000000',
    sign,
    ...over,
});

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

const failure = async (run: Promise<unknown>): Promise<TronSendError> => {
    const error = await run.then(
        () => undefined,
        (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TronSendError);
    return error as TronSendError;
};

describe('sendUsdt', () => {
    it('signs against a fresh block, posts the transfer with the public key, and returns its id', async () => {
        getBlock.mockResolvedValueOnce(block(0));
        answerSent();
        const onSubmit = jest.fn();

        const receipt = await sendUsdt(params({ onSubmit }), clock);

        const signed = lastSigned();
        expect(sign).toHaveBeenCalledTimes(1);
        expect(sign.mock.calls[0][0]).toMatchObject({
            from: FROM.address,
            to: TO,
            amountUnits: '25000000',
            referenceBlock: block(0),
        });
        expect(post).toHaveBeenCalledWith(signed.transactionHex, FROM.publicKey);
        // Reported before it is posted, so a caller can keep it if the app closes mid-send.
        expect(onSubmit).toHaveBeenCalledWith({ txID: signed.txID, expirationMs: signed.expirationMs });
        expect(onSubmit.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
        expect(receipt).toEqual({
            txID: signed.txID,
            expirationMs: EXPIRY,
            energyRented: 130285,
            activated: false,
        });
    });

    it('works with the Hot Vault signer, posting exactly what the phrase signs', async () => {
        const wallet = { getID: () => 'hot', getSecret: () => MNEMONIC, getPassphrase: () => undefined };
        const walletSigner = jest.fn(tronTransferSignerForWallet(wallet)!);
        getBlock.mockResolvedValueOnce(block(0));
        post.mockImplementationOnce(async () => sentFor(walletSigner.mock.results[0].value.txID));

        await sendUsdt(params({ sign: walletSigner }), clock);

        expect(post.mock.calls[0][0]).toBe(signUsdtTransfer(walletSigner.mock.calls[0][0], MNEMONIC).transactionHex);
    });

    it('signs again against a newer block when the backend says the transfer expires too soon', async () => {
        getBlock.mockResolvedValueOnce(block(0)).mockResolvedValueOnce(block(12));
        post.mockResolvedValueOnce(refused('RESIGN_REQUIRED'));
        answerSent();

        const receipt = await sendUsdt(params(), clock);

        const [first, second] = signedAll();
        expect(sign).toHaveBeenCalledTimes(2);
        expect(sign.mock.calls[1][0].referenceBlock).toEqual(block(12));
        expect(second.txID).not.toBe(first.txID);
        expect(receipt.txID).toBe(second.txID);
        // The refusal settled it, so the chain was not needed.
        expect(outcome).not.toHaveBeenCalled();
    });

    it('after ENERGY_NOT_DELIVERED, waits for the late energy before signing again', async () => {
        getBlock.mockResolvedValueOnce(block(0)).mockResolvedValueOnce(block(12));
        post.mockResolvedValueOnce(refused('ENERGY_NOT_DELIVERED'));
        answerSent();
        // The recipient holds no USDT, so the transfer needs 130,285 energy.
        usdtBalance.mockResolvedValue('0');
        accountState.mockResolvedValueOnce(state({ energyAvailable: 0 })).mockResolvedValueOnce(state({ energyAvailable: 130285 }));

        await sendUsdt(params(), clock);

        expect(accountState).toHaveBeenCalledTimes(2);
        expect(accountState).toHaveBeenCalledWith(FROM.address);
        expect(usdtBalance).toHaveBeenCalledWith(TO);
        expect(accountState.mock.invocationCallOrder[1]).toBeLessThan(sign.mock.invocationCallOrder[1]);
        expect(sign).toHaveBeenCalledTimes(2);
    });

    it('signs again after a bounded wait when the late energy never shows', async () => {
        getBlock.mockResolvedValueOnce(block(0)).mockResolvedValueOnce(block(12));
        post.mockResolvedValueOnce(refused('ENERGY_NOT_DELIVERED'));
        answerSent();
        usdtBalance.mockResolvedValue('0');
        accountState.mockResolvedValue(state({ energyAvailable: 0 }));

        await sendUsdt(params(), clock);

        expect(sign).toHaveBeenCalledTimes(2);
        // One read a block for at most 15 seconds.
        expect(accountState.mock.calls.length).toBeLessThanOrEqual(6);
    });

    it('signs again without the wait when the energy cannot be read', async () => {
        getBlock.mockResolvedValueOnce(block(0)).mockResolvedValueOnce(block(12));
        post.mockResolvedValueOnce(refused('ENERGY_NOT_DELIVERED'));
        answerSent();
        usdtBalance.mockRejectedValue(new TronApiError('The Tron network did not answer, try again shortly'));

        await sendUsdt(params(), clock);

        expect(sign).toHaveBeenCalledTimes(2);
        expect(clock.sleep).not.toHaveBeenCalled();
    });

    it('stops after three signatures and says to try again', async () => {
        getBlock.mockResolvedValueOnce(block(0)).mockResolvedValueOnce(block(12)).mockResolvedValueOnce(block(24));
        post.mockResolvedValue(refused('RESIGN_REQUIRED'));

        const error = await failure(sendUsdt(params(), clock));

        expect(error).toMatchObject({ code: 'RESIGN_REQUIRED', remedy: 'retry', indeterminate: false });
        expect(sign).toHaveBeenCalledTimes(3);
    });

    it('posts the same bytes again when a request goes unanswered, rather than signing anew', async () => {
        getBlock.mockResolvedValueOnce(block(0));
        post.mockResolvedValueOnce(unanswered('unreachable'));
        answerSent();

        const receipt = await sendUsdt(params(), clock);

        expect(sign).toHaveBeenCalledTimes(1);
        expect(post).toHaveBeenCalledTimes(2);
        expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
        expect(receipt.txID).toBe(lastSigned().txID);
    });

    it('asks the chain when both requests go unanswered, and reports a transfer that landed as sent', async () => {
        getBlock.mockResolvedValueOnce(block(0));
        post.mockResolvedValue(unanswered());
        outcome.mockResolvedValueOnce(SUCCEEDED);

        const receipt = await sendUsdt(params(), clock);

        expect(outcome).toHaveBeenCalledWith(lastSigned().txID);
        expect(receipt).toEqual({ txID: lastSigned().txID, expirationMs: EXPIRY });
        expect(sign).toHaveBeenCalledTimes(1);
    });

    it('says nothing was sent only once the chain is past the expiry with the transfer in no block', async () => {
        getBlock
            .mockResolvedValueOnce(block(0)) // to sign against
            .mockResolvedValueOnce(block(10)) // still valid
            .mockResolvedValueOnce(block(24)) // past expiry and margin
            .mockResolvedValueOnce(block(25)); // and again, a block later
        post.mockResolvedValue(unanswered('unreachable'));
        outcome.mockResolvedValue(NOT_IN_A_BLOCK);

        const error = await failure(sendUsdt(params(), clock));

        expect(error).toMatchObject({ code: 'NOT_SENT', remedy: 'retry', indeterminate: false });
        expect(outcome).toHaveBeenCalledTimes(3);
        // Backend trouble is not fixed by another signature: the user decides.
        expect(sign).toHaveBeenCalledTimes(1);
    });

    it('does not sign again on RESIGN_REQUIRED after an unanswered request until the chain rules the first out', async () => {
        getBlock
            .mockResolvedValueOnce(block(0))
            .mockResolvedValueOnce(block(24))
            .mockResolvedValueOnce(block(25))
            .mockResolvedValueOnce(block(26));
        // The first request timed out; its repeat was too late to go out.
        post.mockResolvedValueOnce(unanswered()).mockResolvedValueOnce(refused('RESIGN_REQUIRED'));
        answerSent();
        outcome.mockResolvedValue(NOT_IN_A_BLOCK);

        await sendUsdt(params(), clock);

        expect(sign).toHaveBeenCalledTimes(2);
        expect(outcome).toHaveBeenCalledWith(signedAll()[0].txID);
        expect(outcome.mock.invocationCallOrder[1]).toBeLessThan(sign.mock.invocationCallOrder[1]);
    });

    it('reports the first transfer as sent when the chain shows it landed despite a later refusal', async () => {
        getBlock.mockResolvedValueOnce(block(0));
        post.mockResolvedValueOnce(unanswered()).mockResolvedValueOnce(refused('RESIGN_REQUIRED'));
        outcome.mockResolvedValueOnce(SUCCEEDED);

        const receipt = await sendUsdt(params(), clock);

        expect(sign).toHaveBeenCalledTimes(1);
        expect(receipt).toEqual({ txID: lastSigned().txID, expirationMs: EXPIRY });
    });

    it('reports an indeterminate outcome when neither the backend nor the chain can say, and never signs again', async () => {
        getBlock.mockResolvedValueOnce(block(0));
        post.mockResolvedValue(unanswered('unreachable'));
        outcome.mockRejectedValue(new TronApiError('The Tron network did not answer, try again shortly'));

        const error = await failure(sendUsdt(params(), clock));

        expect(error).toMatchObject({
            code: 'OUTCOME_UNKNOWN',
            remedy: 'check_status',
            indeterminate: true,
            detail: { txID: lastSigned().txID, expirationMs: EXPIRY },
        });
        expect(error.message).not.toMatch(/nothing was sent|not moved|did not move|funds are safe/i);
        expect(sign).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['OUT_OF_ENERGY', 'retry'],
        ['REVERT', 'none'],
    ])('reports a transfer that landed but failed with %s', async (reason, remedy) => {
        getBlock.mockResolvedValueOnce(block(0));
        post.mockResolvedValue(unanswered());
        outcome.mockResolvedValueOnce({ status: 'failed', blockNumber: BASE_HEIGHT + 2, reason, energyUsed: 20000, trxBurnedSun: 0 });

        const error = await failure(sendUsdt(params(), clock));

        expect(error).toMatchObject({ code: 'FAILED_ON_CHAIN', remedy, detail: { txID: lastSigned().txID, reason } });
        expect(error.message).toMatch(/no USDT moved/);
    });

    it('does not trust a success for a different transfer, and asks the chain instead', async () => {
        getBlock.mockResolvedValueOnce(block(0));
        post.mockResolvedValueOnce(sentFor('ab'.repeat(32)));
        outcome.mockResolvedValueOnce(SUCCEEDED);

        const receipt = await sendUsdt(params(), clock);

        expect(outcome).toHaveBeenCalledWith(lastSigned().txID);
        expect(receipt).toEqual({ txID: lastSigned().txID, expirationMs: EXPIRY });
    });

    it.each<[TronSendRefusalCode, TronSendRemedy, number | undefined]>([
        ['BANDWIDTH_UNAVAILABLE', 'wait', 12960],
        ['BANDWIDTH_UNAVAILABLE', 'wait', undefined],
        ['RATE_LIMITED', 'wait', 42],
        ['INSUFFICIENT_USDT', 'none', undefined],
        ['DAILY_LIMIT', 'retry_later', undefined],
        ['BUDGET_EXHAUSTED', 'retry_later', undefined],
        ['ENERGY_PROVIDER_UNFUNDED', 'retry_later', undefined],
        ['TRON_NOT_CONFIGURED', 'retry_later', undefined],
        ['ENERGY_UNAVAILABLE', 'retry', undefined],
        ['TRANSFER_REJECTED', 'none', undefined],
        ['INVALID_SIGNATURE', 'none', undefined],
        ['INVALID_TRANSACTION', 'none', undefined],
        ['INVALID_REQUEST', 'none', undefined],
        ['NOT_SPONSORED', 'none', undefined],
        ['BELOW_MINIMUM', 'none', undefined],
        ['QUOTE_EXPIRING', 'requote', undefined],
    ])('passes %s on with remedy %s, without signing again', async (code, remedy, retryAfterSeconds) => {
        getBlock.mockResolvedValueOnce(block(0));
        post.mockResolvedValueOnce(refused(code, retryAfterSeconds));

        const error = await failure(sendUsdt(params(), clock));

        expect(error.code).toBe(code);
        expect(error.remedy).toBe(remedy);
        expect(error.detail.retryAfterSeconds).toBe(retryAfterSeconds);
        expect(error.indeterminate).toBe(false);
        expect(error.message).toMatch(/Nothing was sent/);
        // User-facing copy: no em dash.
        expect(error.message).not.toContain('\u2014');
        expect(sign).toHaveBeenCalledTimes(1);
        expect(outcome).not.toHaveBeenCalled();
    });

    it('runs one send at a time per account, so a double tap cannot pay twice', async () => {
        getBlock.mockResolvedValue(block(0));
        let release: (answer: TronSendAnswer) => void = () => undefined;
        post.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    release = resolve;
                }),
        );

        const first = sendUsdt(params(), clock);
        // Handled here so a failure reads as a failed test rather than a crash; awaited below.
        first.catch(() => undefined);
        for (let i = 0; i < 50 && post.mock.calls.length === 0; i += 1) {
            await Promise.resolve();
        }
        const second = await failure(sendUsdt(params(), clock));
        expect(second).toMatchObject({ code: 'SEND_IN_PROGRESS', remedy: 'none', indeterminate: false });

        release(sentFor(lastSigned().txID));
        await first;
        expect(sign).toHaveBeenCalledTimes(1);

        // Free again once the first is done.
        answerSent();
        await sendUsdt(params(), clock);
        expect(sign).toHaveBeenCalledTimes(2);
    });

    it('frees the account again after a send fails', async () => {
        getBlock.mockRejectedValueOnce(new TronApiError('Could not reach the Tron network, check your connection'));
        await failure(sendUsdt(params(), clock));

        getBlock.mockResolvedValueOnce(block(0));
        answerSent();
        await expect(sendUsdt(params(), clock)).resolves.toMatchObject({ txID: expect.any(String) });
    });

    it('says nothing was sent when it cannot read a block to sign against', async () => {
        getBlock.mockRejectedValueOnce(new TronApiError('Could not reach the Tron network, check your connection'));

        const error = await failure(sendUsdt(params(), clock));

        expect(error).toMatchObject({ code: 'TRON_UNREACHABLE', remedy: 'retry' });
        expect(sign).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
    });

    it('refuses mistakes no retry fixes before calling out', async () => {
        await expect(sendUsdt(params({ from: { address: FROM.address, publicKey: OTHER.publicKey } }), clock)).rejects.toThrow(
            /public key/,
        );
        await expect(sendUsdt(params({ to: 'TNotAnAddress' }), clock)).rejects.toThrow();
        for (const amountUnits of ['0', '-1', '1.5', '', '01']) {
            await expect(sendUsdt(params({ amountUnits }), clock)).rejects.toThrow(/above zero/);
        }
        expect(getBlock).not.toHaveBeenCalled();
    });
});

describe('sendUsdtConversionDeposit', () => {
    const order = (over: Partial<ChainSwapOrder> = {}): ChainSwapOrder => ({
        id: 'q_test_0001',
        status: 'awaiting_deposit',
        depositAddress: DEPOSIT,
        depositAsset: asset('usdt', 'tron'),
        settleAsset: asset('btc', 'lightning'),
        depositAmount: '25.5',
        settleAmount: '0.00024',
        settleAddress: 'lnbc-placeholder',
        refundAddress: FROM.address,
        createdAt: new Date(BASE_TIME),
        expiresAt: new Date(BASE_TIME + 120_000),
        statusChangedAt: new Date(BASE_TIME),
        ...over,
    });
    const deposit = (over: Partial<ChainSwapOrder> = {}) => sendUsdtConversionDeposit({ order: order(over), from: FROM, sign }, clock);

    it('sends exactly the quoted amount to the quoted address', async () => {
        getBlock.mockResolvedValueOnce(block(0));
        answerSent();

        const receipt = await deposit();

        expect(sign.mock.calls[0][0]).toMatchObject({ from: FROM.address, to: DEPOSIT, amountUnits: '25500000' });
        expect(receipt.txID).toBe(lastSigned().txID);
    });

    it('asks for a new quote when the backend has no record of this one', async () => {
        getBlock.mockResolvedValueOnce(block(0));
        post.mockResolvedValueOnce(refused('NOT_SPONSORED'));

        const error = await failure(deposit());

        expect(error).toMatchObject({ code: 'NOT_SPONSORED', remedy: 'requote' });
    });

    it('starts no deposit once the network clock is inside the margin before the quote expires', async () => {
        // Block 21 is 63 seconds in; the quote expires at 120, so the last start is at 60.
        expect(CONVERSION_SEND_MARGIN_MS).toBe(60_000);
        getBlock.mockResolvedValueOnce(block(21));

        const error = await failure(deposit());

        expect(error).toMatchObject({ code: 'QUOTE_EXPIRING', remedy: 'requote' });
        expect(sign).not.toHaveBeenCalled();
    });

    it('still starts a deposit with exactly the margin left', async () => {
        getBlock.mockResolvedValueOnce(block(20));
        answerSent();

        await deposit();

        expect(sign).toHaveBeenCalledTimes(1);
    });

    it('asks for a new quote when the backend finds the quote too close to expiry, without signing again', async () => {
        getBlock.mockResolvedValueOnce(block(0));
        post.mockResolvedValueOnce(refused('QUOTE_EXPIRING'));

        const error = await failure(deposit());

        expect(error).toMatchObject({ code: 'QUOTE_EXPIRING', remedy: 'requote', indeterminate: false });
        expect(error.message).toMatch(/Nothing was sent/);
        expect(sign).toHaveBeenCalledTimes(1);
    });

    it('stops signing again once the quote gets too close to expiry', async () => {
        getBlock.mockResolvedValueOnce(block(0)).mockResolvedValueOnce(block(26));
        post.mockResolvedValueOnce(refused('RESIGN_REQUIRED'));

        const error = await failure(deposit());

        expect(error.code).toBe('QUOTE_EXPIRING');
        expect(sign).toHaveBeenCalledTimes(1);
    });

    it('judges the quote by the network clock, not the phone', async () => {
        clock = makeClock(BASE_TIME - 10 * 60_000); // a phone ten minutes slow
        getBlock.mockResolvedValueOnce(block(26));

        const error = await failure(deposit());

        expect(error.code).toBe('QUOTE_EXPIRING');
    });

    it.each<[string, Partial<ChainSwapOrder>]>([
        ['not USDT on Tron', { depositAsset: asset('btc', 'bitcoin') }],
        ['no longer waiting for the deposit', { status: 'confirming' }],
        ['without a deposit address', { depositAddress: null }],
        ['with a memo', { depositMemo: '1234' }],
        ['refunding to another address', { refundAddress: TO }],
        ['with no refund address', { refundAddress: null }],
        ['finer than a USDT unit', { depositAmount: '25.0000001' }],
        ['without a valid expiry', { expiresAt: new Date(NaN) }],
    ])('refuses an order %s before calling out', async (_label, over) => {
        await expect(deposit(over)).rejects.toThrow();
        expect(getBlock).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
    });
});

describe('checkUsdtSendReadiness', () => {
    const ready = () => checkUsdtSendReadiness(FROM.address, '25000000', clock);

    it('is ready when the balance covers the amount and one bandwidth source covers the transfer', async () => {
        usdtBalance.mockResolvedValue('25');
        accountState.mockResolvedValue(state());

        expect(await ready()).toEqual({ ready: true });
        expect(usdtBalance).toHaveBeenCalledWith(FROM.address);
        expect(accountState).toHaveBeenCalledWith(FROM.address);
        // A read, nothing more.
        expect(post).not.toHaveBeenCalled();
        expect(getBlock).not.toHaveBeenCalled();
    });

    it('reports a USDT shortfall first, since waiting does not fix it', async () => {
        usdtBalance.mockResolvedValue('24.999999');
        accountState.mockResolvedValue(state({ freeBandwidth: 0, freeBandwidthUsed: 600 }));

        expect(await ready()).toEqual({ ready: false, code: 'INSUFFICIENT_USDT' });
    });

    it('says how long until free bandwidth covers a transfer again', async () => {
        usdtBalance.mockResolvedValue('100');
        // One transfer just used 345 of the 600.
        accountState.mockResolvedValue(
            state({ freeBandwidth: 255, freeBandwidthUsed: 345, lastFreeBandwidthUseMs: BASE_TIME }),
        );

        expect(await ready()).toEqual({ ready: false, code: 'BANDWIDTH_UNAVAILABLE', retryAfterSeconds: 22543 });
    });

    it('counts a wallet that has only received USDT as ready, since activation brings the allowance', async () => {
        usdtBalance.mockResolvedValue('25');
        accountState.mockResolvedValue(state({ activated: false, freeBandwidth: 0, freeBandwidthLimit: 0 }));

        expect(await ready()).toEqual({ ready: true });
    });

    it('says nothing was sent when the chain cannot be read', async () => {
        usdtBalance.mockRejectedValue(new TronApiError('Could not reach the Tron network, check your connection'));
        accountState.mockResolvedValue(state());

        const error = await failure(ready());

        expect(error).toMatchObject({ code: 'TRON_UNREACHABLE', remedy: 'retry' });
    });

    it('refuses a bad address or amount before calling out', async () => {
        await expect(checkUsdtSendReadiness('TNotAnAddress', '1', clock)).rejects.toThrow();
        await expect(checkUsdtSendReadiness(FROM.address, '0', clock)).rejects.toThrow(/above zero/);
        expect(usdtBalance).not.toHaveBeenCalled();
    });
});

describe('awaitUsdtTransferOutcome', () => {
    const TX = 'c3a9767f89d31a2e213305d0045ad87c8e31daa90a463af407fe1cc83816abd7';
    const wait = () => awaitUsdtTransferOutcome(TX, EXPIRY, clock);

    it('returns the outcome once the transfer is in a block', async () => {
        outcome.mockResolvedValueOnce(NOT_IN_A_BLOCK).mockResolvedValueOnce(SUCCEEDED);
        getBlock.mockResolvedValueOnce(block(1));

        expect(await wait()).toEqual(SUCCEEDED);
        expect(clock.sleep).toHaveBeenCalledWith(3000);
    });

    it('allows for the block after the expiry to carry the transfer', async () => {
        // Past the expiry at block 20, but inside the margin up to block 23.
        outcome.mockResolvedValue(NOT_IN_A_BLOCK);
        getBlock
            .mockResolvedValueOnce(block(21))
            .mockResolvedValueOnce(block(23))
            .mockResolvedValueOnce(block(24))
            .mockResolvedValueOnce(block(25));

        expect(await wait()).toEqual({ status: 'dropped' });
        expect(outcome).toHaveBeenCalledTimes(4);
    });

    it('does not call a transfer dropped on one read past the margin', async () => {
        // The first read can come from a node a block behind the one that answered the height.
        outcome.mockResolvedValueOnce(NOT_IN_A_BLOCK).mockResolvedValueOnce(SUCCEEDED);
        getBlock.mockResolvedValueOnce(block(24));

        expect(await wait()).toEqual(SUCCEEDED);
    });

    it('needs the two reads past the margin to be in a row', async () => {
        outcome.mockResolvedValue(NOT_IN_A_BLOCK);
        getBlock
            .mockResolvedValueOnce(block(24))
            .mockResolvedValueOnce(block(19)) // a node behind
            .mockResolvedValueOnce(block(25))
            .mockResolvedValueOnce(block(26));

        expect(await wait()).toEqual({ status: 'dropped' });
        expect(outcome).toHaveBeenCalledTimes(4);
    });

    it('rides out a few failed reads', async () => {
        const down = new TronApiError('The Tron network did not answer, try again shortly');
        outcome.mockRejectedValueOnce(down).mockRejectedValueOnce(down).mockResolvedValueOnce(SUCCEEDED);

        expect(await wait()).toEqual(SUCCEEDED);
    });

    it('reports an indeterminate outcome after five failed reads in a row', async () => {
        outcome.mockRejectedValue(new TronApiError('The Tron network did not answer, try again shortly'));

        const error = await failure(wait());

        expect(error).toMatchObject({
            code: 'OUTCOME_UNKNOWN',
            indeterminate: true,
            detail: { txID: TX, expirationMs: EXPIRY },
        });
        expect(outcome).toHaveBeenCalledTimes(5);
    });

    it('gives up as indeterminate when the network clock never passes the expiry', async () => {
        outcome.mockResolvedValue(NOT_IN_A_BLOCK);
        getBlock.mockResolvedValue(block(5));

        const error = await failure(wait());

        expect(error.code).toBe('OUTCOME_UNKNOWN');
        expect(clock.now() - BASE_TIME).toBeGreaterThanOrEqual(180_000);
    });

    it('passes an error no retry fixes straight through', async () => {
        const bad = new TronApiError('Not a Tron transaction id', false);
        outcome.mockRejectedValue(bad);

        await expect(wait()).rejects.toBe(bad);
        expect(outcome).toHaveBeenCalledTimes(1);
    });
});

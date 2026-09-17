/**
 * The public SideShift calls made straight from the device.
 *
 * What this file protects:
 *   - Jurisdiction checks fail closed. A network error, an error response, a
 *     malformed body, or anything but a literal `true` must read as not
 *     allowed. A wrong yes costs the user a rejected order after they commit.
 *   - Failures come back as typed errors the UI can act on, never as raw
 *     fetch exceptions, and an unfixable input error is never dressed up as
 *     a retryable outage.
 *   - A hung request gives up instead of hanging the UI.
 *   - Nothing is logged. A shift id opens SideShift's order page by itself,
 *     so it must never reach device logs.
 */

import {
    getSideShiftPair,
    getSideShiftPermission,
    getSideShiftShift,
} from '../../src/api/sideshiftAPIs';
import {
    ChainSwapError,
    VenueUnavailableError,
    asset,
    type ChainSwapOrder,
} from '../../src/services/chainSwap/types';

type AbortListener = { addEventListener: (type: string, cb: () => void) => void };

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const errJson = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });

const PAIR_BODY = {
    min: '0.00037639',
    max: '0.78',
    rate: '72950.07',
    depositCoin: 'BTC',
    settleCoin: 'USDT',
    depositNetwork: 'bitcoin',
    settleNetwork: 'tron',
};

let fetchMock: jest.Mock;
let logSpies: jest.SpyInstance[];

beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    logSpies = [
        jest.spyOn(console, 'log').mockImplementation(() => undefined),
        jest.spyOn(console, 'warn').mockImplementation(() => undefined),
        jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
});

afterEach(() => {
    for (const spy of logSpies) {
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    }
});

const firstUrl = () => fetchMock.mock.calls[0][0] as string;

describe('getSideShiftPair', () => {
    it('calls the documented pair path with the amount', async () => {
        fetchMock.mockResolvedValue(okJson(PAIR_BODY));
        const pair = await getSideShiftPair(asset('btc', 'bitcoin'), asset('usdt', 'tron'), '0.001');
        expect(firstUrl()).toBe('https://sideshift.ai/api/v2/pair/BTC-bitcoin/USDT-tron?amount=0.001');
        expect(pair.min).toBe('0.00037639');
        expect(pair.settleAsset).toEqual({ coin: 'usdt', network: 'tron' });
    });

    it('omits the amount when none is given', async () => {
        fetchMock.mockResolvedValue(okJson(PAIR_BODY));
        await getSideShiftPair(asset('btc', 'bitcoin'), asset('usdt', 'tron'));
        expect(firstUrl()).toBe('https://sideshift.ai/api/v2/pair/BTC-bitcoin/USDT-tron');
    });

    it('turns a documented error body into a typed error', async () => {
        fetchMock.mockResolvedValue(
            errJson(500, { error: { code: 'SHIFT_UNAVAILABLE', message: 'Deposit method unavailable' } }),
        );
        await expect(
            getSideShiftPair(asset('btc', 'lightning'), asset('usdt', 'tron')),
        ).rejects.toBeInstanceOf(VenueUnavailableError);
    });

    it('does not dress an unfixable input error up as an outage', async () => {
        fetchMock.mockResolvedValue(errJson(500, { error: { code: 'BAD_USER_INPUT', message: 'Invalid network' } }));
        const e = await getSideShiftPair(asset('btc', 'nope'), asset('usdt', 'tron')).catch((x: unknown) => x);
        expect(e).toBeInstanceOf(ChainSwapError);
        expect(e).not.toBeInstanceOf(VenueUnavailableError);
    });

    it('reports a network failure as retryable', async () => {
        fetchMock.mockRejectedValue(new TypeError('Network request failed'));
        const e = await getSideShiftPair(asset('btc', 'bitcoin'), asset('usdt', 'tron')).catch((x: unknown) => x);
        expect(e).toBeInstanceOf(VenueUnavailableError);
        expect((e as VenueUnavailableError).retryable).toBe(true);
    });

    it('gives up after the timeout instead of hanging', async () => {
        fetchMock.mockImplementation(
            (_url: string, init?: { signal?: AbortListener }) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                }),
        );
        const e = await getSideShiftPair(asset('btc', 'bitcoin'), asset('usdt', 'tron'), undefined, {
            timeoutMs: 10,
        }).catch((x: unknown) => x);
        expect(e).toBeInstanceOf(VenueUnavailableError);
    });

    it('rejects an unreadable success body', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => {
                throw new SyntaxError('bad json');
            },
        });
        const e = await getSideShiftPair(asset('btc', 'bitcoin'), asset('usdt', 'tron')).catch((x: unknown) => x);
        expect(e).toBeInstanceOf(VenueUnavailableError);
    });
});

describe('getSideShiftPermission fails closed', () => {
    it('allows only a literal true', async () => {
        fetchMock.mockResolvedValue(okJson({ createShift: true }));
        await expect(getSideShiftPermission()).resolves.toEqual({ allowed: true });
    });

    it('blocks an explicit false', async () => {
        fetchMock.mockResolvedValue(okJson({ createShift: false }));
        expect((await getSideShiftPermission()).allowed).toBe(false);
    });

    it('blocks a truthy value that is not literally true', async () => {
        fetchMock.mockResolvedValue(okJson({ createShift: 'yes' }));
        expect((await getSideShiftPermission()).allowed).toBe(false);
    });

    it('blocks when the check cannot be completed', async () => {
        fetchMock.mockRejectedValue(new TypeError('Network request failed'));
        expect((await getSideShiftPermission()).allowed).toBe(false);
    });

    it('blocks on an error response', async () => {
        fetchMock.mockResolvedValue(errJson(403, { error: { code: 'ACCESS_DENIED', message: 'Access denied' } }));
        expect((await getSideShiftPermission()).allowed).toBe(false);
    });
});

describe('getSideShiftShift', () => {
    const previous: ChainSwapOrder = {
        id: 'shift-test-0001',
        status: 'processing',
        venueStatus: 'processing',
        depositAddress: 'bc1q-placeholder-deposit',
        depositAsset: { coin: 'btc', network: 'bitcoin' },
        settleAsset: { coin: 'usdt', network: 'tron' },
        depositAmount: '0.00129534',
        settleAmount: '99.87',
        settleAddress: 'T-placeholder-settle',
        refundAddress: 'bc1q-placeholder-refund',
        createdAt: new Date('2026-09-11T09:59:00.000Z'),
        expiresAt: new Date('2026-09-11T10:04:47.000Z'),
        statusChangedAt: new Date('2026-09-11T10:01:00.000Z'),
    };

    it('fetches by id and keeps the stall clock on an unchanged status', async () => {
        fetchMock.mockResolvedValue(
            okJson({
                id: 'shift-test-0001',
                createdAt: '2026-09-11T09:59:00.000Z',
                depositCoin: 'BTC',
                settleCoin: 'USDT',
                depositNetwork: 'bitcoin',
                settleNetwork: 'tron',
                depositAddress: 'bc1q-placeholder-deposit',
                settleAddress: 'T-placeholder-settle',
                depositAmount: '0.00129534',
                expiresAt: '2026-09-11T10:04:47.000Z',
                status: 'processing',
            }),
        );
        const next = await getSideShiftShift(previous, new Date('2026-09-11T10:30:00.000Z'));
        expect(firstUrl()).toBe('https://sideshift.ai/api/v2/shifts/shift-test-0001');
        expect(next.statusChangedAt).toEqual(previous.statusChangedAt);
    });
});

/**
 * Handing a signed USDT transfer to our backend, which pays for its energy and
 * broadcasts it.
 *
 * What this protects:
 *   - Only the signed transfer and the sender's public key leave the phone.
 *     No seed, no private key, no credential.
 *   - A refusal is told apart from no answer. A refusal means the transfer
 *     stayed off the network. A dropped connection, a timeout, a gateway page
 *     or a code that can follow a broadcast means it may be on it, and reading
 *     that as a failure is how a wallet ends up paying twice.
 *   - A success counts only when the answer is complete.
 *   - Nothing is logged.
 */

import { TronApiError, postTronSend } from '../../src/api/tronAPIs';
import { deriveTronAccount } from '../../src/services/tron/keys';
import { signUsdtTransfer } from '../../src/services/tron/transaction';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ACCOUNT = deriveTronAccount(MNEMONIC);

/** A real transfer, built and signed by the app's own code. */
const SIGNED = signUsdtTransfer(
    {
        from: ACCOUNT.address,
        to: 'TEERhoTJ3Rn6bKrWDYqdnuPaZ8kZf31YAS',
        amountUnits: '25000000',
        referenceBlock: {
            number: 86344053,
            id: '000000000525817508010f219354e9e406f715ba528e60226ecb4223a807067c',
            timestamp: 1789704360000,
        },
        createdAtMs: 1789704415000,
    },
    MNEMONIC,
);

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => body,
});
const page = (status: number) => ({
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => {
        throw new SyntaxError('Unexpected token <');
    },
});

let fetchMock: jest.Mock;
let logSpies: jest.SpyInstance[];

beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    logSpies = (['log', 'warn', 'error'] as const).map(k => jest.spyOn(console, k).mockImplementation(() => undefined));
});

afterEach(() => {
    for (const spy of logSpies) {
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    }
});

const send = () => postTronSend(SIGNED.transactionHex, ACCOUNT.publicKey);

describe('postTronSend', () => {
    it('posts the signed transfer and the public key to the backend, and nothing else', async () => {
        fetchMock.mockResolvedValue(respond(200, { txid: SIGNED.txID, energyRented: 130285, activated: false }));
        await send();
        const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
        expect(url).toBe('https://cypherbox-backend.onrender.com/tron/send');
        expect(init.method).toBe('POST');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(init.body)).toEqual({ transaction: SIGNED.transactionHex, publicKey: ACCOUNT.publicKey });
    });

    it('reads a complete success as sent', async () => {
        fetchMock.mockResolvedValue(respond(200, { txid: SIGNED.txID.toUpperCase(), energyRented: 130285, activated: true }));
        expect(await send()).toEqual({ outcome: 'sent', txID: SIGNED.txID, energyRented: 130285, activated: true });
    });

    it('does not call an incomplete success sent', async () => {
        for (const body of [
            {},
            null,
            { txid: 'abc', energyRented: 0, activated: false },
            { txid: SIGNED.txID, energyRented: '130285', activated: false },
            { txid: SIGNED.txID, energyRented: 130285 },
        ]) {
            fetchMock.mockResolvedValueOnce(respond(200, body));
            expect((await send()).outcome).toBe('unknown');
        }
    });

    it.each([
        [400, 'INVALID_TRANSACTION'],
        [400, 'INVALID_SIGNATURE'],
        [403, 'NOT_SPONSORED'],
        [403, 'BELOW_MINIMUM'],
        [409, 'RESIGN_REQUIRED'],
        [409, 'INSUFFICIENT_USDT'],
        [409, 'TRANSFER_REJECTED'],
        [429, 'DAILY_LIMIT'],
        [502, 'ENERGY_UNAVAILABLE'],
        [502, 'ENERGY_NOT_DELIVERED'],
        [503, 'TRON_NOT_CONFIGURED'],
        [503, 'BUDGET_EXHAUSTED'],
        [503, 'ENERGY_PROVIDER_UNFUNDED'],
    ])('reads %i %s as a refusal, whatever the status class', async (status, code) => {
        fetchMock.mockResolvedValue(respond(status, { error: 'Request refused', code, message: 'text the app does not show' }));
        expect(await send()).toEqual({ outcome: 'refused', code });
    });

    it('carries how long to wait when the free bandwidth is used up', async () => {
        fetchMock.mockResolvedValue(
            respond(409, { error: 'Request refused', code: 'BANDWIDTH_UNAVAILABLE', message: '...', retryAfterSeconds: 12960 }),
        );
        expect(await send()).toEqual({ outcome: 'refused', code: 'BANDWIDTH_UNAVAILABLE', retryAfterSeconds: 12960 });
    });

    it.each([
        [502, 'TRON_UNAVAILABLE'],
        [502, 'BROADCAST_FAILED'],
        [500, 'TRON_SEND_FAILURE'],
        [409, 'A_CODE_THIS_BUILD_DOES_NOT_KNOW'],
    ])('reads %i %s as unknown, since the transfer may already be out', async (status, code) => {
        fetchMock.mockResolvedValue(respond(status, { error: 'Service unavailable', code, message: '...' }));
        expect(await send()).toEqual({ outcome: 'unknown', reason: code });
    });

    it('reads a dropped connection as unknown, never as a refusal', async () => {
        fetchMock.mockRejectedValue(new TypeError('Network request failed'));
        expect(await send()).toEqual({ outcome: 'unknown', reason: 'unreachable' });
    });

    it('reads a timeout as unknown', async () => {
        fetchMock.mockImplementation(
            (_url: string, init: { signal: AbortSignal }) =>
                new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Aborted')))),
        );
        expect(await postTronSend(SIGNED.transactionHex, ACCOUNT.publicKey, { timeoutMs: 10 })).toEqual({
            outcome: 'unknown',
            reason: 'timed out',
        });
    });

    it('reads a gateway error page as unknown', async () => {
        for (const status of [500, 502, 503, 504]) {
            fetchMock.mockResolvedValueOnce(page(status));
            expect(await send()).toEqual({ outcome: 'unknown', reason: `HTTP ${status}` });
        }
    });

    it('reads the rate limiter, which sends no code, as a refusal with its Retry-After', async () => {
        fetchMock.mockResolvedValue(
            respond(429, { error: 'Too many requests', message: 'Rate limit exceeded. Please try again later.' }, { 'Retry-After': '42' }),
        );
        expect(await send()).toEqual({ outcome: 'refused', code: 'RATE_LIMITED', retryAfterSeconds: 42 });
    });

    it('reads a backend without the route as not configured', async () => {
        // The deployed backend's own 404, until the route ships, and a bare one.
        fetchMock.mockResolvedValueOnce(respond(404, { error: 'Not found', path: '/tron/send' })).mockResolvedValueOnce(page(404));
        expect(await send()).toEqual({ outcome: 'refused', code: 'TRON_NOT_CONFIGURED' });
        expect(await send()).toEqual({ outcome: 'refused', code: 'TRON_NOT_CONFIGURED' });
    });

    it('reads the request validator, which sends no code, as an invalid request', async () => {
        fetchMock.mockResolvedValue(
            respond(400, { error: 'Validation failed', details: [{ field: 'transaction', message: 'transaction must be hex' }] }),
        );
        expect(await send()).toEqual({ outcome: 'refused', code: 'INVALID_REQUEST' });
    });

    it('refuses something that is not a signed transfer or a public key before calling out', async () => {
        await expect(postTronSend('not hex', ACCOUNT.publicKey)).rejects.toBeInstanceOf(TronApiError);
        await expect(postTronSend('abc', ACCOUNT.publicKey)).rejects.toBeInstanceOf(TronApiError);
        await expect(postTronSend('ab'.repeat(1001), ACCOUNT.publicKey)).rejects.toBeInstanceOf(TronApiError);
        // Compressed, which cannot check a first send.
        await expect(postTronSend(SIGNED.transactionHex, `02${ACCOUNT.publicKey.slice(2, 66)}`)).rejects.toBeInstanceOf(
            TronApiError,
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

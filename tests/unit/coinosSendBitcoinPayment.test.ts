/**
 * sendBitcoinPayment and bitcoinSendFee against a mocked fetch: a refusal is
 * thrown with its reason, a success body comes back as before, and a failure
 * whose outcome is unknown keeps the indeterminate marker the withdraw guard
 * relies on. The module pulls in the auth store, toasts and the currency
 * daemon, none of which matter here, so they are stubbed.
 */

import loc from '../../loc';
import { bitcoinSendFee, sendBitcoinPayment } from '../../src/api/coinOSApis';
import { CoinosRequestError } from '../../src/services/coinos/apiResponse';
import { isCoinosWithdrawIndeterminate } from '../../src/services/coinos/withdrawGuard';

// jest hoists these above the imports; they sit here so the import block stays first for the linter.
jest.mock('../../src/stores/authStore', () => ({
  __esModule: true,
  default: { getState: () => ({ token: 'test-token', user: 'tester' }) },
}));
jest.mock('../../src/services/sessionExpiry', () => ({ expireCoinosSession: jest.fn() }));
jest.mock('react-native-simple-toast', () => ({ __esModule: true, default: { show: jest.fn(), SHORT: 0, LONG: 1 } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));
jest.mock('../../blue_modules/currency', () => ({ updateExchangeRate: jest.fn(), EXCHANGE_RATES_STORAGE_KEY: 'rates' }));
jest.mock('../../models/fiatUnit', () => ({ getFiatRate: jest.fn() }));

const HOLD_TEXT = '⚡867004 of your balance came from recent Lightning';
const ADDR = 'bc1qdph4zqqkvf72nd6uz87q2c5hw9tzapfnkmq93c';

const reply = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  json: async () => JSON.parse(body),
  headers: { get: () => 'text/plain' },
});

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('sendBitcoinPayment', () => {
  it('returns the JSON success body as text', async () => {
    fetchMock.mockResolvedValue(reply(200, '{"txid":"abc"}'));
    await expect(sendBitcoinPayment(1_000_000, ADDR, 10, '')).resolves.toBe('{"txid":"abc"}');
  });

  it("throws CoinOS's refusal with the reason, as a clean failure", async () => {
    fetchMock.mockResolvedValue(reply(500, HOLD_TEXT));
    const err = await sendBitcoinPayment(1_000_000, ADDR, 10, '').catch(e => e);
    expect(err).toBeInstanceOf(CoinosRequestError);
    expect(err.serverMessage).toBe(HOLD_TEXT);
    expect(isCoinosWithdrawIndeterminate(err)).toBe(false);
  });

  it('keeps a refusal clean even when its text mentions a timeout', async () => {
    fetchMock.mockResolvedValue(reply(500, 'payment timed out'));
    const err = await sendBitcoinPayment(1_000_000, ADDR, 10, '').catch(e => e);
    expect(err).toBeInstanceOf(CoinosRequestError);
    expect(isCoinosWithdrawIndeterminate(err)).toBe(false);
  });

  it('marks a lost connection indeterminate, exactly as before', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const err = await sendBitcoinPayment(1_000_000, ADDR, 10, '').catch(e => e);
    expect(isCoinosWithdrawIndeterminate(err)).toBe(true);
    expect(err.message).toBe(loc.cypherbox.services.coinos_api.withdrawal_may_have_been_sent);
  });

  it('marks a gateway status indeterminate: the request may have reached CoinOS', async () => {
    fetchMock.mockResolvedValue(reply(502, '<html>Bad Gateway</html>'));
    const err = await sendBitcoinPayment(1_000_000, ADDR, 10, '').catch(e => e);
    expect(isCoinosWithdrawIndeterminate(err)).toBe(true);
  });

  it('marks an OK reply with a non-JSON body indeterminate: the send most likely happened', async () => {
    fetchMock.mockResolvedValue(reply(200, 'ok'));
    const err = await sendBitcoinPayment(1_000_000, ADDR, 10, '').catch(e => e);
    expect(isCoinosWithdrawIndeterminate(err)).toBe(true);
  });

  it('still sends the idempotency key when given one', async () => {
    fetchMock.mockResolvedValue(reply(200, '{"txid":"abc"}'));
    await sendBitcoinPayment(1_000_000, ADDR, 10, '', 'key-1');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Idempotency-Key']).toBe('key-1');
  });
});

describe('bitcoinSendFee', () => {
  it('returns the JSON quote as text', async () => {
    fetchMock.mockResolvedValue(reply(200, '{"fee":1500,"ourfee":100}'));
    await expect(bitcoinSendFee(1_000_000, ADDR, 10)).resolves.toBe('{"fee":1500,"ourfee":100}');
  });

  it('throws a refused estimate with its reason instead of returning the text', async () => {
    fetchMock.mockResolvedValue(reply(500, 'insufficient funds'));
    const err = await bitcoinSendFee(1_000_000, ADDR, 10).catch(e => e);
    expect(err).toBeInstanceOf(CoinosRequestError);
    expect(err.serverMessage).toBe('insufficient funds');
  });
});

/**
 * Selling bitcoin for USDT on Tron, from one of the app's own vaults.
 *
 * What this protects:
 *   - The quote is booked the right way round: bitcoin in, USDT out, exact_in,
 *     so the coins the user picked are what they send and the USDT is what the
 *     quote works out.
 *   - It refunds to the vault the coins are leaving, never anywhere else. A
 *     refund is the one thing that goes back to the sender, and sending it to
 *     the wrong wallet is unrecoverable.
 *   - A quote a vault send cannot pay, one needing a memo or with nowhere to
 *     deposit, is refused here rather than after the user has picked coins.
 *   - The broadcast deadline leaves room for capsule selection and a fee
 *     choice, which a USDT deposit does not need.
 */

import * as flashnetAPIs from '../../src/api/flashnetAPIs';
import { ChainSwapError, VenueUnavailableError, type ChainSwapQuote } from '../../src/services/chainSwap';
import { SALE_BROADCAST_MARGIN_MS, prepareBitcoinSale } from '../../src/services/tron/sellConversion';

jest.mock('../../src/api/flashnetAPIs', () => {
    const actual = jest.requireActual('../../src/api/flashnetAPIs');
    return { ...actual, requestFlashnetQuote: jest.fn() };
});

const requestQuote = flashnetAPIs.requestFlashnetQuote as jest.MockedFunction<typeof flashnetAPIs.requestFlashnetQuote>;

const TRON_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const VAULT_REFUND = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const DEPOSIT_ADDRESS = 'bc1qdeposit0000000000000000000000000000000';
const EXPIRES_AT = new Date('2026-09-28T12:00:00Z');

// Cast because a Partial spread can reintroduce undefined on the optional
// fields, which the quote type does not accept.
const quote = (over: Partial<ChainSwapQuote> = {}): ChainSwapQuote => ({
    id: 'q1',
    depositAsset: { coin: 'btc', network: 'bitcoin' },
    settleAsset: { coin: 'usdt', network: 'tron' },
    depositAmount: '0.005',
    settleAmount: '415.5',
    expiresAt: EXPIRES_AT,
    depositAddress: DEPOSIT_ADDRESS,
    ...over,
}) as ChainSwapQuote;

const request = {
    amountBtc: '0.005',
    settleAddress: TRON_ADDRESS,
    refundAddress: VAULT_REFUND,
};

beforeEach(() => {
    requestQuote.mockReset();
});

describe('prepareBitcoinSale', () => {
    it('quotes bitcoin in and USDT on Tron out, exact_in', async () => {
        requestQuote.mockResolvedValue(quote());
        await prepareBitcoinSale(request);

        const [deposit, settle, amount, addresses, mode] = requestQuote.mock.calls[0];
        expect(deposit).toEqual({ coin: 'btc', network: 'bitcoin' });
        expect(settle).toEqual({ coin: 'usdt', network: 'tron' });
        expect(amount).toBe('0.005');
        expect(mode).toBe('exact_in');
        expect(addresses.settleAddress).toBe(TRON_ADDRESS);
    });

    it('refunds to the vault the coins are leaving', async () => {
        requestQuote.mockResolvedValue(quote());
        await prepareBitcoinSale(request);
        expect(requestQuote.mock.calls[0][3].refundAddress).toBe(VAULT_REFUND);
    });

    it('returns the address and the exact amount the vault must pay', async () => {
        requestQuote.mockResolvedValue(quote());
        const prepared = await prepareBitcoinSale(request);
        expect(prepared.depositAddress).toBe(DEPOSIT_ADDRESS);
        expect(prepared.depositAmount).toBe('0.005');
        expect(prepared.settleAmount).toBe('415.5');
        expect(prepared.order.depositAddress).toBe(DEPOSIT_ADDRESS);
    });

    it('leaves room to pick coins and a fee before the price lapses', async () => {
        requestQuote.mockResolvedValue(quote());
        const prepared = await prepareBitcoinSale(request);
        expect(prepared.broadcastBy.getTime()).toBe(EXPIRES_AT.getTime() - SALE_BROADCAST_MARGIN_MS);
        // Wider than the margin a USDT deposit gets, which is signed in one step.
        expect(SALE_BROADCAST_MARGIN_MS).toBeGreaterThan(60_000);
    });

    it('refuses a quote with nowhere to deposit', async () => {
        // Built by omission rather than by assigning undefined, which the
        // quote type does not allow.
        const { depositAddress, ...withoutAddress } = quote();
        requestQuote.mockResolvedValue(withoutAddress as ChainSwapQuote);
        await expect(prepareBitcoinSale(request)).rejects.toBeInstanceOf(ChainSwapError);
    });

    it('refuses a quote needing a memo, which a bitcoin send cannot carry', async () => {
        requestQuote.mockResolvedValue(quote({ depositMemo: 'abc123' }));
        await expect(prepareBitcoinSale(request)).rejects.toThrow(/memo/);
    });

    it('passes a venue failure through rather than booking anything', async () => {
        requestQuote.mockRejectedValue(new VenueUnavailableError('flashnet', true, 'down'));
        await expect(prepareBitcoinSale(request)).rejects.toBeInstanceOf(VenueUnavailableError);
    });
});

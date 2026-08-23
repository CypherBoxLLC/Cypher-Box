/**
 * Funding the exit-fee reserve from CoinOS.
 *
 * The two orderings under test are the ones that silently undo the whole point
 * if they are wrong: the reserve must be armed BEFORE the send, or auto-board
 * sweeps the sats back into Ark when they confirm, and the duplicate check must
 * happen BEFORE the send, or a retry after a lost reply pays twice.
 */

import { fundExitFeesFromCoinos } from '../../src/services/ark/exitFundingCoinos';
import { markWithdrawIndeterminate } from '../../src/services/coinos/withdrawGuard';

const ADDR = 'bc1qdph4zqqkvf72nd6uz87q2c5hw9tzapfnkmq93c';
const NOW = 1_700_000_000_000;

function deps(over: Partial<Parameters<typeof fundExitFeesFromCoinos>[1]> = {}) {
    const calls: string[] = [];
    const base = {
        calls,
        getOnchainAddress: jest.fn(async () => {
            calls.push('address');
            return ADDR;
        }),
        getRecentPayments: jest.fn(async () => {
            calls.push('history');
            return { payments: [] };
        }),
        estimateFeeSats: jest.fn(async () => {
            calls.push('fee');
            return 300;
        }),
        send: jest.fn(async () => {
            calls.push('send');
            return JSON.stringify({ txid: 'abc123' });
        }),
        armReserve: jest.fn(() => {
            calls.push('arm');
        }),
        now: () => NOW,
    };
    return { ...base, ...over } as any;
}

const req = (over: Record<string, unknown> = {}) => ({
    shortfallSats: 14_504,
    availableSats: 50_000,
    idempotencyKey: 'cbx-test-key',
    ...over,
});

describe('the happy path', () => {
    it('sends the shortfall and reports the txid', async () => {
        const d = deps();
        const res = await fundExitFeesFromCoinos(req(), d);
        expect(res).toMatchObject({ ok: true, txid: 'abc123', sentSats: 14_504, partial: false });
    });

    it('sends to Bark own on-chain address with the idempotency key', async () => {
        const d = deps();
        await fundExitFeesFromCoinos(req(), d);
        expect(d.send).toHaveBeenCalledWith(ADDR, 14_504, 'cbx-test-key');
    });
});

describe('ordering that must not change', () => {
    it('arms the reserve BEFORE sending', async () => {
        // Otherwise sync.ts boards the sats into Ark the moment they confirm,
        // undoing the top-up the user just paid for.
        const d = deps();
        await fundExitFeesFromCoinos(req(), d);
        expect(d.calls.indexOf('arm')).toBeLessThan(d.calls.indexOf('send'));
    });

    it('checks history BEFORE sending', async () => {
        const d = deps();
        await fundExitFeesFromCoinos(req(), d);
        expect(d.calls.indexOf('history')).toBeLessThan(d.calls.indexOf('send'));
    });

    it('never lowers a reserve the user already set higher', async () => {
        const d = deps();
        await fundExitFeesFromCoinos(req({ currentReserveSats: 100_000 }), d);
        const armed = d.armReserve.mock.calls[0][0];
        expect(armed).toBeGreaterThanOrEqual(100_000);
    });
});

describe('duplicate protection', () => {
    it('refuses when a matching top-up already went out', async () => {
        const d = deps({
            getRecentPayments: async () => ({
                payments: [{ amount: -14_504, created: NOW - 5_000, onchain: { address: ADDR } }],
            }),
        });
        const res = await fundExitFeesFromCoinos(req(), d);
        expect(res).toMatchObject({ ok: false, duplicate: true });
        expect(d.send).not.toHaveBeenCalled();
    });

    it('still sends when history cannot be read', async () => {
        // Not being able to read history is not evidence of a duplicate, and
        // refusing there would strand a user mid-exit.
        const d = deps({
            getRecentPayments: async () => {
                throw new Error('Network request failed');
            },
        });
        const res = await fundExitFeesFromCoinos(req(), d);
        expect(res.ok).toBe(true);
        expect(d.send).toHaveBeenCalled();
    });
});

describe('failures', () => {
    it('surfaces an unknown outcome without claiming failure', async () => {
        const d = deps({
            send: async () => {
                throw markWithdrawIndeterminate('may already have been sent');
            },
        });
        const res = await fundExitFeesFromCoinos(req(), d);
        expect(res).toMatchObject({ ok: false, indeterminate: true });
    });

    it('leaves the reserve armed after an unknown outcome', async () => {
        // If the send DID go through, the sats must not be boarded away when
        // they land. Disarming here would be the worst possible response.
        const d = deps({
            send: async () => {
                throw markWithdrawIndeterminate('unknown');
            },
        });
        await fundExitFeesFromCoinos(req(), d);
        expect(d.armReserve).toHaveBeenCalled();
    });

    it('reports a plain server refusal as itself', async () => {
        const d = deps({ send: async () => 'insufficient funds' });
        const res = await fundExitFeesFromCoinos(req(), d);
        expect(res.ok).toBe(false);
        // Must NOT be flagged indeterminate: the server answered, so nothing
        // was sent and retrying is safe.
        expect(res.ok === false && res.indeterminate).toBeFalsy();
        expect(res.ok === false && res.reason).toMatch(/insufficient funds/i);
    });

    it('refuses when the balance cannot cover the fee', async () => {
        const d = deps({ estimateFeeSats: async () => 900 });
        const res = await fundExitFeesFromCoinos(req({ availableSats: 1_100 }), d);
        expect(res.ok).toBe(false);
        expect(d.send).not.toHaveBeenCalled();
    });

    it('does not send when there is no address', async () => {
        const d = deps({ getOnchainAddress: async () => '' });
        const res = await fundExitFeesFromCoinos(req(), d);
        expect(res.ok).toBe(false);
        expect(d.send).not.toHaveBeenCalled();
    });

    it('proceeds with fee 0 when the estimate fails', async () => {
        // A missing estimate must not block funding; CoinOS charges what it
        // charges either way.
        const d = deps({
            estimateFeeSats: async () => {
                throw new Error('estimate unavailable');
            },
        });
        const res = await fundExitFeesFromCoinos(req(), d);
        expect(res.ok).toBe(true);
    });
});

describe('partial funding', () => {
    it('sends what fits and flags it as partial', async () => {
        const d = deps();
        const res = await fundExitFeesFromCoinos(req({ availableSats: 5_000 }), d);
        expect(res).toMatchObject({ ok: true, partial: true, sentSats: 4_700 });
    });
});

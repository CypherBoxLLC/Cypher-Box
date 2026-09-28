/**
 * The durable record behind a plain USDT send.
 *
 * What this protects, all of it about sending the same money twice or telling
 * the user something untrue about where it went:
 *   - the send is written down before anything is signed, and every signed
 *     transfer is recorded before it is posted, so a send interrupted by the
 *     app closing can be settled against the chain afterwards;
 *   - no new send starts while a signed transfer could still land;
 *   - a failure is only ever called "not sent" when the send module settled
 *     that against the backend or the chain. Anything else is unconfirmed,
 *     stays unconfirmed, and cannot be dismissed;
 *   - resuming checks the newest transfer first, since only one can have
 *     landed, and an unreadable chain leaves it unconfirmed rather than
 *     guessing.
 */

import {
    TronSendError,
    type UsdtSendReceipt,
    type UsdtTransferFate,
} from '../../src/services/tron/send';
import {
    type UsdtSendRecord,
    type UsdtSendRunnerDeps,
    createUsdtSendRunner,
    describeUsdtSend,
} from '../../src/services/tron/sendRun';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

const ACCOUNT = { address: 'TSender', publicKey: '04aa' };

const START = {
    account: ACCOUNT,
    to: 'TRecipient',
    amount: '25',
    amountUnits: '25000000',
    sign: (() => {
        throw new Error('the runner must not sign through the test');
    }) as any,
};

const receipt = (txID: string): UsdtSendReceipt => ({ txID, expirationMs: 1_000 });

function harness(overrides: Partial<UsdtSendRunnerDeps> = {}) {
    let record: UsdtSendRecord | null = null;
    const store = {
        get: () => record,
        set: (next: UsdtSendRecord | null) => {
            record = next;
        },
    };
    let clock = 1_000;
    const deps: UsdtSendRunnerDeps = {
        send: async () => receipt('tx1'),
        confirm: async () => ({ status: 'succeeded' }),
        settleTransfer: async () => ({ status: 'dropped' }) as UsdtTransferFate,
        now: () => (clock += 1),
        newId: () => 'send-1',
        ...overrides,
    };
    return { store, runner: createUsdtSendRunner(store, deps), read: () => record };
}

describe('starting a send', () => {
    it('writes the record before anything is signed', () => {
        const { runner, read } = harness();
        runner.start(START);
        // Synchronously, before the send has had a chance to run.
        const r = read()!;
        expect(r.phase).toBe('sending');
        expect(r.transfers).toEqual([]);
        expect(r.request).toEqual({ amount: '25', destination: 'TRecipient', from: 'TSender' });
    });

    it('records each transfer before it is posted, then reports it landed', async () => {
        const { runner, read } = harness({
            send: async params => {
                params.onSubmit?.({ txID: 'txA', expirationMs: 4_000 });
                return receipt('txA');
            },
        });
        runner.start(START);
        await flush();
        const r = read()!;
        expect(r.transfers).toEqual([{ txID: 'txA', expirationMs: 4_000 }]);
        expect(r.phase).toBe('sent');
        expect(r.txID).toBe('txA');
        expect(r.sendError).toBeUndefined();
    });

    it('refuses a second send while one is under way', () => {
        const { runner } = harness({ send: () => new Promise(() => {}) });
        runner.start(START);
        expect(runner.canStart()).toBe(false);
        expect(() => runner.start(START)).toThrow(/already under way/);
    });
});

describe('a send that fails', () => {
    it('is called not sent only when the module settled that', async () => {
        const { runner, read } = harness({
            send: async () => {
                throw new TronSendError('INSUFFICIENT_USDT', 'none', 'Your USDT balance is lower than this amount.');
            },
        });
        runner.start(START);
        await flush();
        const r = read()!;
        expect(r.phase).toBe('not_sent');
        expect(r.sendError).toEqual({
            code: 'INSUFFICIENT_USDT',
            remedy: 'none',
            message: 'Your USDT balance is lower than this amount.',
        });
    });

    it('stays unconfirmed when the transfer may still land, and never claims nothing moved', async () => {
        const { runner, read } = harness({
            send: async params => {
                params.onSubmit?.({ txID: 'txB', expirationMs: 4_000 });
                throw new TronSendError('OUTCOME_UNKNOWN', 'check_status', 'Could not tell.', { txID: 'txB' });
            },
        });
        runner.start(START);
        await flush();
        const r = read()!;
        expect(r.phase).toBe('unconfirmed');
        expect(r.sendError?.remedy).toBe('check_status');
        expect(r.sendError?.message).not.toMatch(/did not go out/);
        expect(r.sendError?.message).toMatch(/may still land/);
    });

    it('treats an unexpected error after signing as unconfirmed, not as nothing sent', async () => {
        const { runner, read } = harness({
            send: async params => {
                params.onSubmit?.({ txID: 'txC', expirationMs: 4_000 });
                throw new Error('socket closed');
            },
        });
        runner.start(START);
        await flush();
        expect(read()!.phase).toBe('unconfirmed');
    });

    it('treats an unexpected error before signing as nothing sent', async () => {
        const { runner, read } = harness({
            send: async () => {
                throw new Error('could not build the transfer');
            },
        });
        runner.start(START);
        await flush();
        const r = read()!;
        expect(r.phase).toBe('not_sent');
        expect(r.sendError?.message).toMatch(/Nothing was sent/);
    });

    it('blocks a new send while the outcome is unknown', async () => {
        const { runner } = harness({
            send: async params => {
                params.onSubmit?.({ txID: 'txD', expirationMs: 4_000 });
                throw new TronSendError('OUTCOME_UNKNOWN', 'check_status', 'Could not tell.');
            },
        });
        runner.start(START);
        await flush();
        expect(runner.canStart()).toBe(false);
    });
});

describe('resuming an interrupted send', () => {
    const interrupted = (phase: UsdtSendRecord['phase'] = 'sending'): UsdtSendRecord => ({
        id: 'send-1',
        phase,
        startedAtMs: 1,
        updatedAtMs: 1,
        request: { amount: '25', destination: 'TRecipient', from: 'TSender' },
        transfers: [
            { txID: 'old', expirationMs: 2_000 },
            { txID: 'newest', expirationMs: 3_000 },
        ],
    });

    it('checks the newest transfer first, since only one can have landed', async () => {
        const asked: string[] = [];
        const { store, runner, read } = harness({
            settleTransfer: async txID => {
                asked.push(txID);
                return { status: txID === 'newest' ? 'succeeded' : 'dropped' } as UsdtTransferFate;
            },
        });
        store.set(interrupted());
        runner.resume();
        await flush();
        expect(asked).toEqual(['newest']);
        expect(read()!.phase).toBe('sent');
        expect(read()!.txID).toBe('newest');
    });

    it('settles as not sent only once every transfer is known to have dropped', async () => {
        const asked: string[] = [];
        const { store, runner, read } = harness({
            settleTransfer: async txID => {
                asked.push(txID);
                return { status: 'dropped' } as UsdtTransferFate;
            },
        });
        store.set(interrupted());
        runner.resume();
        await flush();
        expect(asked).toEqual(['newest', 'old']);
        expect(read()!.phase).toBe('not_sent');
        expect(read()!.sendError?.message).toMatch(/did not go out/);
    });

    it('leaves it unconfirmed when the chain cannot be read', async () => {
        const { store, runner, read } = harness({
            settleTransfer: async () => {
                throw new TronSendError('TRON_UNREACHABLE', 'retry', 'Could not reach Tron.');
            },
        });
        store.set(interrupted());
        runner.resume();
        await flush();
        expect(read()!.phase).toBe('unconfirmed');
        expect(read()!.sendError?.remedy).toBe('check_status');
    });

    it('resumes a send left unconfirmed by a previous session', async () => {
        const { store, runner, read } = harness({
            settleTransfer: async () => ({ status: 'succeeded' }) as UsdtTransferFate,
        });
        store.set(interrupted('unconfirmed'));
        runner.resume();
        await flush();
        expect(read()!.phase).toBe('sent');
    });

    it('does nothing for a send that already ended', async () => {
        const settleTransfer = jest.fn();
        const { store, runner } = harness({ settleTransfer: settleTransfer as any });
        store.set({ ...interrupted(), phase: 'sent', txID: 'newest' });
        runner.resume();
        await flush();
        expect(settleTransfer).not.toHaveBeenCalled();
    });
});

describe('dismissing', () => {
    it('forgets a send that ended either way', async () => {
        const { runner, read } = harness();
        runner.start(START);
        await flush();
        expect(read()!.phase).toBe('sent');
        expect(runner.dismiss()).toBe(true);
        expect(read()).toBeNull();
    });

    it('refuses to forget one whose transfer may still land', async () => {
        const { runner, read } = harness({
            send: async params => {
                params.onSubmit?.({ txID: 'txE', expirationMs: 4_000 });
                throw new TronSendError('OUTCOME_UNKNOWN', 'check_status', 'Could not tell.');
            },
        });
        runner.start(START);
        await flush();
        expect(runner.dismiss()).toBe(false);
        expect(read()).not.toBeNull();
    });

    it('has nothing to do when there is no record', () => {
        const { runner } = harness();
        expect(runner.dismiss()).toBe(true);
    });
});

describe('a record replaced while work runs', () => {
    it('is not written over by the send it no longer belongs to', async () => {
        let release: (() => void) | undefined;
        const { store, runner, read } = harness({
            send: async () => {
                await new Promise<void>(resolve => {
                    release = resolve;
                });
                return receipt('late');
            },
        });
        runner.start(START);
        // The record is dropped mid-flight, as a dismiss or a wipe would.
        store.set(null);
        release?.();
        await flush();
        expect(read()).toBeNull();
    });
});

describe('what the screen is told', () => {
    const base: UsdtSendRecord = {
        id: 'send-1',
        phase: 'sent',
        startedAtMs: 1,
        updatedAtMs: 2,
        request: { amount: '25', destination: 'TRecipient', from: 'TSender' },
        transfers: [{ txID: 'txA', expirationMs: 3_000 }],
        txID: 'txA',
    };
    const view = (over: Partial<UsdtSendRecord>) => describeUsdtSend({ ...base, ...over });

    it('shows a spinner and no way out while work is running', () => {
        for (const phase of ['sending', 'checking'] as const) {
            const v = view({ phase });
            expect(v.busy).toBe(true);
            expect(v.canRetry).toBe(false);
            expect(v.canCheckAgain).toBe(false);
            expect(v.tone).toBe('working');
        }
    });

    it('reports a completed send with the amount and where it went', () => {
        const v = view({ phase: 'sent' });
        expect(v.tone).toBe('success');
        expect(v.detail).toContain('25 USDT');
        expect(v.detail).toContain('TRecipient');
        expect(v.txID).toBe('txA');
    });

    it('offers a retry only when the module settled that nothing moved', () => {
        const settled = view({
            phase: 'not_sent',
            sendError: { code: 'NOT_SENT', message: 'The transfer did not go out, so no USDT moved.', remedy: 'retry' },
        });
        expect(settled.canRetry).toBe(true);
        expect(settled.canCheckAgain).toBe(false);

        const final = view({
            phase: 'not_sent',
            sendError: { code: 'INSUFFICIENT_USDT', message: 'Balance is lower.', remedy: 'none' },
        });
        expect(final.canRetry).toBe(false);
    });

    it('never offers to send again while a transfer may still land', () => {
        const v = view({
            phase: 'unconfirmed',
            sendError: { code: 'OUTCOME_UNKNOWN', message: 'It may still land.', remedy: 'check_status' },
        });
        expect(v.canRetry).toBe(false);
        expect(v.canCheckAgain).toBe(true);
        expect(v.tone).toBe('problem');
        expect(v.txID).toBe('txA');
    });

    it('carries the newest transfer id even before one has landed', () => {
        const v = describeUsdtSend({
            ...base,
            phase: 'unconfirmed',
            txID: undefined,
            transfers: [{ txID: 'old', expirationMs: 1 }, { txID: 'newest', expirationMs: 2 }],
        });
        expect(v.txID).toBe('newest');
    });
});

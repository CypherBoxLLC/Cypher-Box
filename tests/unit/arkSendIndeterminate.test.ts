/**
 * A Lightning send whose outcome is UNKNOWN must never be reported as failed.
 *
 * When the settlement wait times out with the HTLC still live, send.ts throws
 * deliberately so the caller does not retry: the payment may yet settle. The
 * review screen used to append "Your funds were not moved." to that error and
 * clear isSending, which re-armed Send with the same destination and amount.
 * Retrying an ln-address or ln-offer mints a FRESH invoice with a new payment
 * hash, so the retry can settle alongside the original and pay the recipient
 * twice, irreversibly, once per tap.
 *
 * This is the hardest path to reach on a device: it needs a real Lightning
 * payment still unsettled after 75 seconds, which cannot be conjured on demand.
 * Here the bark handle is faked to never report settlement and the clock is
 * advanced past the deadline, so the branch runs deterministically.
 *
 * The contract under test is that the thrown error carries the indeterminate
 * flag, and that its wording never claims the funds are safe. Callers branch on
 * isArkSendIndeterminate() to decide whether to keep Send disabled.
 */

const LightningSendStatus_Tags = {
    Unknown: 'Unknown',
    InProgress: 'InProgress',
    Paid: 'Paid',
} as const;

const mockHandle = {
    estimateLightningSendFee: jest.fn(),
    payLightningAddress: jest.fn(),
    payLightningInvoice: jest.fn(),
    payLightningOffer: jest.fn(),
    checkLightningPayment: jest.fn(),
    history: jest.fn(),
};

jest.mock('@secondts/bark-react-native', () => ({
    __esModule: true,
    LightningSendStatus_Tags,
    validateArkAddress: jest.fn(() => false),
}));

jest.mock('../../src/services/ark/exit', () => ({
    __esModule: true,
    assertNoActiveArkExit: jest.fn(),
}));

jest.mock('../../src/services/ark/restore', () => ({
    __esModule: true,
    ensureArkWalletHandleReady: jest.fn(async () => mockHandle),
}));

jest.mock('../../src/services/ark/balance', () => ({
    __esModule: true,
    fetchArkBalance: jest.fn(async () => ({ spendableSats: 100_000 })),
}));

jest.mock('../../src/services/ark/vtxos', () => ({
    __esModule: true,
    fetchArkVtxos: jest.fn(async () => ({ spendable: [], all: [] })),
}));

jest.mock('@Cypher/stores/eventLogStore', () => ({
    __esModule: true,
    recordEvent: jest.fn(),
}));

import { executeArkSend, isArkSendIndeterminate } from '../../src/services/ark/send';

const LN_ADDRESS_DEST = { kind: 'ln-address' as const, value: 'someone@example.com' };

beforeEach(() => {
    jest.clearAllMocks();
    mockHandle.estimateLightningSendFee.mockResolvedValue({
        feeSats: 2n,
        grossAmountSats: 1002n,
        netAmountSats: 1000n,
        vtxosSpent: [],
    });
    // Dispatch returns without settling. `Unknown` carries no resolved bolt11,
    // so the wait falls back to the raw destination, which is not a decodable
    // invoice, so no payment hash is available to poll.
    mockHandle.payLightningAddress.mockResolvedValue({ tag: LightningSendStatus_Tags.Unknown });
    // No matching movement ever appears: the HTLC stays live.
    mockHandle.history.mockResolvedValue([]);
    mockHandle.checkLightningPayment.mockResolvedValue({ tag: LightningSendStatus_Tags.Unknown });
});

/**
 * Run a send to completion with the 75s settlement wait collapsed.
 *
 * The wait sleeps on setTimeout between polls and compares Date.now() against a
 * deadline. Under fake timers both are driven by the same clock, so flushing
 * microtasks and then jumping past the deadline lets the loop exit on its next
 * check without waiting in real time.
 */
async function runSendPastDeadline() {
    jest.useFakeTimers();
    try {
        const pending = executeArkSend(LN_ADDRESS_DEST, 1000);
        const caught = pending.catch((e) => e);
        // Let dispatch + the first poll settle, then jump the clock repeatedly
        // so every scheduled poll fires and the deadline check finally fails.
        for (let i = 0; i < 20; i++) {
            await Promise.resolve();
            await Promise.resolve();
            jest.advanceTimersByTime(10_000);
        }
        return await caught;
    } finally {
        jest.useRealTimers();
    }
}

describe('an unsettled Lightning send is reported as indeterminate', () => {
    it('throws rather than resolving, so no caller records a success', async () => {
        const err = await runSendPastDeadline();
        expect(err).toBeInstanceOf(Error);
    });

    it('flags the error so callers can branch without string matching', async () => {
        const err = await runSendPastDeadline();
        expect(isArkSendIndeterminate(err)).toBe(true);
    });

    it('never claims the funds are safe or unmoved', async () => {
        // The exact false statement that used to be the last sentence the user
        // read, while the payment was still in flight.
        const err = await runSendPastDeadline();
        expect(err.message).not.toMatch(/not moved/i);
        expect(err.message).not.toMatch(/funds are safe/i);
        expect(err.message).not.toMatch(/nothing was sent/i);
    });

    it('tells the user not to send again', async () => {
        const err = await runSendPastDeadline();
        expect(err.message).toMatch(/do not send it again/i);
    });

    it('did not retry the payment itself', async () => {
        // A pending outcome must break the retry loop. Re-dispatching to an
        // ln-address mints a new invoice and can pay twice.
        await runSendPastDeadline();
        expect(mockHandle.payLightningAddress).toHaveBeenCalledTimes(1);
    });
});

describe('isArkSendIndeterminate', () => {
    it('is true only for the flagged error', () => {
        const flagged = Object.assign(new Error('may still be in flight'), {
            arkSendIndeterminate: true,
        });
        expect(isArkSendIndeterminate(flagged)).toBe(true);
    });

    it('is false for an ordinary send failure, which MAY say funds are safe', () => {
        // The refunded-after-retries error is a genuine failure. Treating it as
        // indeterminate would disable Send forever after a recoverable error.
        expect(isArkSendIndeterminate(new Error('failed after several attempts and was refunded'))).toBe(false);
    });

    it.each([null, undefined, 'a string', 0, {}, { arkSendIndeterminate: false }])(
        'is false for %p',
        (value) => {
            expect(isArkSendIndeterminate(value)).toBe(false);
        },
    );

    it('is false for a truthy-but-not-true flag, so only the real marker counts', () => {
        expect(isArkSendIndeterminate({ arkSendIndeterminate: 'yes' })).toBe(false);
        expect(isArkSendIndeterminate({ arkSendIndeterminate: 1 })).toBe(false);
    });
});

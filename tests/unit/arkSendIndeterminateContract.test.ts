/**
 * The contract on ArkSendIndeterminateError, pinned.
 *
 * From its docstring in services/ark/send.ts:
 *
 *   "Callers MUST use isArkSendIndeterminate() before reporting an error, and
 *    when it is true they MUST NOT claim the funds are safe and MUST NOT
 *    re-enable their send control."
 *
 * ArkWithdrawReviewScreen honoured neither half until now. It reported a
 * definite failure and called swipeButtonRef.reset(). The screens themselves
 * are not unit-testable here (they pull the native bark binding), so these
 * cover the predicate and the copy rules the screens depend on.
 */

// send.ts imports the native bark binding at module load, which a plain unit
// test cannot resolve. Mock the surface it touches so the REAL predicate is
// exercised rather than a copy of it drifting alongside the original.
jest.mock('@secondts/bark-react-native', () => ({
    LightningSendStatus: {},
    LightningSendStatus_Tags: { Settled: 'Settled', Pending: 'Pending', Failed: 'Failed' },
    validateArkAddress: () => false,
    FeeEstimate: {},
    Network: { Bitcoin: 'Bitcoin' },
    Config: {},
}));

import { isArkSendIndeterminate } from '../../src/services/ark/send';
import {
    arkNetworkFaultMessage,
    classifyArkNetworkFault,
} from '../../src/services/ark/networkFault';

const ENDPOINTS = {
    chainUrls: ['https://blockstream.info/api', 'https://mempool.space/api'],
    arkUrl: 'https://ark.second.tech',
};

const indeterminate = () => {
    const e = new Error(
        'This payment may still be in flight. Do not send it again: wait for your ' +
        'balance to settle, or confirm with the recipient before retrying.',
    ) as Error & { arkSendIndeterminate: true };
    e.arkSendIndeterminate = true;
    return e;
};

describe('recognising an indeterminate outcome', () => {
    it('is true only for the flagged error', () => {
        expect(isArkSendIndeterminate(indeterminate())).toBe(true);
    });

    it('is false for an ordinary failure, so the determinate branch still runs', () => {
        expect(isArkSendIndeterminate(new Error('insufficient funds'))).toBe(false);
    });

    it('does not throw on null, undefined, or a non-error', () => {
        for (const v of [null, undefined, 'string', 0, {}, []]) {
            expect(() => isArkSendIndeterminate(v)).not.toThrow();
            expect(isArkSendIndeterminate(v)).toBe(false);
        }
    });

    it('is not fooled by a merely similar-looking message', () => {
        // The flag is explicit precisely so callers never string-match this.
        expect(isArkSendIndeterminate(new Error('This payment may still be in flight.'))).toBe(false);
    });
});

describe('what an indeterminate outcome must never be told', () => {
    it('carries its own instruction, so a caller need not invent one', () => {
        const msg = indeterminate().message;
        expect(msg).toMatch(/do not send it again/i);
        expect(msg).not.toMatch(/funds are safe|were not moved|failed/i);
    });

    it('must not be overwritten by the network advice, which claims funds are safe', () => {
        // This is why the indeterminate branch bypasses describeArkFailure: the
        // 'ark-server' sentence would invert the one thing it exists to say.
        const arkFault = arkNetworkFaultMessage(
            classifyArkNetworkFault({ message: 'connect to https://ark.second.tech failed' }, ENDPOINTS),
        );
        expect(arkFault).toMatch(/funds are safe/i);
        expect(indeterminate().message).not.toMatch(/funds are safe/i);
    });
});

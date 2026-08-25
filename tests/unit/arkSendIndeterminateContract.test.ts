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

// No SDK mock needed any more: the guard now lives in its own module with no
// bark imports, which is a large part of why it is usable from every call site.
import {
    isArkSendIndeterminate,
    makeIndeterminate,
    runBroadcastCall,
} from '../../src/services/ark/indeterminate';
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

describe('runBroadcastCall: the boundary every broadcasting call now goes through', () => {
    it('passes a success straight through', async () => {
        await expect(runBroadcastCall(async () => 'txid123', 'withdrawal')).resolves.toBe('txid123');
    });

    it('lets a REFUSAL through unchanged, so a real failure still reads as one', async () => {
        const refusal = new Error('insufficient funds');
        await expect(runBroadcastCall(async () => { throw refusal; }, 'withdrawal')).rejects.toBe(refusal);
    });

    it('converts a dropped connection into an indeterminate outcome', async () => {
        let caught: unknown;
        try {
            await runBroadcastCall(async () => { throw new Error('transport error: connection reset'); }, 'withdrawal');
        } catch (e) { caught = e; }
        expect(isArkSendIndeterminate(caught)).toBe(true);
        expect((caught as Error).message).toContain('may already have gone through');
        expect((caught as Error).message).not.toMatch(/were not moved|are unchanged/i);
    });

    it('names the operation in the user\'s own words', async () => {
        for (const what of ['withdrawal', 'payment', 'conversion', 'release', 'claim']) {
            let caught: unknown;
            try {
                await runBroadcastCall(async () => { throw new Error('socket hang up'); }, what);
            } catch (e) { caught = e; }
            expect((caught as Error).message).toContain(what);
        }
    });

    it('never leaks bark vocabulary into the sentence', async () => {
        let caught: unknown;
        try {
            await runBroadcastCall(async () => { throw new Error('dns error'); }, 'conversion');
        } catch (e) { caught = e; }
        expect((caught as Error).message).not.toMatch(/offboard|vtxo|arkoor|bark|psbt/i);
    });

    it('makeIndeterminate always sets the flag callers branch on', () => {
        expect(isArkSendIndeterminate(makeIndeterminate('anything'))).toBe(true);
    });
});

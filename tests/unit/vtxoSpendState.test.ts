import {
    parseNotSpendableError,
    isPermanentlyGone,
    notSpendableMessage,
    barkErrorText,
} from '../../src/services/ark/vtxoSpendState';

/** The exact string a tester's device produced, 2026-09-27. */
const REAL_SPENT =
    "error making payment: bad user input: vtxo " +
    "9ca5532722fffa288e7ea214f54d20b4f2259f49d0520d0afea05a1470beaf4e:0 " +
    "is not spendable (state: spent)";

describe('parseNotSpendableError', () => {
    it('parses the real server message, id and state', () => {
        const v = parseNotSpendableError({ inner: { errorMessage: REAL_SPENT } });
        expect(v).toEqual({
            vtxoId: '9ca5532722fffa288e7ea214f54d20b4f2259f49d0520d0afea05a1470beaf4e:0',
            state: 'spent',
        });
    });

    it('reads the message through cause.inner.errorMessage too', () => {
        const v = parseNotSpendableError({ cause: { inner: { errorMessage: REAL_SPENT } } });
        expect(v?.state).toBe('spent');
    });

    it.each([
        ['unregistered', 'unregistered'],
        ['unclaimed', 'unclaimed'],
        ['htlc_recv_unclaimed', 'htlc_recv_unclaimed'],
    ])('recognises the %s state', (raw, expected) => {
        const msg = `vtxo ${'a'.repeat(64)}:1 is not spendable (state: ${raw})`;
        expect(parseNotSpendableError({ message: msg })?.state).toBe(expected);
    });

    it('falls back to state-only when the server does not name the vtxo', () => {
        const v = parseNotSpendableError({ message: 'is not spendable (state: spent)' });
        expect(v).toEqual({ vtxoId: null, state: 'spent' });
    });

    it('maps an unrecognised state to unknown rather than dropping it', () => {
        const msg = `vtxo ${'b'.repeat(64)}:0 is not spendable (state: some_future_state)`;
        expect(parseNotSpendableError({ message: msg })?.state).toBe('unknown');
    });

    it('returns null for unrelated errors', () => {
        expect(parseNotSpendableError({ message: 'Not enough Ark balance' })).toBeNull();
        expect(parseNotSpendableError(null)).toBeNull();
        expect(parseNotSpendableError({})).toBeNull();
    });
});

describe('isPermanentlyGone', () => {
    it('is true only for spent', () => {
        expect(isPermanentlyGone({ vtxoId: 'x', state: 'spent' })).toBe(true);
    });

    // The whole point of the narrow rule: these resolve on their own, so
    // treating them as gone would delete a live capsule from the balance.
    it.each(['unregistered', 'unclaimed', 'htlc_recv_unclaimed', 'unknown'] as const)(
        'is false for %s',
        (state) => {
            expect(isPermanentlyGone({ vtxoId: 'x', state })).toBe(false);
        },
    );

    it('is false for null', () => {
        expect(isPermanentlyGone(null)).toBe(false);
    });
});

describe('notSpendableMessage', () => {
    it('never leaks the raw server string', () => {
        for (const state of ['spent', 'unregistered', 'unclaimed', 'htlc_recv_unclaimed', 'unknown'] as const) {
            const { title, body } = notSpendableMessage({ vtxoId: null, state });
            expect(title.length).toBeGreaterThan(0);
            expect(body).not.toMatch(/not spendable|state:|bad user input|Exception/i);
        }
    });

    it('has no em-dash in user-facing copy', () => {
        for (const state of ['spent', 'unregistered', 'unclaimed', 'unknown'] as const) {
            const { title, body } = notSpendableMessage({ vtxoId: null, state });
            expect(`${title} ${body}`).not.toContain('—');
        }
    });
});

describe('barkErrorText', () => {
    it('prefers inner.errorMessage over the useless variant tag', () => {
        const err = { message: 'BarkError.Internal', inner: { errorMessage: REAL_SPENT } };
        expect(barkErrorText(err)).toBe(REAL_SPENT);
    });
});

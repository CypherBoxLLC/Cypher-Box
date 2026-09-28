/**
 * What the user enters to send USDT on Tron.
 *
 * What this protects:
 *   - An address for another chain is refused by name. This is the mistake
 *     that actually loses USDT: the ticker is the same on Ethereum, BNB Chain
 *     and Solana, the balances are not, and a transfer is final.
 *   - A Tron address with a wrong character is refused rather than sent, and
 *     is told apart from something that is not an address at all.
 *   - Sending to this wallet's own address is refused.
 *   - An amount over the balance is refused, and an unread balance lets the
 *     amount through for the send itself to check against the chain.
 */

import {
    checkSendAmount,
    classifyTronSendDestination,
    describeSendDestinationProblem,
    isSendableDestination,
} from '../../src/services/tron/sendForm';

/** The USDT contract on Tron, a real mainnet address with a valid checksum. */
const VALID_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const problemOf = (raw: string, own?: string) => {
    const d = classifyTronSendDestination(raw, own);
    return d.kind === 'invalid' ? d.problem : 'VALID';
};

describe('classifyTronSendDestination', () => {
    it('accepts a real Tron address', () => {
        const d = classifyTronSendDestination(VALID_TRON);
        expect(isSendableDestination(d)).toBe(true);
        expect(d.value).toBe(VALID_TRON);
    });

    it('trims and drops a tron: scheme with its query', () => {
        expect(problemOf(`  ${VALID_TRON}  `)).toBe('VALID');
        expect(problemOf(`tron:${VALID_TRON}`)).toBe('VALID');
        expect(problemOf(`tron:${VALID_TRON}?amount=5`)).toBe('VALID');
    });

    it('refuses an address for another chain by name, which is how USDT is lost', () => {
        // Same ticker, different balance, and a transfer cannot be recalled.
        expect(problemOf('0x2170Ed0880ac9A755fd29B2688956BD959F933F8')).toBe('evm_address');
        expect(problemOf('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe('bitcoin_address');
        expect(problemOf('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe('bitcoin_address');
        expect(problemOf('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe('bitcoin_address');
        expect(problemOf('lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq')).toBe('lightning');
    });

    it('tells a mistyped Tron address from something that is not one', () => {
        // Right shape, wrong character: the checksum catches it.
        const mistyped = `${VALID_TRON.slice(0, -1)}${VALID_TRON.slice(-1) === 'a' ? 'b' : 'a'}`;
        expect(problemOf(mistyped)).toBe('bad_checksum');
        expect(problemOf('hello world')).toBe('unrecognised');
        expect(problemOf('')).toBe('empty');
        expect(problemOf('   ')).toBe('empty');
    });

    it('refuses this wallet sending to itself', () => {
        expect(problemOf(VALID_TRON, VALID_TRON)).toBe('own_address');
        expect(problemOf(VALID_TRON, 'TSomeOtherAddress')).toBe('VALID');
        expect(problemOf(VALID_TRON, null as any)).toBe('VALID');
    });

    it('explains every problem it can report, and names the remedy', () => {
        const problems = [
            'empty',
            'own_address',
            'evm_address',
            'bitcoin_address',
            'lightning',
            'bad_checksum',
            'unrecognised',
        ] as const;
        for (const p of problems) {
            const message = describeSendDestinationProblem(p);
            expect(message.length).toBeGreaterThan(10);
            // No em dash in anything a user reads.
            expect(message).not.toContain(String.fromCharCode(0x2014));
        }
        expect(describeSendDestinationProblem('evm_address')).toMatch(/Tron address/);
        expect(describeSendDestinationProblem('bitcoin_address')).toMatch(/Swap/);
    });
});

describe('checkSendAmount', () => {
    it('accepts an amount the balance covers', () => {
        expect(checkSendAmount('10', { balance: '25' })).toEqual({ ok: true });
        expect(checkSendAmount('25', { balance: '25' })).toEqual({ ok: true });
    });

    it('has no minimum, unlike a swap', () => {
        expect(checkSendAmount('0.01', { balance: '25' })).toEqual({ ok: true });
    });

    it('refuses nothing, or nothing above zero', () => {
        expect(checkSendAmount('', { balance: '25' })).toEqual({ ok: false, code: 'EMPTY' });
        expect(checkSendAmount('0', { balance: '25' })).toEqual({ ok: false, code: 'EMPTY' });
        expect(checkSendAmount('abc', { balance: '25' })).toEqual({ ok: false, code: 'EMPTY' });
    });

    it('refuses more than the balance, and reports what there is', () => {
        expect(checkSendAmount('26', { balance: '25' })).toEqual({
            ok: false,
            code: 'INSUFFICIENT_USDT',
            balance: '25',
        });
    });

    it('lets an amount through when the balance could not be read', () => {
        expect(checkSendAmount('1000000', { balance: null })).toEqual({ ok: true });
    });
});

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
    parseTronPaymentRequest,
} from '../../src/services/tron/sendForm';

/**
 * A real mainnet address with a valid checksum.
 *
 * Deliberately NOT the USDT contract, which this file used to use. That is a
 * valid address and it now has its own refusal, so using it here tested the
 * wrong thing: every "a good address is accepted" case would have been
 * asserting against a destination that destroys money.
 */
const VALID_TRON = 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs';

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

/**
 * Scanned payment codes.
 *
 * Tron has no single payment-URI standard, so what a QR contains varies. Two
 * of these shapes are dangerous rather than merely unsupported, and both were
 * found by scanning a real payout code:
 *
 *   - the EIP-681 form puts the TOKEN CONTRACT in the address slot and the
 *     recipient in a parameter, so reading the path alone sends USDT to the
 *     USDT contract, where it is destroyed;
 *   - any code naming two addresses makes the recipient a guess.
 *
 * Both are refused. The amount is a convenience on top of that, never a
 * reason to accept an address we are unsure of.
 */
describe('scanned payment codes', () => {
    const RECIPIENT = 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs';
    const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

    it('reads the amount a code asks for', () => {
        const r = parseTronPaymentRequest(`tron:${RECIPIENT}?amount=5.323`);
        expect(r.destination.kind).toBe('tron');
        expect(r.amount).toBe('5.323');
    });

    it('reads it whatever the case and alongside other parameters', () => {
        expect(parseTronPaymentRequest(`TRON:${RECIPIENT}?amount=5.323&token=USDT`).amount).toBe('5.323');
    });

    it('has no amount when the code did not ask for one', () => {
        expect(parseTronPaymentRequest(RECIPIENT).amount).toBeNull();
        expect(parseTronPaymentRequest(`tron:${RECIPIENT}`).amount).toBeNull();
    });

    it('drops an amount it cannot trust rather than filling the field with it', () => {
        for (const bad of ['0', '-1', 'abc', '1.1234567']) {
            const r = parseTronPaymentRequest(`tron:${RECIPIENT}?amount=${bad}`);
            expect(r.destination.kind).toBe('tron');
            expect(r.amount).toBeNull();
        }
    });

    it('ignores an EIP-681 uint256, whose scale is the contract\'s not ours', () => {
        // 5323000 would be 5.323 at six decimals, but nothing in the code says
        // six, so guessing would be a guess about somebody's money.
        const r = parseTronPaymentRequest(`tron:${RECIPIENT}?uint256=5323000`);
        expect(r.amount).toBeNull();
    });

    it('refuses the token contract, which the EIP-681 shape puts in the address slot', () => {
        const d = classifyTronSendDestination(USDT_CONTRACT);
        expect(d.kind).toBe('invalid');
        expect(d.kind === 'invalid' && d.problem).toBe('token_contract');
        expect(describeSendDestinationProblem('token_contract')).toMatch(/destroyed/);
    });

    it('refuses a code naming two addresses rather than picking one', () => {
        const d = classifyTronSendDestination(`tron:${USDT_CONTRACT}?address=${RECIPIENT}&amount=5.323`);
        expect(d.kind === 'invalid' && d.problem).toBe('ambiguous_request');
        // The same shape with a path, which is what EIP-681 actually writes.
        const withPath = classifyTronSendDestination(
            `tron:${USDT_CONTRACT}/transfer?address=${RECIPIENT}&uint256=5323000`,
        );
        expect(withPath.kind).toBe('invalid');
    });

    it('accepts a code whose parameter agrees with its address', () => {
        const d = classifyTronSendDestination(`tron:${RECIPIENT}?address=${RECIPIENT}&amount=1`);
        expect(d.kind).toBe('tron');
    });

    it('still refuses this wallet sending to itself, however the code is shaped', () => {
        const d = classifyTronSendDestination(`tron:${RECIPIENT}?amount=5`, RECIPIENT);
        expect(d.kind === 'invalid' && d.problem).toBe('own_address');
    });

    it('decodes parameters the way a browser would, and keeps a malformed one rather than dropping it', () => {
        expect(parseTronPaymentRequest(`tron:${RECIPIENT}?amount=%35.323`).amount).toBe('5.323');
        // A malformed escape must not make the second address disappear.
        const d = classifyTronSendDestination(`tron:${USDT_CONTRACT}?address=${RECIPIENT}%zz`);
        expect(d.kind === 'invalid' && d.problem).toBe('ambiguous_request');
    });
});

/**
 * The same checks with React Native's URLSearchParams in place.
 *
 * What this protects, and why it exists: React Native ships its own
 * URLSearchParams, which ignores a string handed to its constructor and throws
 * "not implemented" from get(). Every test above passed on Node while every
 * destination check on the phone threw, and the send review screen failed on
 * device. Had get() merely returned nothing, the refusal of a code naming a
 * second address would have been silently off on the phone. So these run with
 * the phone's version installed and assert the answers are unchanged.
 */
describe("scanned payment codes, with React Native's URLSearchParams", () => {
    const RECIPIENT = 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs';
    const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const runtime = globalThis as unknown as { URLSearchParams: unknown };
    const NodeURLSearchParams = runtime.URLSearchParams;

    /** Like React Native's: whatever the constructor is given is ignored. */
    class PhoneURLSearchParams {
        get(): never {
            throw new Error('URLSearchParams.get is not implemented');
        }
    }

    beforeAll(() => {
        runtime.URLSearchParams = PhoneURLSearchParams;
    });
    afterAll(() => {
        runtime.URLSearchParams = NodeURLSearchParams;
    });

    it('accepts a plain address and reads the amount a code asks for', () => {
        expect(classifyTronSendDestination(RECIPIENT).kind).toBe('tron');
        const r = parseTronPaymentRequest(`tron:${RECIPIENT}?amount=5.323`);
        expect(r.destination.kind).toBe('tron');
        expect(r.amount).toBe('5.323');
    });

    it('still refuses a code naming a second address', () => {
        const d = classifyTronSendDestination(`tron:${USDT_CONTRACT}?address=${RECIPIENT}&amount=5.323`);
        expect(d.kind === 'invalid' && d.problem).toBe('ambiguous_request');
    });
});

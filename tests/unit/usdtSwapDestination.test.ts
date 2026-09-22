/**
 * Where a USDT swap's bitcoin goes: what is recognised, what is refused, and
 * what is asked of Flashnet.
 *
 * What this protects:
 *   - Only the three rails Flashnet pays out to get through, and only on
 *     mainnet. Everything else is refused before a quote is booked, with a
 *     reason the screen can show.
 *   - An invoice that lapses before a swap could pay it is refused, and so is
 *     one asking for a fraction of a sat.
 *   - An invoice that names its amount is paid exactly (exact_out); anything
 *     else sends the USDT the user entered (exact_in).
 *
 * Invoices are signed here with a throwaway key, so their amounts and
 * expiries are exact.
 */

import bolt11 from 'bolt11';

import {
    INVOICE_MIN_REMAINING_MS,
    LIGHTNING_BTC,
    ONCHAIN_BTC,
    classifySwapDestination,
    describeSwapDestinationProblem,
    formatSats,
    labelForSwapDestination,
    planUsdtSwap,
    type SwapDestinationProblem,
    type UsableSwapDestination,
} from '../../src/services/tron/swapDestination';

const SIGNING_KEY = 'e126f68f7eafcc8b74f54d269fe206be715000f94dac067d1c04a8ca3b2db734';
const ISSUED_AT = 1789704360; // seconds
const NOW_MS = (ISSUED_AT + 60) * 1000;

function invoice({
    millisatoshis,
    expirySeconds = 3600,
    network,
}: { millisatoshis?: string; expirySeconds?: number; network?: { bech32: string; pubKeyHash: number; scriptHash: number; validWitnessVersions: number[] } } = {}): string {
    const encoded = bolt11.encode({
        ...(network ? { network } : {}),
        timestamp: ISSUED_AT,
        ...(millisatoshis !== undefined ? { millisatoshis } : {}),
        tags: [
            { tagName: 'payment_hash', data: '0001020304050607080900010203040506070809000102030405060708090102' },
            { tagName: 'payment_secret', data: '1111111111111111111111111111111111111111111111111111111111111111' },
            { tagName: 'description', data: 'swap test' },
            { tagName: 'expire_time', data: expirySeconds },
        ],
    });
    return bolt11.sign(encoded, SIGNING_KEY).paymentRequest as string;
}

const TESTNET = { bech32: 'tb', pubKeyHash: 0x6f, scriptHash: 0xc4, validWitnessVersions: [0, 1] };

const problemOf = (raw: string, now = NOW_MS): SwapDestinationProblem | null => {
    const d = classifySwapDestination(raw, now);
    return d.kind === 'invalid' ? d.problem : null;
};

describe('Lightning invoices', () => {
    it('reads the amount an invoice asks for, in whole sats', () => {
        const d = classifySwapDestination(invoice({ millisatoshis: '100000000' }), NOW_MS);
        expect(d).toMatchObject({ kind: 'ln-invoice', amountSats: '100000' });
    });

    it('leaves an open invoice open, including one written with a zero amount', () => {
        expect(classifySwapDestination(invoice(), NOW_MS)).toMatchObject({ kind: 'ln-invoice', amountSats: null });
        expect(classifySwapDestination(invoice({ millisatoshis: '0' }), NOW_MS)).toMatchObject({
            kind: 'ln-invoice',
            amountSats: null,
        });
    });

    it('takes an invoice in upper case or behind a lightning: scheme, and hands on the lower-case form', () => {
        const lower = invoice({ millisatoshis: '5000000' });
        const upper = classifySwapDestination(`LIGHTNING:${lower.toUpperCase()}`, NOW_MS);
        expect(upper).toMatchObject({ kind: 'ln-invoice', value: lower, amountSats: '5000' });
    });

    it('refuses an invoice asking for a fraction of a sat', () => {
        expect(problemOf(invoice({ millisatoshis: '100000500' }))).toBe('invoice_fraction');
    });

    it('refuses an expired invoice, and one too close to expiry to pay', () => {
        const oneHour = invoice({ expirySeconds: 3600 });
        const expiresAtMs = (ISSUED_AT + 3600) * 1000;
        expect(problemOf(oneHour, expiresAtMs)).toBe('invoice_expired');
        expect(problemOf(oneHour, expiresAtMs - INVOICE_MIN_REMAINING_MS + 1)).toBe('invoice_expiring');
        expect(problemOf(oneHour, expiresAtMs - INVOICE_MIN_REMAINING_MS)).toBeNull();
    });

    it('uses the default hour when an invoice states no expiry', () => {
        // Without defaults, which would add an expiry tag of their own.
        const encoded = bolt11.encode({
            timestamp: ISSUED_AT,
            tags: [
                { tagName: 'payment_hash', data: '0001020304050607080900010203040506070809000102030405060708090102' },
                { tagName: 'description', data: 'no expiry tag' },
            ],
        }, false);
        const noExpiry = bolt11.sign(encoded, SIGNING_KEY).paymentRequest as string;
        const d = classifySwapDestination(noExpiry, NOW_MS);
        expect(d).toMatchObject({ kind: 'ln-invoice', expiresAtMs: (ISSUED_AT + 3600) * 1000 });
    });

    it('refuses a test network invoice by name', () => {
        expect(problemOf(invoice({ network: TESTNET }))).toBe('testnet');
    });

    it('refuses a damaged invoice as unreadable rather than unrecognised', () => {
        const good = invoice({ millisatoshis: '100000000' });
        expect(problemOf(good.slice(0, -4))).toBe('invoice_unreadable');
        expect(problemOf('lnbc1notaninvoice')).toBe('invoice_unreadable');
    });

    it('refuses offers and LNURL, which a swap cannot pay', () => {
        expect(problemOf('lno1qgsqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrc')).toBe('lightning_offer');
        expect(problemOf('LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS')).toBe('lnurl');
    });
});

describe('Lightning addresses', () => {
    it('recognises one as typed, including one that starts like an invoice', () => {
        expect(classifySwapDestination(' satoshi@strike.me ', NOW_MS)).toEqual({ kind: 'ln-address', value: 'satoshi@strike.me' });
        expect(classifySwapDestination('lnbits@example.com', NOW_MS)).toEqual({ kind: 'ln-address', value: 'lnbits@example.com' });
        expect(classifySwapDestination('lightning:satoshi@strike.me', NOW_MS)).toEqual({
            kind: 'ln-address',
            value: 'satoshi@strike.me',
        });
    });

    it('does not take a bare host or a name without one', () => {
        expect(problemOf('satoshi@')).toBe('unrecognised');
        expect(problemOf('strike.me')).toBe('unrecognised');
    });
});

describe('bitcoin addresses', () => {
    it.each([
        ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
        ['3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
        ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
        ['bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'],
        ['bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'],
    ])('recognises the mainnet address %s', address => {
        expect(classifySwapDestination(address, NOW_MS)).toEqual({ kind: 'onchain', value: address });
    });

    it('lower-cases an upper-case bech32 address and drops a bitcoin: scheme and its query', () => {
        expect(classifySwapDestination('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', NOW_MS)).toEqual({
            kind: 'onchain',
            value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        });
        expect(
            classifySwapDestination('bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=0.001&label=x', NOW_MS),
        ).toEqual({ kind: 'onchain', value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' });
    });

    it('refuses test network addresses by name', () => {
        expect(problemOf('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe('testnet');
        expect(problemOf('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe('testnet');
        expect(problemOf('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe('testnet');
    });

    it('refuses a bad checksum, mixed case and future witness versions', () => {
        expect(problemOf('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3')).toBe('unrecognised');
        expect(problemOf('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5')).toBe('unrecognised');
        expect(problemOf('bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe('unrecognised');
        expect(problemOf('bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs')).toBe('unrecognised');
    });
});

describe('everything else', () => {
    it('names a Tron address, the likeliest wrong paste from this wallet', () => {
        expect(problemOf('TNrDPeCdW8CFQqkM6uJxT381MhJyusgaJq')).toBe('tron_address');
    });

    it('treats blank input as empty and noise as unrecognised', () => {
        expect(problemOf('   ')).toBe('empty');
        expect(problemOf('lightning:')).toBe('empty');
        expect(problemOf('hello')).toBe('unrecognised');
    });

    it('has copy for every problem, with no em dash', () => {
        const problems: SwapDestinationProblem[] = [
            'empty',
            'unrecognised',
            'testnet',
            'invoice_unreadable',
            'invoice_expired',
            'invoice_expiring',
            'invoice_fraction',
            'lightning_offer',
            'lnurl',
            'tron_address',
        ];
        for (const problem of problems) {
            const copy = describeSwapDestinationProblem(problem);
            expect(copy.length).toBeGreaterThan(10);
            expect(copy).not.toContain('\u2014');
        }
    });
});

describe('planUsdtSwap', () => {
    const address: UsableSwapDestination = { kind: 'ln-address', value: 'satoshi@strike.me' };
    const onchain: UsableSwapDestination = { kind: 'onchain', value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' };
    const openInvoice: UsableSwapDestination = { kind: 'ln-invoice', value: 'lnbc1open', amountSats: null, expiresAtMs: 0 };
    const fixedInvoice: UsableSwapDestination = { kind: 'ln-invoice', value: 'lnbc1fixed', amountSats: '100000', expiresAtMs: 0 };

    it('sends the entered USDT to a Lightning address or open invoice, over Lightning', () => {
        expect(planUsdtSwap('150', address)).toEqual({
            settle: LIGHTNING_BTC,
            settleAddress: 'satoshi@strike.me',
            mode: 'exact_in',
            amount: '150',
        });
        expect(planUsdtSwap('150.5', openInvoice)).toMatchObject({ settle: LIGHTNING_BTC, mode: 'exact_in', amount: '150.5' });
    });

    it('settles on chain to a bitcoin address', () => {
        expect(planUsdtSwap('200', onchain)).toEqual({
            settle: ONCHAIN_BTC,
            settleAddress: onchain.value,
            mode: 'exact_in',
            amount: '200',
        });
    });

    it('pays an invoice with an amount exactly, in bitcoin, whatever USDT was entered', () => {
        expect(planUsdtSwap('150', fixedInvoice)).toEqual({
            settle: LIGHTNING_BTC,
            settleAddress: 'lnbc1fixed',
            mode: 'exact_out',
            amount: '0.001',
        });
    });

    it('drops a trailing point from a typed amount', () => {
        expect(planUsdtSwap('150.', address).amount).toBe('150');
    });
});

describe('labels', () => {
    it('names each rail, and an invoice by its amount when it has one', () => {
        expect(labelForSwapDestination({ kind: 'ln-invoice', value: 'x', amountSats: '1234567', expiresAtMs: 0 })).toBe(
            'Lightning invoice for 1,234,567 sats',
        );
        expect(labelForSwapDestination({ kind: 'ln-invoice', value: 'x', amountSats: null, expiresAtMs: 0 })).toBe(
            'Lightning invoice',
        );
        expect(labelForSwapDestination({ kind: 'ln-address', value: 'x' })).toBe('Lightning address');
        expect(labelForSwapDestination({ kind: 'onchain', value: 'x' })).toBe('Bitcoin address');
    });

    it('formats sats whole and grouped, rounding down', () => {
        expect(formatSats('100000')).toBe('100,000');
        expect(formatSats(1044.9)).toBe('1,044');
    });
});

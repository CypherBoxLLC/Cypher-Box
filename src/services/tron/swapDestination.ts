/**
 * Where the bitcoin from a USDT swap goes, read from what the user entered.
 *
 * A swap pays out to one of three things, the ones Flashnet settles to from
 * USDT on Tron: a Lightning invoice, a Lightning address or a bitcoin address.
 * Anything else is refused here with a reason the screen can show, before a
 * quote is booked. A quote holds a deposit address for two minutes whether or
 * not it is used, so a destination Flashnet would reject costs the user a wait
 * and a quote for nothing.
 *
 * Mainnet only: a test network invoice or address is refused by name, which is
 * clearer than the error Flashnet would give.
 *
 * Pure, with no network and no React Native, so every rule is unit-tested. The
 * same shape as classifyArkDestination, for a different set of rails.
 */

import BigNumber from 'bignumber.js';
import * as bitcoin from 'bitcoinjs-lib';
import bolt11 from 'bolt11';

import type { ChainAsset, ChainSwapAmountMode } from '../chainSwap/types';
import { asset } from '../chainSwap/types';
import { isValidTronAddress } from './address';

/** Bitcoin as a swap pays it out. */
export const LIGHTNING_BTC: ChainAsset = asset('btc', 'lightning');
export const ONCHAIN_BTC: ChainAsset = asset('btc', 'bitcoin');

/**
 * Time an invoice must have left for a swap to pay it. A swap takes a few
 * minutes end to end: the quote, the deposit landing in a block, Flashnet
 * detecting it (about 20 seconds on the first mainnet conversion) and paying
 * out. An invoice that lapses in the middle fails the payout, and the deposit
 * comes back less its fees.
 */
export const INVOICE_MIN_REMAINING_MS = 10 * 60_000;

/** BOLT11's expiry when an invoice does not state one. */
const INVOICE_DEFAULT_EXPIRY_SECONDS = 3600;

const LIGHTNING_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mainnet base58 address versions: pay to public key hash, pay to script hash. */
const BASE58_MAINNET = new Set([0x00, 0x05]);
const BASE58_TESTNET = new Set([0x6f, 0xc4]);

export type SwapDestinationProblem =
    | 'empty'
    | 'unrecognised'
    /** An invoice or address for a test network. */
    | 'testnet'
    /** Starts like an invoice but does not decode: a truncated copy, usually. */
    | 'invoice_unreadable'
    | 'invoice_expired'
    /** Valid now, but it lapses before a swap could pay it. */
    | 'invoice_expiring'
    /** Asks for a fraction of a sat, which a swap cannot pay exactly. */
    | 'invoice_fraction'
    | 'lightning_offer'
    | 'lnurl'
    | 'tron_address';

export type SwapDestination =
    | {
          readonly kind: 'ln-invoice';
          /** Lower case: bech32 reads the same either way, and QR codes are often upper case. */
          readonly value: string;
          /** Whole sats the invoice asks for, or null when it leaves the amount open. */
          readonly amountSats: string | null;
          readonly expiresAtMs: number;
      }
    | { readonly kind: 'ln-address'; readonly value: string }
    | { readonly kind: 'onchain'; readonly value: string }
    | { readonly kind: 'invalid'; readonly value: string; readonly problem: SwapDestinationProblem };

/** A destination a swap can pay out to. */
export type UsableSwapDestination = Exclude<SwapDestination, { kind: 'invalid' }>;

export const isUsableSwapDestination = (d: SwapDestination): d is UsableSwapDestination => d.kind !== 'invalid';

const invalid = (value: string, problem: SwapDestinationProblem): SwapDestination => ({
    kind: 'invalid',
    value,
    problem,
});

/** Drop a URI scheme: `lightning:` before an invoice or address, `bitcoin:` and its query before an address. */
function stripScheme(value: string): string {
    if (/^lightning:/i.test(value)) {
        return value.slice('lightning:'.length).trim();
    }
    if (/^bitcoin:/i.test(value)) {
        return value.slice('bitcoin:'.length).split('?')[0].trim();
    }
    return value;
}

function classifyInvoice(invoice: string, nowMs: number): SwapDestination {
    let decoded: ReturnType<typeof bolt11.decode>;
    try {
        decoded = bolt11.decode(invoice);
    } catch {
        return invalid(invoice, 'invoice_unreadable');
    }
    if (decoded.network?.bech32 !== 'bc') {
        return invalid(invoice, 'testnet');
    }
    const timestamp = decoded.timestamp ?? 0;
    const expiresAtMs = (decoded.timeExpireDate ?? timestamp + INVOICE_DEFAULT_EXPIRY_SECONDS) * 1000;
    if (nowMs >= expiresAtMs) {
        return invalid(invoice, 'invoice_expired');
    }
    if (expiresAtMs - nowMs < INVOICE_MIN_REMAINING_MS) {
        return invalid(invoice, 'invoice_expiring');
    }
    let amountSats: string | null = null;
    if (decoded.millisatoshis) {
        const msat = new BigNumber(decoded.millisatoshis);
        if (!msat.isInteger() || !msat.modulo(1000).isZero()) {
            return invalid(invoice, 'invoice_fraction');
        }
        // A zero amount is how some wallets write an open one.
        amountSats = msat.isZero() ? null : msat.dividedBy(1000).toFixed(0);
    }
    return { kind: 'ln-invoice', value: invoice, amountSats, expiresAtMs };
}

/** A mainnet bitcoin address, as the value to pay out to, or the reason it is not one. */
function classifyAddress(value: string): SwapDestination | null {
    try {
        const { version, hash } = bitcoin.address.fromBase58Check(value);
        if (hash.length === 20 && BASE58_MAINNET.has(version)) {
            return { kind: 'onchain', value };
        }
        return BASE58_TESTNET.has(version) ? invalid(value, 'testnet') : null;
    } catch {
        // Not base58; try bech32 below.
    }
    try {
        const { prefix, version, data } = bitcoin.address.fromBech32(value);
        if (prefix !== 'bc') {
            return prefix === 'tb' || prefix === 'bcrt' ? invalid(value, 'testnet') : null;
        }
        // Segwit v0 (20 or 32 bytes) and taproot. Later witness versions are
        // not in use, and nothing promises Flashnet pays to one.
        const usable = (version === 0 && (data.length === 20 || data.length === 32)) || (version === 1 && data.length === 32);
        return usable ? { kind: 'onchain', value: value.toLowerCase() } : null;
    } catch {
        return null;
    }
}

/**
 * Read a destination the user typed, pasted or scanned.
 *
 * `nowMs` decides whether an invoice has time left; it is a parameter so the
 * rule can be tested against fixed invoices.
 */
export function classifySwapDestination(raw: string, nowMs: number = Date.now()): SwapDestination {
    const value = stripScheme(raw.trim());
    if (!value) {
        return invalid(value, 'empty');
    }
    const lower = value.toLowerCase();

    // First, because a Lightning address can start with "ln" too (lnbits@...),
    // and nothing bech32 below contains an @.
    if (LIGHTNING_ADDRESS.test(value)) {
        return { kind: 'ln-address', value };
    }
    if (lower.startsWith('lnurl')) {
        return invalid(value, 'lnurl');
    }
    if (lower.startsWith('lno')) {
        return invalid(value, 'lightning_offer');
    }
    if (lower.startsWith('ln')) {
        return classifyInvoice(lower, nowMs);
    }
    if (isValidTronAddress(value)) {
        return invalid(value, 'tron_address');
    }
    return classifyAddress(value) ?? invalid(value, 'unrecognised');
}

/** What to ask Flashnet for, from the amount and a usable destination. */
export type UsdtSwapPlan = {
    readonly settle: ChainAsset;
    readonly settleAddress: string;
    readonly mode: ChainSwapAmountMode;
    /** Decimal string: USDT on exact_in, bitcoin on exact_out. */
    readonly amount: string;
};

/**
 * Plan the conversion.
 *
 * The user's USDT amount is what they send (exact_in), except for an invoice
 * that names its own amount. That invoice can only be paid exactly, so the
 * swap works backwards from it (exact_out) and the USDT needed comes from the
 * quote. The screen says so before the user continues.
 */
export function planUsdtSwap(usdtAmount: string, destination: UsableSwapDestination): UsdtSwapPlan {
    if (destination.kind === 'ln-invoice' && destination.amountSats !== null) {
        return {
            settle: LIGHTNING_BTC,
            settleAddress: destination.value,
            mode: 'exact_out',
            amount: new BigNumber(destination.amountSats).shiftedBy(-8).toFixed(),
        };
    }
    return {
        settle: destination.kind === 'onchain' ? ONCHAIN_BTC : LIGHTNING_BTC,
        settleAddress: destination.value,
        mode: 'exact_in',
        amount: new BigNumber(usdtAmount).toFixed(),
    };
}

/** Whole sats, grouped: "100,000". */
export function formatSats(sats: string | number): string {
    return new BigNumber(sats).integerValue(BigNumber.ROUND_DOWN).toFormat(0);
}

/** A short name for what was recognised, for the pill under the field and the review. */
export function labelForSwapDestination(destination: UsableSwapDestination): string {
    switch (destination.kind) {
        case 'ln-invoice':
            return destination.amountSats !== null
                ? `Lightning invoice for ${formatSats(destination.amountSats)} sats`
                : 'Lightning invoice';
        case 'ln-address':
            return 'Lightning address';
        case 'onchain':
            return 'Bitcoin address';
    }
}

/** What is wrong, and what to do about it. */
export function describeSwapDestinationProblem(problem: SwapDestinationProblem): string {
    switch (problem) {
        case 'empty':
            return 'Paste or scan a Lightning invoice, a Lightning address or a bitcoin address.';
        case 'testnet':
            return 'This is for a test network, not real bitcoin. Use a mainnet bitcoin address or Lightning invoice.';
        case 'invoice_unreadable':
            return 'This invoice could not be read. Copy it again in full.';
        case 'invoice_expired':
            return 'This invoice has expired. Ask for a new one.';
        case 'invoice_expiring':
            return 'This invoice expires in less than 10 minutes, too soon for a swap to pay it. Ask for a new one.';
        case 'invoice_fraction':
            return 'This invoice asks for a fraction of a sat, which a swap cannot pay exactly. Ask for one in whole sats.';
        case 'lightning_offer':
            return 'A swap cannot pay a Lightning offer yet. Use a Lightning invoice or a Lightning address.';
        case 'lnurl':
            return 'A swap cannot pay an LNURL link. Use a Lightning invoice or a Lightning address.';
        case 'tron_address':
            return 'This is a Tron address. A swap sends bitcoin, so use a bitcoin address or a Lightning invoice or address.';
        case 'unrecognised':
        default:
            return 'This is not a Lightning invoice, a Lightning address or a bitcoin address. Check it and try again.';
    }
}

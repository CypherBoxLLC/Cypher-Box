/**
 * What the user enters to send USDT on Tron: where it goes, and how much.
 *
 * Both rules are pure and unit-tested, because both decide whether money
 * leaves and where to. A Tron transfer is final and unaddressed to anyone we
 * can ask for it back, so a destination is refused here by name rather than
 * sent and regretted: the most likely mistakes are pasting an address for a
 * different chain, which is where USDT is actually lost, and pasting an
 * address whose checksum does not hold.
 *
 * The same shape as swapDestination, for a different set of rails.
 */

import BigNumber from 'bignumber.js';

import { isValidTronAddress } from './address';
import { USDT_DECIMALS, USDT_TRC20_CONTRACT } from './constants';

export type SendDestinationProblem =
    | 'empty'
    /** A well formed Tron address, but this wallet's own. */
    | 'own_address'
    /** An Ethereum, BNB Chain or other EVM address: USDT there is not this USDT. */
    | 'evm_address'
    | 'bitcoin_address'
    | 'lightning'
    /** Shaped like a Tron address but the checksum fails, so a character is wrong. */
    | 'bad_checksum'
    /**
     * The USDT contract itself. Some payment URIs put the token contract in the
     * address slot and the real recipient in a parameter, so this is reachable
     * by scanning rather than by typing, and sending there burns the money.
     */
    | 'token_contract'
    /**
     * A request that names more than one address, so which one is the
     * recipient is a guess. Refused rather than guessed.
     */
    | 'ambiguous_request'
    | 'unrecognised';

export type SendDestination =
    | { readonly kind: 'tron'; readonly value: string }
    | { readonly kind: 'invalid'; readonly value: string; readonly problem: SendDestinationProblem };

export const isSendableDestination = (d: SendDestination): d is { kind: 'tron'; value: string } => d.kind === 'tron';

const invalid = (value: string, problem: SendDestinationProblem): SendDestination => ({ kind: 'invalid', value, problem });

/**
 * A scanned or pasted request, split into the part that names where the money
 * goes and the parameters that came with it.
 *
 * Tron has no single payment-URI standard the way bitcoin does. What is in the
 * wild includes a bare address, `tron:<address>` with an `amount`, and the
 * EIP-681 shape `tron:<contract>/transfer?address=<to>&uint256=<units>`, where
 * the address in the path is the TOKEN and the recipient is a parameter. That
 * last one is why the query cannot simply be thrown away: reading only the
 * path would send USDT to the USDT contract.
 */
type ParsedRequest = { readonly path: string; readonly params: URLSearchParams };

function parseRequest(value: string): ParsedRequest {
    const withoutScheme = /^tron:/i.test(value) ? value.slice('tron:'.length).trim() : value;
    const cut = withoutScheme.indexOf('?');
    if (cut === -1) {
        return { path: withoutScheme, params: new URLSearchParams() };
    }
    let params: URLSearchParams;
    try {
        params = new URLSearchParams(withoutScheme.slice(cut + 1));
    } catch {
        params = new URLSearchParams();
    }
    return { path: withoutScheme.slice(0, cut).trim(), params };
}

/** The address a request's parameters name, when they name one. */
function recipientParam(params: URLSearchParams): string | null {
    for (const key of ['address', 'to', 'recipient']) {
        const value = params.get(key)?.trim();
        if (value) return value;
    }
    return null;
}

/**
 * Read a destination the user typed, pasted or scanned.
 *
 * `ownAddress` is this wallet's own Tron address when it is known. Sending to
 * yourself is refused: it costs a transfer's network fee to move nothing, and
 * it is almost always a paste of the wrong half of the screen.
 */
export function classifyTronSendDestination(raw: string, ownAddress?: string | null): SendDestination {
    const { path, params } = parseRequest(raw.trim());

    // A request that names a recipient in its parameters is either the EIP-681
    // token shape, where the path is the contract, or something we do not
    // recognise. Either way two addresses are on offer and picking one is a
    // guess, so it is refused unless they agree.
    const named = recipientParam(params);
    if (named && named !== path) {
        return invalid(path || named, 'ambiguous_request');
    }

    const value = path;
    if (!value) {
        return invalid(value, 'empty');
    }
    const lower = value.toLowerCase();

    // Before the address check, because it IS a valid address. Sending USDT to
    // the USDT contract is never what anyone meant and cannot be undone.
    if (value === USDT_TRC20_CONTRACT) {
        return invalid(value, 'token_contract');
    }

    // Named before the generic checks, so each gets its own explanation.
    if (/^0x[0-9a-f]{40}$/i.test(value)) {
        return invalid(value, 'evm_address');
    }
    if (lower.startsWith('lnbc') || lower.startsWith('lightning:') || lower.startsWith('lnurl')) {
        return invalid(value, 'lightning');
    }
    if (/^(bc1|tb1)[0-9a-z]{6,}$/i.test(value) || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(value)) {
        return invalid(value, 'bitcoin_address');
    }

    if (isValidTronAddress(value)) {
        return ownAddress && value === ownAddress ? invalid(value, 'own_address') : { kind: 'tron', value };
    }
    // Tron mainnet addresses are 34 base58 characters starting with T. Getting
    // that far and failing means a character is wrong, which is worth saying,
    // rather than "this is not an address".
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) {
        return invalid(value, 'bad_checksum');
    }
    return invalid(value, 'unrecognised');
}

/** What is wrong, and what to do about it. */
export function describeSendDestinationProblem(problem: SendDestinationProblem): string {
    switch (problem) {
        case 'empty':
            return 'Paste or scan the Tron address to send to.';
        case 'own_address':
            return 'This is this wallet\'s own address. Enter the address you want to send to.';
        case 'evm_address':
            return 'This is an Ethereum-style address, used by Ethereum and BNB Chain. USDT on those networks is a different balance and cannot be sent from here. Use a Tron address, starting with T.';
        case 'bitcoin_address':
            return 'This is a bitcoin address. This wallet sends USDT on Tron, so use a Tron address, starting with T. To turn USDT into bitcoin, use Swap instead.';
        case 'lightning':
            return 'This is a Lightning invoice. To turn USDT into bitcoin over Lightning, use Swap instead.';
        case 'bad_checksum':
            return 'This looks like a Tron address but one character is wrong, so it would not arrive. Copy it again in full.';
        case 'token_contract':
            return 'This is the USDT contract itself, not a wallet. USDT sent there is destroyed. Use the receiving wallet\'s own Tron address.';
        case 'ambiguous_request':
            return 'This payment code names more than one address, so it is not clear which one should receive the USDT. Ask for the plain Tron address instead.';
        case 'unrecognised':
        default:
            return 'This is not a Tron address. A Tron address is 34 characters and starts with T.';
    }
}

export type SendAmountCheck =
    | { readonly ok: true }
    | { readonly ok: false; readonly code: 'EMPTY' }
    /** More than the wallet holds. */
    | { readonly ok: false; readonly code: 'INSUFFICIENT_USDT'; readonly balance: string };

/**
 * Whether an amount can be sent.
 *
 * There is no minimum: unlike a swap, a plain transfer has no venue floor, and
 * the network cost does not come out of the amount. The balance is optional:
 * when it could not be read the amount is let through, and the send itself
 * checks it against the chain before anything is signed.
 */
export function checkSendAmount(amount: string, limits: { readonly balance: string | null }): SendAmountCheck {
    const n = new BigNumber(amount);
    if (!amount || !n.isFinite() || !n.isGreaterThan(0)) {
        return { ok: false, code: 'EMPTY' };
    }
    if (limits.balance !== null && n.isGreaterThan(limits.balance)) {
        return { ok: false, code: 'INSUFFICIENT_USDT', balance: new BigNumber(limits.balance).toFixed() };
    }
    return { ok: true };
}

/**
 * A scanned payment request: where it pays, and how much it asks for.
 *
 * The amount is read only from a plain decimal `amount` parameter. An EIP-681
 * `uint256` is deliberately ignored: its scale depends on the contract it was
 * written for, and reading it as USDT's six decimals would be a guess about
 * somebody's money. A request carrying one still hands over its address, and
 * the user types the amount.
 */
export type ScannedPaymentRequest = {
    readonly destination: SendDestination;
    /** Decimal USDT the code asked for, when it asked for something usable. */
    readonly amount: string | null;
};

export function parseTronPaymentRequest(raw: string, ownAddress?: string | null): ScannedPaymentRequest {
    const destination = classifyTronSendDestination(raw, ownAddress);
    const { params } = parseRequest(raw.trim());
    const asked = params.get('amount')?.trim();
    if (!asked) {
        return { destination, amount: null };
    }
    const n = new BigNumber(asked);
    // Anything not a positive number this chain can carry is dropped rather
    // than shown: a wrong amount in the field is worse than an empty one.
    if (!n.isFinite() || !n.isGreaterThan(0) || (n.decimalPlaces() ?? 0) > USDT_DECIMALS) {
        return { destination, amount: null };
    }
    return { destination, amount: n.toFixed() };
}

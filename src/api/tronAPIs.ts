/**
 * tronAPIs: the Tron calls the USDT balance, receive and send flows need.
 *
 * Reads go straight to a public Tron node, since none of them needs a
 * credential. What they do need is care in two places:
 *   - Balances are decimal strings end to end. A TRC20 balance does not fit a
 *     JS number, and a rounded balance is how a UI offers to send more than
 *     exists.
 *   - An address that has never been used does not exist on chain. That is an
 *     ordinary state for a fresh wallet, not an error, and it also costs more
 *     to send to, which the send flow has to know.
 *
 * A send goes through our backend instead (postTronSend). Our users hold no
 * TRX to pay a transfer's network fee, so the backend rents the energy it
 * needs and broadcasts it. The phone still builds and signs every transfer.
 *
 * Nothing here logs. A Tron address is a lasting identifier for one user, and
 * putting it in device logs is the kind of privacy leak that never gets found.
 */

import { Buffer } from 'buffer';

import {
    BALANCE_OF_SELECTOR,
    decodeUint256,
    encodeBalanceOfParameter,
    unitsToDecimal,
} from '../services/tron/contract';
import { TRX_DECIMALS, USDT_DECIMALS, USDT_TRC20_CONTRACT } from '../services/tron/constants';
import { tronAddressToHex } from '../services/tron/address';
import type { TronReferenceBlock } from '../services/tron/transaction';

const TRONGRID_URL = 'https://api.trongrid.io';
const DEFAULT_TIMEOUT_MS = 15_000;

export type TronRequestOptions = { timeoutMs?: number };

/** A node call that did not answer usefully. Message is safe to show. */
export class TronApiError extends Error {
    constructor(message: string, readonly retryable = true) {
        super(message);
        this.name = 'TronApiError';
    }
}

type Json = Record<string, unknown>;

/**
 * TronGrid without a key answers 429 past 3 requests a second from one IP and
 * refuses that IP for the next 3 seconds (its own error text, 2026-09-19). A
 * phone can hit that without doing anything wrong, behind a mobile IP it
 * shares, so a 429 is waited out and asked again within the request's
 * timeout rather than reported as the network being unreachable.
 */
const RATE_LIMITED_WAIT_MS = 3_200;
const RATE_LIMITED_RETRIES = 2;

async function post(path: string, body: Json, opts: TronRequestOptions): Promise<Json> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        for (let retries = 0; ; retries += 1) {
            const response = await fetch(`${TRONGRID_URL}${path}`, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            }).catch(() => {
                throw new TronApiError('Could not reach the Tron network, check your connection');
            });

            if (response.status === 429) {
                if (retries < RATE_LIMITED_RETRIES && deadline - Date.now() > RATE_LIMITED_WAIT_MS) {
                    await new Promise(resolve => setTimeout(resolve, RATE_LIMITED_WAIT_MS));
                    continue;
                }
                throw new TronApiError('The Tron network is busy, try again in a few seconds');
            }

            let parsed: unknown = null;
            try {
                parsed = await response.json();
            } catch {
                parsed = null;
            }
            if (!response.ok || parsed === null || typeof parsed !== 'object') {
                throw new TronApiError('The Tron network did not answer, try again shortly');
            }
            return parsed as Json;
        }
    } finally {
        clearTimeout(timeoutId);
    }
}

/** Node errors arrive as hex-encoded text inside a 200 response. */
function decodeNodeMessage(message: unknown): string | null {
    if (typeof message !== 'string' || message.length === 0) return null;
    if (/^[0-9a-fA-F]+$/.test(message) && message.length % 2 === 0) {
        const text = Buffer.from(message, 'hex').toString('utf8');
        if (/^[\x20-\x7e\s]+$/.test(text)) return text;
    }
    return message;
}

/**
 * The user's USDT balance, as a decimal string.
 *
 * A constant call, so it costs nothing and needs no key. An address with no
 * USDT, including one that has never been used, answers zero rather than
 * failing.
 */
export async function getTronUsdtBalance(
    address: string,
    opts: TronRequestOptions = {},
): Promise<string> {
    const ownerHex = tronAddressToHex(address);
    const body = await post(
        '/wallet/triggerconstantcontract',
        {
            owner_address: ownerHex,
            contract_address: tronAddressToHex(USDT_TRC20_CONTRACT),
            function_selector: BALANCE_OF_SELECTOR,
            parameter: encodeBalanceOfParameter(ownerHex),
            visible: false,
        },
        opts,
    );

    const result = body.result as { result?: boolean; message?: unknown } | undefined;
    const constantResult = body.constant_result;
    if (!Array.isArray(constantResult) || typeof constantResult[0] !== 'string') {
        const message = decodeNodeMessage(result?.message) ?? decodeNodeMessage(body.Error);
        throw new TronApiError(message || 'The Tron network could not read this balance');
    }
    return unitsToDecimal(decodeUint256(constantResult[0]), USDT_DECIMALS);
}

export type TronAccountState = {
    /**
     * Whether the address exists on chain. A fresh address does not, which is
     * normal, and it makes the first transfer into it cost the sender more.
     */
    readonly activated: boolean;
    /** TRX balance as a decimal string, for fees. */
    readonly trxBalance: string;
    /** Energy available now, which decides whether a send needs rented energy. */
    readonly energyAvailable: number;
    /** Free plus staked bandwidth available now. */
    readonly bandwidthAvailable: number;
    /**
     * The two bandwidth sources separately. A transaction draws its whole size
     * from one of them or burns TRX for all of it, so 200 free plus 200 staked
     * does not cover a 345 byte transfer.
     */
    readonly freeBandwidth: number;
    readonly stakedBandwidth: number;
    /**
     * What decides when free bandwidth covers a transfer again: usage as the
     * node reports it, already decayed to now, the daily allowance, and when
     * the account last used any, in ms (zero when never).
     */
    readonly freeBandwidthUsed: number;
    readonly freeBandwidthLimit: number;
    readonly lastFreeBandwidthUseMs: number;
};

const asNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * What it costs this address to transact: whether it exists, its TRX, and the
 * energy and bandwidth it already has.
 *
 * Two calls, because the node splits them, and a missing field means zero
 * rather than missing data: the node omits counters that are at zero.
 */
export async function getTronAccountState(
    address: string,
    opts: TronRequestOptions = {},
): Promise<TronAccountState> {
    const hex = tronAddressToHex(address);
    const [account, resource] = await Promise.all([
        post('/wallet/getaccount', { address: hex, visible: false }, opts),
        post('/wallet/getaccountresource', { address: hex, visible: false }, opts),
    ]);

    // An unused address answers with an empty object, which is why presence of
    // the address field is the test rather than the balance being above zero.
    const activated = typeof account.address === 'string' && account.address.length > 0;
    const sun = asNumber(account.balance);

    const energy = asNumber(resource.EnergyLimit) - asNumber(resource.EnergyUsed);
    const freeNet = asNumber(resource.freeNetLimit) - asNumber(resource.freeNetUsed);
    const stakedNet = asNumber(resource.NetLimit) - asNumber(resource.NetUsed);

    return {
        activated,
        trxBalance: unitsToDecimal(String(sun), TRX_DECIMALS),
        energyAvailable: Math.max(0, energy),
        bandwidthAvailable: Math.max(0, freeNet) + Math.max(0, stakedNet),
        freeBandwidth: Math.max(0, freeNet),
        stakedBandwidth: Math.max(0, stakedNet),
        freeBandwidthUsed: asNumber(resource.freeNetUsed),
        freeBandwidthLimit: asNumber(resource.freeNetLimit),
        lastFreeBandwidthUseMs: asNumber(account.latest_consume_free_time),
    };
}

const HEX_64 = /^[0-9a-fA-F]{64}$/;

/**
 * A recent block to anchor a transaction to.
 *
 * Asks for the header only: the full block carries every transaction in it
 * and runs to hundreds of kilobytes. The builder checks the id against the
 * height, since a Tron block id begins with it.
 */
export async function getTronReferenceBlock(opts: TronRequestOptions = {}): Promise<TronReferenceBlock> {
    const body = await post('/wallet/getblock', { detail: false }, opts);
    const header = (body.block_header as { raw_data?: { number?: unknown; timestamp?: unknown } } | undefined)
        ?.raw_data;
    const id = body.blockID;
    const number = header?.number;
    const timestamp = header?.timestamp;
    if (
        typeof id !== 'string' ||
        !HEX_64.test(id) ||
        typeof number !== 'number' ||
        !Number.isSafeInteger(number) ||
        number <= 0 ||
        typeof timestamp !== 'number' ||
        !Number.isSafeInteger(timestamp) ||
        timestamp <= 0
    ) {
        throw new TronApiError('The Tron network did not return a usable block, try again shortly');
    }
    return { number, id, timestamp };
}

export type TronTransactionOutcome =
    /** Not in a block yet, or never broadcast. Keep asking until it expires. */
    | { readonly status: 'unknown' }
    /** In a block with the transfer done. Irreversible about a minute later. */
    | {
          readonly status: 'succeeded';
          readonly blockNumber: number;
          readonly energyUsed: number;
          readonly trxBurnedSun: number;
      }
    /** In a block, but the call failed: the fee is spent and no USDT moved. */
    | {
          readonly status: 'failed';
          readonly blockNumber: number;
          readonly reason: string;
          readonly energyUsed: number;
          readonly trxBurnedSun: number;
      };

/**
 * What became of a transaction the app broadcast.
 *
 * A failed contract call still lands in a block and still costs its fee, so
 * "in a block" is not "done": the receipt's result says whether the transfer
 * happened. OUT_OF_ENERGY is the one to expect here, when rented energy did
 * not arrive in time or fell short.
 */
export async function getTronTransactionOutcome(
    txID: string,
    opts: TronRequestOptions = {},
): Promise<TronTransactionOutcome> {
    if (!HEX_64.test(txID)) {
        throw new TronApiError('Not a Tron transaction id', false);
    }
    const info = await post('/wallet/gettransactioninfobyid', { value: txID }, opts);
    const blockNumber = info.blockNumber;
    if (typeof blockNumber !== 'number') {
        return { status: 'unknown' };
    }
    const receipt = (info.receipt ?? {}) as { result?: unknown; energy_usage_total?: unknown };
    const energyUsed = asNumber(receipt.energy_usage_total);
    const trxBurnedSun = asNumber(info.fee);
    if (receipt.result === 'SUCCESS') {
        return { status: 'succeeded', blockNumber, energyUsed, trxBurnedSun };
    }
    const reason =
        (typeof receipt.result === 'string' && receipt.result) || decodeNodeMessage(info.resMessage) || 'FAILED';
    return { status: 'failed', blockNumber, reason, energyUsed, trxBurnedSun };
}

/* ------------------------------------------------------------------ */
/* Through our backend                                                 */
/* ------------------------------------------------------------------ */

const BACKEND_URL = 'https://cypherbox-backend.onrender.com/tron';
// Longer than a node call: the route rents energy and waits for it to land,
// which takes up to about 30 seconds, and an idle instance on its host can
// take most of a minute to wake.
const BACKEND_TIMEOUT_MS = 60_000;

/**
 * Refusals that leave the transfer off the network: the backend gives these
 * before it broadcasts, or when the node refused the broadcast. The last two
 * are ours, for refusals that arrive with no code: the rate limiter and the
 * request validator, and a backend without the route at all.
 */
export type TronSendRefusalCode =
    | 'INVALID_TRANSACTION'
    | 'INVALID_SIGNATURE'
    | 'NOT_SPONSORED'
    | 'BELOW_MINIMUM'
    | 'RESIGN_REQUIRED'
    | 'QUOTE_EXPIRING'
    | 'INSUFFICIENT_USDT'
    | 'BANDWIDTH_UNAVAILABLE'
    | 'TRANSFER_REJECTED'
    | 'DAILY_LIMIT'
    | 'ENERGY_UNAVAILABLE'
    | 'ENERGY_NOT_DELIVERED'
    | 'TRON_NOT_CONFIGURED'
    | 'BUDGET_EXHAUSTED'
    | 'ENERGY_PROVIDER_UNFUNDED'
    | 'RATE_LIMITED'
    | 'INVALID_REQUEST';

const REFUSAL_CODES: ReadonlySet<string> = new Set<TronSendRefusalCode>([
    'INVALID_TRANSACTION',
    'INVALID_SIGNATURE',
    'NOT_SPONSORED',
    'BELOW_MINIMUM',
    'RESIGN_REQUIRED',
    'QUOTE_EXPIRING',
    'INSUFFICIENT_USDT',
    'BANDWIDTH_UNAVAILABLE',
    'TRANSFER_REJECTED',
    'DAILY_LIMIT',
    'ENERGY_UNAVAILABLE',
    'ENERGY_NOT_DELIVERED',
    'TRON_NOT_CONFIGURED',
    'BUDGET_EXHAUSTED',
    'ENERGY_PROVIDER_UNFUNDED',
]);

export type TronSendAnswer =
    /** Broadcast, and the node took it. Not in a block yet. */
    | {
          readonly outcome: 'sent';
          readonly txID: string;
          readonly energyRented: number;
          readonly activated: boolean;
      }
    /** Refused, and this request did not put the transfer on the network. */
    | { readonly outcome: 'refused'; readonly code: TronSendRefusalCode; readonly retryAfterSeconds?: number }
    /**
     * No answer that settles it. The transfer may or may not have gone out, so
     * this must never be read as a failure. `reason` is for tests and support.
     */
    | { readonly outcome: 'unknown'; readonly reason: string };

const asSeconds = (value: unknown): number | undefined => {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined;
};

/**
 * Read the backend's answer. Only a code that certifies the transfer stayed
 * off the network becomes a refusal. TRON_UNAVAILABLE and BROADCAST_FAILED can
 * follow a broadcast the node took, an unexpected failure can happen anywhere,
 * and a code this build does not know proves nothing, so all of those, and any
 * answer without a code outside the 4xx range, are unknown.
 */
function readSendAnswer(status: number, body: unknown, retryAfterHeader: string | null): TronSendAnswer {
    const json = body !== null && typeof body === 'object' ? (body as Json) : null;
    if (status === 200) {
        const { txid, energyRented, activated } = json ?? ({} as Json);
        if (
            typeof txid === 'string' &&
            HEX_64.test(txid) &&
            typeof energyRented === 'number' &&
            Number.isSafeInteger(energyRented) &&
            energyRented >= 0 &&
            typeof activated === 'boolean'
        ) {
            return { outcome: 'sent', txID: txid.toLowerCase(), energyRented, activated };
        }
        return { outcome: 'unknown', reason: 'unreadable answer' };
    }

    const code = typeof json?.code === 'string' ? json.code : null;
    if (code !== null) {
        if (!REFUSAL_CODES.has(code)) {
            return { outcome: 'unknown', reason: code };
        }
        const retryAfterSeconds = asSeconds(json?.retryAfterSeconds);
        return {
            outcome: 'refused',
            code: code as TronSendRefusalCode,
            ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        };
    }

    // No code: turned away before the route ran, which a 4xx says.
    if (status === 429) {
        const retryAfterSeconds = asSeconds(retryAfterHeader);
        return { outcome: 'refused', code: 'RATE_LIMITED', ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) };
    }
    if (status === 404) {
        // A backend that does not have the route cannot send.
        return { outcome: 'refused', code: 'TRON_NOT_CONFIGURED' };
    }
    if (status >= 400 && status < 500) {
        return { outcome: 'refused', code: 'INVALID_REQUEST' };
    }
    return { outcome: 'unknown', reason: `HTTP ${status}` };
}

/**
 * Hand a signed USDT transfer to our backend, which rents the energy it needs
 * and broadcasts it. Can take about 30 seconds.
 *
 * Returns rather than throws for everything the backend or the connection can
 * do, because the one distinction the caller cannot do without is "refused"
 * against "unknown". A refusal means this request left the transfer off the
 * network. A dropped connection or a timeout means it may be on it. Posting
 * the same bytes again is safe either way: the backend handles a repeat as
 * the same transfer and pays for its energy once.
 *
 * `publicKey` is the sender's uncompressed key. A node cannot confirm who
 * signed for an address that has never been used, so the backend checks a
 * first send against it.
 */
export async function postTronSend(
    transactionHex: string,
    publicKey: string,
    opts: TronRequestOptions = {},
): Promise<TronSendAnswer> {
    if (!/^[0-9a-fA-F]+$/.test(transactionHex) || transactionHex.length % 2 !== 0 || transactionHex.length > 2000) {
        throw new TronApiError('Not a signed transaction', false);
    }
    if (!/^04[0-9a-fA-F]{128}$/.test(publicKey)) {
        throw new TronApiError('Not an uncompressed public key', false);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? BACKEND_TIMEOUT_MS);
    try {
        let response: Response;
        try {
            response = await fetch(`${BACKEND_URL}/send`, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ transaction: transactionHex, publicKey }),
                signal: controller.signal,
            });
        } catch {
            // The request may have reached the backend before the line went.
            return { outcome: 'unknown', reason: controller.signal.aborted ? 'timed out' : 'unreachable' };
        }

        let body: unknown = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }
        const headers = response.headers as { get?: (name: string) => string | null } | undefined;
        const retryAfter = typeof headers?.get === 'function' ? headers.get('Retry-After') : null;
        return readSendAnswer(response.status, body, retryAfter);
    } finally {
        clearTimeout(timeoutId);
    }
}

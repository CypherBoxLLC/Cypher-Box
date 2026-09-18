/**
 * tronAPIs: the read-only Tron calls the USDT balance and receive flow need.
 *
 * Straight to a public Tron node, since none of this needs a credential. What
 * it does need is care in two places:
 *   - Balances are decimal strings end to end. A TRC20 balance does not fit a
 *     JS number, and a rounded balance is how a UI offers to send more than
 *     exists.
 *   - An address that has never been used does not exist on chain. That is an
 *     ordinary state for a fresh wallet, not an error, and it also costs more
 *     to send to, which the send flow has to know.
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

async function post(path: string, body: Json, opts: TronRequestOptions): Promise<Json> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
        const response = await fetch(`${TRONGRID_URL}${path}`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        }).catch(() => {
            throw new TronApiError('Could not reach the Tron network, check your connection');
        });

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

/**
 * What a USDT send needs in place on the sending address before it can go out.
 *
 * Tron charges the sender in energy and bandwidth, and our users hold no TRX to
 * burn for either, so every send has to have both supplied first, rented or
 * delegated. This works out how much from state the app already reads: whether
 * the address exists yet, what it holds now, and whether the recipient holds
 * any USDT, which is what doubles the energy.
 */

import BigNumber from 'bignumber.js';

import type { TronAccountState } from '../../api/tronAPIs';

/**
 * Energy for a USDT transfer to an address that already holds some USDT.
 *
 * Measured on mainnet on 2026-09-18: 40 consecutive USDT transfers each used
 * exactly this or USDT_TRANSFER_ENERGY_TO_EMPTY. USDT is already at the
 * network's maximum dynamic energy factor, so these hold until a governance
 * vote changes the energy parameters.
 */
export const USDT_TRANSFER_ENERGY_TO_HOLDER = 64_285;

/**
 * Energy when the recipient holds no USDT at all, which includes every fresh
 * swap deposit address and any address swept to zero. Storing a first balance
 * costs more than updating one.
 */
export const USDT_TRANSFER_ENERGY_TO_EMPTY = 130_285;

/** Bandwidth for a USDT transfer: its size in bytes, 338 to 345 on mainnet. */
export const USDT_TRANSFER_BANDWIDTH = 345;

/** The window free bandwidth usage decays over: 28,800 blocks of 3 seconds. */
const FREE_BANDWIDTH_WINDOW_MS = 24 * 60 * 60 * 1000;

/** One block. The network rounds per block, so allow one. */
const BLOCK_MS = 3_000;

export type UsdtSendNeeds = {
    /**
     * The address has never been activated, which receiving USDT does not do.
     * Energy cannot be delegated to it, and it cannot sign, until it is.
     */
    readonly activation: boolean;
    /** Energy the transfer will use. */
    readonly energy: number;
    /** Energy to supply: what the transfer uses minus what the address has now. */
    readonly energyToSupply: number;
    /** Bandwidth to supply, zero when free or staked bandwidth covers the transfer. */
    readonly bandwidthToSupply: number;
};

/**
 * Whether the sender can pay a transfer's bandwidth now.
 *
 * The network takes a transaction's whole size from staked bandwidth, else
 * from free bandwidth, else burns TRX for all of it; it never splits one
 * transaction across the two. A newly activated address starts with the full
 * free allowance, which covers one transfer.
 */
export function hasTransferBandwidth(sender: TronAccountState): boolean {
    return (
        !sender.activated ||
        sender.stakedBandwidth >= USDT_TRANSFER_BANDWIDTH ||
        sender.freeBandwidth >= USDT_TRANSFER_BANDWIDTH
    );
}

/**
 * Seconds until free bandwidth covers a transfer again: zero when it already
 * does, undefined when the allowance is too small ever to.
 *
 * Free bandwidth does not refill at a flat 600 a day. Usage decays in a
 * straight line to zero over the 24 hours after the account last used any, so
 * it falls at a rate set by how much was used: after one transfer from empty,
 * the next fits about 6.3 hours later. The node reports usage already decayed
 * to now, and the time of last use fixes the line it is on. Without that
 * time, the last use is taken as just now, the longest wait. Our backend's
 * retryAfterSeconds follows the same rule.
 */
export function secondsUntilTransferBandwidth(sender: TronAccountState, nowMs: number): number | undefined {
    if (hasTransferBandwidth(sender)) {
        return 0;
    }
    const target = sender.freeBandwidthLimit - USDT_TRANSFER_BANDWIDTH;
    if (target < 0) {
        return undefined;
    }
    const used = sender.freeBandwidthUsed;
    if (used <= target) {
        return 0;
    }
    const sinceLastUse = nowMs - sender.lastFreeBandwidthUseMs;
    const known = sender.lastFreeBandwidthUseMs > 0 && sinceLastUse >= 0 && sinceLastUse < FREE_BANDWIDTH_WINDOW_MS;
    const remainingMs = known ? FREE_BANDWIDTH_WINDOW_MS - sinceLastUse : FREE_BANDWIDTH_WINDOW_MS;
    const waitMs = (remainingMs * (used - target)) / used;
    return Math.ceil((waitMs + BLOCK_MS) / 1000);
}

export function usdtSendNeeds(sender: TronAccountState, recipientUsdtBalance: string): UsdtSendNeeds {
    const balance = new BigNumber(recipientUsdtBalance);
    if (!balance.isFinite() || balance.isNegative()) {
        throw new Error(`Unreadable recipient balance: ${recipientUsdtBalance}`);
    }
    const energy = balance.isZero() ? USDT_TRANSFER_ENERGY_TO_EMPTY : USDT_TRANSFER_ENERGY_TO_HOLDER;
    return {
        activation: !sender.activated,
        energy,
        energyToSupply: Math.max(0, energy - sender.energyAvailable),
        bandwidthToSupply: hasTransferBandwidth(sender) ? 0 : USDT_TRANSFER_BANDWIDTH,
    };
}

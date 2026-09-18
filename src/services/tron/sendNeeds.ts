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

export function usdtSendNeeds(sender: TronAccountState, recipientUsdtBalance: string): UsdtSendNeeds {
    const balance = new BigNumber(recipientUsdtBalance);
    if (!balance.isFinite() || balance.isNegative()) {
        throw new Error(`Unreadable recipient balance: ${recipientUsdtBalance}`);
    }
    const energy = balance.isZero() ? USDT_TRANSFER_ENERGY_TO_EMPTY : USDT_TRANSFER_ENERGY_TO_HOLDER;

    // The network takes a transaction's whole size from staked bandwidth, else
    // from free bandwidth, else burns TRX for all of it; it never splits one
    // transaction across the two. A newly activated address starts with the
    // full free allowance, which covers one transfer.
    const bandwidthCovered =
        !sender.activated ||
        sender.stakedBandwidth >= USDT_TRANSFER_BANDWIDTH ||
        sender.freeBandwidth >= USDT_TRANSFER_BANDWIDTH;

    return {
        activation: !sender.activated,
        energy,
        energyToSupply: Math.max(0, energy - sender.energyAvailable),
        bandwidthToSupply: bandwidthCovered ? 0 : USDT_TRANSFER_BANDWIDTH,
    };
}

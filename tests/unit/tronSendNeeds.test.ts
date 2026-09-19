/**
 * What a USDT send needs supplied before it can go out.
 *
 * What this protects: renting the right energy tier (too little and the
 * transfer fails on-chain with the rental spent), activating an address that
 * has only ever received USDT, not counting two half-filled bandwidth sources
 * as one full one, and telling a wallet out of free bandwidth how long it
 * really has to wait. Usage regrows in proportion to what was used, not at a
 * flat 600 a day, so the flat estimate sends users back too early.
 */

import type { TronAccountState } from '../../src/api/tronAPIs';
import {
    USDT_TRANSFER_BANDWIDTH,
    USDT_TRANSFER_ENERGY_TO_EMPTY,
    USDT_TRANSFER_ENERGY_TO_HOLDER,
    hasTransferBandwidth,
    secondsUntilTransferBandwidth,
    usdtSendNeeds,
} from '../../src/services/tron/sendNeeds';

const state = (overrides: Partial<TronAccountState> = {}): TronAccountState => ({
    activated: true,
    trxBalance: '0',
    energyAvailable: 0,
    bandwidthAvailable: 600,
    freeBandwidth: 600,
    stakedBandwidth: 0,
    freeBandwidthUsed: 0,
    freeBandwidthLimit: 600,
    lastFreeBandwidthUseMs: 0,
    ...overrides,
});

const HOUR_MS = 60 * 60 * 1000;
const NOW = 1789718364000;
/** Free bandwidth as the node reports it: `used` of 600, last used at `lastUseMs`. */
const afterUse = (used: number, lastUseMs: number) =>
    state({ freeBandwidth: 600 - used, bandwidthAvailable: 600 - used, freeBandwidthUsed: used, lastFreeBandwidthUseMs: lastUseMs });

describe('usdtSendNeeds', () => {
    it('uses the higher energy tier when the recipient holds no USDT', () => {
        expect(usdtSendNeeds(state(), '0').energy).toBe(USDT_TRANSFER_ENERGY_TO_EMPTY);
        expect(usdtSendNeeds(state(), '0.000000').energy).toBe(USDT_TRANSFER_ENERGY_TO_EMPTY);
    });

    it('uses the lower tier for a recipient holding anything, even one unit', () => {
        expect(usdtSendNeeds(state(), '0.000001').energy).toBe(USDT_TRANSFER_ENERGY_TO_HOLDER);
        expect(usdtSendNeeds(state(), '1500').energy).toBe(USDT_TRANSFER_ENERGY_TO_HOLDER);
    });

    it('asks only for the energy the address does not already have', () => {
        const needs = usdtSendNeeds(state({ energyAvailable: 20_000 }), '10');
        expect(needs.energyToSupply).toBe(USDT_TRANSFER_ENERGY_TO_HOLDER - 20_000);
        expect(usdtSendNeeds(state({ energyAvailable: 200_000 }), '0').energyToSupply).toBe(0);
    });

    it('flags an address that has only received USDT as needing activation', () => {
        const needs = usdtSendNeeds(state({ activated: false, freeBandwidth: 0, bandwidthAvailable: 0 }), '0');
        expect(needs.activation).toBe(true);
        // Activation brings the free daily allowance, which covers one transfer.
        expect(needs.bandwidthToSupply).toBe(0);
    });

    it('needs no bandwidth when either source alone covers the transfer', () => {
        expect(usdtSendNeeds(state({ freeBandwidth: 345 }), '1').bandwidthToSupply).toBe(0);
        expect(usdtSendNeeds(state({ freeBandwidth: 0, stakedBandwidth: 400 }), '1').bandwidthToSupply).toBe(0);
    });

    it('needs the full size when neither source covers it alone, even if together they would', () => {
        const split = state({ freeBandwidth: 200, stakedBandwidth: 200, bandwidthAvailable: 400 });
        expect(usdtSendNeeds(split, '1').bandwidthToSupply).toBe(USDT_TRANSFER_BANDWIDTH);
    });

    it('refuses a recipient balance it cannot read', () => {
        expect(() => usdtSendNeeds(state(), 'abc')).toThrow(/Unreadable/);
        expect(() => usdtSendNeeds(state(), '-1')).toThrow(/Unreadable/);
    });
});

describe('hasTransferBandwidth', () => {
    it('needs one source to cover the whole transfer', () => {
        expect(hasTransferBandwidth(state())).toBe(true);
        expect(hasTransferBandwidth(afterUse(255, NOW))).toBe(true);
        expect(hasTransferBandwidth(afterUse(256, NOW))).toBe(false);
        expect(hasTransferBandwidth(state({ freeBandwidth: 200, stakedBandwidth: 200 }))).toBe(false);
    });

    it('counts a never-activated address as covered, since activation brings the allowance', () => {
        expect(hasTransferBandwidth(state({ activated: false, freeBandwidth: 0 }))).toBe(true);
    });
});

describe('secondsUntilTransferBandwidth', () => {
    it('is zero while the allowance covers a transfer', () => {
        expect(secondsUntilTransferBandwidth(state(), NOW)).toBe(0);
        expect(secondsUntilTransferBandwidth(afterUse(255, NOW), NOW)).toBe(0);
    });

    it('is about 6.3 hours after one transfer from empty, where a flat 600 a day says 3.6', () => {
        // Usage falls from 345 to zero over 24 hours; it reaches 255 after 90/345 of that.
        const wait = secondsUntilTransferBandwidth(afterUse(345, NOW), NOW);
        expect(wait).toBe(22543);
        expect(wait).toBeGreaterThan((345 - 255) * 144);
    });

    it('counts from the last use, not from now', () => {
        // Seen on mainnet: 318 still used 1.8 hours after one transfer that started at about 344.
        expect(secondsUntilTransferBandwidth(afterUse(318, NOW - 1.8 * HOUR_MS), NOW)).toBe(15837);
    });

    it('takes the last use as just now when its time is missing or does not add up', () => {
        const justNow = secondsUntilTransferBandwidth(afterUse(400, NOW), NOW);
        expect(secondsUntilTransferBandwidth(afterUse(400, 0), NOW)).toBe(justNow);
        expect(secondsUntilTransferBandwidth(afterUse(400, NOW + 60_000), NOW)).toBe(justNow);
        expect(secondsUntilTransferBandwidth(afterUse(400, NOW - 25 * HOUR_MS), NOW)).toBe(justNow);
    });

    it('has no answer when the allowance could never cover a transfer', () => {
        const tiny = state({ freeBandwidth: 0, bandwidthAvailable: 0, freeBandwidthUsed: 300, freeBandwidthLimit: 300 });
        expect(secondsUntilTransferBandwidth(tiny, NOW)).toBeUndefined();
    });

    it('is never shorter than the flat-rate estimate', () => {
        // Any state the network can produce: usage decaying from at most 600.
        for (let usedAfterLastUse = 256; usedAfterLastUse <= 600; usedAfterLastUse += 17) {
            for (let hours = 0; hours < 24; hours += 1.5) {
                const used = Math.floor(usedAfterLastUse * (1 - hours / 24));
                if (used <= 255) continue;
                const wait = secondsUntilTransferBandwidth(afterUse(used, NOW - hours * HOUR_MS), NOW);
                expect(wait).toBeGreaterThanOrEqual((used - 255) * 144);
            }
        }
    });
});

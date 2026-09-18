/**
 * What a USDT send needs supplied before it can go out.
 *
 * What this protects: renting the right energy tier (too little and the
 * transfer fails on-chain with the rental spent), activating an address that
 * has only ever received USDT, and not counting two half-filled bandwidth
 * sources as one full one.
 */

import type { TronAccountState } from '../../src/api/tronAPIs';
import {
    USDT_TRANSFER_BANDWIDTH,
    USDT_TRANSFER_ENERGY_TO_EMPTY,
    USDT_TRANSFER_ENERGY_TO_HOLDER,
    usdtSendNeeds,
} from '../../src/services/tron/sendNeeds';

const state = (overrides: Partial<TronAccountState> = {}): TronAccountState => ({
    activated: true,
    trxBalance: '0',
    energyAvailable: 0,
    bandwidthAvailable: 600,
    freeBandwidth: 600,
    stakedBandwidth: 0,
    ...overrides,
});

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

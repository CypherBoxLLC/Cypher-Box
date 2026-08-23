/**
 * Sizing a top-up of the exit-fee reserve.
 *
 * Wrong in either direction is expensive: too little leaves the exit stalled
 * after the user believes they fixed it, too much strips a wallet they still
 * need. The subtlety is that the miner fee comes off the top, so a wallet
 * holding exactly the shortfall cannot deliver the shortfall.
 */

import { planExitFunding } from '../../src/services/ark/exitFundingPlan';
import { MIN_USEFUL_FUNDING_SATS } from '../../src/services/ark/exitFundingSources';

const plan = (over: Partial<Parameters<typeof planExitFunding>[0]> = {}) =>
    planExitFunding({ shortfallSats: 14_504, availableSats: 50_000, feeSats: 300, ...over });

describe('the ordinary case', () => {
    it('sends exactly the shortfall when the source can cover it', () => {
        const p = plan();
        expect(p).toMatchObject({ ok: true, sendSats: 14_504, partial: false });
    });

    it('reports the total leaving the wallet, fee included', () => {
        // What lands and what leaves are different numbers, and the confirm
        // screen has to show both or the user is surprised by the difference.
        const p = plan();
        expect(p.ok && p.totalCostSats).toBe(14_804);
    });
});

describe('the fee comes off the top', () => {
    it('cannot deliver the shortfall from a wallet holding exactly it', () => {
        // The trap. 14,504 available against a 14,504 shortfall lands only
        // 14,204 once the fee is paid.
        const p = plan({ availableSats: 14_504, feeSats: 300 });
        expect(p).toMatchObject({ ok: true, partial: true });
        expect(p.ok && p.sendSats).toBe(14_204);
    });

    it('spends the whole balance on a partial top-up', () => {
        const p = plan({ availableSats: 5_000, feeSats: 300 });
        expect(p.ok && p.sendSats).toBe(4_700);
        expect(p.ok && p.totalCostSats).toBe(5_000);
    });

    it('covers the shortfall exactly when the balance leaves room for the fee', () => {
        const p = plan({ availableSats: 14_804, feeSats: 300 });
        expect(p).toMatchObject({ ok: true, sendSats: 14_504, partial: false });
    });
});

describe('refusing to send', () => {
    it('will not send when the fee eats almost everything', () => {
        const p = plan({ availableSats: 1_200, feeSats: 300 });
        expect(p.ok).toBe(false);
    });

    it('names the fee rather than claiming an insufficient balance', () => {
        // "Insufficient balance" reads as a lie to someone looking at a balance
        // bigger than the amount they typed.
        const p = plan({ availableSats: 1_100, feeSats: 900 });
        expect(p.ok === false && p.reason).toMatch(/900/);
        expect(p.ok === false && p.reason).toMatch(/network fee/i);
    });

    it('refuses when the reserve is already funded', () => {
        const p = plan({ shortfallSats: 0 });
        expect(p.ok).toBe(false);
        expect(p.ok === false && p.reason).toMatch(/already funded/i);
    });

    it('refuses at one sat under the useful floor', () => {
        const p = plan({ availableSats: MIN_USEFUL_FUNDING_SATS - 1, feeSats: 0 });
        expect(p.ok).toBe(false);
    });

    it('accepts exactly at the floor', () => {
        const p = plan({ availableSats: MIN_USEFUL_FUNDING_SATS, feeSats: 0, shortfallSats: 99_999 });
        expect(p.ok).toBe(true);
    });
});

describe('an unreadable balance', () => {
    it('plans the full shortfall rather than refusing', () => {
        // A balance that failed to load is not a balance of zero. Refusing here
        // would strand a user whose network hiccuped on the balance call; the
        // provider will reject the send if the funds really are not there.
        const p = plan({ availableSats: null });
        expect(p).toMatchObject({ ok: true, sendSats: 14_504, partial: false });
    });
});

describe('junk input', () => {
    it('does not produce a negative or fractional send', () => {
        const p = plan({ availableSats: 20_000.7, feeSats: 12.9, shortfallSats: 10_000.4 });
        expect(p.ok && Number.isInteger(p.sendSats)).toBe(true);
        expect(p.ok && p.sendSats).toBeGreaterThan(0);
    });

    it('treats a negative balance as empty', () => {
        expect(plan({ availableSats: -500 }).ok).toBe(false);
    });

    it('tolerates a NaN fee', () => {
        const p = plan({ feeSats: Number.NaN });
        expect(p.ok).toBe(true);
    });
});

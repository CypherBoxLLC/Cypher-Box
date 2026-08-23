/**
 * The "fund exit fees from another wallet" source list.
 *
 * Two rules carry most of the value here and neither is obvious from the UI:
 * unavailable sources are still listed with a reason rather than hidden, and
 * Cold Vault is always last because it needs a hardware signing round-trip.
 */

import {
    MIN_USEFUL_FUNDING_SATS,
    buildExitFundingSources,
    hasUsableExitFundingSource,
} from '../../src/services/ark/exitFundingSources';

const connected = (balanceSats: number) => ({ connected: true, balanceSats });
const vaultWith = (balanceSats: number) => ({ walletID: 'w'.repeat(64), balanceSats });

const ALL_READY = {
    coinos: connected(50_000),
    strike: connected(50_000),
    hotVault: vaultWith(50_000),
    coldVault: vaultWith(50_000),
};

describe('ordering', () => {
    it('puts custodial wallets first and Cold Vault last', () => {
        // Cold Vault needs a PSBT round-trip through an airgapped signer, so it
        // must never sit next to Hot Vault as an equal-looking choice.
        expect(buildExitFundingSources(ALL_READY).map((s) => s.id)).toEqual([
            'coinos',
            'strike',
            'hot-vault',
            'cold-vault',
        ]);
    });

    it('keeps Cold Vault last even when it is the only funded source', () => {
        const ids = buildExitFundingSources({ coldVault: vaultWith(50_000) }).map((s) => s.id);
        expect(ids[ids.length - 1]).toBe('cold-vault');
    });

    it('flags Cold Vault as slow and nothing else', () => {
        const sources = buildExitFundingSources(ALL_READY);
        expect(sources.find((s) => s.id === 'cold-vault')?.slow).toBe(true);
        expect(sources.filter((s) => s.slow).map((s) => s.id)).toEqual(['cold-vault']);
    });
});

describe('every source is listed, even when unusable', () => {
    it('returns all four with an empty state', () => {
        // Hiding them makes the feature look broken. Showing them with a reason
        // teaches the user what to fix.
        const sources = buildExitFundingSources();
        expect(sources).toHaveLength(4);
        expect(sources.every((s) => !s.available)).toBe(true);
    });

    it('says why a custodial wallet cannot be used', () => {
        const s = buildExitFundingSources({ coinos: { connected: false } });
        expect(s.find((x) => x.id === 'coinos')?.unavailableReason).toMatch(/not connected/i);
    });

    it('says why a vault cannot be used', () => {
        const s = buildExitFundingSources({ hotVault: { walletID: null } });
        expect(s.find((x) => x.id === 'hot-vault')?.unavailableReason).toMatch(/no vault/i);
    });

    it('names the floor rather than saying "insufficient"', () => {
        // "Insufficient balance" leaves the user guessing how much is enough.
        const s = buildExitFundingSources({ coinos: connected(MIN_USEFUL_FUNDING_SATS - 1) });
        expect(s.find((x) => x.id === 'coinos')?.unavailableReason).toContain(
            MIN_USEFUL_FUNDING_SATS.toLocaleString(),
        );
    });

    it('marks a drained vault as having no spendable capsules', () => {
        const s = buildExitFundingSources({ hotVault: vaultWith(0) });
        const hot = s.find((x) => x.id === 'hot-vault');
        expect(hot?.available).toBe(false);
        expect(hot?.unavailableReason).toMatch(/no spendable capsules/i);
    });
});

describe('availability', () => {
    it('accepts a connected wallet at exactly the floor', () => {
        const s = buildExitFundingSources({ coinos: connected(MIN_USEFUL_FUNDING_SATS) });
        expect(s.find((x) => x.id === 'coinos')?.available).toBe(true);
    });

    it('offers a source that cannot cover the whole shortfall', () => {
        // Partial funding is still progress: it may be the difference between a
        // stalled exit and a finished one.
        const s = buildExitFundingSources({
            coinos: connected(5_000),
            shortfallSats: 14_504,
        });
        expect(s.find((x) => x.id === 'coinos')?.available).toBe(true);
    });

    it('treats an unknown balance as usable rather than blocking', () => {
        // A balance we could not read is not the same as a balance of zero, and
        // refusing on a failed read would strand the user.
        const s = buildExitFundingSources({ strike: { connected: true, balanceSats: null } });
        expect(s.find((x) => x.id === 'strike')?.available).toBe(true);
    });

    it('ignores a nonsense balance instead of crashing', () => {
        const s = buildExitFundingSources({
            coinos: { connected: true, balanceSats: Number.NaN },
            hotVault: { walletID: 'x'.repeat(64), balanceSats: -5 },
        });
        expect(s.find((x) => x.id === 'coinos')?.available).toBe(true);
        expect(s.find((x) => x.id === 'hot-vault')?.available).toBe(true);
    });

    it('reports balances for the ones it could read', () => {
        const s = buildExitFundingSources({ coinos: connected(42_000) });
        expect(s.find((x) => x.id === 'coinos')?.balanceSats).toBe(42_000);
    });
});

describe('hasUsableExitFundingSource', () => {
    it('is false when nothing is connected, so the caller can fall back', () => {
        // The caller shows the receive-an-address path instead, which is the
        // one that always works.
        expect(hasUsableExitFundingSource(buildExitFundingSources())).toBe(false);
    });

    it('is true when any single source works', () => {
        expect(
            hasUsableExitFundingSource(buildExitFundingSources({ strike: connected(20_000) })),
        ).toBe(true);
    });
});

/**
 * Which wallets can top up the exit-fee reserve, and which cannot right now.
 *
 * The funding sheet's "Receive Bitcoin" tab hands the user an address and
 * leaves them to find some bitcoin. That is the ASP-independent path and it
 * always works, but it is also the least helpful thing to show someone whose
 * exit has stalled and who already holds sats in this very app.
 *
 * This builds the list behind "Fund from another wallet". It is pure: state in,
 * sources out, so the ordering and the availability rules can be tested without
 * a screen.
 *
 * DESIGN NOTES, because two of these are easy to get wrong.
 *
 * Unavailable sources are RETURNED, not filtered out, each carrying its reason.
 * A user who cannot see their Hot Vault in the list concludes the feature is
 * broken; one who sees it greyed out with "no spendable capsules" has learned
 * something. Callers render them disabled.
 *
 * Cold Vault is ordered LAST and flagged slow. It needs a PSBT round-trip
 * through an airgapped signer, which is minutes to hours. Offering it as a peer
 * of Hot Vault to someone in a degraded exit invites the worst choice on the
 * list.
 */

export type ExitFundingSourceId = 'coinos' | 'strike' | 'hot-vault' | 'cold-vault';

export type ExitFundingSource = {
    id: ExitFundingSourceId;
    label: string;
    /** Selectable right now. */
    available: boolean;
    /** Why not, when `available` is false. Shown to the user verbatim. */
    unavailableReason?: string;
    /** Spendable sats this source could contribute, when known. */
    balanceSats?: number;
    /** Needs a hardware signing round-trip, so it is slow. */
    slow?: boolean;
};

export type ExitFundingSourceState = {
    coinos?: { connected: boolean; balanceSats?: number | null } | null;
    strike?: { connected: boolean; balanceSats?: number | null } | null;
    hotVault?: { walletID: string | null; balanceSats?: number | null } | null;
    coldVault?: { walletID: string | null; balanceSats?: number | null } | null;
    /** Sats still needed. Sources holding less than this are still offered. */
    shortfallSats?: number;
};

/** Below this a contribution cannot cover its own on-chain fee. */
export const MIN_USEFUL_FUNDING_SATS = 1_000;

function sats(v: number | null | undefined): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}

function custodial(
    id: 'coinos' | 'strike',
    label: string,
    entry: { connected: boolean; balanceSats?: number | null } | null | undefined,
): ExitFundingSource {
    if (!entry?.connected) {
        return { id, label, available: false, unavailableReason: `Not connected` };
    }
    const balanceSats = sats(entry.balanceSats);
    if (balanceSats != null && balanceSats < MIN_USEFUL_FUNDING_SATS) {
        return {
            id,
            label,
            available: false,
            balanceSats,
            // Naming the floor beats "insufficient balance", which leaves the
            // user guessing how much would be enough.
            unavailableReason: `Balance below ${MIN_USEFUL_FUNDING_SATS.toLocaleString()} sats`,
        };
    }
    return { id, label, available: true, balanceSats };
}

function vault(
    id: 'hot-vault' | 'cold-vault',
    label: string,
    entry: { walletID: string | null; balanceSats?: number | null } | null | undefined,
    opts: { slow?: boolean } = {},
): ExitFundingSource {
    const base = { id, label, slow: opts.slow } as ExitFundingSource;
    if (!entry?.walletID) {
        return { ...base, available: false, unavailableReason: 'No vault on this device' };
    }
    const balanceSats = sats(entry.balanceSats);
    if (balanceSats != null && balanceSats < MIN_USEFUL_FUNDING_SATS) {
        return {
            ...base,
            available: false,
            balanceSats,
            unavailableReason: 'No spendable capsules',
        };
    }
    return { ...base, available: true, balanceSats };
}

/**
 * Ordered list of funding sources.
 *
 * Custodial wallets first: they hold most users' spare sats and settle without
 * a signing device. Hot Vault next. Cold Vault last, always, because it is the
 * slow one.
 */
export function buildExitFundingSources(
    state: ExitFundingSourceState = {},
): ExitFundingSource[] {
    return [
        custodial('coinos', 'CoinOS', state.coinos),
        custodial('strike', 'Strike', state.strike),
        vault('hot-vault', 'Hot Vault', state.hotVault),
        vault('cold-vault', 'Cold Vault', state.coldVault, { slow: true }),
    ];
}

/** True when at least one source can actually be used. */
export function hasUsableExitFundingSource(sources: readonly ExitFundingSource[]): boolean {
    return sources.some((s) => s.available);
}

/**
 * @secondts/bark-react-native 0.16.1 (bark 0.6.1) -> 0.27.0 (bark 0.8.1).
 *
 * The call sites whose behaviour the upgrade changes without a type error,
 * or with a type error that would only show up as one more line in a
 * baseline of ~360. Each case below is a money path or a fund-safety message:
 *
 *   - balance: bark 0.8.0 already leaves expired and depth-limited capsules
 *     out of `spendableSats` (`needsRefreshSats`); the app filter must not
 *     take them out a second time.
 *   - rounds: a delegated refresh waiting for its round reads ongoing=false
 *     (`DelegatedPending`); the "one refresh at a time" guards must still see it.
 *   - sendOnchain / offboardVtxos: return OffboardResult, not a txid string;
 *     reading the txid must never throw after the broadcast.
 *   - bolt11Invoice: gained `expirySecs`.
 *   - recoveryStatus: tells a failed seed-recovery scan from one that never ran.
 *   - LightningReceive.amountSats: optional now.
 *
 * Only the native handle is faked.
 */

const mockHandle = {
    balance: jest.fn(),
    offboardVtxos: jest.fn(),
    sendOnchain: jest.fn(),
    estimateSendOnchainFee: jest.fn(),
    bolt11Invoice: jest.fn(),
    pendingLightningReceives: jest.fn(),
};

jest.mock('../../src/services/ark/walletHandle', () => {
    const actual = jest.requireActual('../../src/services/ark/walletHandle');
    return {
        __esModule: true,
        // Pure helper under test, from the real module.
        readArkRecoveryStatus: actual.readArkRecoveryStatus,
        getArkWalletHandle: () => mockHandle,
        getLastOnchainBalanceSats: () => ({ confirmedSats: 0, pendingSats: 0 }),
        ensureArkOnchainHandle: jest.fn(async () => ({ newAddress: jest.fn(async () => 'bc1qfeewallet') })),
    };
});

// The real enum's runtime shape: a numeric TypeScript enum with reverse
// mapping, in the declaration order of SDK 0.27.0's bark.ts.
jest.mock('@secondts/bark-react-native', () => {
    const RoundFlowKind: Record<string | number, string | number> = {};
    ['DelegatedPending', 'Pending', 'Ongoing', 'AwaitingConfirmations', 'Failed', 'Canceled'].forEach((name, i) => {
        RoundFlowKind[name] = i;
        RoundFlowKind[i] = name;
    });
    return {
        __esModule: true,
        RoundFlowKind,
        extractTxFromPsbt: jest.fn(),
        uniffiInitAsync: jest.fn(),
        Wallet: {},
        OnchainWallet: {},
        WalletOpenArgs: { create: jest.fn() },
        Network: { Bitcoin: 'Bitcoin' },
        Config: { create: jest.fn() },
    };
});

jest.mock('../../src/services/ark/restore', () => ({
    __esModule: true,
    ensureArkWalletHandleReady: jest.fn(async () => mockHandle),
}));
jest.mock('../../src/services/ark/exit', () => ({
    __esModule: true,
    assertNoActiveArkExit: jest.fn(),
}));

import { applyExpiredVtxoFilter, fetchArkBalance, type ArkBalanceSummary } from '../../src/services/ark/balance';
import type { ArkVtxoView } from '../../src/services/ark/vtxos';
import {
    describeArkRound,
    isArkRoundInFlight,
    isInFlightInputsRefusal,
    roundFlowName,
} from '../../src/services/ark/roundFlight';
import { offboardTxid } from '../../src/services/ark/indeterminate';
import { offboardArkVtxos } from '../../src/services/ark/offboard';
import { convertToExitFees } from '../../src/services/ark/exitFunding';
import { createArkLightningInvoice } from '../../src/services/ark/receive';
import { fetchArkPendingLightningReceives } from '../../src/services/ark/lightning';
import { readArkRecoveryStatus } from '../../src/services/ark/walletHandle';

const TIP = 900_000;
const MAX_DEPTH = 100;

function summary(spendableSats: number, barkNeedsRefreshSats?: number): ArkBalanceSummary {
    return {
        totalSats: spendableSats,
        spendableSats,
        pendingInRoundSats: 0,
        pendingExitSats: 0,
        pendingLightningSendSats: 0,
        claimableLightningReceiveSats: 0,
        pendingBoardSats: 0,
        expiredUnrecoverableSats: 0,
        onchainBoardingSats: 0,
        onchainConfirmingSats: 0,
        ...(barkNeedsRefreshSats === undefined ? {} : { barkNeedsRefreshSats, needsRefreshSats: barkNeedsRefreshSats }),
    };
}

function view(p: Partial<ArkVtxoView> & { id: string; sats: number }): ArkVtxoView {
    return { expiryHeight: TIP + 20_000, kind: 'round', state: 'Spendable', exitDepth: 2, ...p };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('fetchArkBalance with bark 0.8.0 buckets', () => {
    it('carries needsRefreshSats and the new pending-send buckets', async () => {
        mockHandle.balance.mockResolvedValue({
            spendableSats: 60_000n,
            needsRefreshSats: 15_000n,
            pendingInRoundSats: 0n,
            pendingExitSats: 0n,
            pendingLightningSendSats: 0n,
            claimableLightningReceiveSats: 0n,
            pendingBoardSats: 0n,
            pendingArkoorSendSats: 2_000n,
            pendingOffboardSats: 3_000n,
        });
        const out = await fetchArkBalance();
        expect(out?.spendableSats).toBe(60_000);
        expect(out?.barkNeedsRefreshSats).toBe(15_000);
        expect(out?.pendingSendSats).toBe(5_000);
    });

    it('reads 0 for the new buckets when a binding does not have them', async () => {
        mockHandle.balance.mockResolvedValue({
            spendableSats: 60_000n,
            pendingInRoundSats: 0n,
            pendingExitSats: 0n,
            pendingLightningSendSats: 0n,
            claimableLightningReceiveSats: 0n,
            pendingBoardSats: 0n,
        });
        const out = await fetchArkBalance();
        expect(out?.barkNeedsRefreshSats).toBe(0);
        expect(out?.pendingSendSats).toBe(0);
    });
});

describe('applyExpiredVtxoFilter once bark leaves needs-refresh capsules out', () => {
    it('does not take an expired capsule off a second time', () => {
        // bark: 60,000 spendable, the expired 10,000 already in needsRefresh.
        const out = applyExpiredVtxoFilter(
            summary(60_000, 10_000),
            [view({ id: 'live', sats: 60_000 }), view({ id: 'old', sats: 10_000, expiryHeight: TIP - 3 })],
            TIP,
            MAX_DEPTH,
        );
        expect(out.spendableSats).toBe(60_000);
        expect(out.totalSats).toBe(60_000);
        expect(out.expiredUnrecoverableSats).toBe(10_000);
        expect(out.needsRefreshSats).toBe(0);
    });

    it('reports a live capsule at the depth limit as needing a refresh, without subtracting it', () => {
        const out = applyExpiredVtxoFilter(
            summary(60_000, 20_000),
            [view({ id: 'live', sats: 60_000 }), view({ id: 'deep', sats: 20_000, exitDepth: MAX_DEPTH })],
            TIP,
            MAX_DEPTH,
        );
        expect(out.spendableSats).toBe(60_000);
        expect(out.needsRefreshSats).toBe(20_000);
        expect(out.expiredUnrecoverableSats).toBe(0);
    });

    it('does not count one below the limit', () => {
        const out = applyExpiredVtxoFilter(
            summary(80_000, 0),
            [view({ id: 'live', sats: 60_000 }), view({ id: 'deep', sats: 20_000, exitDepth: MAX_DEPTH - 1 })],
            TIP,
            MAX_DEPTH,
        );
        expect(out.spendableSats).toBe(80_000);
        expect(out.needsRefreshSats).toBe(0);
    });

    it('subtracts a server-spent capsule only while bark still counts it', () => {
        // Expired phantom: bark already left it out (needsRefresh), so it must
        // not come off again. Live phantom: bark counts it, so it does.
        const out = applyExpiredVtxoFilter(
            summary(100_000, 10_000),
            [
                view({ id: 'phantom-expired', sats: 10_000, serverSpent: true, expiryHeight: TIP - 1 }),
                view({ id: 'phantom-live', sats: 40_000, serverSpent: true }),
                view({ id: 'live', sats: 60_000 }),
            ],
            TIP,
            MAX_DEPTH,
        );
        expect(out.spendableSats).toBe(60_000);
        expect(out.expiredUnrecoverableSats).toBe(0);
    });

    it('does not subtract a server-spent capsule at the depth limit twice', () => {
        const out = applyExpiredVtxoFilter(
            summary(60_000, 40_000),
            [
                view({ id: 'phantom-deep', sats: 40_000, serverSpent: true, exitDepth: MAX_DEPTH }),
                view({ id: 'live', sats: 60_000 }),
            ],
            TIP,
            MAX_DEPTH,
        );
        expect(out.spendableSats).toBe(60_000);
        // A phantom is not the user's to refresh.
        expect(out.needsRefreshSats).toBe(0);
    });

    it('keeps an exiting capsule at the depth limit in the pending exit without subtracting it', () => {
        const out = applyExpiredVtxoFilter(
            summary(60_000, 25_000),
            [view({ id: 'exiting-deep', sats: 25_000, exiting: true, exitDepth: MAX_DEPTH }), view({ id: 'live', sats: 60_000 })],
            TIP,
            MAX_DEPTH,
        );
        expect(out.spendableSats).toBe(60_000);
        expect(out.pendingExitSats).toBe(25_000);
    });

    it('still subtracts an exiting capsule bark counts as spendable', () => {
        const out = applyExpiredVtxoFilter(
            summary(90_000, 0),
            [view({ id: 'exiting', sats: 30_000, exiting: true }), view({ id: 'live', sats: 60_000 })],
            TIP,
            MAX_DEPTH,
        );
        expect(out.spendableSats).toBe(60_000);
        expect(out.pendingExitSats).toBe(30_000);
    });

    it('takes off a capsule our tip sees as expired while bark, a block behind, still counts it', () => {
        const out = applyExpiredVtxoFilter(
            summary(70_000, 0),
            [view({ id: 'live', sats: 60_000 }), view({ id: 'just-expired', sats: 10_000, expiryHeight: TIP })],
            TIP,
            MAX_DEPTH,
        );
        expect(out.spendableSats).toBe(60_000);
        expect(out.expiredUnrecoverableSats).toBe(10_000);
    });

    it('never raises the headline above what bark reported', () => {
        const out = applyExpiredVtxoFilter(
            summary(60_000, 50_000),
            [view({ id: 'live', sats: 60_000 }), view({ id: 'old', sats: 10_000, expiryHeight: TIP - 3 })],
            TIP,
            MAX_DEPTH,
        );
        expect(out.spendableSats).toBeLessThanOrEqual(60_000);
    });

    it('without the depth limit, reports what bark left out beyond the expired capsules', () => {
        const out = applyExpiredVtxoFilter(
            summary(60_000, 30_000),
            [
                view({ id: 'live', sats: 60_000 }),
                view({ id: 'old', sats: 10_000, expiryHeight: TIP - 3 }),
                view({ id: 'deep', sats: 20_000, exitDepth: MAX_DEPTH }),
            ],
            TIP,
            null,
        );
        expect(out.spendableSats).toBe(60_000);
        expect(out.needsRefreshSats).toBe(20_000);
    });

    it('a summary from an older binding (no needsRefresh) is filtered exactly as before', () => {
        // Pre-0.8 bark counted the expired capsule as spendable, so it comes off.
        const out = applyExpiredVtxoFilter(
            summary(100_000),
            [
                view({ id: 'exiting', sats: 30_000, exiting: true }),
                view({ id: 'old', sats: 10_000, expiryHeight: TIP - 5 }),
                view({ id: 'live', sats: 60_000 }),
            ],
            TIP,
        );
        expect(out.spendableSats).toBe(60_000);
        expect(out.pendingExitSats).toBe(30_000);
        expect(out.expiredUnrecoverableSats).toBe(10_000);
    });
});

describe('isArkRoundInFlight (bark 0.8.0 RoundState.state)', () => {
    // RoundFlowKind numbers, as the stand-in above (and the SDK) number them.
    const DELEGATED_PENDING = 0;
    const PENDING = 1;
    const ONGOING = 2;
    const AWAITING_CONFIRMATIONS = 3;
    const FAILED = 4;
    const CANCELED = 5;

    it('counts a delegated refresh waiting for its round, which reads ongoing=false', () => {
        expect(isArkRoundInFlight({ ongoing: false, state: DELEGATED_PENDING })).toBe(true);
    });

    it.each([PENDING, ONGOING])('counts interactive state %s', (state) => {
        expect(isArkRoundInFlight({ ongoing: false, state })).toBe(true);
    });

    it.each([AWAITING_CONFIRMATIONS, FAILED, CANCELED])('does not count finished state %s', (state) => {
        expect(isArkRoundInFlight({ ongoing: false, state })).toBe(false);
    });

    it('still trusts ongoing=true, which is all bark 0.6.1 reported', () => {
        expect(isArkRoundInFlight({ ongoing: true })).toBe(true);
        expect(isArkRoundInFlight({ ongoing: false })).toBe(false);
    });

    it('does not block on a state it does not know', () => {
        // Blocking could stop refreshes for good; a capsule never refreshed expires.
        expect(isArkRoundInFlight({ ongoing: false, state: 99 })).toBe(false);
        expect(isArkRoundInFlight(null)).toBe(false);
    });

    it('names the state for logs', () => {
        expect(roundFlowName(DELEGATED_PENDING)).toBe('DelegatedPending');
        expect(describeArkRound({ id: 7, ongoing: false, state: DELEGATED_PENDING })).toBe('7(DelegatedPending)');
        expect(describeArkRound({ id: 8, ongoing: false })).toBe('8(finalising)');
    });
});

describe('isInFlightInputsRefusal (server 0.8.1)', () => {
    it('recognises the in-flight-inputs refusal in the inner message', () => {
        expect(isInFlightInputsRefusal({
            message: 'BarkError.ServerConnection',
            inner: { errorMessage: 'status: InvalidArgument, message: "inputs held by a round attempt", metadata: {"in-flight-inputs": "abc:0"}' },
        })).toBe(true);
    });

    it('ignores other failures', () => {
        expect(isInFlightInputsRefusal(new Error('round failed: timeout'))).toBe(false);
        expect(isInFlightInputsRefusal(null)).toBe(false);
    });
});

describe('reading the txid after an on-chain send or offboard (bark 0.8.0 OffboardResult)', () => {
    const TXID = 'cd'.repeat(32);

    it('offboardTxid takes the new and the old shape and never throws', () => {
        expect(offboardTxid({ txid: TXID, movementId: 3 })).toBe(TXID);
        expect(offboardTxid(TXID)).toBe(TXID);
        expect(offboardTxid({ movementId: 3 })).toBe('');
        expect(offboardTxid(undefined)).toBe('');
        expect(offboardTxid({ txid: 42 })).toBe('');
    });

    it('offboardArkVtxos returns the txid string', async () => {
        mockHandle.offboardVtxos.mockResolvedValue({ txid: TXID, movementId: 9 });
        await expect(offboardArkVtxos(['a', 'b'], '  bc1qdest  ')).resolves.toBe(TXID);
        expect(mockHandle.offboardVtxos).toHaveBeenCalledWith(['a', 'b'], 'bc1qdest');
    });

    it('convertToExitFees returns the txid string', async () => {
        mockHandle.sendOnchain.mockResolvedValue({ txid: TXID, movementId: 10 });
        await expect(convertToExitFees(5_000)).resolves.toEqual({ txid: TXID, grossSats: 5_000 });
        expect(mockHandle.sendOnchain).toHaveBeenCalledWith('bc1qfeewallet', 5_000n);
    });
});

describe('createArkLightningInvoice (bark 0.8.1 expirySecs)', () => {
    it("passes all four arguments, leaving description, token and expiry to bark's defaults", async () => {
        mockHandle.bolt11Invoice.mockResolvedValue({ invoice: 'lnbc1example' });
        await expect(createArkLightningInvoice(2_500)).resolves.toBe('lnbc1example');
        expect(mockHandle.bolt11Invoice).toHaveBeenCalledWith(2_500n, undefined, undefined, undefined);
    });
});

describe('readArkRecoveryStatus (bark 0.7.0 recoveryStatus)', () => {
    const report = { isComplete: true };

    it('tells a failed scan from one that never ran', () => {
        expect(readArkRecoveryStatus({ tag: 'Failed', inner: { message: 'server unreachable' } })).toEqual({
            outcome: 'failed',
            message: 'server unreachable',
        });
        expect(readArkRecoveryStatus({ tag: 'NotRun' })).toEqual({ outcome: 'not-run' });
    });

    it('carries the report of a completed scan', () => {
        expect(readArkRecoveryStatus({ tag: 'Completed', inner: { report } })).toEqual({ outcome: 'completed', report });
    });

    it.each([undefined, null, {}, { tag: 'Somewhere' }])('reads %j as unknown, never as complete', (status) => {
        expect(readArkRecoveryStatus(status).outcome).toBe('unknown');
    });
});

describe('pending Lightning receives with an optional amount (bark 0.8.x)', () => {
    it('reads a missing amount as 0 instead of NaN', async () => {
        mockHandle.pendingLightningReceives.mockResolvedValue([
            { paymentHash: 'aa'.repeat(32), invoice: 'lnbc1a', state: 'awaiting-payment' },
            { paymentHash: 'bb'.repeat(32), invoice: 'lnbc1b', amountSats: 1_234n, state: 'htlcs-ready' },
        ]);
        const out = await fetchArkPendingLightningReceives();
        expect(out.map((r) => r.amountSats)).toEqual([0, 1_234]);
        expect(out[1].hasHtlcVtxos).toBe(true);
    });
});

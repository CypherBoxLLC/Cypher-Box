/**
 * The list of capsules the Ark server has called spent must not be trusted all
 * the way (reported by MrHodl, 0.1.14 item 1).
 *
 * Three rules, each tested against the real modules with only the native bark
 * handle faked:
 *   accept  an id goes on the list only if it was an input of the call that
 *           failed
 *   show    a listed capsule is excluded from the exit set with its own reason
 *           and keeps its amount and expiry, instead of vanishing
 *   prune   an id leaves the list only on the wallet's own evidence of the
 *           spend, never on the server's word alone
 */

import useAuthStore from '../../src/stores/authStore';
import { computeArkExitPlan, computeExitFeeReserveSats } from '../../src/services/ark/exitFunding';
import { triageArkExit, type ExitTriageVtxo } from '../../src/services/ark/exitTriage';
import {
    acceptServerSpentId,
    serverSpentIdsWithWalletEvidence,
    soonestExpiryBlocks,
} from '../../src/services/ark/serverSpentList';
import { recheckArkServerSpentVtxos } from '../../src/services/ark/serverSpentRecheck';
import {
    fetchArkVtxos,
    recordAndDescribeNotSpendable,
    recordServerSpentFromError,
    spendableVtxoIdsForInputs,
} from '../../src/services/ark/vtxos';

const mockHandle = {
    allVtxos: jest.fn(),
    getExitVtxos: jest.fn(),
    balance: jest.fn(),
    sync: jest.fn(),
};
const mockHandleRef: { current: typeof mockHandle | null } = { current: mockHandle };
const mockSyncArkWallet = jest.fn();
const mockFetchChainTipHeight = jest.fn();

jest.mock('../../src/services/ark/walletHandle', () => ({
    __esModule: true,
    getArkWalletHandle: () => mockHandleRef.current,
    getCachedArkMnemonic: () => null,
    getLastOnchainBalanceSats: () => ({ confirmedSats: 0, pendingSats: 0 }),
    ensureArkOnchainHandle: jest.fn(),
}));
jest.mock('@secondts/bark-react-native', () => ({
    __esModule: true,
    Network: { Bitcoin: 'Bitcoin' },
    Config: { create: jest.fn() },
    extractTxFromPsbt: jest.fn(),
}));
jest.mock('../../src/services/ark/restore', () => ({
    __esModule: true,
    ensureArkWalletHandleReady: jest.fn(async () => mockHandleRef.current),
}));
jest.mock('../../src/services/ark/exit', () => ({
    __esModule: true,
    assertNoActiveArkExit: jest.fn(),
    assertNoActiveArkExitAsync: jest.fn(async () => undefined),
}));
jest.mock('../../src/services/ark/receive', () => ({
    __esModule: true,
    getArkOnchainAddress: jest.fn(),
}));
jest.mock('../../src/services/ark/sync', () => ({
    __esModule: true,
    syncArkWallet: (...args: unknown[]) => mockSyncArkWallet(...args),
}));
jest.mock('../../src/services/ark/chainTip', () => ({
    __esModule: true,
    AVG_BLOCK_MINUTES: 10,
    fetchChainTipHeight: (...args: unknown[]) => mockFetchChainTipHeight(...args),
    getChainTipFetchedAt: () => Date.now(),
}));
jest.mock('@Cypher/stores/eventLogStore', () => ({
    __esModule: true,
    recordEvent: jest.fn(),
}));

const TIP = 900_000;
const PHANTOM = `${'9ca5'.repeat(16)}:0`;
const LIVE = `${'1f66'.repeat(16)}:1`;
const OTHER = `${'d4ec'.repeat(16)}:0`;

/** The server's refusal, worded as a tester's device produced it. */
const spentError = (id: string) => ({
    message: 'BarkError.Internal',
    inner: { errorMessage: `error making payment: bad user input: vtxo ${id} is not spendable (state: spent)` },
});

/** A capsule as bark's allVtxos() returns it. */
function sdkVtxo(id: string, sats: number, state = 'Spendable', expiryHeight = TIP + 20_000) {
    return {
        id,
        amountSats: BigInt(sats),
        expiryHeight,
        kind: 'round',
        exitDepth: 2,
        exitTxWeightWu: 1325n,
        state: { tag: state },
        registered: true,
    };
}

function sdkBalance(spendableSats: number) {
    return {
        spendableSats: BigInt(spendableSats),
        needsRefreshSats: 0n,
        pendingInRoundSats: 0n,
        pendingExitSats: 0n,
        pendingLightningSendSats: 0n,
        claimableLightningReceiveSats: 0n,
        pendingBoardSats: 0n,
        pendingArkoorSendSats: 0n,
        pendingOffboardSats: 0n,
    };
}

const exitRecord = (vtxoId: string, tag: string, sats = 1_000) => ({
    vtxoId,
    amountSats: BigInt(sats),
    state: { tag },
    isClaimable: tag === 'Claimable',
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeAll(async () => {
    await settle();
});

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockHandleRef.current = mockHandle;
    mockHandle.allVtxos.mockResolvedValue([
        sdkVtxo(PHANTOM, 40_000),
        sdkVtxo(LIVE, 60_000),
        sdkVtxo(OTHER, 10_000, 'Spent'),
    ]);
    mockHandle.getExitVtxos.mockResolvedValue([]);
    mockHandle.balance.mockResolvedValue(sdkBalance(100_000));
    mockHandle.sync.mockResolvedValue(undefined);
    mockSyncArkWallet.mockResolvedValue(true);
    mockFetchChainTipHeight.mockResolvedValue(TIP);
    (global as any).fetch = jest.fn(async () => {
        throw new Error('offline');
    });
    useAuthStore.setState({
        arkServerSpentVtxoIds: [],
        arkExitStartedVtxoIds: [],
        arkForcedExitNoticedVtxoIds: [],
        arkExitStartedAt: null,
        arkVtxos: [],
        arkBalance: 100_000,
        arkChainTipHeight: TIP,
        arkChainTipHeightAt: Date.now(),
        arkVtxoExitDeltaBlocks: 144,
        arkMaxVtxoExitDepth: 100,
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('accepting a server-reported spent id', () => {
    it('records the capsule when it was an input of the failed call', async () => {
        const parsed = await recordServerSpentFromError(spentError(PHANTOM), [PHANTOM, LIVE]);
        expect(parsed).toEqual({ vtxoId: PHANTOM, state: 'spent' });
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([PHANTOM]);
        // The correction lands with the failure that revealed it.
        expect(useAuthStore.getState().arkVtxos.map((v) => v.id)).toEqual([LIVE]);
        expect(useAuthStore.getState().arkBalance).toBe(60_000);
    });

    it('matches the input list without regard to case', async () => {
        await recordServerSpentFromError(spentError(PHANTOM.toUpperCase()), [PHANTOM]);
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([PHANTOM]);
    });

    it('does not record a capsule the failed call never used, but still classifies it', async () => {
        // The call refreshed LIVE; the response names PHANTOM.
        const parsed = await recordServerSpentFromError(spentError(PHANTOM), [LIVE]);
        expect(parsed).toEqual({ vtxoId: PHANTOM, state: 'spent' });
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([]);
        expect(useAuthStore.getState().arkBalance).toBe(100_000);
    });

    it('records nothing when the caller cannot name its inputs', async () => {
        const parsed = await recordServerSpentFromError(spentError(PHANTOM), null);
        expect(parsed?.state).toBe('spent');
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([]);
    });

    it('still gives the spent copy for a described-only failure', async () => {
        const msg = await recordAndDescribeNotSpendable(spentError(PHANTOM), null);
        expect(msg?.title).toBeTruthy();
        expect(msg?.body).not.toMatch(/not spendable|state:|bad user input/i);
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([]);
    });

    it('never records a transient state, whatever the input list says', async () => {
        const err = { message: `vtxo ${PHANTOM} is not spendable (state: unregistered)` };
        await recordServerSpentFromError(err, [PHANTOM]);
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([]);
    });

    it('the pure rule: in the list yes, outside no, no list no', () => {
        expect(acceptServerSpentId(PHANTOM, [LIVE, PHANTOM])).toBe(true);
        expect(acceptServerSpentId(PHANTOM.toUpperCase(), [PHANTOM])).toBe(true);
        expect(acceptServerSpentId(PHANTOM, [LIVE])).toBe(false);
        expect(acceptServerSpentId(PHANTOM, [])).toBe(false);
        expect(acceptServerSpentId(PHANTOM, null)).toBe(false);
        expect(acceptServerSpentId(null, [PHANTOM])).toBe(false);
    });

    it('bark-picked calls are bounded by the Spendable set', async () => {
        // maintenanceDelegated and amount-based sends have no id list of
        // their own; the wallet's Spendable capsules are the honest bound.
        await expect(spendableVtxoIdsForInputs()).resolves.toEqual([PHANTOM, LIVE]);
        mockHandleRef.current = null;
        await expect(spendableVtxoIdsForInputs()).resolves.toBeNull();
    });
});

describe('a listed capsule in the exit plan', () => {
    it('is excluded under its own reason, with its amount and expiry, not dropped', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        mockHandle.allVtxos.mockResolvedValue([
            sdkVtxo(PHANTOM, 2_000_000, 'Spendable', TIP + 3_000),
            sdkVtxo(LIVE, 3_000_000),
        ]);
        const plan = await computeArkExitPlan();
        expect(plan?.selectedIds).toEqual([LIVE]);
        const entry = plan?.excluded.find((e) => e.id === PHANTOM);
        expect(entry?.reason).toBe('server-says-spent');
        expect(entry?.sats).toBe(2_000_000);
        expect(entry?.blocksUntilExpiry).toBe(3_000);
        // Disclosed in the total the user is told they are leaving behind.
        expect(plan?.excludedSats).toBe(2_000_000);
    });

    it('is not brought back by "exit anyway"', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        mockHandle.allVtxos.mockResolvedValue([sdkVtxo(PHANTOM, 2_000_000), sdkVtxo(LIVE, 3_000_000)]);
        const plan = await computeArkExitPlan({ economicPolicy: 'recover-everything' });
        expect(plan?.selectedIds).toEqual([LIVE]);
        expect(plan?.overridableCount).toBe(0);
    });

    it('is reported ahead of any economic verdict', () => {
        const v = (p: Partial<ExitTriageVtxo> & { id: string; sats: number }): ExitTriageVtxo => ({
            exitDepth: 17,
            exitTxWeightWu: 12377,
            expiryHeight: TIP + 20_000,
            stateTag: 'Spendable',
            ...p,
        });
        const out = triageArkExit({
            vtxos: [v({ id: PHANTOM, sats: 400, serverSpent: true }), v({ id: LIVE, sats: 400 })],
            feeRateSatPerVb: 1,
            chainTipHeight: TIP,
            vtxoExitDeltaBlocks: 144,
        });
        expect(out.excluded.find((e) => e.id === PHANTOM)?.reason).toBe('server-says-spent');
        expect(out.excluded.find((e) => e.id === LIVE)?.reason).toBe('fees-dwarf-value');
        // A terminal capsule is still skipped, not reported, whatever the flag.
        const terminal = triageArkExit({
            vtxos: [v({ id: OTHER, sats: 400, serverSpent: true, stateTag: 'Spent' })],
            feeRateSatPerVb: 1,
            chainTipHeight: TIP,
            vtxoExitDeltaBlocks: 144,
        });
        expect(terminal.excluded).toEqual([]);
        expect(terminal.skippedTerminalCount).toBe(1);
    });

    it('is counted apart from the economic exclusions in the reserve', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        mockHandle.allVtxos.mockResolvedValue([
            sdkVtxo(PHANTOM, 2_000_000, 'Spendable', TIP + 3_000),
            sdkVtxo(LIVE, 3_000_000),
        ]);
        const r = await computeExitFeeReserveSats();
        expect(r.vtxoCount).toBe(1);
        expect(r.excludedCount).toBe(0);
        expect(r.excludedSats).toBe(0);
        expect(r.serverSaysSpent).toEqual({ count: 1, sats: 2_000_000, soonestExpiryBlocks: 3_000 });
    });

    it('leaves the reserve unchanged for a wallet with nothing listed', async () => {
        mockHandle.allVtxos.mockResolvedValue([sdkVtxo(PHANTOM, 2_000_000), sdkVtxo(LIVE, 3_000_000)]);
        const r = await computeExitFeeReserveSats();
        expect(r.vtxoCount).toBe(2);
        expect(r.serverSaysSpent).toEqual({ count: 0, sats: 0, soonestExpiryBlocks: null });
    });

    it('soonest expiry ignores unknown ones', () => {
        expect(soonestExpiryBlocks([{ blocksUntilExpiry: null }])).toBeNull();
        expect(soonestExpiryBlocks([{ blocksUntilExpiry: 50 }, { blocksUntilExpiry: null }, { blocksUntilExpiry: 7 }])).toBe(7);
    });
});

describe('pruning the list', () => {
    it('the pure rule: only the wallet\'s own records count', () => {
        const listed = [PHANTOM, LIVE, OTHER];
        expect(
            serverSpentIdsWithWalletEvidence(listed, [{ id: PHANTOM, stateTag: 'Spent' }, { id: LIVE, stateTag: 'Spendable' }], []),
        ).toEqual([PHANTOM]);
        expect(
            serverSpentIdsWithWalletEvidence(listed, [], [exitRecord(LIVE, 'VtxoAlreadySpent'), exitRecord(OTHER, 'Claimed')]),
        ).toEqual([LIVE, OTHER]);
        expect(serverSpentIdsWithWalletEvidence(listed, [], [exitRecord(LIVE, 'VtxoSwept')])).toEqual([LIVE]);
        // Live, cancelled or unknown exit records are not evidence of a spend.
        expect(
            serverSpentIdsWithWalletEvidence(listed, [], [
                exitRecord(PHANTOM, 'AwaitingDelta'),
                exitRecord(LIVE, 'Canceled'),
                exitRecord(OTHER, 'Processing'),
            ]),
        ).toEqual([]);
        expect(serverSpentIdsWithWalletEvidence([], [{ id: PHANTOM, stateTag: 'Spent' }], [])).toEqual([]);
    });

    it('removes an id once bark itself marks the capsule spent', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        mockHandle.allVtxos.mockResolvedValue([sdkVtxo(PHANTOM, 40_000, 'Spent'), sdkVtxo(LIVE, 60_000)]);
        await fetchArkVtxos();
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([]);
    });

    it('removes an id once bark holds a finished exit record for it', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        mockHandle.getExitVtxos.mockResolvedValue([exitRecord(PHANTOM, 'VtxoAlreadySpent')]);
        await fetchArkVtxos();
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([]);
    });

    it('keeps an id while bark still calls the capsule Spendable, however often the server repeats itself', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        await fetchArkVtxos();
        await recordServerSpentFromError(spentError(PHANTOM), [PHANTOM]);
        await fetchArkVtxos();
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([PHANTOM]);
        // Still hidden from the spendable set and the balance meanwhile.
        const list = await fetchArkVtxos();
        expect(list?.spendable.map((v) => v.id)).toEqual([LIVE]);
        expect(list?.all.find((v) => v.id === PHANTOM)?.serverSpent).toBe(true);
    });

    it('keeps an id whose exit is still live or was cancelled', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM, LIVE] });
        mockHandle.getExitVtxos.mockResolvedValue([exitRecord(PHANTOM, 'AwaitingDelta'), exitRecord(LIVE, 'Canceled')]);
        await fetchArkVtxos();
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([PHANTOM, LIVE]);
    });
});

describe('Re-check', () => {
    it('reports nothing to do for an empty list without touching the server', async () => {
        await expect(recheckArkServerSpentVtxos()).resolves.toEqual({ outcome: 'nothing', confirmedIds: [], remainingIds: [] });
        expect(mockSyncArkWallet).not.toHaveBeenCalled();
    });

    it('asks the server and the chain, and prunes only what the wallet then confirms', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM, LIVE] });
        // After the sync, bark records PHANTOM as spent; LIVE is still Spendable.
        mockHandle.allVtxos.mockResolvedValue([sdkVtxo(PHANTOM, 40_000, 'Spent'), sdkVtxo(LIVE, 60_000)]);
        const out = await recheckArkServerSpentVtxos();
        expect(mockSyncArkWallet).toHaveBeenCalledTimes(1);
        expect(mockFetchChainTipHeight).toHaveBeenCalledTimes(1);
        expect(out).toEqual({ outcome: 'confirmed', confirmedIds: [PHANTOM], remainingIds: [LIVE] });
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([LIVE]);
    });

    it('reports no change when the server was reached and the wallet still disagrees', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        const out = await recheckArkServerSpentVtxos();
        expect(out).toEqual({ outcome: 'unchanged', confirmedIds: [], remainingIds: [PHANTOM] });
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([PHANTOM]);
    });

    it('reports a failure, and changes nothing, when the server is unreachable', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        mockSyncArkWallet.mockRejectedValue(new Error('connect error: transport error'));
        const out = await recheckArkServerSpentVtxos();
        expect(out.outcome).toBe('failed');
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([PHANTOM]);
    });

    it('still prunes on wallet evidence even when the server is down', async () => {
        // The chain can have moved on without the server: an exit of this
        // capsule finished. The wallet's own record is the evidence.
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        mockSyncArkWallet.mockRejectedValue(new Error('connect error: transport error'));
        mockHandle.getExitVtxos.mockResolvedValue([exitRecord(PHANTOM, 'Claimed')]);
        const out = await recheckArkServerSpentVtxos();
        expect(out).toEqual({ outcome: 'confirmed', confirmedIds: [PHANTOM], remainingIds: [] });
    });
});

/**
 * A capsule the Ark server says is already spent must stop counting anywhere
 * the wallet decides what the user can spend or exit.
 *
 * bark decides spendability from its own database and never asks the server,
 * so a capsule spent from another device holding the same seed (or brought
 * back by restoring an old backup file) stays Spendable in bark forever. The
 * app records its id when a spend is refused (`arkServerSpentVtxoIds`). It used
 * to hide it from the capsule list only, while the headline balance, swap Max,
 * the swap balance check and the emergency-exit set all still counted it, and
 * only some spend paths recorded it at all.
 *
 * Only the native bark handle is faked here. The list, the balance filter, the
 * store, the exit plan and the refresh service are the real modules.
 */

import loc from '../../loc';
import arkSwapProvider from '../../src/services/lightningSwap/providers/ark';
import useAuthStore from '../../src/stores/authStore';
import { applyExpiredVtxoFilter, fetchArkBalance, type ArkBalanceSummary } from '../../src/services/ark/balance';
import {
    fetchArkVtxos,
    recordAndDescribeNotSpendable,
    recordServerSpentFromError,
    type ArkVtxoView,
} from '../../src/services/ark/vtxos';
import { computeArkExitPlan } from '../../src/services/ark/exitFunding';
import {
    maintenanceArkDelegated,
    refreshArkVtxos,
    refreshArkVtxosDelegated,
} from '../../src/services/ark/refresh';

const mockHandle = {
    allVtxos: jest.fn(),
    getExitVtxos: jest.fn(),
    balance: jest.fn(),
    pendingRoundStates: jest.fn(),
    refreshVtxos: jest.fn(),
    refreshVtxosDelegated: jest.fn(),
    maintenanceDelegated: jest.fn(),
    sync: jest.fn(),
};
const mockHandleRef: { current: typeof mockHandle | null } = { current: mockHandle };

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
jest.mock('../../src/services/ark/backup', () => ({
    __esModule: true,
    writeArkAutoBackup: jest.fn(async () => ({ createdAt: 0, offDevice: false })),
}));
jest.mock('../../src/services/ark/backgroundNotifications', () => ({
    __esModule: true,
    scheduleArkRefreshReminder: jest.fn(),
}));
jest.mock('@Cypher/stores/eventLogStore', () => ({
    __esModule: true,
    recordEvent: jest.fn(),
}));

// The swap provider reads through the barrel. The list and the balance filter
// stay the real modules; only the fee quote and the send itself are faked.
const mockEstimateArkSendFee = jest.fn();
const mockExecuteArkSend = jest.fn();
jest.mock('@Cypher/services/ark', () => {
    const balance = jest.requireActual('../../src/services/ark/balance');
    const vtxos = jest.requireActual('../../src/services/ark/vtxos');
    return {
        __esModule: true,
        applyExpiredVtxoFilter: balance.applyExpiredVtxoFilter,
        fetchArkBalance: balance.fetchArkBalance,
        fetchArkVtxos: vtxos.fetchArkVtxos,
        fetchChainTipHeight: async () => 900_000,
        estimateArkSendFee: (...args: unknown[]) => mockEstimateArkSendFee(...args),
        executeArkSend: (...args: unknown[]) => mockExecuteArkSend(...args),
        classifyArkDestination: (value: string) => ({ kind: 'ln-invoice', value }),
        createArkLightningInvoice: jest.fn(),
        fetchArkPendingLightningReceives: async () => [],
    };
});
jest.mock('@Cypher/services/ark/movementWatcher', () => ({
    __esModule: true,
    hadSuccessfulReceiveSince: () => false,
}));
// The registry exports a function named `require`, which shadows the module
// loader once ts-jest compiles it to CommonJS. The provider only registers
// itself with it.
jest.mock('../../src/services/lightningSwap/registry', () => ({
    __esModule: true,
    register: jest.fn(),
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
function sdkVtxo(id: string, sats: number, state = 'Spendable') {
    return {
        id,
        amountSats: BigInt(sats),
        expiryHeight: TIP + 20_000,
        kind: 'round',
        exitDepth: 2,
        exitTxWeightWu: 1325n,
        state,
        registered: true,
    };
}

/** bark's balance(): it still counts the phantom, because it never asked the server. */
function sdkBalance(spendableSats: number) {
    return {
        spendableSats: BigInt(spendableSats),
        pendingInRoundSats: 0n,
        pendingExitSats: 0n,
        pendingLightningSendSats: 0n,
        claimableLightningReceiveSats: 0n,
        pendingBoardSats: 0n,
    };
}

function summary(spendableSats: number): ArkBalanceSummary {
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
    };
}

function view(p: Partial<ArkVtxoView> & { id: string; sats: number }): ArkVtxoView {
    return { expiryHeight: TIP + 20_000, kind: 'round', state: 'Spendable', ...p };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeAll(async () => {
    // Let the store's own load at import finish, so it cannot land mid-test.
    await settle();
});

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockHandleRef.current = mockHandle;
    // bark's view: a 40,000-sat phantom beside a 60,000-sat live capsule, plus
    // an ordinary piece of spent history.
    mockHandle.allVtxos.mockResolvedValue([
        sdkVtxo(PHANTOM, 40_000),
        sdkVtxo(LIVE, 60_000),
        sdkVtxo(OTHER, 10_000, 'Spent'),
    ]);
    mockHandle.getExitVtxos.mockResolvedValue([]);
    mockHandle.balance.mockResolvedValue(sdkBalance(100_000));
    mockHandle.pendingRoundStates.mockResolvedValue([]);
    mockHandle.sync.mockResolvedValue(undefined);
    useAuthStore.setState({
        arkServerSpentVtxoIds: [],
        arkVtxos: [],
        arkBalance: 100_000,
        arkBalanceDetail: summary(100_000),
        arkRefreshFailStreak: 0,
        arkRefreshingVtxoIds: [],
        arkChainTipHeight: TIP,
        arkChainTipHeightAt: Date.now(),
        arkVtxoExitDeltaBlocks: 144,
        arkMaxVtxoExitDepth: 100,
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('the balance filter', () => {
    it('takes a server-spent capsule out of the spendable balance', () => {
        const out = applyExpiredVtxoFilter(
            summary(100_000),
            [view({ id: PHANTOM, sats: 40_000, serverSpent: true }), view({ id: LIVE, sats: 60_000 })],
            TIP,
        );
        expect(out.spendableSats).toBe(60_000);
        expect(out.totalSats).toBe(60_000);
        // Gone, not pending: nothing on this wallet will pay it out.
        expect(out.pendingExitSats).toBe(0);
        expect(out.expiredUnrecoverableSats).toBe(0);
    });

    it('does not count it as a pending exit or as expired dust either', () => {
        const out = applyExpiredVtxoFilter(
            summary(100_000),
            [
                view({ id: PHANTOM, sats: 30_000, serverSpent: true, exiting: true }),
                view({ id: OTHER, sats: 10_000, serverSpent: true, expiryHeight: TIP - 5 }),
                view({ id: LIVE, sats: 60_000 }),
            ],
            TIP,
        );
        expect(out.spendableSats).toBe(60_000);
        expect(out.pendingExitSats).toBe(0);
        expect(out.expiredUnrecoverableSats).toBe(0);
    });

    it('leaves a capsule bark itself no longer counts as spendable alone', () => {
        // A Locked capsule is not in bark's spendableSats, so subtracting it
        // again would under-report the balance.
        const out = applyExpiredVtxoFilter(
            summary(60_000),
            [view({ id: PHANTOM, sats: 40_000, serverSpent: true, state: 'Locked' }), view({ id: LIVE, sats: 60_000 })],
            TIP,
        );
        expect(out.spendableSats).toBe(60_000);
    });

    it('keeps the expired and exiting rules for capsules not on the list', () => {
        const out = applyExpiredVtxoFilter(
            summary(100_000),
            [
                view({ id: PHANTOM, sats: 30_000, exiting: true }),
                view({ id: OTHER, sats: 10_000, expiryHeight: TIP - 5 }),
                view({ id: LIVE, sats: 60_000 }),
            ],
            TIP,
        );
        expect(out.spendableSats).toBe(60_000);
        expect(out.pendingExitSats).toBe(30_000);
        expect(out.expiredUnrecoverableSats).toBe(10_000);
    });
});

describe('fetchArkVtxos and the headline it feeds', () => {
    it('flags a recorded capsule, whatever its case, and leaves it out of the list', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM.toUpperCase()] });
        const list = await fetchArkVtxos();
        expect(list?.spendable.map((v) => v.id)).toEqual([LIVE]);
        expect(list?.all.find((v) => v.id === PHANTOM)?.serverSpent).toBe(true);
        expect(list?.all.find((v) => v.id === LIVE)?.serverSpent).toBe(false);
    });

    it('gives the same headline the sync tick writes: bark minus the recorded capsule', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        const [balance, list] = await Promise.all([fetchArkBalance(), fetchArkVtxos()]);
        const headline = applyExpiredVtxoFilter(balance as ArkBalanceSummary, list?.all, TIP);
        expect(headline.totalSats).toBe(60_000);
    });

    it('changes nothing for a wallet with no recorded capsule', async () => {
        const [balance, list] = await Promise.all([fetchArkBalance(), fetchArkVtxos()]);
        expect(list?.spendable.map((v) => v.id)).toEqual([PHANTOM, LIVE]);
        expect(applyExpiredVtxoFilter(balance as ArkBalanceSummary, list?.all, TIP).totalSats).toBe(100_000);
    });
});

describe('swap Max and the swap balance check', () => {
    beforeEach(() => {
        mockEstimateArkSendFee.mockResolvedValue({ feeSats: 100 });
        mockExecuteArkSend.mockResolvedValue({ id: 'paid', feeSats: 100 });
    });

    // Max is the source balance minus this reserve. The fee estimate is padded
    // by a quarter, so 100 sats of fee holds back 125.
    const maxFor = async (balanceSats: number) =>
        balanceSats - (await arkSwapProvider.maxFeeReserve!(balanceSats));

    it('Max leaves out a recorded capsule', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        await expect(maxFor(100_000)).resolves.toBe(60_000 - 125);
    });

    it('Max is unchanged for a wallet with no recorded capsule', async () => {
        await expect(maxFor(100_000)).resolves.toBe(100_000 - 125);
    });

    it('refuses a swap only the recorded capsule could cover, before anything is sent', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        await expect(arkSwapProvider.payInvoice('lnbc-test', 80_000)).rejects.toThrow(/Not enough Ark balance/);
        expect(mockExecuteArkSend).not.toHaveBeenCalled();

        await arkSwapProvider.payInvoice('lnbc-test', 50_000);
        expect(mockExecuteArkSend).toHaveBeenCalledTimes(1);
    });
});

describe('recordServerSpentFromError', () => {
    it('records the capsule and corrects the stored list and balance at once', async () => {
        const parsed = await recordServerSpentFromError(spentError(PHANTOM));
        expect(parsed).toEqual({ vtxoId: PHANTOM, state: 'spent' });
        const s = useAuthStore.getState();
        expect(s.arkServerSpentVtxoIds).toEqual([PHANTOM]);
        expect(s.arkVtxos.map((v) => v.id)).toEqual([LIVE]);
        expect(s.arkBalance).toBe(60_000);
        expect(s.arkBalanceDetail?.spendableSats).toBe(60_000);
    });

    it('does not record a transient refusal, or touch the balance for it', async () => {
        const err = { message: `vtxo ${PHANTOM} is not spendable (state: unregistered)` };
        const parsed = await recordServerSpentFromError(err);
        expect(parsed?.state).toBe('unregistered');
        const s = useAuthStore.getState();
        expect(s.arkServerSpentVtxoIds).toEqual([]);
        expect(s.arkBalance).toBe(100_000);
    });

    it('never writes bark\'s raw balance when the capsule list cannot be read', async () => {
        // Without the list the filter would hand back bark's number, phantom
        // and all, over a headline that may already be right.
        mockHandle.allVtxos.mockRejectedValue(new Error('handle busy'));
        await recordServerSpentFromError(spentError(PHANTOM));
        const s = useAuthStore.getState();
        expect(s.arkServerSpentVtxoIds).toEqual([PHANTOM]);
        expect(s.arkBalance).toBe(100_000);
    });
});

describe('recordAndDescribeNotSpendable, which the send, withdraw and convert screens call', () => {
    const vss = loc.cypherbox.services.vtxo_spend_state;

    it('records a named spent capsule and gives the spent copy', async () => {
        const msg = await recordAndDescribeNotSpendable(spentError(PHANTOM));
        expect(msg).toEqual({ title: vss.spent_title, body: vss.spent_body });
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([PHANTOM]);
        expect(msg?.body).not.toMatch(/not spendable|state:|bad user input/i);
    });

    it('does not claim a correction it could not make when the server named no capsule', async () => {
        const msg = await recordAndDescribeNotSpendable({ message: 'vtxo is not spendable (state: spent)' });
        expect(msg).toEqual({ title: vss.default_title, body: vss.default_body });
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([]);
    });

    it('gives a transient refusal its own copy without recording it', async () => {
        const msg = await recordAndDescribeNotSpendable({ message: `vtxo ${PHANTOM} is not spendable (state: unclaimed)` });
        expect(msg).toEqual({ title: vss.unclaimed_title, body: vss.unclaimed_body });
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([]);
    });

    it('returns null for any other failure, so the screen keeps its own message', async () => {
        await expect(recordAndDescribeNotSpendable(new Error('insufficient funds'))).resolves.toBeNull();
        await expect(recordAndDescribeNotSpendable(undefined)).resolves.toBeNull();
    });
});

describe('the emergency-exit set', () => {
    beforeEach(() => {
        // Every fee source unreachable: the plan prices at the fallback rates.
        (global as any).fetch = jest.fn(async () => {
            throw new Error('offline');
        });
    });

    it('leaves a recorded capsule out of the exit and its reserve', async () => {
        useAuthStore.setState({ arkServerSpentVtxoIds: [PHANTOM] });
        mockHandle.allVtxos.mockResolvedValue([sdkVtxo(PHANTOM, 2_000_000), sdkVtxo(LIVE, 3_000_000)]);
        const plan = await computeArkExitPlan();
        expect(plan?.selectedIds).toEqual([LIVE]);
        // Not disclosed as an exclusion either: it holds nothing of the user's.
        expect(plan?.excluded.map((e) => e.id)).not.toContain(PHANTOM);
    });

    it('still exits both when nothing is recorded', async () => {
        mockHandle.allVtxos.mockResolvedValue([sdkVtxo(PHANTOM, 2_000_000), sdkVtxo(LIVE, 3_000_000)]);
        const plan = await computeArkExitPlan();
        expect([...(plan?.selectedIds ?? [])].sort()).toEqual([LIVE, PHANTOM].sort());
    });
});

describe('a refresh the server refuses over a spent capsule', () => {
    it.each([
        ['delegated', () => refreshArkVtxosDelegated([PHANTOM, LIVE], 100_000), 'refreshVtxosDelegated'],
        ['self-signed', () => refreshArkVtxos([PHANTOM, LIVE], 100_000), 'refreshVtxos'],
    ] as const)('%s: records it and does not raise the failure streak', async (_label, run, sdkCall) => {
        const err = spentError(PHANTOM);
        mockHandle[sdkCall].mockRejectedValue(err);
        await expect(run()).rejects.toBe(err);
        const s = useAuthStore.getState();
        expect(s.arkServerSpentVtxoIds).toEqual([PHANTOM]);
        expect(s.arkRefreshFailStreak).toBe(0);
        expect(s.arkBalance).toBe(60_000);
    });

    it.each([
        ['an ordinary failure', new Error('connect error: transport error')],
        ['a spent refusal that names no capsule', { message: 'vtxo is not spendable (state: spent)' }],
        ['a transient refusal', { message: `vtxo ${PHANTOM} is not spendable (state: unregistered)` }],
    ])('still counts %s', async (_label, err) => {
        mockHandle.refreshVtxosDelegated.mockRejectedValue(err);
        await expect(refreshArkVtxosDelegated([LIVE], 60_000)).rejects.toBe(err);
        expect(useAuthStore.getState().arkRefreshFailStreak).toBe(1);
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([]);
    });

    it('is recorded by the background maintenance path too', async () => {
        const err = spentError(PHANTOM);
        mockHandle.maintenanceDelegated.mockRejectedValue(err);
        await expect(maintenanceArkDelegated()).rejects.toBe(err);
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([PHANTOM]);
    });
});

describe('the store', () => {
    const merge = (persisted: unknown) =>
        useAuthStore.persist.getOptions().merge?.(persisted, useAuthStore.getState()) as ReturnType<
            typeof useAuthStore.getState
        >;

    it('keeps capsules recorded before it loaded as well as the saved ones', () => {
        useAuthStore.getState().addArkServerSpentVtxoIds([PHANTOM]);
        expect(merge({ arkServerSpentVtxoIds: [OTHER] }).arkServerSpentVtxoIds).toEqual([OTHER, PHANTOM]);
        // Once each, when both lists hold it.
        expect(merge({ arkServerSpentVtxoIds: [OTHER, PHANTOM] }).arkServerSpentVtxoIds).toEqual([OTHER, PHANTOM]);
    });

    it('keeps the saved list when nothing was recorded before it loaded', () => {
        expect(merge({ arkServerSpentVtxoIds: [OTHER] }).arkServerSpentVtxoIds).toEqual([OTHER]);
        expect(merge({}).arkServerSpentVtxoIds).toEqual([]);
        expect(merge(undefined).arkServerSpentVtxoIds).toEqual([]);
    });

    it('keeps the 500 cap, dropping the oldest saved ids first', () => {
        const saved = Array.from({ length: 500 }, (_, i) => `${i.toString(16).padStart(64, '0')}:0`);
        useAuthStore.getState().addArkServerSpentVtxoIds([PHANTOM]);
        const merged = merge({ arkServerSpentVtxoIds: saved }).arkServerSpentVtxoIds;
        expect(merged).toHaveLength(500);
        expect(merged[merged.length - 1]).toBe(PHANTOM);
        expect(merged).not.toContain(saved[0]);
    });

    it('lowercases and de-duplicates on the way in, with the same cap', () => {
        const s = useAuthStore.getState();
        s.addArkServerSpentVtxoIds([PHANTOM.toUpperCase(), PHANTOM, '']);
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([PHANTOM]);
        s.addArkServerSpentVtxoIds(Array.from({ length: 600 }, (_, i) => `${i.toString(16).padStart(64, 'a')}:1`));
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toHaveLength(500);
    });

    it('survives a real load from storage after an early record', async () => {
        // A background wake can record before the store has loaded. The load
        // used to replace the list with the saved one and put the capsule back.
        useAuthStore.getState().addArkServerSpentVtxoIds([PHANTOM]);
        const storage = useAuthStore.persist.getOptions().storage!;
        const getItem = jest.spyOn(storage, 'getItem').mockResolvedValue({
            state: { arkServerSpentVtxoIds: [OTHER] },
            version: 1,
        } as any);
        await useAuthStore.persist.rehydrate();
        expect(getItem).toHaveBeenCalled();
        expect(useAuthStore.getState().arkServerSpentVtxoIds).toEqual([OTHER, PHANTOM]);
    });
});

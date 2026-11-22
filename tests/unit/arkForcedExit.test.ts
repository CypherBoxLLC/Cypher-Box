/**
 * Exits the user did not start (bark 0.9.0 `syncForceExitedVtxos`).
 *
 * The rules are pure (services/ark/forcedExit.ts) and tested without the SDK:
 * which exit records count as forced, which to tell the user about, and how
 * the started-id list is kept honest as records finish.
 */

import {
    classifyExitRecords,
    forcedExitIds,
    isLegacyUserExit,
    pickForcedExitsToNotice,
    pruneStartedExitIds,
    sumExitSats,
    shortAddress,
} from '../../src/services/ark/forcedExit';
import useAuthStore from '../../src/stores/authStore';
import { applyExpiredVtxoFilter, type ArkBalanceSummary } from '../../src/services/ark/balance';
import { assertNoActiveArkExit, assertNoActiveArkExitAsync } from '../../src/services/ark/exit';
import { driveForcedExits, resetForcedExitDriveForTests } from '../../src/services/ark/forcedExitDrive';
import { assertNotForcedExitVtxos } from '../../src/services/ark/forcedExitGuard';
import { lockForcedExitVtxos, resetForcedExitLocksForTests } from '../../src/services/ark/forcedExitLock';
import { offboardArkVtxos } from '../../src/services/ark/offboard';
import { maintenanceArkDelegated, refreshArkVtxosDelegated } from '../../src/services/ark/refresh';
import { isVtxoMidRound, type ArkVtxoView } from '../../src/services/ark/vtxos';

// Only the native bark handle is faked. The store, the guards, the refresh and
// offboard services and the forced-exit drive are the real modules.
const mockHandle = {
    allVtxos: jest.fn(),
    getExitVtxos: jest.fn(),
    getVtxoById: jest.fn(),
    lockVtxos: jest.fn(),
    balance: jest.fn(),
    pendingRoundStates: jest.fn(),
    refreshVtxosDelegated: jest.fn(),
    maintenanceDelegated: jest.fn(),
    offboardVtxos: jest.fn(),
    progressExits: jest.fn(),
    syncExits: jest.fn(),
    listClaimableExits: jest.fn(),
    drainExits: jest.fn(),
    signExitClaimInputs: jest.fn(),
    broadcastTx: jest.fn(),
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
    extractTxFromPsbt: jest.fn(() => 'deadbeef'),
}));
jest.mock('../../src/services/ark/restore', () => ({
    __esModule: true,
    ensureArkWalletHandleReady: jest.fn(async () => mockHandleRef.current),
}));
jest.mock('../../src/services/ark/receive', () => ({ __esModule: true, getArkOnchainAddress: jest.fn() }));
jest.mock('../../src/services/ark/backup', () => ({
    __esModule: true,
    writeArkAutoBackup: jest.fn(async () => ({ createdAt: 0, offDevice: false })),
}));
jest.mock('../../src/services/ark/backgroundNotifications', () => ({
    __esModule: true,
    scheduleArkRefreshReminder: jest.fn(),
}));
jest.mock('@Cypher/stores/eventLogStore', () => ({ __esModule: true, recordEvent: jest.fn() }));

const MINE = `${'1f66'.repeat(16)}:1`;
const FORCED = `${'9ca5'.repeat(16)}:0`;
const OLD = `${'d4ec'.repeat(16)}:0`;
const DEST = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const TIP = 900_000;

const rec = (vtxoId: string, tag: string, sats = 1_000) => ({
    vtxoId,
    amountSats: BigInt(sats),
    state: { tag },
    isClaimable: tag === 'Claimable',
});

/** A capsule row as the store holds it. */
const row = (p: Partial<ArkVtxoView> & { id: string }): ArkVtxoView => ({
    sats: 10_000,
    expiryHeight: TIP + 20_000,
    kind: 'round',
    state: 'Spendable',
    ...p,
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeAll(async () => {
    await settle();
});

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    resetForcedExitLocksForTests();
    resetForcedExitDriveForTests();
    mockHandleRef.current = mockHandle;
    mockHandle.getExitVtxos.mockResolvedValue([]);
    mockHandle.lockVtxos.mockResolvedValue(undefined);
    mockHandle.pendingRoundStates.mockResolvedValue([]);
    mockHandle.refreshVtxosDelegated.mockResolvedValue({ roundState: null });
    mockHandle.maintenanceDelegated.mockResolvedValue(undefined);
    mockHandle.offboardVtxos.mockResolvedValue({ txid: 'offb0ard', movementId: 1 });
    mockHandle.progressExits.mockResolvedValue([]);
    mockHandle.syncExits.mockResolvedValue(undefined);
    mockHandle.listClaimableExits.mockResolvedValue([]);
    mockHandle.drainExits.mockResolvedValue({ psbtBase64: 'cHNidP8=', feeSats: 99n, vtxoIds: [FORCED], skippedVtxoIds: [] });
    mockHandle.signExitClaimInputs.mockResolvedValue('cHNidP8=');
    mockHandle.broadcastTx.mockResolvedValue('c1a1m');
    mockHandle.sync.mockResolvedValue(undefined);
    (global as any).fetch = jest.fn(async () => {
        throw new Error('offline');
    });
    useAuthStore.setState({
        arkExitInProgress: false,
        arkExitStartedAt: null,
        arkExitStartedVtxoIds: [],
        arkForcedExitNoticedVtxoIds: [],
        arkExitDestinationAddress: DEST,
        arkExitFeeDeadlineHeight: null,
        arkVtxos: [],
        arkRefreshingVtxoIds: [],
        arkRefreshFailStreak: 0,
        arkChainTipHeight: TIP,
        arkChainTipHeightAt: Date.now(),
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('which exit records are forced', () => {
    it('an active record the user did not start here is forced', () => {
        const out = forcedExitIds([rec(MINE, 'Processing'), rec(FORCED, 'AwaitingDelta')], {
            startedIds: [MINE],
            exitStartedAt: Date.now(),
        });
        expect([...out]).toEqual([FORCED]);
    });

    it('matches started ids without regard to case', () => {
        const out = forcedExitIds([rec(MINE.toUpperCase(), 'Processing')], { startedIds: [MINE], exitStartedAt: 1 });
        expect(out.size).toBe(0);
    });

    it('a finished record is not forced, whatever its origin', () => {
        const out = forcedExitIds(
            [rec(FORCED, 'Claimed'), rec(OLD, 'VtxoAlreadySpent'), rec(MINE, 'Canceled')],
            { startedIds: [], exitStartedAt: null },
        );
        expect(out.size).toBe(0);
    });

    it('a claimable record counts as active even under an unknown tag', () => {
        const out = forcedExitIds([{ vtxoId: FORCED, state: { tag: 'SomethingNew' }, isClaimable: true }], {
            startedIds: [],
            exitStartedAt: null,
        });
        expect([...out]).toEqual([FORCED]);
    });

    it('an exit started here before ids were tracked is the user\'s own', () => {
        // Upgrade mid-exit: the started-at stamp is set, the id list is empty.
        const ctx = { startedIds: [], exitStartedAt: Date.now() - 60_000 };
        expect(isLegacyUserExit(ctx)).toBe(true);
        expect(forcedExitIds([rec(MINE, 'Processing'), rec(OLD, 'AwaitingDelta')], ctx).size).toBe(0);
    });

    it('with no exit started here at all, every active record is forced', () => {
        const ctx = { startedIds: [], exitStartedAt: null };
        expect(isLegacyUserExit(ctx)).toBe(false);
        expect([...forcedExitIds([rec(FORCED, 'Start')], ctx)]).toEqual([FORCED]);
    });

    it('once ids are tracked, a later record outside them is forced even mid-exit', () => {
        const ctx = { startedIds: [MINE], exitStartedAt: Date.now() };
        expect([...forcedExitIds([rec(MINE, 'AwaitingDelta'), rec(FORCED, 'Processing')], ctx)]).toEqual([FORCED]);
    });
});

describe('what to tell the user about', () => {
    it('names each forced record once', () => {
        const exits = [rec(MINE, 'Processing'), rec(FORCED, 'Processing', 25_000)];
        const ctx = { startedIds: [MINE], exitStartedAt: 1 };
        const first = pickForcedExitsToNotice(exits, ctx, []);
        expect(first.map((e) => e.vtxoId)).toEqual([FORCED]);
        expect(sumExitSats(first)).toBe(25_000);
        expect(pickForcedExitsToNotice(exits, ctx, [FORCED])).toEqual([]);
        expect(pickForcedExitsToNotice(exits, ctx, [FORCED.toUpperCase()])).toEqual([]);
    });

    it('says nothing for the user\'s own exit', () => {
        expect(pickForcedExitsToNotice([rec(MINE, 'Processing')], { startedIds: [MINE], exitStartedAt: 1 }, [])).toEqual([]);
        expect(pickForcedExitsToNotice([rec(MINE, 'Processing')], { startedIds: [], exitStartedAt: 1 }, [])).toEqual([]);
    });

    it('a second forced capsule arriving later is still announced', () => {
        const ctx = { startedIds: [MINE], exitStartedAt: 1 };
        const later = pickForcedExitsToNotice(
            [rec(MINE, 'AwaitingDelta'), rec(FORCED, 'AwaitingDelta'), rec(OLD, 'Processing', 7_000)],
            ctx,
            [FORCED],
        );
        expect(later.map((e) => e.vtxoId)).toEqual([OLD]);
    });
});

describe('keeping the started list honest', () => {
    it('drops an id only once bark holds a finished record for it', () => {
        const exits = [rec(MINE, 'Claimed'), rec(OLD, 'AwaitingDelta')];
        expect(pruneStartedExitIds([MINE, OLD, FORCED], exits)).toEqual([OLD, FORCED]);
    });

    it('keeps an id with no record yet, so a just-started exit is not misread as forced', () => {
        expect(pruneStartedExitIds([MINE], [])).toEqual([MINE]);
    });

    it('is case-insensitive about bark\'s ids', () => {
        expect(pruneStartedExitIds([MINE], [rec(MINE.toUpperCase(), 'VtxoSwept')])).toEqual([]);
    });
});

describe('address shortening for the notice', () => {
    it('keeps a short address and shortens a long one', () => {
        expect(shortAddress('bc1qshort')).toBe('bc1qshort');
        const long = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
        const out = shortAddress(long);
        expect(out.startsWith('bc1qar0s')).toBe(true);
        expect(out.endsWith('wf5mdq')).toBe(true);
        expect(out.length).toBeLessThan(long.length);
    });
});

describe('classifyExitRecords', () => {
    it('splits active records by who started them and drops finished ones', () => {
        const out = classifyExitRecords(
            [rec(MINE, 'Processing'), rec(FORCED, 'AwaitingDelta'), rec(OLD, 'Claimed')],
            { startedIds: [MINE], exitStartedAt: 1 },
        );
        expect(out.userStarted.map((e) => e.vtxoId)).toEqual([MINE]);
        expect(out.forced.map((e) => e.vtxoId)).toEqual([FORCED]);
    });

    it('calls everything the user\'s for a legacy exit, and everything forced with nothing started here', () => {
        const exits = [rec(MINE, 'Processing'), rec(FORCED, 'Processing')];
        expect(classifyExitRecords(exits, { startedIds: [], exitStartedAt: 1 }).forced).toEqual([]);
        expect(classifyExitRecords(exits, { startedIds: [], exitStartedAt: null }).userStarted).toEqual([]);
    });
});

describe('the wallet-wide lock is for the user\'s exit only', () => {
    it('forced-only rows leave sends, swaps and refreshes of other capsules allowed', async () => {
        useAuthStore.setState({ arkVtxos: [row({ id: OLD }), row({ id: FORCED, exiting: true, exitForced: true })] });
        mockHandle.getExitVtxos.mockResolvedValue([rec(FORCED, 'Processing')]);
        expect(() => assertNoActiveArkExit()).not.toThrow();
        await expect(assertNoActiveArkExitAsync('Refreshing')).resolves.toBeUndefined();
    });

    it('a user-started exit still locks everything', async () => {
        useAuthStore.setState({
            arkExitStartedVtxoIds: [MINE],
            arkExitStartedAt: Date.now(),
            arkVtxos: [row({ id: OLD }), row({ id: MINE, exiting: true, exitForced: false })],
        });
        mockHandle.getExitVtxos.mockResolvedValue([rec(MINE, 'Processing')]);
        expect(() => assertNoActiveArkExit()).toThrow(/Emergency Exit/);
        await expect(assertNoActiveArkExitAsync('Refreshing')).rejects.toThrow(/Emergency Exit/);
    });

    it('a mix locks everything too', async () => {
        useAuthStore.setState({
            arkExitStartedVtxoIds: [MINE],
            arkExitStartedAt: Date.now(),
            arkVtxos: [row({ id: MINE, exiting: true }), row({ id: FORCED, exiting: true, exitForced: true })],
        });
        mockHandle.getExitVtxos.mockResolvedValue([rec(MINE, 'AwaitingDelta'), rec(FORCED, 'Processing')]);
        expect(() => assertNoActiveArkExit()).toThrow(/Emergency Exit/);
        await expect(assertNoActiveArkExitAsync('Refreshing')).rejects.toThrow(/Emergency Exit/);
    });

    it('the flag alone still locks, whatever the rows say', () => {
        useAuthStore.setState({ arkExitInProgress: true, arkVtxos: [] });
        expect(() => assertNoActiveArkExit()).toThrow(/Emergency Exit/);
    });
});

describe('forced capsules are excluded one by one', () => {
    beforeEach(() => {
        useAuthStore.setState({ arkVtxos: [row({ id: OLD }), row({ id: FORCED, exiting: true, exitForced: true })] });
        mockHandle.getExitVtxos.mockResolvedValue([rec(FORCED, 'Processing')]);
    });

    it('the per-id guard refuses a forced id and lets others through, whatever the case', () => {
        expect(() => assertNotForcedExitVtxos([OLD])).not.toThrow();
        expect(() => assertNotForcedExitVtxos([])).not.toThrow();
        expect(() => assertNotForcedExitVtxos(null)).not.toThrow();
        expect(() => assertNotForcedExitVtxos([OLD, FORCED.toUpperCase()], 'Sending')).toThrow(/Sending is unavailable/);
    });

    it('a refresh of another capsule goes through; one naming the forced capsule is refused before bark', async () => {
        await refreshArkVtxosDelegated([OLD], 10_000);
        expect(mockHandle.refreshVtxosDelegated).toHaveBeenCalledWith([OLD]);
        await expect(refreshArkVtxosDelegated([OLD, FORCED], 20_000)).rejects.toThrow(/Refreshing capsules is unavailable/);
        expect(mockHandle.refreshVtxosDelegated).toHaveBeenCalledTimes(1);
    });

    it('an offboard naming the forced capsule is refused before bark', async () => {
        await expect(offboardArkVtxos([FORCED], DEST)).rejects.toThrow(/unavailable while an Emergency Exit/);
        expect(mockHandle.offboardVtxos).not.toHaveBeenCalled();
        await offboardArkVtxos([OLD], DEST);
        expect(mockHandle.offboardVtxos).toHaveBeenCalledWith([OLD], DEST);
    });

    it('maintenance (bark picks the inputs) runs once the forced capsule is locked, and is held when it cannot be', async () => {
        await maintenanceArkDelegated();
        expect(mockHandle.lockVtxos).toHaveBeenCalledWith([FORCED], undefined);
        expect(mockHandle.maintenanceDelegated).toHaveBeenCalledTimes(1);

        resetForcedExitLocksForTests();
        mockHandle.lockVtxos.mockRejectedValue(new Error('not spendable'));
        mockHandle.getVtxoById.mockRejectedValue(new Error('unknown'));
        await expect(maintenanceArkDelegated()).rejects.toThrow(/Background refresh is unavailable/);
        expect(mockHandle.maintenanceDelegated).toHaveBeenCalledTimes(1);
    });

    it('maintenance also locks a forced capsule bark reports when the store has no rows yet (background wake)', async () => {
        useAuthStore.setState({ arkVtxos: [] });
        mockHandle.getExitVtxos.mockResolvedValue([rec(FORCED, 'Processing')]);
        await maintenanceArkDelegated();
        expect(mockHandle.lockVtxos).toHaveBeenCalledWith([FORCED], undefined);
        expect(mockHandle.maintenanceDelegated).toHaveBeenCalledTimes(1);
    });

    it('a lock refused because bark already holds the capsule Locked, Exited or Spent counts as done', async () => {
        mockHandle.lockVtxos.mockRejectedValue(new Error('only Spendable vtxos can be locked'));
        mockHandle.getVtxoById.mockResolvedValue({ id: FORCED, state: { tag: 'Locked' } });
        await expect(lockForcedExitVtxos([FORCED])).resolves.toEqual({ locked: [FORCED], failed: [] });
        // Remembered: the next call does not ask bark again.
        mockHandle.lockVtxos.mockClear();
        await lockForcedExitVtxos([FORCED]);
        expect(mockHandle.lockVtxos).not.toHaveBeenCalled();
    });

    it('a locked exiting capsule is not mid-round and still shows under pending exit', () => {
        expect(isVtxoMidRound(row({ id: FORCED, state: 'Locked', exiting: true }), [])).toBe(false);
        expect(isVtxoMidRound(row({ id: OLD, state: 'Locked' }), [])).toBe(true);
        const summary: ArkBalanceSummary = {
            totalSats: 10_000, spendableSats: 10_000, pendingInRoundSats: 0, pendingExitSats: 0,
            pendingLightningSendSats: 0, claimableLightningReceiveSats: 0, pendingBoardSats: 0,
            expiredUnrecoverableSats: 0, onchainBoardingSats: 0, onchainConfirmingSats: 0,
        };
        const out = applyExpiredVtxoFilter(
            summary,
            [row({ id: OLD }), row({ id: FORCED, sats: 4_000, state: 'Locked', exiting: true, exitForced: true })],
            TIP,
        );
        // bark already left the Locked capsule out of spendableSats: nothing
        // more comes off, and its sats are shown as a pending exit.
        expect(out.spendableSats).toBe(10_000);
        expect(out.pendingExitSats).toBe(4_000);
    });
});

describe('driveForcedExits', () => {
    beforeEach(() => {
        useAuthStore.setState({ arkVtxos: [row({ id: OLD }), row({ id: FORCED, exiting: true, exitForced: true })] });
    });

    it('locks, progresses and syncs without raising the exit flag', async () => {
        mockHandle.getExitVtxos.mockResolvedValue([rec(FORCED, 'Processing', 4_000)]);
        const out = await driveForcedExits([rec(FORCED, 'Processing', 4_000)]);
        expect(out.action).toBe('driven');
        expect(mockHandle.lockVtxos).toHaveBeenCalledWith([FORCED], undefined);
        expect(mockHandle.progressExits).toHaveBeenCalledTimes(1);
        expect(mockHandle.syncExits).toHaveBeenCalledTimes(1);
        expect(mockHandle.drainExits).not.toHaveBeenCalled();
        expect(useAuthStore.getState().arkExitInProgress).toBe(false);
    });

    it('claims to the saved destination once the record is claimable', async () => {
        const claimable = { ...rec(FORCED, 'Claimable', 4_000), isClaimable: true };
        mockHandle.getExitVtxos.mockResolvedValue([claimable]);
        mockHandle.listClaimableExits.mockResolvedValue([claimable]);
        const out = await driveForcedExits([claimable]);
        expect(out.claimTxid).toBe('c1a1m');
        expect(mockHandle.drainExits).toHaveBeenCalledWith([], true, DEST, 1n);
        expect(mockHandle.broadcastTx).toHaveBeenCalledWith('deadbeef');
        expect(useAuthStore.getState().arkExitInProgress).toBe(false);
    });

    it('does not claim without a destination, and does not throw', async () => {
        useAuthStore.setState({ arkExitDestinationAddress: null });
        const claimable = { ...rec(FORCED, 'Claimable', 4_000), isClaimable: true };
        mockHandle.getExitVtxos.mockResolvedValue([claimable]);
        mockHandle.listClaimableExits.mockResolvedValue([claimable]);
        const out = await driveForcedExits([claimable]);
        expect(out.claimTxid).toBeNull();
        expect(mockHandle.drainExits).not.toHaveBeenCalled();
    });

    it('paces itself: a second call inside the cadence window only re-checks the lock', async () => {
        mockHandle.getExitVtxos.mockResolvedValue([rec(FORCED, 'Processing', 4_000)]);
        await driveForcedExits([rec(FORCED, 'Processing', 4_000)]);
        const again = await driveForcedExits([rec(FORCED, 'Processing', 4_000)]);
        expect(again.action).toBe('skipped');
        expect(mockHandle.progressExits).toHaveBeenCalledTimes(1);
    });

    it('survives a failing bark call without throwing', async () => {
        mockHandle.progressExits.mockRejectedValue(new Error('esplora 429'));
        await expect(driveForcedExits([rec(FORCED, 'Processing', 4_000)])).resolves.toMatchObject({ action: 'driven', claimTxid: null });
    });
});

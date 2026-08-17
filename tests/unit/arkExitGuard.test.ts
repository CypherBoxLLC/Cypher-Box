/**
 * Exit guard: never run a cooperative round while a unilateral exit is live.
 *
 * bark does NOT defend against this. Confirmed with Second 2026-08-13: "we
 * allow VTXOs to be marked for exit and for the user to still spend them."
 * The lock/unlock API they suggest is not exposed in bark-react-native 0.16.1,
 * so this client-side guard is the only thing standing between a delegated
 * round and a coin that is already committed on-chain.
 *
 * These paths are deliberately NOT reachable from the UI, which is why they get
 * a unit test rather than device QA. On device (2026-08-16) every refresh
 * control is disabled once an exit is active, so the guard underneath can never
 * be exercised by tapping. The background wake has no UI at all: it runs
 * headless from a silent push, picks its own VTXOs inside bark, and executes
 * before the store has hydrated.
 */

const mockGetExitVtxos = jest.fn();
const mockStoreState = {
    arkExitInProgress: false,
    arkVtxos: [] as Array<{ id: string; exiting?: boolean }>,
};

jest.mock('@Cypher/stores/authStore', () => ({
    __esModule: true,
    default: { getState: () => mockStoreState },
}));

jest.mock('../../src/services/ark/walletHandle', () => ({
    __esModule: true,
    getArkWalletHandle: () => ({ getExitVtxos: mockGetExitVtxos }),
    ensureArkOnchainHandle: jest.fn(),
}));

jest.mock('@secondts/bark-react-native', () => ({
    __esModule: true,
    extractTxFromPsbt: jest.fn(),
}));

import {
    assertNoActiveArkExitAsync,
    hasActiveArkExitRecords,
} from '../../src/services/ark/exit';

beforeEach(() => {
    mockGetExitVtxos.mockReset();
    mockStoreState.arkExitInProgress = false;
    mockStoreState.arkVtxos = [];
});

describe('hasActiveArkExitRecords', () => {
    it('is false when bark reports no exit records at all', async () => {
        mockGetExitVtxos.mockResolvedValue([]);
        await expect(hasActiveArkExitRecords()).resolves.toBe(false);
    });

    it('is true while an exit is Processing (broadcasting)', async () => {
        // The live state observed on device: every capsule sat at Processing
        // for the whole broadcast phase.
        mockGetExitVtxos.mockResolvedValue([{ state: 'Processing', isClaimable: false }]);
        await expect(hasActiveArkExitRecords()).resolves.toBe(true);
    });

    it.each([
        'AwaitingConfirmation',
        'AwaitingInputConfirmation',
        'AwaitingCpfpBroadcast',
        'AwaitingDelta',
    ])('is true during the %s phase', async (state) => {
        // Matching only Processing would report "no exit" for most of an exit's
        // life: AwaitingDelta alone is the ~24h CSV wait.
        mockGetExitVtxos.mockResolvedValue([{ state, isClaimable: false }]);
        await expect(hasActiveArkExitRecords()).resolves.toBe(true);
    });

    it('is true when a vtxo is claimable but not yet claimed', async () => {
        mockGetExitVtxos.mockResolvedValue([{ state: 'Done', isClaimable: true }]);
        await expect(hasActiveArkExitRecords()).resolves.toBe(true);
    });

    it('is false once every record is terminal', async () => {
        mockGetExitVtxos.mockResolvedValue([
            { state: 'Done', isClaimable: false },
            { state: 'Exited', isClaimable: false },
        ]);
        await expect(hasActiveArkExitRecords()).resolves.toBe(false);
    });

    it('is true when only ONE of several records is still active', async () => {
        mockGetExitVtxos.mockResolvedValue([
            { state: 'Done', isClaimable: false },
            { state: 'Exited', isClaimable: false },
            { state: 'Processing', isClaimable: false },
        ]);
        await expect(hasActiveArkExitRecords()).resolves.toBe(true);
    });

    it('is false when the read throws, because a failed read is not evidence of an exit', async () => {
        // Callers use this to BLOCK an action. Returning true on a failed read
        // would wedge refresh whenever bark's DB hiccuped.
        mockGetExitVtxos.mockRejectedValue(new Error('db locked'));
        await expect(hasActiveArkExitRecords()).resolves.toBe(false);
    });

    it('is false when getExitVtxos resolves null rather than an array', async () => {
        mockGetExitVtxos.mockResolvedValue(null);
        await expect(hasActiveArkExitRecords()).resolves.toBe(false);
    });
});

describe('assertNoActiveArkExitAsync', () => {
    it('resolves when nothing indicates an exit', async () => {
        mockGetExitVtxos.mockResolvedValue([]);
        await expect(assertNoActiveArkExitAsync('Refreshing capsules')).resolves.toBeUndefined();
    });

    it('throws on the zustand flag alone', async () => {
        mockGetExitVtxos.mockResolvedValue([]);
        mockStoreState.arkExitInProgress = true;
        await expect(assertNoActiveArkExitAsync('Refreshing capsules')).rejects.toThrow(
            /Emergency Exit is in progress/,
        );
    });

    it('throws on a vtxo flagged exiting even when the store flag is clear', async () => {
        mockGetExitVtxos.mockResolvedValue([]);
        mockStoreState.arkVtxos = [{ id: 'a' }, { id: 'b', exiting: true }];
        await expect(assertNoActiveArkExitAsync('Refreshing capsules')).rejects.toThrow(
            /Emergency Exit is in progress/,
        );
    });

    it("throws on bark's DB even when the store looks clean", async () => {
        // The whole reason this async variant exists. The background wake runs
        // before the store hydrates, so `arkExitInProgress` reads its default
        // false and the sync guard silently passes. bark is the authority.
        mockStoreState.arkExitInProgress = false;
        mockStoreState.arkVtxos = [];
        mockGetExitVtxos.mockResolvedValue([{ state: 'Processing', isClaimable: false }]);
        await expect(assertNoActiveArkExitAsync('Background refresh')).rejects.toThrow(
            /Emergency Exit is in progress/,
        );
    });

    it('names the action in the message so the UI can surface it verbatim', async () => {
        mockStoreState.arkExitInProgress = true;
        mockGetExitVtxos.mockResolvedValue([]);
        await expect(assertNoActiveArkExitAsync('Background refresh')).rejects.toThrow(
            /^Background refresh is unavailable/,
        );
    });
});

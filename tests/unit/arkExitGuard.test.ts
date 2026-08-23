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
        // The terminal set is exactly Claimed / VtxoAlreadySpent / Canceled,
        // per the SDK's generated ExitState_Tags. This case used to assert on
        // 'Done' and 'Exited', which are not ExitState variants at all, so it
        // proved nothing about real terminal detection.
        mockGetExitVtxos.mockResolvedValue([
            { state: 'Claimed', isClaimable: false },
            { state: 'VtxoAlreadySpent', isClaimable: false },
            { state: 'Canceled', isClaimable: false },
        ]);
        await expect(hasActiveArkExitRecords()).resolves.toBe(false);
    });

    it('is true when only ONE of several records is still active', async () => {
        mockGetExitVtxos.mockResolvedValue([
            { state: 'Claimed', isClaimable: false },
            { state: 'VtxoAlreadySpent', isClaimable: false },
            { state: 'Processing', isClaimable: false },
        ]);
        await expect(hasActiveArkExitRecords()).resolves.toBe(true);
    });

    it('treats an unrecognised state as ACTIVE, not complete', async () => {
        // Deliberate asymmetry. Mis-reading an in-flight exit as finished is
        // what retired an exit early and deleted a wallet mid-exit (2026-07-31);
        // mis-reading a finished exit as live only delays a refresh.
        mockGetExitVtxos.mockResolvedValue([
            { state: 'SomeFutureSdkState', isClaimable: false },
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

/**
 * bark 0.6.1 turned `ExitVtxo.state` from a plain string into a UniFFI
 * tagged-enum object. Every fixture above uses the OLD string shape, which is
 * why this suite stayed green while the guard was broken in production: the
 * implementation regexed `String(v.state)` for /^(Processing|Awaiting)/, and
 * against a real object that is "[object Object]", which matches nothing. The
 * check silently collapsed to `v.isClaimable`.
 *
 * Read off the device on 2026-08-18 during a live mainnet exit with 2794 sats
 * in flight: three capsules AwaitingDelta, one ClaimInProgress, every one of
 * them isClaimable=false. hasActiveArkExitRecords() returned false, so the
 * cooperative-round guard was open for essentially the whole exit.
 *
 * These fixtures are those exact payloads. They fail against the regex.
 */
describe('hasActiveArkExitRecords with bark 0.6.1 tagged-enum states', () => {
    const awaitingDelta = {
        state: {
            tag: 'AwaitingDelta',
            inner: {
                tipHeight: 962962,
                confirmedBlock: { height: 962957, hash: '0000000000000000000217a2e759c9143db1946b6a49ddf6a07c2c59b7e9341c' },
                claimableHeight: 963101,
            },
        },
        isClaimable: false,
    };
    const claimInProgress = {
        state: {
            tag: 'ClaimInProgress',
            inner: {
                tipHeight: 963060,
                claimableSince: { height: 963046, hash: '00000000000000000000e17fac82dcb0cb9c5d78a7dfc2328c3bb970fd2a2cbc' },
                claimTxid: 'fcdfa310ecd61bdbea44d03d88412a7756ad65a8c0483c1f5ca6bd8d7d558482',
            },
        },
        isClaimable: false,
    };

    it('is true during AwaitingDelta, the ~24h CSV wait', async () => {
        mockGetExitVtxos.mockResolvedValue([awaitingDelta]);
        await expect(hasActiveArkExitRecords()).resolves.toBe(true);
    });

    it('is true during ClaimInProgress, after the claim is broadcast', async () => {
        mockGetExitVtxos.mockResolvedValue([claimInProgress]);
        await expect(hasActiveArkExitRecords()).resolves.toBe(true);
    });

    it('is true for the exact 4-capsule set read off the device', async () => {
        mockGetExitVtxos.mockResolvedValue([
            claimInProgress,
            awaitingDelta,
            awaitingDelta,
            awaitingDelta,
        ]);
        await expect(hasActiveArkExitRecords()).resolves.toBe(true);
    });

    it.each(['Start', 'Processing', 'AwaitingDelta', 'Claimable', 'ClaimInProgress'])(
        'is true for tagged-enum %s',
        async (tag) => {
            mockGetExitVtxos.mockResolvedValue([{ state: { tag }, isClaimable: false }]);
            await expect(hasActiveArkExitRecords()).resolves.toBe(true);
        },
    );

    it.each(['Claimed', 'VtxoAlreadySpent', 'Canceled'])(
        'is false for terminal tagged-enum %s',
        async (tag) => {
            mockGetExitVtxos.mockResolvedValue([{ state: { tag }, isClaimable: false }]);
            await expect(hasActiveArkExitRecords()).resolves.toBe(false);
        },
    );

    it('blocks a background refresh mid-exit with a clean store', async () => {
        // The end-to-end shape of the production bug: store flag lost (or not
        // yet hydrated), bark holding a live AwaitingDelta exit. Before the
        // fix this resolved, letting a cooperative round spend a coin already
        // committed on-chain.
        mockStoreState.arkExitInProgress = false;
        mockStoreState.arkVtxos = [];
        mockGetExitVtxos.mockResolvedValue([awaitingDelta]);
        await expect(assertNoActiveArkExitAsync('Background refresh')).rejects.toThrow(
            /Emergency Exit is in progress/,
        );
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

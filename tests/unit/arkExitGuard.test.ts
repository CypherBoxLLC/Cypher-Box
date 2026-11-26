/**
 * Exit guard: never run a cooperative round while a unilateral exit is live.
 *
 * bark does NOT defend against this. Confirmed with Second 2026-08-13: "we
 * allow VTXOs to be marked for exit and for the user to still spend them."
 * The lock/unlock API they suggested is exposed since bark-react-native 0.18.0
 * but unused, so this client-side guard is still the only thing standing
 * between a delegated round and a coin that is already committed on-chain.
 *
 * These paths are deliberately NOT reachable from the UI, which is why they get
 * a unit test rather than device QA. On device (2026-08-16) every refresh
 * control is disabled once an exit is active, so the guard underneath can never
 * be exercised by tapping. The background wake has no UI at all: it runs
 * headless from a silent push, picks its own VTXOs inside bark, and executes
 * before the store has hydrated.
 */

const mockGetExitVtxos = jest.fn();
// The rest of the bark 0.8.1 (SDK 0.27.0) handle surface exit.ts touches.
const mockHandle = {
    getExitVtxos: mockGetExitVtxos,
    drainExits: jest.fn(),
    signExitClaimInputs: jest.fn(),
    broadcastTx: jest.fn(),
    cancelExit: jest.fn(),
};
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
    getArkWalletHandle: () => mockHandle,
    ensureArkOnchainHandle: jest.fn(),
}));

jest.mock('@secondts/bark-react-native', () => ({
    __esModule: true,
    extractTxFromPsbt: jest.fn(() => 'deadbeef'),
}));

import {
    assertNoActiveArkExitAsync,
    cancelArkExits,
    claimArkExitsToAddress,
    hasActiveArkExitRecords,
    readExitCancelResult,
} from '../../src/services/ark/exit';
import { isActiveExit, isSweptExit } from '../../src/services/ark/barkState';

beforeEach(() => {
    mockGetExitVtxos.mockReset();
    mockHandle.drainExits.mockReset();
    mockHandle.signExitClaimInputs.mockReset();
    mockHandle.broadcastTx.mockReset();
    mockHandle.cancelExit.mockReset();
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
        // The terminal set is exactly Claimed / VtxoAlreadySpent / Canceled /
        // VtxoSwept (bark 0.8.0), per the SDK's generated ExitState_Tags. This
        // case used to assert on 'Done' and 'Exited', which are not ExitState
        // variants at all, so it proved nothing about real terminal detection.
        mockGetExitVtxos.mockResolvedValue([
            { state: 'Claimed', isClaimable: false },
            { state: 'VtxoAlreadySpent', isClaimable: false },
            { state: 'Canceled', isClaimable: false },
            { state: 'VtxoSwept', isClaimable: false },
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

    it.each(['Claimed', 'VtxoAlreadySpent', 'Canceled', 'VtxoSwept'])(
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

/**
 * bark 0.8.0 VtxoSwept: an exit that ended because the chain it needed was
 * spent on chain (the server swept the round after expiry). Listed as
 * terminal; before that it read as active forever, because unknown states are
 * active by design, which kept every spend blocked by the exit guard.
 * Payload shape from the SDK 0.27.0 bindings: { tipHeight, spentInputs }.
 */
describe('VtxoSwept (bark 0.8.0)', () => {
    const swept = {
        vtxoId: 'swept-vtxo',
        amountSats: BigInt(4_000),
        state: {
            tag: 'VtxoSwept',
            inner: {
                tipHeight: 975000,
                spentInputs: [{ txid: 'aa'.repeat(32), vout: 0 }],
            },
        },
        isClaimable: false,
    };

    it('is terminal, so a swept exit no longer counts as live', async () => {
        expect(isActiveExit(swept)).toBe(false);
        mockGetExitVtxos.mockResolvedValue([swept]);
        await expect(hasActiveArkExitRecords()).resolves.toBe(false);
    });

    it('releases the background-refresh guard once the only exit is swept', async () => {
        mockGetExitVtxos.mockResolvedValue([swept]);
        await expect(assertNoActiveArkExitAsync('Background refresh')).resolves.toBeUndefined();
    });

    it('is recognised by isSweptExit, and nothing else is', () => {
        expect(isSweptExit(swept)).toBe(true);
        expect(isSweptExit({ state: 'VtxoSwept' })).toBe(true);
        expect(isSweptExit({ state: { tag: 'VtxoAlreadySpent' } })).toBe(false);
        expect(isSweptExit({ state: { tag: 'AwaitingDelta' } })).toBe(false);
        expect(isSweptExit(null)).toBe(false);
    });
});

/**
 * bark 0.8.0 inserted `drainAll` as drainExits' SECOND argument. The old
 * three-argument call would land the address in `drainAll` and the fee rate in
 * `address`, and an empty id list without drainAll is now an error, so every
 * claim would fail. The claim is the step that stalled exits in August.
 */
describe('claimArkExitsToAddress with bark 0.8.0 drainExits', () => {
    beforeEach(() => {
        mockHandle.drainExits.mockResolvedValue({
            psbtBase64: 'cHNidP8=',
            feeSats: BigInt(210),
            vtxoIds: ['a', 'b'],
            skippedVtxoIds: [],
        });
        mockHandle.signExitClaimInputs.mockResolvedValue('cHNidP8signed');
        mockHandle.broadcastTx.mockResolvedValue('c1a1m');
    });

    it('asks to drain everything claimable, with the address and rate in their new places', async () => {
        const out = await claimArkExitsToAddress('  bc1qdestination  ', BigInt(3));
        expect(mockHandle.drainExits).toHaveBeenCalledTimes(1);
        expect(mockHandle.drainExits).toHaveBeenCalledWith([], true, 'bc1qdestination', BigInt(3));
        expect(out).toEqual({ txid: 'c1a1m', feeSats: 210, psbtBase64: 'cHNidP8=' });
    });

    it('passes an undefined rate through rather than shifting it', async () => {
        await claimArkExitsToAddress('bc1qdestination');
        expect(mockHandle.drainExits).toHaveBeenCalledWith([], true, 'bc1qdestination', undefined);
    });

    it('still claims when a binding leaves out the new vtxoIds fields', async () => {
        mockHandle.drainExits.mockResolvedValue({ psbtBase64: 'cHNidP8=', feeSats: BigInt(99) });
        await expect(claimArkExitsToAddress('bc1qdestination')).resolves.toMatchObject({ txid: 'c1a1m', feeSats: 99 });
    });

    it('refuses an empty destination before touching bark', async () => {
        await expect(claimArkExitsToAddress('   ')).rejects.toThrow();
        expect(mockHandle.drainExits).not.toHaveBeenCalled();
    });
});

/**
 * bark 0.8.x cancelExit. Expected refusals come back IN the result
 * (ExitCancelResult { canceled, reason? }), never as a throw. Anything that is
 * not an explicit `canceled: true` must read as a refusal: an unknown shape
 * read as success would drop the spend guard while an exit may be broadcasting.
 */
describe('cancelling an exit (bark 0.8.x cancelExit)', () => {
    it('reads canceled: true as cancelled', () => {
        expect(readExitCancelResult('v1', { canceled: true })).toEqual({ vtxoId: 'v1', canceled: true });
    });

    it.each([
        [{ tag: 'NotExiting' }, 'not-exiting'],
        [{ tag: 'TooLate', inner: { state: 3 } }, 'too-late'],
        [{ tag: 'SomethingNew' }, 'unknown'],
    ])('reads refusal %j as %s', (reason, refusal) => {
        expect(readExitCancelResult('v1', { canceled: false, reason })).toEqual({
            vtxoId: 'v1',
            canceled: false,
            refusal,
        });
    });

    it('keeps the txid of an exit that is already broadcast', () => {
        expect(
            readExitCancelResult('v1', { canceled: false, reason: { tag: 'AlreadyBroadcast', inner: { txid: 'ab'.repeat(32) } } }),
        ).toEqual({ vtxoId: 'v1', canceled: false, refusal: 'already-broadcast', txid: 'ab'.repeat(32) });
    });

    it.each([undefined, null, {}, { canceled: 'yes' }, 'canceled'])(
        'never reads %j as cancelled',
        (result) => {
            expect(readExitCancelResult('v1', result)).toMatchObject({ canceled: false, refusal: 'unknown' });
        },
    );

    it('asks bark once per capsule and keeps going past a throw', async () => {
        mockHandle.cancelExit
            .mockResolvedValueOnce({ canceled: true })
            .mockRejectedValueOnce(new Error('handle busy'))
            .mockResolvedValueOnce({ canceled: false, reason: { tag: 'TooLate', inner: { state: 2 } } });
        const out = await cancelArkExits(['a', 'b', 'c']);
        expect(mockHandle.cancelExit.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c']);
        expect(out).toEqual([
            { vtxoId: 'a', canceled: true },
            { vtxoId: 'b', canceled: false, refusal: 'unknown' },
            { vtxoId: 'c', canceled: false, refusal: 'too-late' },
        ]);
    });

    it('skips empty ids instead of sending them to bark', async () => {
        mockHandle.cancelExit.mockResolvedValue({ canceled: true });
        const out = await cancelArkExits(['', 'a']);
        expect(mockHandle.cancelExit).toHaveBeenCalledTimes(1);
        expect(out).toEqual([{ vtxoId: 'a', canceled: true }]);
    });
});

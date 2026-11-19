/**
 * After a send, deepened change is folded back into a refresh round. That step
 * reads bark's own capsule list, where a capsule the Ark server has said is
 * spent can still look Spendable. Submitting it gets the whole round refused,
 * so the live deep capsules beside it never fold back in, after every send.
 * The fold-in must leave recorded capsules out and keep everything else.
 */

import { executeArkSend } from '../../src/services/ark/send';

const mockHandle = {
    estimateArkoorPaymentFee: jest.fn(),
    sendArkoorPayment: jest.fn(),
    sync: jest.fn(),
    allVtxos: jest.fn(),
};
const mockRefresh = jest.fn();
const mockStore = {
    arkExitInProgress: false,
    arkRefreshingVtxoIds: [] as string[],
    arkServerSpentVtxoIds: [] as string[],
};

jest.mock('@secondts/bark-react-native', () => ({
    __esModule: true,
    LightningSendStatus_Tags: { Unknown: 'Unknown', InProgress: 'InProgress', Paid: 'Paid' },
    validateArkAddress: jest.fn(() => true),
    Network: { Bitcoin: 'Bitcoin' },
    Config: { create: jest.fn() },
}));
jest.mock('../../src/services/ark/exit', () => ({ __esModule: true, assertNoActiveArkExit: jest.fn() }));
jest.mock('../../src/services/ark/restore', () => ({
    __esModule: true,
    ensureArkWalletHandleReady: jest.fn(async () => mockHandle),
}));
jest.mock('../../src/services/ark/balance', () => ({ __esModule: true, fetchArkBalance: jest.fn(async () => null) }));
jest.mock('../../src/services/ark/vtxos', () => ({ __esModule: true, fetchArkVtxos: jest.fn(async () => null) }));
jest.mock('@Cypher/stores/eventLogStore', () => ({ __esModule: true, recordEvent: jest.fn() }));
// What the fold-in requires lazily.
jest.mock('../../src/services/ark/chainTip', () => ({
    __esModule: true,
    AVG_BLOCK_MINUTES: 10,
    fetchChainTipHeight: jest.fn(async () => 900_000),
}));
jest.mock('../../src/services/ark/refresh', () => ({
    __esModule: true,
    refreshArkVtxosDelegatedAndSync: (...args: unknown[]) => mockRefresh(...args),
}));
jest.mock('../../src/services/ark/walletHandle', () => ({ __esModule: true, getArkWalletHandle: () => mockHandle }));
jest.mock('@Cypher/stores/authStore', () => ({ __esModule: true, default: { getState: () => mockStore } }));

const PHANTOM = `${'9ca5'.repeat(16)}:0`;
const DEEP = `${'1f66'.repeat(16)}:1`;

/** Deep enough to fold back in, well clear of expiry, above the round minimum. */
const deepCapsule = (id: string) => ({
    id,
    amountSats: 20_000n,
    expiryHeight: 900_000 + 4_000,
    exitDepth: 9,
    state: 'Spendable',
});

const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockHandle.estimateArkoorPaymentFee.mockResolvedValue({
        feeSats: 0n,
        grossAmountSats: 1_000n,
        netAmountSats: 1_000n,
        vtxosSpent: [],
    });
    mockHandle.sendArkoorPayment.mockResolvedValue(undefined);
    mockHandle.sync.mockResolvedValue(undefined);
    mockHandle.allVtxos.mockResolvedValue([deepCapsule(PHANTOM), deepCapsule(DEEP)]);
    mockRefresh.mockResolvedValue({ roundState: null });
    mockStore.arkServerSpentVtxoIds = [];
});

afterEach(() => {
    jest.restoreAllMocks();
});

async function sendAndFoldIn() {
    await executeArkSend({ kind: 'ark', value: 'ark1qexampledestination' }, 1_000);
    await settle();
}

describe('the change fold-in after a send', () => {
    it('leaves a recorded capsule out and folds in the rest', async () => {
        mockStore.arkServerSpentVtxoIds = [PHANTOM.toUpperCase()];
        await sendAndFoldIn();
        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(mockRefresh).toHaveBeenCalledWith([DEEP], 20_000);
    });

    it('folds in every qualifying capsule when nothing is recorded', async () => {
        await sendAndFoldIn();
        expect(mockRefresh).toHaveBeenCalledWith([PHANTOM, DEEP], 40_000);
    });

    it('submits nothing when the only deep capsule is recorded', async () => {
        mockStore.arkServerSpentVtxoIds = [PHANTOM];
        mockHandle.allVtxos.mockResolvedValue([deepCapsule(PHANTOM)]);
        await sendAndFoldIn();
        expect(mockRefresh).not.toHaveBeenCalled();
    });
});

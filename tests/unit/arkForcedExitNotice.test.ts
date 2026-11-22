/**
 * The one notice for an exit the user did not start, and the copy the
 * server-spent exclusion shows. Real store and real copy; only the native
 * handle, the Alert and the fee pricing are faked.
 */

import { Alert } from 'react-native';

import loc from '../../loc';
import en from '../../loc/en.json';
import ar from '../../loc/ar.json';
import useAuthStore from '../../src/stores/authStore';
import { describeExitExclusion } from '../../src/services/ark/exitTriage';
import { buildForcedExitNotice } from '../../src/services/ark/forcedExit';
import { noticeForcedExits } from '../../src/services/ark/forcedExitNotice';

const mockFeeNeed = jest.fn();

jest.mock('../../src/services/ark/exitFunding', () => ({
    __esModule: true,
    computeExitFeeNeedForVtxos: (...args: unknown[]) => mockFeeNeed(...args),
}));
jest.mock('../../src/services/ark/walletHandle', () => ({
    __esModule: true,
    getArkWalletHandle: () => null,
    getCachedArkMnemonic: () => null,
    getLastOnchainBalanceSats: () => ({ confirmedSats: 0, pendingSats: 0 }),
}));
jest.mock('@secondts/bark-react-native', () => ({
    __esModule: true,
    Network: { Bitcoin: 'Bitcoin' },
    Config: { create: jest.fn() },
}));
jest.mock('@Cypher/stores/eventLogStore', () => ({ __esModule: true, recordEvent: jest.fn() }));

const MINE = `${'1f66'.repeat(16)}:1`;
const FORCED = `${'9ca5'.repeat(16)}:0`;
const OTHER = `${'d4ec'.repeat(16)}:0`;
const DEST = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const rec = (vtxoId: string, tag: string, sats: number) => ({
    vtxoId,
    amountSats: BigInt(sats),
    state: { tag },
    isClaimable: false,
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeAll(async () => {
    await settle();
});

let alertSpy: jest.SpyInstance;

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockFeeNeed.mockResolvedValue({ reserveSats: 5_000, feeRateSatPerVb: 2, collectableInBlocks: 156 });
    useAuthStore.setState({
        arkExitStartedVtxoIds: [],
        arkForcedExitNoticedVtxoIds: [],
        arkExitStartedAt: null,
        arkExitDestinationAddress: DEST,
        arkBalanceDetail: null,
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

const NO_EM_DASH = /^[^—]*$/;

describe('the forced-exit notice text', () => {
    it('names the amount, the destination, the wait and what to do', () => {
        const { title, body } = buildForcedExitNotice({
            sats: 25_000,
            count: 1,
            destination: DEST,
            waitBlocks: 156,
            blockMinutes: 10,
            feeHeldSats: 10_000,
            feeNeededSats: 5_000,
        });
        expect(title).toBe(loc.cypherbox.services.ark_exit.forced_exit_title);
        expect(body).toContain('25,000');
        expect(body).toContain('bc1qar0s');
        expect(body).toContain('about 26 hours');
        expect(body).toMatch(/did not start here/);
        // Fees are covered, so no top-up clause.
        expect(body).not.toMatch(/Top it up/);
        expect(body).toMatch(NO_EM_DASH);
    });

    it('asks for a fee top-up only when the on-chain fee wallet is short', () => {
        const short = buildForcedExitNotice({
            sats: 25_000, count: 2, destination: DEST, waitBlocks: 156, blockMinutes: 10,
            feeHeldSats: 1_200, feeNeededSats: 5_000,
        });
        expect(short.body).toContain('1,200');
        expect(short.body).toContain('5,000');
        expect(short.body).toMatch(/Top it up/);
        expect(short.body).toMatch(/2 capsules/);
        const unpriced = buildForcedExitNotice({
            sats: 25_000, count: 2, destination: DEST, waitBlocks: null, blockMinutes: 10,
            feeHeldSats: 0, feeNeededSats: null,
        });
        expect(unpriced.body).not.toMatch(/Top it up/);
        expect(unpriced.body).toContain(loc.cypherbox.services.ark_exit.forced_exit_wait_unknown);
    });

    it('says when no destination is set', () => {
        const { body } = buildForcedExitNotice({
            sats: 700, count: 1, destination: null, waitBlocks: 156, blockMinutes: 10,
            feeHeldSats: 0, feeNeededSats: 5_000,
        });
        expect(body).toContain(loc.cypherbox.services.ark_exit.forced_exit_no_destination);
        expect(body).toContain(loc.cypherbox.services.ark_exit.forced_exit_dest_unknown);
    });
});

describe('noticeForcedExits', () => {
    it('alerts once per forced capsule and remembers it', async () => {
        const exits = [rec(FORCED, 'Processing', 25_000)];
        await expect(noticeForcedExits(exits)).resolves.toEqual([FORCED]);
        expect(alertSpy).toHaveBeenCalledTimes(1);
        expect(alertSpy.mock.calls[0][0]).toBe(loc.cypherbox.services.ark_exit.forced_exit_title);
        expect(String(alertSpy.mock.calls[0][1])).toContain('25,000');
        expect(mockFeeNeed).toHaveBeenCalledWith([FORCED]);
        expect(useAuthStore.getState().arkForcedExitNoticedVtxoIds).toEqual([FORCED]);
        // Next tick: nothing new to say.
        await expect(noticeForcedExits(exits)).resolves.toEqual([]);
        expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it('says nothing about the user\'s own exit, tracked or legacy', async () => {
        useAuthStore.setState({ arkExitStartedVtxoIds: [MINE], arkExitStartedAt: Date.now() });
        await expect(noticeForcedExits([rec(MINE, 'Processing', 1_000)])).resolves.toEqual([]);
        useAuthStore.setState({ arkExitStartedVtxoIds: [], arkExitStartedAt: Date.now() });
        await expect(noticeForcedExits([rec(OTHER, 'AwaitingDelta', 1_000)])).resolves.toEqual([]);
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('still alerts when the fee need cannot be priced', async () => {
        mockFeeNeed.mockRejectedValue(new Error('offline'));
        await expect(noticeForcedExits([rec(FORCED, 'Start', 700)])).resolves.toEqual([FORCED]);
        expect(alertSpy).toHaveBeenCalledTimes(1);
        expect(useAuthStore.getState().arkForcedExitNoticedVtxoIds).toEqual([FORCED]);
    });

    it('groups capsules that arrive together into one alert', async () => {
        await noticeForcedExits([rec(FORCED, 'Processing', 700), rec(OTHER, 'Processing', 300)]);
        expect(alertSpy).toHaveBeenCalledTimes(1);
        expect(String(alertSpy.mock.calls[0][1])).toContain('1,000');
        expect(useAuthStore.getState().arkForcedExitNoticedVtxoIds).toEqual([FORCED, OTHER]);
    });
});

describe('the copy', () => {
    it('describes the server-says-spent exclusion in the app\'s words', () => {
        const text = describeExitExclusion('server-says-spent');
        expect(text).toBe(loc.cypherbox.services.exit_triage.exclusion_server_says_spent);
        expect(text).not.toBe(loc.cypherbox.services.exit_triage.exclusion_default);
        expect(text).toMatch(/server/i);
    });

    it('has every new English key in Arabic too, with no placeholder English lacks and no em dash', () => {
        const groups: [Record<string, string>, Record<string, string>, string[]][] = [
            [en.cypherbox.services.exit_triage, ar.cypherbox.services.exit_triage, ['exclusion_server_says_spent']],
            [en.cypherbox.strike.ark_exit, ar.cypherbox.strike.ark_exit, [
                'capsule_server_spent_row', 'server_spent_card_one', 'server_spent_card_other', 'recheck', 'rechecking',
                'recheck_title', 'recheck_confirmed_one', 'recheck_confirmed_other', 'recheck_unchanged', 'recheck_failed',
                'exit_forced_note',
            ]],
            [en.cypherbox.strike.ark_capsules, ar.cypherbox.strike.ark_capsules, ['label_exit_forced']],
            [en.cypherbox.services.ark_exit, ar.cypherbox.services.ark_exit, [
                'forced_exit_title', 'forced_exit_body_one', 'forced_exit_body_other', 'forced_exit_fees_short',
                'forced_exit_no_destination', 'forced_exit_wait_unknown', 'forced_exit_dest_unknown',
            ]],
        ];
        const placeholders = (s: string) => new Set(s.match(/\{[a-z_]+\}/g) ?? []);
        for (const [e, a, keys] of groups) {
            for (const k of keys) {
                expect(typeof e[k]).toBe('string');
                expect(typeof a[k]).toBe('string');
                expect(e[k]).toMatch(NO_EM_DASH);
                // Arabic singular forms say "one capsule" without {count};
                // formatString ignores an unused placeholder, so a missing one
                // is fine, an invented one would print raw.
                const en = placeholders(e[k]);
                for (const ph of placeholders(a[k])) expect(en.has(ph)).toBe(true);
            }
        }
    });
});

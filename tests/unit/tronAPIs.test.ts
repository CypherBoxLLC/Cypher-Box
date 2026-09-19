/**
 * Reading a USDT balance and an address's fee resources from a Tron node.
 *
 * What this protects:
 *   - Addresses go on the wire in the 41-prefixed hex form the node expects,
 *     not the base58 a user sees. Sending base58 with visible:false reads the
 *     wrong account.
 *   - Balances stay exact decimal strings, because a realistic USDT amount
 *     loses precision as a JS number.
 *   - An address that has never been used is reported as such rather than as a
 *     failure. It is the normal state of a fresh wallet, and it makes the first
 *     transfer in cost the sender more.
 *   - Nothing is logged. A Tron address identifies one user for as long as they
 *     use it.
 */

import {
    TronApiError,
    getTronAccountState,
    getTronReferenceBlock,
    getTronTransactionOutcome,
    getTronUsdtBalance,
} from '../../src/api/tronAPIs';
import { tronAddressToHex } from '../../src/services/tron/address';
import { USDT_TRC20_CONTRACT } from '../../src/services/tron/constants';
import { deriveTronAccount } from '../../src/services/tron/keys';

const ADDRESS = deriveTronAccount(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
).address;
const ADDRESS_HEX = tronAddressToHex(ADDRESS);

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const word = (hex: string) => hex.padStart(64, '0');

let fetchMock: jest.Mock;
let logSpies: jest.SpyInstance[];

beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    logSpies = (['log', 'warn', 'error'] as const).map(k =>
        jest.spyOn(console, k).mockImplementation(() => undefined),
    );
});

afterEach(() => {
    for (const spy of logSpies) {
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    }
});

const sent = (i = 0) => {
    const [url, init] = fetchMock.mock.calls[i] as [string, { body: string }];
    return { url, body: JSON.parse(init.body) as Record<string, unknown> };
};

describe('getTronUsdtBalance', () => {
    it('asks the node in hex, for the pinned contract', async () => {
        fetchMock.mockResolvedValue(ok({ constant_result: [word('0f4240')], result: { result: true } }));
        const balance = await getTronUsdtBalance(ADDRESS);
        const { url, body } = sent();
        expect(url).toBe('https://api.trongrid.io/wallet/triggerconstantcontract');
        expect(body.owner_address).toBe(ADDRESS_HEX);
        expect(body.contract_address).toBe(tronAddressToHex(USDT_TRC20_CONTRACT));
        expect(body.function_selector).toBe('balanceOf(address)');
        expect(body.visible).toBe(false);
        // The argument is the address without Tron's 0x41 prefix.
        expect(body.parameter).toBe(`${'0'.repeat(24)}${ADDRESS_HEX.slice(2)}`);
        expect(balance).toBe('1');
    });

    it('reports zero for an address holding none', async () => {
        fetchMock.mockResolvedValue(ok({ constant_result: [word('0')], result: { result: true } }));
        expect(await getTronUsdtBalance(ADDRESS)).toBe('0');
    });

    it('keeps precision on an amount a number would round', async () => {
        // 9,007,199,254.740993 USDT, one unit past a safe integer.
        fetchMock.mockResolvedValue(ok({ constant_result: [word('20000000000001')] }));
        expect(await getTronUsdtBalance(ADDRESS)).toBe('9007199254.740993');
    });

    it('surfaces the node message, which arrives hex encoded inside a 200', async () => {
        const message = Buffer.from('contract validate error', 'utf8').toString('hex');
        fetchMock.mockResolvedValue(ok({ result: { result: false, message } }));
        await expect(getTronUsdtBalance(ADDRESS)).rejects.toThrow('contract validate error');
    });

    it('fails clearly when there is no result at all', async () => {
        fetchMock.mockResolvedValue(ok({ result: { result: true } }));
        await expect(getTronUsdtBalance(ADDRESS)).rejects.toBeInstanceOf(TronApiError);
    });

    it('tells the user what to do when the network is unreachable', async () => {
        fetchMock.mockRejectedValue(new TypeError('Network request failed'));
        await expect(getTronUsdtBalance(ADDRESS)).rejects.toThrow(/check your connection/);
    });

    it('refuses an address that is not a valid Tron address before calling out', async () => {
        await expect(getTronUsdtBalance('not-an-address')).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('getTronAccountState', () => {
    const resource = {
        freeNetLimit: 600,
        freeNetUsed: 100,
        NetLimit: 200,
        NetUsed: 50,
        EnergyLimit: 1500,
        EnergyUsed: 500,
    };

    it('reports an existing account with its TRX and resources', async () => {
        fetchMock
            .mockResolvedValueOnce(ok({ address: ADDRESS_HEX, balance: 5_000_000, latest_consume_free_time: 1789687896000 }))
            .mockResolvedValueOnce(ok(resource));
        const state = await getTronAccountState(ADDRESS);
        expect(state.activated).toBe(true);
        expect(state.trxBalance).toBe('5');
        expect(state.energyAvailable).toBe(1000);
        expect(state.bandwidthAvailable).toBe(650);
        // Kept apart, since one transaction cannot draw on both.
        expect(state.freeBandwidth).toBe(500);
        expect(state.stakedBandwidth).toBe(150);
        // What decides when free bandwidth covers a transfer again.
        expect(state.freeBandwidthUsed).toBe(100);
        expect(state.freeBandwidthLimit).toBe(600);
        expect(state.lastFreeBandwidthUseMs).toBe(1789687896000);
    });

    it('reports a never-used address as not activated, not as a failure', async () => {
        fetchMock.mockResolvedValueOnce(ok({})).mockResolvedValueOnce(ok({}));
        const state = await getTronAccountState(ADDRESS);
        expect(state.activated).toBe(false);
        expect(state.trxBalance).toBe('0');
        expect(state.energyAvailable).toBe(0);
        expect(state.bandwidthAvailable).toBe(0);
        expect(state.lastFreeBandwidthUseMs).toBe(0);
    });

    it('treats omitted counters as zero, which is how the node reports them', async () => {
        fetchMock
            .mockResolvedValueOnce(ok({ address: ADDRESS_HEX }))
            .mockResolvedValueOnce(ok({ freeNetLimit: 600, EnergyLimit: 100 }));
        const state = await getTronAccountState(ADDRESS);
        expect(state.bandwidthAvailable).toBe(600);
        expect(state.energyAvailable).toBe(100);
        expect(state.trxBalance).toBe('0');
    });

    it('never reports a negative allowance', async () => {
        fetchMock
            .mockResolvedValueOnce(ok({ address: ADDRESS_HEX }))
            .mockResolvedValueOnce(ok({ EnergyLimit: 100, EnergyUsed: 500, freeNetLimit: 10, freeNetUsed: 90 }));
        const state = await getTronAccountState(ADDRESS);
        expect(state.energyAvailable).toBe(0);
        expect(state.bandwidthAvailable).toBe(0);
    });

    it('sends the hex address to both endpoints', async () => {
        fetchMock.mockResolvedValue(ok({}));
        await getTronAccountState(ADDRESS);
        expect(sent(0).url).toBe('https://api.trongrid.io/wallet/getaccount');
        expect(sent(1).url).toBe('https://api.trongrid.io/wallet/getaccountresource');
        expect(sent(0).body.address).toBe(ADDRESS_HEX);
        expect(sent(1).body.address).toBe(ADDRESS_HEX);
    });
});

describe('getTronReferenceBlock', () => {
    const header = {
        blockID: '0000000005258181a96415362cb6d639039846e1934aa868b0fbe91ab2b5781e',
        block_header: { raw_data: { number: 86344065, timestamp: 1789704396000 } },
    };

    it('asks for the header only and returns height, id and network time', async () => {
        fetchMock.mockResolvedValue(ok(header));
        const block = await getTronReferenceBlock();
        expect(sent().url).toBe('https://api.trongrid.io/wallet/getblock');
        expect(sent().body).toEqual({ detail: false });
        expect(block).toEqual({ number: 86344065, id: header.blockID, timestamp: 1789704396000 });
    });

    it('refuses an answer that is not a usable block', async () => {
        for (const body of [
            {},
            { ...header, blockID: 'abc' },
            { ...header, block_header: { raw_data: { number: 86344065 } } },
            { ...header, block_header: { raw_data: { number: -1, timestamp: 1789704396000 } } },
        ]) {
            fetchMock.mockResolvedValueOnce(ok(body));
            await expect(getTronReferenceBlock()).rejects.toBeInstanceOf(TronApiError);
        }
    });
});

describe('getTronTransactionOutcome', () => {
    const TX = 'c3a9767f89d31a2e213305d0045ad87c8e31daa90a463af407fe1cc83816abd7';

    it('reports unknown while the transaction is not in a block', async () => {
        fetchMock.mockResolvedValue(ok({}));
        expect(await getTronTransactionOutcome(TX)).toEqual({ status: 'unknown' });
        expect(sent().url).toBe('https://api.trongrid.io/wallet/gettransactioninfobyid');
        expect(sent().body).toEqual({ value: TX });
    });

    it('reports success only when the receipt says the call succeeded', async () => {
        fetchMock.mockResolvedValue(
            ok({ blockNumber: 86344100, receipt: { energy_usage_total: 64285, result: 'SUCCESS' } }),
        );
        expect(await getTronTransactionOutcome(TX)).toEqual({
            status: 'succeeded',
            blockNumber: 86344100,
            energyUsed: 64285,
            trxBurnedSun: 0,
        });
    });

    it('reports a failed call, which still lands in a block and still costs its fee', async () => {
        fetchMock.mockResolvedValue(
            ok({
                blockNumber: 86344100,
                fee: 345000,
                result: 'FAILED',
                receipt: { energy_usage_total: 20000, net_fee: 345000, result: 'OUT_OF_ENERGY' },
            }),
        );
        expect(await getTronTransactionOutcome(TX)).toEqual({
            status: 'failed',
            blockNumber: 86344100,
            reason: 'OUT_OF_ENERGY',
            energyUsed: 20000,
            trxBurnedSun: 345000,
        });
    });

    it('never calls a receipt without a result a success', async () => {
        fetchMock.mockResolvedValue(ok({ blockNumber: 86344100, receipt: {} }));
        expect((await getTronTransactionOutcome(TX)).status).toBe('failed');
    });

    it('refuses something that is not a transaction id before calling out', async () => {
        await expect(getTronTransactionOutcome('not-a-txid')).rejects.toBeInstanceOf(TronApiError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

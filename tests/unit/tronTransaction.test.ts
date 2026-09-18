/**
 * Building and signing a USDT transfer on the device.
 *
 * What this protects:
 *   - The bytes are java-tron's, exactly. The vectors below are unsigned
 *     transfers built by the network's own encoder (api.trongrid.io,
 *     /wallet/triggersmartcontract, 2026-09-18). A single differing byte
 *     changes the transaction id, and the network would reject the signature.
 *   - The signature format is the one the network accepts: checked by
 *     recovering the signer of a real mainnet transfer.
 *   - The key signs only a transfer this module built, and only for the
 *     address it controls. A wrong account or missing passphrase fails here,
 *     not on-chain.
 *   - The two recipients that silently lose money are refused.
 */

import { tronAddressToHex } from '../../src/services/tron/address';
import { USDT_TRC20_CONTRACT } from '../../src/services/tron/constants';
import { deriveTronAccount } from '../../src/services/tron/keys';
import {
    DEFAULT_FEE_LIMIT_SUN,
    DEFAULT_VALIDITY_MS,
    TRANSFER_METHOD_ID,
    UsdtTransferRequest,
    buildUsdtTransfer,
    recoverTronSigner,
    signUsdtTransfer,
} from '../../src/services/tron/transaction';

/** Block 86344053, the reference the node chose for both vectors. */
const NODE_REFERENCE_BLOCK = {
    number: 86344053,
    id: '000000000525817508010f219354e9e406f715ba528e60226ecb4223a807067c',
    timestamp: 1789704360000,
};

const NODE_VECTORS = [
    {
        amountUnits: '1000000',
        feeLimitSun: 30_000_000,
        createdAtMs: 1789704415589,
        expirationMs: 1789704474000,
        rawDataHex:
            '0a028175220808010f219354e9e440909bcc958b345aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a154166426c7ac3d98b29191063833345b6bc540d7278121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244a9059cbb0000000000000000000000002ec158963bea8da94bff30427ed93b402b43630600000000000000000000000000000000000000000000000000000000000f424070e5d2c8958b3490018087a70e',
        txID: '5fbadcafd329a3a96e6a4dc11ac9eb9d2bfdf3613fb0cb16137f51ce556933f3',
    },
    {
        // Above 2^32, so the amount and the fee limit both need multi-byte varints.
        amountUnits: '123456789012',
        feeLimitSun: 100_000_000,
        createdAtMs: 1789704415720,
        expirationMs: 1789704474000,
        rawDataHex:
            '0a028175220808010f219354e9e440909bcc958b345aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a154166426c7ac3d98b29191063833345b6bc540d7278121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244a9059cbb0000000000000000000000002ec158963bea8da94bff30427ed93b402b4363060000000000000000000000000000000000000000000000000000001cbe991a1470e8d3c8958b34900180c2d72f',
        txID: '479d93ee9b11148c02fd1aa4543b5753547d6ec7209a6f252486b0be0a44fccb',
    },
];

const NODE_FROM = 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs';
const NODE_TO = 'TEERhoTJ3Rn6bKrWDYqdnuPaZ8kZf31YAS';

/** A real mainnet USDT transfer, signature and all (tx c3a9767f..., 2026-09-18). */
const MAINNET_SIGNED = {
    txID: 'c3a9767f89d31a2e213305d0045ad87c8e31daa90a463af407fe1cc83816abd7',
    signature:
        '5df6a20507681a065b591f831d7b83626e0c962539d44ba23bdf99da98f231ef74a6c051b78be68ebd9672e0f0d5e261791fc0dba71d6d6c1066a3bb81d64e641c',
    signer: 'TSxPjNL9zk5e8jKYD8pvsAKNpsJJ4s9YUB',
};

const TEST_MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OWN = deriveTronAccount(TEST_MNEMONIC).address;

const request = (overrides: Partial<UsdtTransferRequest> = {}): UsdtTransferRequest => ({
    from: OWN,
    to: NODE_TO,
    amountUnits: '2500000',
    referenceBlock: NODE_REFERENCE_BLOCK,
    createdAtMs: 1789704415000,
    ...overrides,
});

describe('TRANSFER_METHOD_ID', () => {
    it('is keccak256 of the ERC20 transfer signature, first four bytes', () => {
        expect(TRANSFER_METHOD_ID).toBe('a9059cbb');
    });
});

describe('buildUsdtTransfer', () => {
    it.each(NODE_VECTORS)('reproduces the node-built transfer of $amountUnits units byte for byte', vector => {
        const built = buildUsdtTransfer({
            from: NODE_FROM,
            to: NODE_TO,
            amountUnits: vector.amountUnits,
            referenceBlock: NODE_REFERENCE_BLOCK,
            feeLimitSun: vector.feeLimitSun,
            createdAtMs: vector.createdAtMs,
            expirationMs: vector.expirationMs,
        });
        expect(built.rawDataHex).toBe(vector.rawDataHex);
        expect(built.txID).toBe(vector.txID);
        expect(built.expirationMs).toBe(vector.expirationMs);
    });

    it('expires a minute after the reference block unless told otherwise', () => {
        expect(buildUsdtTransfer(request()).expirationMs).toBe(NODE_REFERENCE_BLOCK.timestamp + DEFAULT_VALIDITY_MS);
    });

    it('defaults the fee limit to 100 TRX, enough headroom for the 130,285 energy tier', () => {
        const withDefault = buildUsdtTransfer(request());
        const explicit = buildUsdtTransfer(request({ feeLimitSun: DEFAULT_FEE_LIMIT_SUN }));
        expect(withDefault.rawDataHex).toBe(explicit.rawDataHex);
        expect(DEFAULT_FEE_LIMIT_SUN).toBeGreaterThanOrEqual(130_285 * 100);
    });

    it('gives two transfers built moments apart different ids', () => {
        const first = buildUsdtTransfer(request({ createdAtMs: 1789704415000 }));
        const second = buildUsdtTransfer(request({ createdAtMs: 1789704415001 }));
        expect(first.txID).not.toBe(second.txID);
    });

    it('refuses to send to the sender, which only burns the fee', () => {
        expect(() => buildUsdtTransfer(request({ to: OWN }))).toThrow(/same address/);
    });

    it('refuses to send to the USDT contract, where tokens are lost for good', () => {
        expect(() => buildUsdtTransfer(request({ to: USDT_TRC20_CONTRACT }))).toThrow(/USDT contract/);
    });

    it('refuses an invalid address on either side', () => {
        expect(() => buildUsdtTransfer(request({ to: 'TNotAnAddress' }))).toThrow();
        expect(() => buildUsdtTransfer(request({ from: 'TNotAnAddress' }))).toThrow();
    });

    it('refuses an amount that is zero, negative or finer than a unit', () => {
        for (const amountUnits of ['0', '-1', '1.5', 'abc', '']) {
            expect(() => buildUsdtTransfer(request({ amountUnits }))).toThrow(/whole number of units/);
        }
    });

    it('refuses a fee limit the network would not accept', () => {
        for (const feeLimitSun of [0, -1, 1.5, 15_000_000_001]) {
            expect(() => buildUsdtTransfer(request({ feeLimitSun }))).toThrow(/Fee limit/);
        }
    });

    it('refuses a reference block whose id does not start with its height', () => {
        const mismatched = { ...NODE_REFERENCE_BLOCK, number: NODE_REFERENCE_BLOCK.number + 1 };
        expect(() => buildUsdtTransfer(request({ referenceBlock: mismatched }))).toThrow(/does not match/);
        expect(() =>
            buildUsdtTransfer(request({ referenceBlock: { ...NODE_REFERENCE_BLOCK, id: 'zz' } })),
        ).toThrow(/32 bytes/);
    });

    it('refuses an expiry before the reference block or more than a day after it', () => {
        const at = NODE_REFERENCE_BLOCK.timestamp;
        expect(() => buildUsdtTransfer(request({ expirationMs: at }))).toThrow(/within a day/);
        expect(() => buildUsdtTransfer(request({ expirationMs: at + 24 * 3600 * 1000 + 1 }))).toThrow(/within a day/);
    });
});

describe('recoverTronSigner', () => {
    it('recovers the signer of a real mainnet transfer, so the format matches the network', () => {
        expect(recoverTronSigner(MAINNET_SIGNED.txID, MAINNET_SIGNED.signature)).toBe(MAINNET_SIGNED.signer);
    });

    it('refuses a recovery byte other than 27 or 28', () => {
        const bad = `${MAINNET_SIGNED.signature.slice(0, 128)}01`;
        expect(() => recoverTronSigner(MAINNET_SIGNED.txID, bad)).toThrow(/27 or 28/);
    });

    it('refuses malformed input rather than recovering something', () => {
        expect(() => recoverTronSigner('00', MAINNET_SIGNED.signature)).toThrow();
        expect(() => recoverTronSigner(MAINNET_SIGNED.txID, '00')).toThrow();
    });
});

describe('signUsdtTransfer', () => {
    it('signs the transfer it built, and the signature recovers to the sender', () => {
        const signed = signUsdtTransfer(request(), TEST_MNEMONIC);
        expect(signed.txID).toBe(buildUsdtTransfer(request()).txID);
        expect(signed.signature).toMatch(/^[0-9a-f]{128}(1b|1c)$/);
        expect(recoverTronSigner(signed.txID, signed.signature)).toBe(OWN);
    });

    it('is deterministic, so a retry signs the same bytes', () => {
        expect(signUsdtTransfer(request(), TEST_MNEMONIC)).toEqual(signUsdtTransfer(request(), TEST_MNEMONIC));
    });

    it('wraps raw data and signature as a protobuf Transaction for broadcast', () => {
        const signed = signUsdtTransfer(request(), TEST_MNEMONIC);
        const rawLength = signed.rawDataHex.length / 2;
        // Field 1, the raw data, length-prefixed as a varint (two bytes here).
        const lengthVarint = Buffer.from([(rawLength % 0x80) + 0x80, Math.floor(rawLength / 0x80)]).toString('hex');
        expect(signed.transactionHex).toBe(`0a${lengthVarint}${signed.rawDataHex}1241${signed.signature}`);
    });

    it('refuses to sign for an address the phrase does not control', () => {
        expect(() => signUsdtTransfer(request({ from: NODE_FROM }), TEST_MNEMONIC)).toThrow(/cannot sign/);
    });

    it('signs with the passphrase account, and refuses when the passphrase is missing', () => {
        const withPassphrase = deriveTronAccount(TEST_MNEMONIC, 0, 0, 'hunter2').address;
        const passphraseRequest = request({ from: withPassphrase });
        const signed = signUsdtTransfer(passphraseRequest, TEST_MNEMONIC, 'hunter2');
        expect(recoverTronSigner(signed.txID, signed.signature)).toBe(withPassphrase);
        expect(() => signUsdtTransfer(passphraseRequest, TEST_MNEMONIC)).toThrow(/passphrase/);
    });

    it('never signs a transfer it would refuse to build', () => {
        expect(() => signUsdtTransfer(request({ to: OWN }), TEST_MNEMONIC)).toThrow(/same address/);
    });

    it('puts the recipient and amount it was asked for into the signed bytes', () => {
        const signed = signUsdtTransfer(request({ amountUnits: '2500000' }), TEST_MNEMONIC);
        const toWord = tronAddressToHex(NODE_TO).slice(2).padStart(64, '0');
        const amountWord = (2_500_000).toString(16).padStart(64, '0');
        expect(signed.rawDataHex).toContain(`a9059cbb${toWord}${amountWord}`);
    });
});

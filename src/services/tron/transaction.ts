/**
 * Building and signing a USDT transfer on Tron, on the device.
 *
 * The node is asked for one thing only: a recent block to anchor the
 * transaction to. Everything that decides where the money goes (sender,
 * recipient, amount, contract) is encoded here, so a lying or compromised node
 * cannot swap the recipient under a signature. The bytes match what java-tron
 * builds for the same inputs, and the tests pin that against transactions the
 * network's own encoder produced.
 *
 * The key signs only what this module has just built. There is deliberately no
 * export that signs caller-supplied bytes: a general-purpose signer is how an
 * integration bug ends up authorizing a transfer nobody asked for. After
 * signing, the signature is recovered back to an address and compared with
 * the sender, which catches the wrong account or a missing BIP39 passphrase
 * before anything leaves the phone.
 *
 * Nothing here logs. The inputs include seed material.
 */

import * as secp from '@noble/secp256k1';
import BigNumber from 'bignumber.js';
import { Buffer } from 'buffer';
import CryptoJS from 'crypto-js';

// Installs the synchronous HMAC that secp.signSync needs.
import '../../../blue_modules/noble_ecc';
import { keccak256, tronAddressBytesFromPublicKey, tronAddressFromHex, tronAddressToHex } from './address';
import { sliceBytes, toHex } from './bytes';
import { USDT_TRC20_CONTRACT } from './constants';
import { TRANSFER_SELECTOR, encodeTransferParameter } from './contract';
import { withTronPrivateKey, withTronPrivateKeyNative } from './keys';
import { bytesField, varintField } from './protobuf';

/** Protocol enum for a smart contract call, and the Any type it travels in. */
const TRIGGER_SMART_CONTRACT = 31;
const TRIGGER_SMART_CONTRACT_TYPE_URL = 'type.googleapis.com/protocol.TriggerSmartContract';

/** First four bytes of keccak256("transfer(address,uint256)"): a9059cbb. */
export const TRANSFER_METHOD_ID = toHex(sliceBytes(keccak256(Buffer.from(TRANSFER_SELECTOR, 'utf8')), 0, 4));

/**
 * Cap on the TRX the network may burn for energy, in sun: 100 TRX.
 *
 * A ceiling, not a charge. It still has to be generous: the network also uses
 * it to limit how much energy a call may consume, rented energy included, so a
 * cap below energy times the energy price stops the transfer part way even when
 * the energy is sitting on the address. 100 TRX covers the 130,285 energy tier
 * up to about 760 sun per energy, against 100 today. Our users hold no TRX, so
 * there is nothing for it to burn.
 */
export const DEFAULT_FEE_LIMIT_SUN = 100_000_000;

/** The network's own ceiling on a fee limit, 15,000 TRX. */
export const MAX_FEE_LIMIT_SUN = 15_000_000_000;

/**
 * How long a signed transfer stays valid: one minute past its reference block.
 *
 * Kept short on purpose. Until it expires, a signed transfer can be broadcast
 * by whoever holds it, so a send the user has abandoned should stop being
 * spendable soon after. A minute covers renting energy and relaying it.
 */
export const DEFAULT_VALIDITY_MS = 60_000;

/** The network refuses expiries more than a day past the reference block. */
const MAX_VALIDITY_MS = 24 * 60 * 60 * 1000;

/** The block a transaction is anchored to, which the node checks it against. */
export type TronReferenceBlock = {
    /** Block height. */
    readonly number: number;
    /** 32 byte block id, hex. */
    readonly id: string;
    /** Block time in ms, by the network's clock rather than the phone's. */
    readonly timestamp: number;
};

export type UsdtTransferRequest = {
    /** Sender, base58. Must be the account the signing phrase derives. */
    readonly from: string;
    /** Recipient, base58. */
    readonly to: string;
    /** Amount in USDT's smallest unit (six decimals), as an integer string. */
    readonly amountUnits: string;
    readonly referenceBlock: TronReferenceBlock;
    /** Defaults to DEFAULT_FEE_LIMIT_SUN. */
    readonly feeLimitSun?: number;
    /** Creation time in ms. Defaults to now. */
    readonly createdAtMs?: number;
    /**
     * Exact expiry in ms. Defaults to DEFAULT_VALIDITY_MS past the reference
     * block; set it only to reproduce a transaction built elsewhere.
     */
    readonly expirationMs?: number;
};

export type UnsignedUsdtTransfer = {
    /** sha256 of rawDataHex: what gets signed, and how the network names it. */
    readonly txID: string;
    readonly rawDataHex: string;
    readonly expirationMs: number;
};

export type SignedUsdtTransfer = UnsignedUsdtTransfer & {
    /** 65 bytes, hex: r, then s, then v as 27 or 28. */
    readonly signature: string;
    /** The whole signed transaction as protobuf, hex. What /wallet/broadcasthex takes. */
    readonly transactionHex: string;
};

/**
 * Signs one transfer request for one account. The send flow takes this rather
 * than a phrase, so it can sign again when asked without holding seed
 * material itself. See tronTransferSignerForWallet in ./account.
 *
 * May answer with a promise: the app's signer does its seed step natively,
 * which is asynchronous. The send flow awaits either.
 */
export type UsdtTransferSigner = (request: UsdtTransferRequest) => SignedUsdtTransfer | Promise<SignedUsdtTransfer>;

function sha256(bytes: Buffer): Buffer {
    const digest = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(toHex(bytes)));
    return Buffer.from(digest.toString(CryptoJS.enc.Hex), 'hex');
}

/**
 * TAPoS reference: the low two bytes of the height and bytes 8 to 16 of the id.
 *
 * The node matches the pair against its recent blocks, so a transaction built
 * on a stale or foreign chain is refused rather than replayed. A Tron block id
 * starts with the height, which lets a mismatched answer be caught here.
 */
function referenceFields(block: TronReferenceBlock): { refBlockBytes: Buffer; refBlockHash: Buffer } {
    if (!Number.isSafeInteger(block.number) || block.number <= 0) {
        throw new Error('Reference block height is not a positive integer');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(block.id)) {
        throw new Error('Reference block id must be 32 bytes of hex');
    }
    if (parseInt(block.id.slice(0, 16), 16) !== block.number) {
        throw new Error('Reference block id does not match its height');
    }
    const low = block.number % 0x10000;
    return {
        refBlockBytes: Buffer.from([Math.floor(low / 0x100), low % 0x100]),
        refBlockHash: Buffer.from(block.id.slice(16, 32), 'hex'),
    };
}

function checkedAmount(amountUnits: string): string {
    const amount = new BigNumber(amountUnits);
    if (!amount.isFinite() || !amount.isInteger() || amount.lte(0)) {
        throw new Error('Amount must be a whole number of units above zero');
    }
    return amount.toFixed(0);
}

function checkedFeeLimit(feeLimitSun: number): number {
    if (!Number.isSafeInteger(feeLimitSun) || feeLimitSun <= 0 || feeLimitSun > MAX_FEE_LIMIT_SUN) {
        throw new Error('Fee limit must be a whole number of sun, up to 15,000 TRX');
    }
    return feeLimitSun;
}

/**
 * The unsigned transfer: raw bytes and the id that gets signed.
 *
 * Refuses the two recipients that lose money without any error from the
 * network: the sender itself, which burns the fee for nothing, and the USDT
 * contract, where tokens sent are gone for good.
 */
export function buildUsdtTransfer(request: UsdtTransferRequest): UnsignedUsdtTransfer {
    const fromHex = tronAddressToHex(request.from);
    const toHex = tronAddressToHex(request.to);
    const contractHex = tronAddressToHex(USDT_TRC20_CONTRACT);
    if (toHex === fromHex) {
        throw new Error('Cannot send to the same address');
    }
    if (toHex === contractHex) {
        throw new Error('That is the USDT contract, not a wallet. USDT sent there cannot be recovered');
    }

    const { refBlockBytes, refBlockHash } = referenceFields(request.referenceBlock);
    const expirationMs = request.expirationMs ?? request.referenceBlock.timestamp + DEFAULT_VALIDITY_MS;
    if (
        !Number.isSafeInteger(expirationMs) ||
        expirationMs <= request.referenceBlock.timestamp ||
        expirationMs > request.referenceBlock.timestamp + MAX_VALIDITY_MS
    ) {
        throw new Error('Expiry must fall within a day after the reference block');
    }
    const createdAtMs = request.createdAtMs ?? Date.now();
    const feeLimitSun = checkedFeeLimit(request.feeLimitSun ?? DEFAULT_FEE_LIMIT_SUN);
    const callData = Buffer.from(TRANSFER_METHOD_ID + encodeTransferParameter(toHex, checkedAmount(request.amountUnits)), 'hex');

    // Field numbers are java-tron's Transaction.raw, TriggerSmartContract and
    // google.protobuf.Any. call_value is zero and so left out, as proto3 does.
    const triggerSmartContract = Buffer.concat([
        bytesField(1, Buffer.from(fromHex, 'hex')),
        bytesField(2, Buffer.from(contractHex, 'hex')),
        bytesField(4, callData),
    ]);
    const contract = Buffer.concat([
        varintField(1, TRIGGER_SMART_CONTRACT),
        bytesField(
            2,
            Buffer.concat([
                bytesField(1, Buffer.from(TRIGGER_SMART_CONTRACT_TYPE_URL, 'utf8')),
                bytesField(2, triggerSmartContract),
            ]),
        ),
    ]);
    const rawData = Buffer.concat([
        bytesField(1, refBlockBytes),
        bytesField(4, refBlockHash),
        varintField(8, expirationMs),
        bytesField(11, contract),
        varintField(14, createdAtMs),
        varintField(18, feeLimitSun),
    ]);

    return {
        txID: sha256(rawData).toString('hex'),
        rawDataHex: rawData.toString('hex'),
        expirationMs,
    };
}

/** The base58 address that produced a signature over a transaction id. */
export function recoverTronSigner(txID: string, signature: string): string {
    if (!/^[0-9a-fA-F]{64}$/.test(txID) || !/^[0-9a-fA-F]{130}$/.test(signature)) {
        throw new Error('Expected a 32 byte transaction id and a 65 byte signature');
    }
    const v = parseInt(signature.slice(128), 16);
    if (v !== 27 && v !== 28) {
        throw new Error('Signature recovery byte must be 27 or 28');
    }
    // Parsed as compact explicitly: handed a bare hex string, the library tries
    // DER first, and a signature should never depend on that guess.
    const compact = secp.Signature.fromCompact(signature.slice(0, 128));
    const publicKey = secp.recoverPublicKey(txID, compact, v - 27, false);
    return tronAddressFromHex(tronAddressBytesFromPublicKey(Buffer.from(publicKey)).toString('hex'));
}

/** 65 bytes, hex: r, s, then v as 27 or 28. */
function signTxID(txID: string, privateKey: Buffer): string {
    const [compact, recovery] = secp.signSync(txID, privateKey, {
        recovered: true,
        der: false,
        canonical: true,
    });
    return Buffer.concat([Buffer.from(compact), Buffer.from([recovery + 27])]).toString('hex');
}

/** Check the signature recovers to the sender, then wrap it into the broadcastable transaction. */
function assembleSigned(request: UsdtTransferRequest, unsigned: UnsignedUsdtTransfer, signature: string): SignedUsdtTransfer {
    if (tronAddressToHex(recoverTronSigner(unsigned.txID, signature)) !== tronAddressToHex(request.from)) {
        throw new Error('This wallet cannot sign for the sending address. Check the account and its passphrase');
    }

    const transaction = Buffer.concat([
        bytesField(1, Buffer.from(unsigned.rawDataHex, 'hex')),
        bytesField(2, Buffer.from(signature, 'hex')),
    ]);
    return { ...unsigned, signature, transactionHex: transaction.toString('hex') };
}

/**
 * Build the transfer, sign it with the account the phrase derives, and check
 * the signature recovers to the sender before returning anything.
 *
 * The signature is deterministic (RFC 6979) and low-S, so signing the same
 * request twice gives the same bytes.
 */
export function signUsdtTransfer(
    request: UsdtTransferRequest,
    mnemonic: string,
    passphrase?: string,
): SignedUsdtTransfer {
    const unsigned = buildUsdtTransfer(request);
    const signature = withTronPrivateKey(mnemonic, privateKey => signTxID(unsigned.txID, privateKey), 0, 0, passphrase);
    return assembleSigned(request, unsigned, signature);
}

/**
 * signUsdtTransfer with the seed step done natively, which is what the app
 * signs with: the JavaScript seed step froze the app for seconds at the moment
 * the user confirmed. The same bytes come out, since only the seed step moved.
 */
export async function signUsdtTransferNative(
    request: UsdtTransferRequest,
    mnemonic: string,
    passphrase?: string,
): Promise<SignedUsdtTransfer> {
    const unsigned = buildUsdtTransfer(request);
    const signature = await withTronPrivateKeyNative(
        mnemonic,
        privateKey => signTxID(unsigned.txID, privateKey),
        0,
        0,
        passphrase,
    );
    return assembleSigned(request, unsigned, signature);
}

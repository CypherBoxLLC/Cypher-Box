/**
 * A hardware signer can hand back a finished raw transaction instead of a signed PSBT. That transaction must
 * be the one the user reviewed: same inputs, same outputs, same version and locktime. Anything else is refused
 * before it can reach the confirm screen or the broadcast call.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';
import {
    SIGNED_TX_INVALID,
    SIGNED_TX_MISMATCH,
    assertSignedTxMatchesPsbt,
    isRawTransactionHex,
    parseImportedTransaction,
    summarizeSignedTx,
} from '../../src/helpers/signedTransaction';

const PREV_TXID = Buffer.alloc(32, 0xaa);
const SEQUENCE = 0xfffffffd;
const OWN = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 1) });
const PAYEE = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 2) });
const OTHER = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 3) });

const REVIEWED_OUTPUTS: [Buffer, number][] = [
    [PAYEE.output as Buffer, 60_000],
    [OWN.output as Buffer, 39_000],
];

const reviewedPsbt = () => {
    const psbt = new bitcoin.Psbt();
    psbt.addInput({ hash: PREV_TXID, index: 0, sequence: SEQUENCE, witnessUtxo: { script: OWN.output as Buffer, value: 100_000 } });
    for (const [script, value] of REVIEWED_OUTPUTS) psbt.addOutput({ script, value });
    return psbt;
};

// what a signer returns: a transaction with witness data attached
const signedHex = ({
    outputs = REVIEWED_OUTPUTS,
    prevTxid = PREV_TXID as Buffer,
    sequence = SEQUENCE,
    locktime = 0,
}: { outputs?: [Buffer, number][]; prevTxid?: Buffer; sequence?: number; locktime?: number } = {}) => {
    const tx = new bitcoin.Transaction();
    tx.version = 2;
    tx.locktime = locktime;
    tx.addInput(prevTxid, 0, sequence);
    for (const [script, value] of outputs) tx.addOutput(script, value);
    tx.setWitness(0, [Buffer.alloc(71, 1), Buffer.alloc(33, 2)]);
    return tx.toHex();
};

describe('assertSignedTxMatchesPsbt', () => {
    it('accepts the reviewed transaction once signed', () => {
        const hex = signedHex();
        expect(assertSignedTxMatchesPsbt(hex, reviewedPsbt()).toHex()).toBe(hex);
    });

    it('accepts the PSBT as base64 and tolerates surrounding whitespace', () => {
        expect(() => assertSignedTxMatchesPsbt(signedHex() + '\n', reviewedPsbt().toBase64())).not.toThrow();
    });

    it('refuses a different recipient', () => {
        const hex = signedHex({ outputs: [[OTHER.output as Buffer, 60_000], REVIEWED_OUTPUTS[1]] });
        expect(() => assertSignedTxMatchesPsbt(hex, reviewedPsbt())).toThrow(SIGNED_TX_MISMATCH);
    });

    it('refuses a different amount', () => {
        const hex = signedHex({ outputs: [[PAYEE.output as Buffer, 60_000], [OWN.output as Buffer, 9_000]] });
        expect(() => assertSignedTxMatchesPsbt(hex, reviewedPsbt())).toThrow(SIGNED_TX_MISMATCH);
    });

    it('refuses an extra output', () => {
        const hex = signedHex({ outputs: [...REVIEWED_OUTPUTS, [OTHER.output as Buffer, 500]] });
        expect(() => assertSignedTxMatchesPsbt(hex, reviewedPsbt())).toThrow(SIGNED_TX_MISMATCH);
    });

    it('refuses a transaction spending other coins', () => {
        const hex = signedHex({ prevTxid: Buffer.alloc(32, 0xbb) });
        expect(() => assertSignedTxMatchesPsbt(hex, reviewedPsbt())).toThrow(SIGNED_TX_MISMATCH);
    });

    it('refuses a changed sequence or locktime', () => {
        expect(() => assertSignedTxMatchesPsbt(signedHex({ sequence: 0xffffffff }), reviewedPsbt())).toThrow(SIGNED_TX_MISMATCH);
        expect(() => assertSignedTxMatchesPsbt(signedHex({ locktime: 900_000 }), reviewedPsbt())).toThrow(SIGNED_TX_MISMATCH);
    });

    it('refuses data that is not a transaction', () => {
        expect(() => assertSignedTxMatchesPsbt('deadbeef', reviewedPsbt())).toThrow(SIGNED_TX_INVALID);
    });

    it('refuses when there is no reviewed PSBT to compare against', () => {
        expect(() => assertSignedTxMatchesPsbt(signedHex(), undefined as any)).toThrow(SIGNED_TX_MISMATCH);
    });
});

describe('isRawTransactionHex', () => {
    it('recognises raw transaction hex, including a trailing newline from a .txn file', () => {
        expect(isRawTransactionHex(signedHex())).toBe(true);
        expect(isRawTransactionHex(signedHex() + '\n')).toBe(true);
    });

    it('treats PSBTs as PSBTs, including base64 without padding and hex-encoded ones', () => {
        const psbt = reviewedPsbt();
        expect(isRawTransactionHex(psbt.toBase64())).toBe(false);
        expect(isRawTransactionHex(psbt.toBase64().replace(/=+$/, ''))).toBe(false);
        expect(isRawTransactionHex(psbt.toHex())).toBe(false);
    });
});

describe('summarizeSignedTx', () => {
    it('lists every output with its address and amount, and the fee from the PSBT', () => {
        const summary = summarizeSignedTx(signedHex(), reviewedPsbt());
        expect(summary.outputs).toEqual([
            { address: PAYEE.address, value: 60_000 },
            { address: OWN.address, value: 39_000 },
        ]);
        expect(summary.fee).toBe(1_000);
    });

    it('omits the fee without a PSBT', () => {
        expect(summarizeSignedTx(signedHex()).fee).toBeNull();
    });

    it('reads input amounts from a full previous transaction too', () => {
        const prevTx = new bitcoin.Transaction();
        prevTx.addInput(Buffer.alloc(32, 0x09), 0);
        prevTx.addOutput(OWN.output as Buffer, 100_000);
        const psbt = new bitcoin.Psbt();
        psbt.addInput({ hash: prevTx.getHash(), index: 0, sequence: SEQUENCE, nonWitnessUtxo: prevTx.toBuffer() });
        for (const [script, value] of REVIEWED_OUTPUTS) psbt.addOutput({ script, value });

        expect(summarizeSignedTx(signedHex({ prevTxid: prevTx.getHash() }), psbt).fee).toBe(1_000);
    });
});

describe('parseImportedTransaction', () => {
    const key = ECPairFactory(ecc).fromPrivateKey(Buffer.alloc(32, 7));
    const KEY_OUT = bitcoin.payments.p2wpkh({ pubkey: key.publicKey });

    const unsignedPsbt = () => {
        const psbt = new bitcoin.Psbt();
        psbt.addInput({ hash: PREV_TXID, index: 0, sequence: SEQUENCE, witnessUtxo: { script: KEY_OUT.output as Buffer, value: 100_000 } });
        for (const [script, value] of REVIEWED_OUTPUTS) psbt.addOutput({ script, value });
        return psbt;
    };
    const signedPsbt = () => unsignedPsbt().signAllInputs(key);

    it('passes a raw transaction through, trimmed', () => {
        expect(parseImportedTransaction(signedHex() + '\n')).toEqual({ txhex: signedHex() });
    });

    it('turns a signed PSBT into a finished transaction, as base64 or hex', () => {
        const expected = signedPsbt().finalizeAllInputs().extractTransaction().toHex();
        expect(parseImportedTransaction(signedPsbt().toBase64())).toEqual({ txhex: expected });
        expect(parseImportedTransaction(signedPsbt().toHex())).toEqual({ txhex: expected });
    });

    it('accepts a PSBT the signer already finalized', () => {
        const finalized = signedPsbt().finalizeAllInputs();
        expect(parseImportedTransaction(finalized.toBase64())).toEqual({ txhex: finalized.extractTransaction().toHex() });
    });

    it('hands back a PSBT that still needs signatures, unchanged', () => {
        const base64 = unsignedPsbt().toBase64();
        const result = parseImportedTransaction(base64) as { psbt: bitcoin.Psbt };
        expect(result.psbt.toBase64()).toBe(base64);
    });

    it('refuses data that is neither', () => {
        expect(() => parseImportedTransaction('deadbeef')).toThrow(SIGNED_TX_INVALID);
        expect(() => parseImportedTransaction('hello world')).toThrow(SIGNED_TX_INVALID);
    });
});

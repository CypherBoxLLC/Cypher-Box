/**
 * A cold vault spend waits while the user signs it on another device. When a signed transaction comes back from
 * outside the signing flow, it is only treated as that spend if it is exactly that spend; one that spends the same
 * capsules differently must not pass as it.
 */

import * as bitcoin from 'bitcoinjs-lib';
import {
    createPendingSignature,
    describePending,
    formatAge,
    formatSats,
    pendingInputsSpent,
    resumeParams,
    sameUnsignedTransaction,
    signedTxMatchesPending,
    spendsPendingInputs,
} from '../../src/helpers/pendingSignature';

const PREV_A = Buffer.alloc(32, 0xaa);
const PREV_B = Buffer.alloc(32, 0xbb);
const OWN = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 1) });
const OWN_CHANGE = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 4) });
const PAYEE = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 2) });
const ATTACKER = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 3) });
const SEQUENCE = 0xfffffffd;

const isOwn = (address: string) => address === OWN.address || address === OWN_CHANGE.address;

const unsignedPsbt = (outputs: [Buffer, number][] = [[PAYEE.output as Buffer, 60_000], [OWN_CHANGE.output as Buffer, 39_000]]) => {
    const psbt = new bitcoin.Psbt();
    psbt.addInput({ hash: PREV_A, index: 0, sequence: SEQUENCE, witnessUtxo: { script: OWN.output as Buffer, value: 100_000 } });
    for (const [script, value] of outputs) psbt.addOutput({ script, value });
    return psbt;
};

const signedHex = (outputs: [Buffer, number][], prev = PREV_A) => {
    const tx = new bitcoin.Transaction();
    tx.version = 2;
    tx.addInput(prev, 0, SEQUENCE);
    for (const [script, value] of outputs) tx.addOutput(script, value);
    tx.setWitness(0, [Buffer.alloc(71, 1), Buffer.alloc(33, 2)]);
    return tx.toHex();
};

const txid = (hash: Buffer) => Buffer.from(hash).reverse().toString('hex');

const pending = () =>
    createPendingSignature({ psbt: unsignedPsbt(), sats: 60_000, inUSD: '60.00', destinationAddress: PAYEE.address, fromWallet: {} }, 1_000);

describe('createPendingSignature', () => {
    it('keeps the unsigned PSBT as base64 and only plain data', () => {
        const entry = pending();
        expect(entry.psbt).toBe(unsignedPsbt().toBase64());
        expect(entry.createdAt).toBe(1_000);
        expect(entry.sats).toBe(60_000);
        expect(entry).not.toHaveProperty('fromWallet');
        expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
    });
});

describe('sameUnsignedTransaction', () => {
    it('ignores signatures one copy picked up', () => {
        const signed = unsignedPsbt();
        signed.updateInput(0, { finalScriptWitness: Buffer.from('0201aa01bb', 'hex') });
        expect(sameUnsignedTransaction(signed, pending().psbt)).toBe(true);
    });

    it('tells a different transaction apart', () => {
        expect(sameUnsignedTransaction(unsignedPsbt([[ATTACKER.output as Buffer, 99_000]]), pending().psbt)).toBe(false);
    });
});

describe('resumeParams', () => {
    it('rebuilds the PSBT and takes the wallet looked up again', () => {
        const wallet = { getID: () => 'cold-1' };
        const params = resumeParams(pending(), wallet);
        expect(params.psbt.toBase64()).toBe(pending().psbt);
        expect(params.fromWallet).toBe(wallet);
        expect(params.walletID).toBe('cold-1');
        expect(params).not.toHaveProperty('createdAt');
    });
});

describe('signedTxMatchesPending', () => {
    it('accepts the prepared transaction once signed', () => {
        expect(signedTxMatchesPending(signedHex([[PAYEE.output as Buffer, 60_000], [OWN_CHANGE.output as Buffer, 39_000]]), pending())).toBe(true);
    });

    it('refuses one that spends the same capsule but pays someone else', () => {
        const swapped = signedHex([[ATTACKER.output as Buffer, 60_000], [OWN_CHANGE.output as Buffer, 39_000]]);
        expect(signedTxMatchesPending(swapped, pending())).toBe(false);
        expect(spendsPendingInputs(swapped, pending())).toBe(true);
    });

    it('treats an unrelated transaction as unrelated', () => {
        const other = signedHex([[PAYEE.output as Buffer, 10_000]], PREV_B);
        expect(signedTxMatchesPending(other, pending())).toBe(false);
        expect(spendsPendingInputs(other, pending())).toBe(false);
    });

    it('never throws on garbage', () => {
        expect(signedTxMatchesPending('deadbeef', pending())).toBe(false);
        expect(spendsPendingInputs('deadbeef', pending())).toBe(false);
    });
});

describe('pendingInputsSpent', () => {
    it('is false while the capsule is still unspent', () => {
        expect(pendingInputsSpent(pending(), [{ txid: txid(PREV_A), vout: 0 }, { txid: txid(PREV_B), vout: 1 }])).toBe(false);
    });

    it('is true once the capsule is gone from the wallet', () => {
        expect(pendingInputsSpent(pending(), [{ txid: txid(PREV_B), vout: 1 }])).toBe(true);
    });

    it('proves nothing from an empty list', () => {
        expect(pendingInputsSpent(pending(), [])).toBe(false);
    });
});

describe('describePending', () => {
    it('reports what leaves the vault, not the change', () => {
        expect(describePending(pending(), isOwn)).toEqual({ kind: 'send', sats: 60_000, address: PAYEE.address });
    });

    it('calls it a consolidation when everything comes back to the vault', () => {
        const merge = createPendingSignature({ psbt: unsignedPsbt([[OWN_CHANGE.output as Buffer, 99_000]]) });
        expect(describePending(merge, isOwn)).toEqual({ kind: 'consolidate', capsules: 1, sats: 99_000 });
    });
});

describe('formatting', () => {
    it('groups sats', () => {
        expect(formatSats(1234567)).toBe('1,234,567 sats');
        expect(formatSats(999)).toBe('999 sats');
    });

    it('says how long ago', () => {
        expect(formatAge(10_000)).toBe('just now');
        expect(formatAge(5 * 60_000)).toBe('5 min ago');
        expect(formatAge(3 * 3_600_000)).toBe('3 h ago');
        expect(formatAge(26 * 3_600_000)).toBe('1 day ago');
        expect(formatAge(72 * 3_600_000)).toBe('3 days ago');
    });
});

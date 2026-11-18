/**
 * Nonce-reuse canary. Deterministic (RFC6979) signing makes reuse impossible,
 * so this exists to catch a broken or tampered primitive: two signatures from
 * the same key that share r but differ in s leak the private key. An identical
 * re-sign (same r AND s) is benign, and the same r under a different key is
 * unrelated.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { auditPsbtSignatures, NonceReuseError, __resetSignatureAuditForTest } from '../../class/signatureAudit';

const der = (rHex: string, sHex: string) =>
    bitcoin.script.signature.encode(Buffer.concat([Buffer.from(rHex, 'hex'), Buffer.from(sHex, 'hex')]), 1);

const psbtOf = (sigs: Array<{ pubkey: Buffer; sig: Buffer }>) =>
    ({ data: { inputs: sigs.map(x => ({ partialSig: [{ pubkey: x.pubkey, signature: x.sig }] })) } } as unknown as bitcoin.Psbt);

const R1 = '11'.repeat(32);
const R2 = '22'.repeat(32);
const S1 = '00'.repeat(31) + '01';
const S2 = '00'.repeat(31) + '02';
const PUB = Buffer.from('02' + 'ab'.repeat(32), 'hex');
const PUB2 = Buffer.from('03' + 'cd'.repeat(32), 'hex');

beforeEach(() => __resetSignatureAuditForTest());

describe('auditPsbtSignatures (nonce canary)', () => {
    it('passes for distinct signatures', () => {
        expect(() =>
            auditPsbtSignatures(psbtOf([{ pubkey: PUB, sig: der(R1, S1) }, { pubkey: PUB, sig: der(R2, S2) }])),
        ).not.toThrow();
    });

    it('throws on nonce reuse: same pubkey and r, different s', () => {
        expect(() =>
            auditPsbtSignatures(psbtOf([{ pubkey: PUB, sig: der(R1, S1) }, { pubkey: PUB, sig: der(R1, S2) }])),
        ).toThrow(NonceReuseError);
    });

    it('allows an identical re-sign (same pubkey, r and s)', () => {
        auditPsbtSignatures(psbtOf([{ pubkey: PUB, sig: der(R1, S1) }]));
        expect(() => auditPsbtSignatures(psbtOf([{ pubkey: PUB, sig: der(R1, S1) }]))).not.toThrow();
    });

    it('allows the same r under a different key', () => {
        expect(() =>
            auditPsbtSignatures(psbtOf([{ pubkey: PUB, sig: der(R1, S1) }, { pubkey: PUB2, sig: der(R1, S2) }])),
        ).not.toThrow();
    });

    it('ignores inputs with no partial signatures', () => {
        const p = { data: { inputs: [{ finalScriptWitness: Buffer.from('00', 'hex') }] } } as unknown as bitcoin.Psbt;
        expect(() => auditPsbtSignatures(p)).not.toThrow();
    });
});

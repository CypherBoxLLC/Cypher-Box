import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import ecc from '../../blue_modules/noble_ecc';
import {
  hostCommitStep,
  hostRevealStep,
  hostVerifyStep,
  signerCommitStep,
  signerSignStep,
  SignerKeyAccess,
} from '../../src/helpers/antiExfilController';
import { decodeAntiExfilMessage } from '../../src/helpers/antiExfilTransport';
import { hostVerify, taggedHash } from '../../src/helpers/antiExfil';
import * as necc from '@noble/secp256k1';

const assert = require('assert');
const crypto = require('crypto');

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

const SEED = Buffer.from('b1d2e3f405162738495a6b7c8d9eafb0c1d2e3f405162738495a6b7c8d9eaf01', 'hex');
const PATH = "m/84'/0'/0'/0/0";

function makeWalletPsbt() {
  const root = bip32.fromSeed(SEED);
  const node = root.derivePath(PATH);
  const pubkey = Buffer.from(node.publicKey);
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey });
  const psbt = new bitcoin.Psbt();
  psbt.addInput({
    hash: 'cd'.repeat(32),
    index: 0,
    witnessUtxo: { script: p2wpkh.output as Buffer, value: 200000 },
    bip32Derivation: [{ masterFingerprint: Buffer.from(root.fingerprint), path: PATH, pubkey }],
  });
  psbt.addOutput({ address: p2wpkh.address as string, value: 180000 });

  const access: SignerKeyAccess = {
    derive: (path: string) => {
      const n = root.derivePath(path);
      return n.privateKey ? Uint8Array.from(n.privateKey) : null;
    },
  };
  return { psbtBase64: psbt.toBase64(), access, node };
}

const randomness = () => Uint8Array.from(crypto.randomBytes(32));
const decodeOk = (raw: string) => {
  const r = decodeAntiExfilMessage(raw);
  if (r.kind !== 'ok') throw new Error(`expected ok message, got ${r.kind}`);
  return r.message;
};

describe('antiExfil controller 4-hop state machine', () => {
  it('drives an honest host <-> signer exchange to an ok verdict', () => {
    const { psbtBase64, access } = makeWalletPsbt();

    // hop 1: host commit.
    const h1 = hostCommitStep(psbtBase64, randomness);
    const commitMsg = decodeOk(h1.message);
    assert.strictEqual(commitMsg.hop, 'commit');

    // hop 2: signer opens.
    const s1 = signerCommitStep(commitMsg, access);
    const openMsg = decodeOk(s1.message);
    assert.strictEqual(openMsg.hop, 'open');

    // hop 3: host reveals rho.
    const h2 = hostRevealStep(openMsg, h1.session);
    const revealMsg = decodeOk(h2.message);
    assert.strictEqual(revealMsg.hop, 'reveal');
    assert.ok(revealMsg.rhos && revealMsg.rhos.length === 1);

    // hop 4: signer signs.
    const s2 = signerSignStep(revealMsg, s1.session, access);
    const signMsg = decodeOk(s2.message);
    assert.strictEqual(signMsg.hop, 'sign');

    // host verifies.
    const verdict = hostVerifyStep(signMsg, h2.session);
    assert.strictEqual(verdict.verdict, 'ok');
    assert.ok(verdict.signedPsbtBase64);

    // and the verified signed PSBT finalizes.
    const tx = bitcoin.Psbt.fromBase64(verdict.signedPsbtBase64!).finalizeAllInputs().extractTransaction();
    assert.strictEqual(tx.getId().length, 64);
  });

  it('returns a tamper verdict when the signer signs honestly-looking but off-commitment', () => {
    const { psbtBase64, access, node } = makeWalletPsbt();
    const h1 = hostCommitStep(psbtBase64, randomness);
    const commitMsg = decodeOk(h1.message);
    const s1 = signerCommitStep(commitMsg, access);
    const openMsg = decodeOk(s1.message);
    const h2 = hostRevealStep(openMsg, h1.session);

    // Tampered signer: ignore rho, sign the PSBT normally (valid ECDSA).
    const cheat = bitcoin.Psbt.fromBase64(psbtBase64);
    cheat.signInput(0, ECPair.fromPrivateKey(Buffer.from(node.privateKey as Buffer)));
    const forgedSignMsg = {
      hop: 'sign' as const,
      sessionId: h2.session.id,
      inputs: h2.session.inputs,
      psbt: cheat.toBase64(),
      openings: s1.session.openingsHex,
    };

    const verdict = hostVerifyStep(forgedSignMsg, h2.session);
    assert.strictEqual(verdict.verdict, 'tamper');
    assert.strictEqual(verdict.signedPsbtBase64, undefined);
  });

  it('catches a signer that swaps its opening after learning rho (nonce grinding)', () => {
    const { psbtBase64, access, node } = makeWalletPsbt();
    const h1 = hostCommitStep(psbtBase64, randomness);
    const s1 = signerCommitStep(decodeOk(h1.message), access);
    const h2 = hostRevealStep(decodeOk(s1.message), h1.session);
    const rho = Uint8Array.from(Buffer.from(h2.session.perInput[0].rhoHex, 'hex'));

    // the input's sighash, as bitcoinjs computes it
    let z: Buffer | null = null;
    bitcoin.Psbt.fromBase64(psbtBase64).signInput(0, {
      publicKey: Buffer.from(node.publicKey),
      sign: (h: Buffer) => {
        z = h;
        return Buffer.alloc(64, 1);
      },
    } as any);

    // A tampered signer that knows rho picks a fresh k1 (it could keep picking until the final nonce leaks what it
    // wants), and derives an opening and a signature that are consistent with each other under rho.
    const N = necc.CURVE.n;
    const mod = (a: bigint) => necc.utils.mod(a, N);
    const toBig = (b: Uint8Array | Buffer) => BigInt('0x' + Buffer.from(b).toString('hex'));
    const to32 = (n: bigint) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
    const k1 = mod(toBig(crypto.randomBytes(32))) || 1n;
    const R1 = necc.Point.BASE.multiply(k1);
    const opening = R1.toRawBytes(true);
    const e = mod(toBig(taggedHash('s2c/ecdsa/point', opening, rho)));
    const k = mod(k1 + e);
    const r = mod(necc.Point.BASE.multiply(k).x);
    let sScalar = mod(necc.utils.invert(k, N) * mod(toBig(z!) + r * toBig(node.privateKey as Buffer)));
    if (sScalar > N >> 1n) sScalar = N - sScalar;
    const sig64 = Buffer.concat([to32(r), to32(sScalar)]);
    const cheat = bitcoin.Psbt.fromBase64(psbtBase64);
    cheat.data.inputs[0].partialSig = [
      { pubkey: Buffer.from(node.publicKey), signature: bitcoin.script.signature.encode(sig64, bitcoin.Transaction.SIGHASH_ALL) },
    ];

    // on its own the pair passes the opening check: that is exactly why the hop-2 record has to be the authority
    assert.ok(hostVerify({ z: Uint8Array.from(z!), pubkey: Uint8Array.from(node.publicKey), rho, opening, signature: Uint8Array.from(sig64) }));

    // with the swapped opening echoed in the sign message
    const swapped = { hop: 'sign' as const, sessionId: h2.session.id, inputs: h2.session.inputs, psbt: cheat.toBase64(), openings: [Buffer.from(opening).toString('hex')] };
    const loud = hostVerifyStep(swapped, h2.session);
    assert.strictEqual(loud.verdict, 'tamper');
    assert.strictEqual(loud.signedPsbtBase64, undefined);
    assert.ok(loud.perInput.some(p => p.reason === 'opening changed after commit'));
    // and with the committed opening echoed, but the signature made for the swapped one
    const quiet = { ...swapped, openings: s1.session.openingsHex };
    assert.strictEqual(hostVerifyStep(quiet, h2.session).verdict, 'tamper');
    // and with no echo at all
    assert.strictEqual(hostVerifyStep({ ...swapped, openings: undefined }, h2.session).verdict, 'tamper');
  });

  it('rejects a malformed opening before revealing rho', () => {
    const { psbtBase64 } = makeWalletPsbt();
    const h1 = hostCommitStep(psbtBase64, randomness);
    const malformed = { hop: 'open' as const, sessionId: h1.session.id, inputs: [0], openings: ['not a point'] };
    assert.throws(() => hostRevealStep(malformed, h1.session), /malformed opening/);
    const uncompressed = { ...malformed, openings: ['04' + '11'.repeat(64)] };
    assert.throws(() => hostRevealStep(uncompressed, h1.session), /malformed opening/);
  });

  it('rejects an open message from a different session', () => {
    const { psbtBase64 } = makeWalletPsbt();
    const h1 = hostCommitStep(psbtBase64, randomness);
    const foreignOpen = { hop: 'open' as const, sessionId: 'someone-else', inputs: [0], openings: ['02' + '00'.repeat(32)] };
    assert.throws(() => hostRevealStep(foreignOpen, h1.session), /different session/);
  });

  it('refuses to verify before rho is revealed', () => {
    const { psbtBase64, access } = makeWalletPsbt();
    const h1 = hostCommitStep(psbtBase64, randomness);
    const s1 = signerCommitStep(decodeOk(h1.message), access);
    // Jump straight to a (well-formed) sign without the reveal step.
    const bogusSign = { hop: 'sign' as const, sessionId: h1.session.id, inputs: h1.session.inputs, psbt: psbtBase64, openings: s1.session.openingsHex };
    assert.throws(() => hostVerifyStep(bogusSign, h1.session), /before revealing/);
  });
});

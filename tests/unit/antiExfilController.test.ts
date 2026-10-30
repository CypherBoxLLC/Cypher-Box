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

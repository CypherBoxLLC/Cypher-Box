import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import { BIP32Factory } from 'bip32';
import ecc from '../../blue_modules/noble_ecc';
import {
  enumerateInputs,
  signerBuildOpenings,
  signerSignPsbt,
  hostVerifyPsbt,
  DerivePrivateKey,
} from '../../src/helpers/antiExfilPsbt';
import { hostCommit } from '../../src/helpers/antiExfil';

const assert = require('assert');
const crypto = require('crypto');

const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

// Deterministic test seed (not real funds).
const SEED = Buffer.from('7e4b2f1a9c8d6e5f0a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778', 'hex');
const PATH = "m/84'/0'/0'/0/0";

function buildUnsignedPsbt() {
  const root = bip32.fromSeed(SEED);
  const node = root.derivePath(PATH);
  const pubkey = Buffer.from(node.publicKey);
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey });

  const psbt = new bitcoin.Psbt();
  psbt.addInput({
    hash: 'aa'.repeat(32),
    index: 0,
    witnessUtxo: { script: p2wpkh.output as Buffer, value: 100000 },
    bip32Derivation: [{ masterFingerprint: Buffer.from(root.fingerprint), path: PATH, pubkey }],
  });
  psbt.addOutput({ address: p2wpkh.address as string, value: 90000 });

  const derive: DerivePrivateKey = (path: string) => {
    const n = root.derivePath(path);
    return n.privateKey ? Uint8Array.from(n.privateKey) : null;
  };
  return { psbt, derive, node, pubkey };
}

describe('antiExfil PSBT driver', () => {
  it('enumerates the single-sig ECDSA input with its sighash', () => {
    const { psbt } = buildUnsignedPsbt();
    const { inputs, uncovered } = enumerateInputs(psbt);
    assert.strictEqual(inputs.length, 1);
    assert.strictEqual(uncovered.length, 0);
    assert.strictEqual(inputs[0].index, 0);
    assert.strictEqual(inputs[0].sighash.length, 32);
    assert.strictEqual(inputs[0].pubkey.length, 33);
  });

  it('honest end-to-end roundtrip verifies and finalizes', () => {
    const { psbt, derive } = buildUnsignedPsbt();
    const unsigned = psbt.clone();
    const { inputs, uncovered } = enumerateInputs(psbt);

    // Host hop 0: commit per input.
    const commits = inputs.map(() => hostCommit(Uint8Array.from(crypto.randomBytes(32))));
    const commitmentsHex = commits.map(c => Buffer.from(c.c).toString('hex'));

    // Signer hop 2: openings.
    const openings = signerBuildOpenings(inputs, commitmentsHex, derive);
    assert.strictEqual(openings.length, 1);

    // Host hop 3: reveal rho.
    const rhosHex = commits.map(c => Buffer.from(c.rho).toString('hex'));

    // Signer hop 4: sign in place with the committed nonce.
    const echoedOpenings = signerSignPsbt(psbt, inputs, rhosHex, derive);
    assert.deepStrictEqual(echoedOpenings, openings);

    // Host: verify input by input against its retained unsigned copy.
    const result = hostVerifyPsbt(unsigned, psbt, inputs, openings, rhosHex, uncovered);
    assert.strictEqual(result.ok, true);

    // And the verified PSBT finalizes to a real transaction.
    const tx = psbt.finalizeAllInputs().extractTransaction();
    assert.ok(tx.getId().length === 64);
  });

  it('rejects a signer that ignored anti-exfil and signed normally', () => {
    const { psbt, derive, node } = buildUnsignedPsbt();
    const unsigned = psbt.clone();
    const { inputs, uncovered } = enumerateInputs(psbt);

    const commits = inputs.map(() => hostCommit(Uint8Array.from(crypto.randomBytes(32))));
    const commitmentsHex = commits.map(c => Buffer.from(c.c).toString('hex'));
    const openings = signerBuildOpenings(inputs, commitmentsHex, derive);
    const rhosHex = commits.map(c => Buffer.from(c.rho).toString('hex'));

    // Tampered/old signer: produce a perfectly valid signature with the normal
    // RFC6979 nonce, ignoring rho entirely.
    const cheat = unsigned.clone();
    const keyPair = ECPair.fromPrivateKey(Buffer.from(node.privateKey as Buffer));
    cheat.signInput(0, keyPair);

    const result = hostVerifyPsbt(unsigned, cheat, inputs, openings, rhosHex, uncovered);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.perInput[0].ok, false);
  });

  it('fails closed when the signer returns no signature for the input', () => {
    const { psbt, derive } = buildUnsignedPsbt();
    const unsigned = psbt.clone();
    const { inputs, uncovered } = enumerateInputs(psbt);
    const commits = inputs.map(() => hostCommit(Uint8Array.from(crypto.randomBytes(32))));
    const openings = signerBuildOpenings(inputs, commits.map(c => Buffer.from(c.c).toString('hex')), derive);
    const rhosHex = commits.map(c => Buffer.from(c.rho).toString('hex'));
    // signedPsbt is just the unsigned one (no partialSig).
    const result = hostVerifyPsbt(unsigned, unsigned.clone(), inputs, openings, rhosHex, uncovered);
    assert.strictEqual(result.ok, false);
  });
});

import * as necc from '@noble/secp256k1';
import '../../blue_modules/noble_ecc';
import { hostCommit, signerCommit, signerSign, hostVerify, taggedHash } from '../../src/helpers/antiExfil';

const assert = require('assert');

const N = necc.CURVE.n;
const h = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'));

function bytesToNumberBE(bytes: Uint8Array): bigint {
  let r = 0n;
  for (let i = 0; i < bytes.length; i++) r = (r << 8n) | BigInt(bytes[i]);
  return r;
}
function numberTo32BE(num: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let n = num;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}
function modN(a: bigint): bigint {
  return necc.utils.mod(a, N);
}

// A standalone ECDSA signer with an explicit, caller-chosen nonce. Used to
// forge a VALID ECDSA signature that nevertheless uses the wrong nonce, i.e.
// a signature a tampered signer could produce to try to open a covert channel.
function ecdsaWithNonce(z: Uint8Array, d: Uint8Array, k: bigint): Uint8Array {
  const R = necc.Point.BASE.multiply(k);
  const r = modN(R.x);
  const dInt = bytesToNumberBE(d);
  const zInt = bytesToNumberBE(z);
  let s = modN(necc.utils.invert(k, N) * modN(zInt + r * dInt));
  if (s > N >> 1n) s = N - s;
  const sig = new Uint8Array(64);
  sig.set(numberTo32BE(r), 0);
  sig.set(numberTo32BE(s), 32);
  return sig;
}

// Deterministic, known-good test material (not real funds).
const PRIV = h('b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef');
const PUB = necc.getPublicKey(PRIV, true);
const Z = h('0101010101010101010101010101010101010101010101010101010101010101');
const RAND = h('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff000102030405060708090a0b0c0d0e0f');

describe('antiExfil sign-to-contract', () => {
  it('taggedHash follows SHA256(SHA256(tag)||SHA256(tag)||...x)', () => {
    const tag = 's2c/ecdsa/data';
    const tagHash = necc.utils.sha256Sync!(Uint8Array.from(Buffer.from(tag, 'utf8')));
    const expected = necc.utils.sha256Sync!(tagHash, tagHash, RAND);
    assert.strictEqual(Buffer.from(taggedHash(tag, RAND)).toString('hex'), Buffer.from(expected).toString('hex'));
  });

  it('honest roundtrip is accepted by host verify', () => {
    const { rho, c } = hostCommit(RAND);

    // hop 2: signer commits to R1 knowing only c.
    const { opening } = signerCommit(Z, PRIV, c);

    // hop 4: host reveals rho, signer signs with the committed nonce.
    const signed = signerSign(Z, PRIV, rho);

    // The opening the signer recomputes in hop 4 matches the hop-2 commitment.
    assert.strictEqual(Buffer.from(signed.opening).toString('hex'), Buffer.from(opening).toString('hex'));

    const ok = hostVerify({ z: Z, pubkey: PUB, rho, opening, signature: signed.signature });
    assert.strictEqual(ok, true);
  });

  it('the produced signature is a valid, low-S ECDSA signature', () => {
    const { rho } = hostCommit(RAND);
    const signed = signerSign(Z, PRIV, rho);
    const s = bytesToNumberBE(signed.signature.subarray(32, 64));
    assert.ok(s <= N >> 1n, 's must be low-S');
    assert.strictEqual(necc.verify(signed.signature, Z, PUB, { strict: true }), true);
  });

  it('rejects a cheating signer that signs with k != k1 + e (still valid ECDSA)', () => {
    const { rho, c } = hostCommit(RAND);
    const { opening } = signerCommit(Z, PRIV, c);

    // Forge a perfectly valid ECDSA signature under the same key and message,
    // but with an unrelated nonce. This is the covert-channel signature.
    const forgedNonce = modN(bytesToNumberBE(h('0f0e0d0c0b0a09080706050403020100fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0')));
    const forged = ecdsaWithNonce(Z, PRIV, forgedNonce);

    // Sanity: the forged signature really is valid ECDSA.
    assert.strictEqual(necc.verify(forged, Z, PUB, { strict: true }), true);

    // ...but it does not open to the committed R1, so host verify rejects it.
    const ok = hostVerify({ z: Z, pubkey: PUB, rho, opening, signature: forged });
    assert.strictEqual(ok, false);
  });

  it('rejects a signature whose r opens to R1 instead of R1 + e*G', () => {
    // The Dark-Skippy-relevant case: a signer commits honestly to R1 then
    // signs with k1, ignoring the host tweak e. Its r would be x(R1), not
    // x(R1 + e*G), so host verify must reject on the r-check.
    const { rho, c } = hostCommit(RAND);
    const { opening } = signerCommit(Z, PRIV, c);
    const R1 = necc.Point.fromHex(opening);
    const sig = new Uint8Array(64);
    sig.set(numberTo32BE(modN(R1.x)), 0); // r = x(R1)
    sig.set(numberTo32BE(1n), 32);
    const ok = hostVerify({ z: Z, pubkey: PUB, rho, opening, signature: sig });
    assert.strictEqual(ok, false);
  });

  it('fails closed on a missing opening', () => {
    const { rho } = hostCommit(RAND);
    const signed = signerSign(Z, PRIV, rho);
    // @ts-expect-error intentionally passing a missing opening
    const ok = hostVerify({ z: Z, pubkey: PUB, rho, opening: undefined, signature: signed.signature });
    assert.strictEqual(ok, false);
  });

  it('fails closed on a malformed opening (wrong length)', () => {
    const { rho } = hostCommit(RAND);
    const signed = signerSign(Z, PRIV, rho);
    const ok = hostVerify({ z: Z, pubkey: PUB, rho, opening: h('00'), signature: signed.signature });
    assert.strictEqual(ok, false);
  });

  it('fails closed on a malformed opening (33 bytes, off-curve)', () => {
    const { rho } = hostCommit(RAND);
    const signed = signerSign(Z, PRIV, rho);
    const garbage = new Uint8Array(33);
    garbage[0] = 0x02;
    garbage.fill(0xff, 1); // x far outside the field => not a point
    const ok = hostVerify({ z: Z, pubkey: PUB, rho, opening: garbage, signature: signed.signature });
    assert.strictEqual(ok, false);
  });

  it('rejects when the host reveals a different rho than was committed', () => {
    const { rho, c } = hostCommit(RAND);
    const { opening } = signerCommit(Z, PRIV, c);
    const signed = signerSign(Z, PRIV, rho);
    const otherRho = hostCommit(h('1112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f30')).rho;
    const ok = hostVerify({ z: Z, pubkey: PUB, rho: otherRho, opening, signature: signed.signature });
    assert.strictEqual(ok, false);
  });

  it('rejects a signature whose s has been mauled out of low-S range', () => {
    const { rho, opening } = (() => {
      const hc = hostCommit(RAND);
      const sc = signerCommit(Z, PRIV, hc.c);
      return { rho: hc.rho, opening: sc.opening };
    })();
    const signed = signerSign(Z, PRIV, rho);
    const high = new Uint8Array(signed.signature);
    const s = bytesToNumberBE(signed.signature.subarray(32, 64));
    high.set(numberTo32BE(N - s), 32); // flip to high-S: valid value, non-canonical
    const ok = hostVerify({ z: Z, pubkey: PUB, rho, opening, signature: high });
    assert.strictEqual(ok, false);
  });

  it('is deterministic: same inputs give the same opening and signature', () => {
    const a = hostCommit(RAND);
    const b = hostCommit(RAND);
    assert.strictEqual(Buffer.from(a.c).toString('hex'), Buffer.from(b.c).toString('hex'));
    const s1 = signerSign(Z, PRIV, a.rho);
    const s2 = signerSign(Z, PRIV, b.rho);
    assert.strictEqual(Buffer.from(s1.signature).toString('hex'), Buffer.from(s2.signature).toString('hex'));
    assert.strictEqual(Buffer.from(s1.opening).toString('hex'), Buffer.from(s2.opening).toString('hex'));
  });
});

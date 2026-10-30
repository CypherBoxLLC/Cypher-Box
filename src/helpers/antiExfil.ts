/**
 * Anti-exfil (ECDSA sign-to-contract) primitives.
 *
 * Countermeasure against the Dark Skippy class of attack: a tampered signing
 * build that leaks the seed through the nonces of otherwise-valid signatures.
 * Every integrity check the app has today passes such signatures, because they
 * ARE valid signatures. Anti-exfil closes this by having the verifier (the
 * online Cold Vault) contribute randomness `rho` to every signing nonce and
 * then prove, after the fact, that the signer used exactly the agreed nonce.
 * A tampered signer can no longer choose its nonce freely, so it has no covert
 * channel left to leak key material through.
 *
 * This file is pure (no React, no storage, no network) so it can be unit
 * tested in isolation and reused by both roles. It is built on the installed
 * `@noble/secp256k1` 1.6.3, which is the app's ECC backend. Importing
 * `noble_ecc` wires `necc.utils.sha256Sync` / `hmacSha256Sync`, which the
 * tagged hash and RFC6979 nonce below rely on.
 *
 * Construction (Blockstream / secp256k1-zkp anti-exfil, matching the tag
 * strings used by `secp256k1_anti_exfil_host_verify` so the C library can
 * serve as a test oracle):
 *
 *   T(tag, ...x)  = SHA256( SHA256(tag) || SHA256(tag) || ...x )
 *   host commit   : rho = 32 fresh random bytes reduced mod n (used once)
 *                   c   = T("s2c/ecdsa/data", rho32)
 *   signer nonce  : k1  = RFC6979(msg = sighash z, key = d, extraEntropy = c)
 *                   R1  = k1*G                          (the opening)
 *   tweak         : e   = T("s2c/ecdsa/point", compressed(R1), rho32) mod n
 *   final nonce   : k   = (k1 + e) mod n                (NO low-R grinding)
 *   host verify   : recompute e; require sig.r == x(R1 + e*G) mod n AND that
 *                   the ECDSA signature verifies under the input pubkey and
 *                   sighash, low-S.
 *
 * SECURITY NOTE: `rho` (host secret), `k1`, `k` and `d` are never logged here.
 * `rho` must be revealed to the signer ONLY after the signer has committed to
 * R1 (hop 3 of the protocol), otherwise the commitment is worthless.
 */
import * as necc from '@noble/secp256k1';
// Side-effect import: installs sha256Sync / hmacSha256Sync onto necc.utils.
import '../../blue_modules/noble_ecc';

const N = necc.CURVE.n;

// --- small byte / scalar helpers (noble 1.6.3 keeps these internal) ---------

function bytesToNumberBE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
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

function assertBytes(value: unknown, length: number, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new Error(`antiExfil: ${name} must be ${length} bytes`);
  }
  return value;
}

function sha256(...messages: Uint8Array[]): Uint8Array {
  // Set by noble_ecc; guard so a misconfigured import fails loudly instead of
  // silently producing a wrong (and insecure) hash.
  if (!necc.utils.sha256Sync) throw new Error('antiExfil: sha256Sync is not configured');
  return necc.utils.sha256Sync(...messages);
}

function hmac(key: Uint8Array, ...messages: Uint8Array[]): Uint8Array {
  if (!necc.utils.hmacSha256Sync) throw new Error('antiExfil: hmacSha256Sync is not configured');
  return necc.utils.hmacSha256Sync(key, ...messages);
}

const utf8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'utf8'));

/**
 * Tagged hash T(tag, ...x) = SHA256( SHA256(tag) || SHA256(tag) || ...x ).
 * Same scheme as BIP340 tagged hashes; tags are taken verbatim from the
 * secp256k1-zkp anti-exfil implementation.
 */
export function taggedHash(tag: string, ...data: Uint8Array[]): Uint8Array {
  const tagHash = sha256(utf8(tag));
  return sha256(tagHash, tagHash, ...data);
}

/**
 * RFC6979 deterministic nonce (HMAC-SHA256 drbg) with optional additional
 * data, used here to bind k1 to the host commitment `c`. Security does NOT
 * depend on the exact nonce function, only on the signer being committed to
 * R1 before it learns `rho`; RFC6979 is used for determinism and interop.
 */
function rfc6979Nonce(z32: Uint8Array, d32: Uint8Array, extra32: Uint8Array): bigint {
  // h1 = bits2octets(z): reduce the message hash mod n, serialise to 32 bytes.
  const h1 = numberTo32BE(modN(bytesToNumberBE(z32)));
  const x = d32;
  // Annotate as the generic Uint8Array so the HMAC results (which the type
  // system widens to Uint8Array<ArrayBufferLike>) assign back cleanly under
  // TypeScript 5.7's typed-array generics.
  let v: Uint8Array = new Uint8Array(32).fill(0x01);
  let k: Uint8Array = new Uint8Array(32).fill(0x00);
  const b0 = Uint8Array.of(0x00);
  const b1 = Uint8Array.of(0x01);

  k = hmac(k, v, b0, x, h1, extra32);
  v = hmac(k, v);
  k = hmac(k, v, b1, x, h1, extra32);
  v = hmac(k, v);

  // Bounded retry loop; RFC6979 practically never iterates for secp256k1.
  for (let i = 0; i < 1000; i++) {
    v = hmac(k, v);
    const candidate = bytesToNumberBE(v);
    if (candidate >= 1n && candidate < N) return candidate;
    k = hmac(k, v, b0);
    v = hmac(k, v);
  }
  throw new Error('antiExfil: RFC6979 failed to produce a valid nonce');
}

// --- protocol roles ---------------------------------------------------------

export interface HostCommitment {
  /** Host secret, revealed only in hop 3. 32-byte big-endian, reduced mod n. */
  rho: Uint8Array;
  /** Public commitment sent to the signer in hop 1. 32 bytes. */
  c: Uint8Array;
}

export interface SignerSignature {
  /** 64-byte compact (r || s), low-S. */
  signature: Uint8Array;
  /** 33-byte compressed opening R1 = k1*G. */
  opening: Uint8Array;
}

export interface HostVerifyInput {
  /** Input sighash z, 32 bytes. */
  z: Uint8Array;
  /** Signer's public key, 33-byte compressed (or 65-byte uncompressed). */
  pubkey: Uint8Array;
  /** Host secret revealed in hop 3, 32 bytes. */
  rho: Uint8Array;
  /** Signer's opening R1 from hop 2, 33-byte compressed. */
  opening: Uint8Array;
  /** Signer's signature from hop 4, 64-byte compact (r || s). */
  signature: Uint8Array;
}

/**
 * Host, hop 0: turn 32 fresh random bytes into {rho, c}. `rho` stays secret on
 * the host until hop 3; `c` is sent to the signer in hop 1.
 *
 * Randomness is injected rather than generated here so this module stays pure
 * and testable; callers pass secure randomness (class/rng `randomBytes(32)`).
 */
export function hostCommit(randomness: Uint8Array): HostCommitment {
  assertBytes(randomness, 32, 'randomness');
  const rho = numberTo32BE(modN(bytesToNumberBE(randomness)));
  const c = taggedHash('s2c/ecdsa/data', rho);
  return { rho, c };
}

/**
 * Signer, hop 2: commit to the opening R1 = k1*G without yet knowing `rho`.
 * Returns the 33-byte compressed R1. Deterministic in (z, d, c), so the signer
 * can be killed and recompute it; no signer-side state needs persisting.
 */
export function signerCommit(z: Uint8Array, d: Uint8Array, c: Uint8Array): { opening: Uint8Array } {
  assertBytes(z, 32, 'z');
  assertBytes(d, 32, 'd');
  assertBytes(c, 32, 'c');
  const k1 = rfc6979Nonce(z, d, c);
  const R1 = necc.Point.BASE.multiply(k1);
  return { opening: R1.toRawBytes(true) };
}

/**
 * Signer, hop 4: with `rho` now revealed, produce the final signature using
 * EXACTLY the committed-to nonce k = k1 + e. No low-R grinding (grinding would
 * change k and break the commitment). Low-S is enforced on the final s, which
 * does not affect r and so leaves the commitment intact.
 */
export function signerSign(z: Uint8Array, d: Uint8Array, rho: Uint8Array): SignerSignature {
  assertBytes(z, 32, 'z');
  assertBytes(d, 32, 'd');
  assertBytes(rho, 32, 'rho');

  // Recompute c from rho so hop-4 k1 matches the hop-2 commitment exactly.
  const c = taggedHash('s2c/ecdsa/data', rho);
  const k1 = rfc6979Nonce(z, d, c);
  const R1 = necc.Point.BASE.multiply(k1);

  const e = modN(bytesToNumberBE(taggedHash('s2c/ecdsa/point', R1.toRawBytes(true), rho)));
  const k = modN(k1 + e);
  if (k === 0n) throw new Error('antiExfil: degenerate nonce (k == 0)');

  const R = necc.Point.BASE.multiply(k);
  const r = modN(R.x);
  if (r === 0n) throw new Error('antiExfil: degenerate signature (r == 0)');

  const dInt = bytesToNumberBE(d);
  const zInt = bytesToNumberBE(z);
  let s = modN(necc.utils.invert(k, N) * modN(zInt + r * dInt));
  if (s === 0n) throw new Error('antiExfil: degenerate signature (s == 0)');
  // Enforce low-S (BIP62): flip to n - s when in the upper half.
  if (s > N >> 1n) s = N - s;

  const signature = new Uint8Array(64);
  signature.set(numberTo32BE(r), 0);
  signature.set(numberTo32BE(s), 32);
  return { signature, opening: R1.toRawBytes(true) };
}

/**
 * Host, final step: verify one input's signature against its opening and the
 * revealed `rho`. Returns true only when BOTH hold:
 *   1. sig.r == x(R1 + e*G) mod n  (the signer used the committed nonce), and
 *   2. the ECDSA signature verifies under the pubkey and sighash, low-S.
 * Fails closed: any malformed input or internal error returns false.
 */
export function hostVerify(input: HostVerifyInput): boolean {
  try {
    const { z, pubkey, rho, opening, signature } = input;
    assertBytes(z, 32, 'z');
    assertBytes(rho, 32, 'rho');
    assertBytes(opening, 33, 'opening');
    assertBytes(signature, 64, 'signature');
    if (!(pubkey instanceof Uint8Array) || (pubkey.length !== 33 && pubkey.length !== 65)) {
      return false;
    }

    // Throws on a malformed / off-curve opening -> caught below -> false.
    const R1 = necc.Point.fromHex(opening);
    const e = modN(bytesToNumberBE(taggedHash('s2c/ecdsa/point', opening, rho)));
    const expected = e === 0n ? R1 : R1.add(necc.Point.BASE.multiply(e));
    const expectedR = modN(expected.x);

    const r = bytesToNumberBE(signature.subarray(0, 32));
    if (r !== expectedR) return false;

    // Independent ECDSA check: the signature must be valid AND low-S (strict).
    return necc.verify(signature, z, pubkey, { strict: true });
  } catch (_e) {
    return false;
  }
}

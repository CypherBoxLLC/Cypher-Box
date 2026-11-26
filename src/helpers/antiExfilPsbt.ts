/**
 * PSBT driver for the anti-exfil protocol.
 *
 * Bridges the pure crypto in `antiExfil.ts` to bitcoinjs PSBTs: it extracts the
 * per-input ECDSA sighash `z`, drives the signer's two hops (commit openings,
 * then sign with the revealed `rho`), and verifies a returned signed PSBT input
 * by input, failing closed.
 *
 * Pure module: no React, no storage, no network. It relies only on bitcoinjs
 * and `antiExfil.ts`. Scope is single-sig ECDSA inputs (native/wrapped segwit
 * and legacy p2pkh), which is what the phone-to-phone cold-storage vault uses.
 * Taproot (schnorr) inputs are NOT anti-exfil-covered here and are reported as
 * `uncovered` so the host can refuse to broadcast rather than ship an
 * unverified signature.
 */
import * as bitcoin from 'bitcoinjs-lib';
import * as necc from '@noble/secp256k1';
import { hostVerify, signerCommit, signerSign } from './antiExfil';
import { auditSignatures } from '../../class/signatureAudit';

const { script: bscript, Transaction, Psbt } = bitcoin;

export interface AntiExfilInput {
  /** Global PSBT input index. */
  index: number;
  /** 33-byte compressed signing pubkey, taken from the input's bip32Derivation. */
  pubkey: Uint8Array;
  /** bip32 derivation path for this input. */
  path: string;
  /** ECDSA sighash z for this input, 32 bytes. */
  sighash: Uint8Array;
}

export interface EnumeratedInputs {
  /** Inputs we can anti-exfil-protect, in ascending index order. */
  inputs: AntiExfilInput[];
  /** Indices we cannot protect (taproot, or no usable ECDSA derivation). */
  uncovered: number[];
}

/** Supplies the 32-byte private key for a derivation path, or null if not ours. */
export type DerivePrivateKey = (path: string, pubkey: Uint8Array) => Uint8Array | null;

function toU8(b: Buffer | Uint8Array): Uint8Array {
  return b instanceof Uint8Array ? b : Uint8Array.from(b);
}

/**
 * Probe one input for its ECDSA sighash by running bitcoinjs's own signer path
 * on a throwaway clone of the PSBT. The probe returns a syntactically valid
 * (but meaningless) signature that is discarded with the clone; we only keep
 * the hash bitcoinjs asked us to sign. This reuses bitcoinjs's exact sighash
 * logic instead of re-deriving it, so `z` always matches a real sign.
 */
function extractSighash(psbt: bitcoin.Psbt, index: number, pubkey: Uint8Array): Uint8Array {
  const clone = psbt.clone();
  let captured: Uint8Array | null = null;
  const probe = {
    publicKey: Buffer.from(pubkey),
    sign: (hash: Buffer): Buffer => {
      captured = toU8(hash);
      return Buffer.alloc(64, 0x01); // discarded with the clone
    },
  };
  clone.signInput(index, probe as any);
  if (!captured) throw new Error('antiExfil: failed to extract input sighash');
  return captured;
}

function isTaprootInput(input: any): boolean {
  return !!(input.tapInternalKey || (input.tapBip32Derivation && input.tapBip32Derivation.length) || input.tapKeySig);
}

/**
 * Enumerate the inputs that can be anti-exfil-protected, with their sighash.
 * `fingerprint` (8 hex chars, upper or lower case) selects the matching
 * bip32Derivation when more than one is present; omit it for a single-sig
 * vault where host and signer share the one key.
 */
export function enumerateInputs(psbt: bitcoin.Psbt, fingerprint?: string): EnumeratedInputs {
  const inputs: AntiExfilInput[] = [];
  const uncovered: number[] = [];
  const fp = fingerprint ? fingerprint.toLowerCase() : undefined;

  for (let index = 0; index < psbt.inputCount; index++) {
    const input = psbt.data.inputs[index];
    if (isTaprootInput(input)) {
      uncovered.push(index);
      continue;
    }
    const derivations = input.bip32Derivation || [];
    if (derivations.length === 0) {
      uncovered.push(index);
      continue;
    }
    const chosen = fp
      ? derivations.find(d => Buffer.from(d.masterFingerprint).toString('hex').toLowerCase() === fp)
      : derivations[0];
    if (!chosen) {
      uncovered.push(index);
      continue;
    }
    const pubkey = toU8(chosen.pubkey);
    let sighash: Uint8Array;
    try {
      sighash = extractSighash(psbt, index, pubkey);
    } catch (_e) {
      uncovered.push(index);
      continue;
    }
    inputs.push({ index, pubkey, path: chosen.path, sighash });
  }

  return { inputs, uncovered };
}

/**
 * Signer, hop 2: given the host's commitments (one per enumerated input, in the
 * same order), produce the openings R1. Deterministic; no state is kept.
 * Returns openings as compressed-point hex, aligned to `inputs`.
 */
export function signerBuildOpenings(
  inputs: AntiExfilInput[],
  commitmentsHex: string[],
  derive: DerivePrivateKey,
): string[] {
  if (commitmentsHex.length !== inputs.length) {
    throw new Error('antiExfil: commitment count does not match signable inputs');
  }
  return inputs.map((inp, i) => {
    const d = derive(inp.path, inp.pubkey);
    if (!d) throw new Error(`antiExfil: no private key for input ${inp.index}`);
    const c = Uint8Array.from(Buffer.from(commitmentsHex[i], 'hex'));
    const { opening } = signerCommit(inp.sighash, d, c);
    return Buffer.from(opening).toString('hex');
  });
}

// bitcoinjs's shape for a signature check: strict (low-S) ECDSA under the input's key and sighash.
const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer): boolean =>
  necc.verify(toU8(signature), toU8(msghash), toU8(pubkey), { strict: true });

/**
 * Signer, hop 4: with the revealed `rho` per input, sign the PSBT in place
 * using exactly the committed nonce. Returns the openings again, echoed back to
 * the host for diagnostics only: the host verifies against the openings it
 * recorded in hop 2, never against this echo. The PSBT is signed via a custom
 * bitcoinjs signer so the sighash bitcoinjs computes is the one we sign, and
 * the partialSig is inserted and encoded the normal way.
 *
 * The same two checks the plain signing path runs afterwards (helpers/signOnce
 * signWithRoot) run here too: every signature just added verifies under its
 * key, and the nonce-reuse canary (class/signatureAudit) sees it. Both throw,
 * so a signature that fails them never reaches the host.
 */
export function signerSignPsbt(
  psbt: bitcoin.Psbt,
  inputs: AntiExfilInput[],
  rhosHex: string[],
  derive: DerivePrivateKey,
): string[] {
  if (rhosHex.length !== inputs.length) {
    throw new Error('antiExfil: rho count does not match signable inputs');
  }
  const openings: string[] = [];
  const added: { pubkey: Buffer; signature: Buffer }[] = [];
  inputs.forEach((inp, i) => {
    const d = derive(inp.path, inp.pubkey);
    if (!d) throw new Error(`antiExfil: no private key for input ${inp.index}`);
    const rho = Uint8Array.from(Buffer.from(rhosHex[i], 'hex'));
    let capturedOpening: Uint8Array | null = null;
    const customSigner = {
      publicKey: Buffer.from(inp.pubkey),
      sign: (hash: Buffer): Buffer => {
        const res = signerSign(toU8(hash), d, rho);
        capturedOpening = res.opening;
        return Buffer.from(res.signature);
      },
    };
    psbt.signInput(inp.index, customSigner as any);
    if (!capturedOpening) throw new Error(`antiExfil: signer produced no opening for input ${inp.index}`);
    const pubkey = Buffer.from(inp.pubkey);
    if (!psbt.validateSignaturesOfInput(inp.index, validator, pubkey)) {
      throw new Error(`antiExfil: signature for input ${inp.index} does not verify`);
    }
    const partial = (psbt.data.inputs[inp.index].partialSig || []).find(ps => Buffer.from(ps.pubkey).equals(pubkey));
    if (!partial) throw new Error(`antiExfil: signature for input ${inp.index} was not recorded`);
    added.push({ pubkey, signature: Buffer.from(partial.signature) });
    openings.push(Buffer.from(capturedOpening).toString('hex'));
  });
  // Nonce-reuse canary over the signatures this key just added, each verified above.
  auditSignatures(added);
  return openings;
}

export interface HostVerifyPsbtResult {
  /** True only when every enumerated input passed anti-exfil verification. */
  ok: boolean;
  /** Per-input verdicts, by global index, for diagnostics (no secrets). */
  perInput: { index: number; ok: boolean; reason?: string }[];
}

/**
 * Host, final step: verify a returned signed PSBT against the openings and
 * revealed `rho`, input by input. `unsignedPsbt` is the host's retained copy
 * used to recompute each sighash; `signedPsbt` is what the signer returned.
 *
 * Fails closed: ok is true ONLY if every enumerated input verifies AND there
 * are no uncovered inputs. The caller must refuse to broadcast unless ok.
 */
export function hostVerifyPsbt(
  unsignedPsbt: bitcoin.Psbt,
  signedPsbt: bitcoin.Psbt,
  inputs: AntiExfilInput[],
  openingsHex: string[],
  rhosHex: string[],
  uncovered: number[] = [],
): HostVerifyPsbtResult {
  const perInput: { index: number; ok: boolean; reason?: string }[] = [];

  for (const idx of uncovered) {
    perInput.push({ index: idx, ok: false, reason: 'input not anti-exfil-covered' });
  }
  if (openingsHex.length !== inputs.length || rhosHex.length !== inputs.length) {
    return {
      ok: false,
      perInput: [...perInput, { index: -1, ok: false, reason: 'opening/rho count mismatch' }],
    };
  }

  inputs.forEach((inp, i) => {
    try {
      const signedInput = signedPsbt.data.inputs[inp.index];
      const partial = (signedInput?.partialSig || []).find(ps => toU8(ps.pubkey).every((b, j) => b === inp.pubkey[j]));
      if (!partial) {
        perInput.push({ index: inp.index, ok: false, reason: 'no signature for expected pubkey' });
        return;
      }
      const decoded = bscript.signature.decode(partial.signature); // { signature: 64-byte, hashType }
      // Recompute z from the host's own unsigned copy; never trust the signer's.
      const z = extractSighash(unsignedPsbt, inp.index, inp.pubkey);
      const opening = Uint8Array.from(Buffer.from(openingsHex[i], 'hex'));
      const rho = Uint8Array.from(Buffer.from(rhosHex[i], 'hex'));
      const ok = hostVerify({ z, pubkey: inp.pubkey, rho, opening, signature: toU8(decoded.signature) });
      perInput.push({ index: inp.index, ok, reason: ok ? undefined : 'opening/signature mismatch' });
    } catch (e) {
      perInput.push({ index: inp.index, ok: false, reason: 'verification threw' });
    }
  });

  const ok = uncovered.length === 0 && inputs.length > 0 && perInput.every(p => p.ok);
  return { ok, perInput };
}

/** Re-export so callers can finalize without importing bitcoinjs directly. */
export { Transaction, Psbt };

/**
 * Anti-exfil protocol controllers: the 4-hop state machine for both roles.
 *
 * Pure orchestration (no React, no storage, no network): each step takes the
 * current session state plus one decoded transport message and returns the next
 * message to show and the new session state to persist. The screens are thin
 * I/O around these: they scan/show QR and read/write the persisted session.
 *
 * Hops:
 *   1. host  -> signer  commit  : unsigned PSBT + c[]
 *   2. signer -> host   open    : openings R1[]
 *   3. host  -> signer  reveal  : rho[]
 *   4. signer -> host   sign    : signed PSBT + R1[]
 *   then the host verifies, fails closed, and only broadcasts if every input
 *   passed.
 *
 * SECURITY: `rho` is the host secret. It lives in the host session (persisted
 * encrypted) and is revealed to the signer ONLY in hop 3, after the signer has
 * committed to R1 in hop 2. It is never logged.
 */
import * as bitcoin from 'bitcoinjs-lib';
import {
  AntiExfilMessage,
  encodeAntiExfilMessage,
  MAX_ANTI_EXFIL_INPUTS,
} from './antiExfilTransport';
import { hostCommit } from './antiExfil';
import {
  AntiExfilInput,
  DerivePrivateKey,
  enumerateInputs,
  hostVerifyPsbt,
  signerBuildOpenings,
  signerSignPsbt,
} from './antiExfilPsbt';

export interface HostPerInput {
  index: number;
  cHex: string;
  rhoHex: string;
  openingHex?: string;
}

export interface HostSession {
  id: string;
  createdAt: number;
  unsignedPsbtBase64: string;
  inputs: number[];
  perInput: HostPerInput[];
  stage: 'committed' | 'revealed';
}

export interface SignerSession {
  id: string;
  createdAt: number;
  unsignedPsbtBase64: string;
  inputs: number[];
  openingsHex: string[];
}

export interface SignerKeyAccess {
  /** 8-hex master fingerprint to pick the signer's derivation (optional for single-sig). */
  fingerprint?: string;
  derive: DerivePrivateKey;
}

export type HostVerifyVerdict = 'ok' | 'tamper';

function newSessionId(): string {
  // Not security-critical: just ties the four hops together. Avoids any crypto
  // dependency so this module stays pure.
  return `ae-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function orderInputsByMessage(enumerated: AntiExfilInput[], messageInputs: number[]): AntiExfilInput[] {
  // Map each message input index to the signer's enumerated input, preserving
  // the message order. Fails closed (throws) if the sets disagree, so a
  // host/signer input mismatch cannot silently sign the wrong subset.
  if (enumerated.length !== messageInputs.length) {
    throw new Error('antiExfil: signer input set does not match the host commit');
  }
  return messageInputs.map(idx => {
    const found = enumerated.find(e => e.index === idx);
    if (!found) throw new Error(`antiExfil: host referenced input ${idx} that the signer cannot sign`);
    return found;
  });
}

// --- Host role --------------------------------------------------------------

/**
 * Host hop 0 -> 1: build the commit message from an unsigned PSBT. `randomness`
 * returns 32 fresh secure bytes per call (class/rng on device). Returns the
 * message to show and the session to persist.
 */
export function hostCommitStep(
  unsignedPsbtBase64: string,
  randomness: () => Uint8Array,
  fingerprint?: string,
): { message: string; session: HostSession } {
  const psbt = bitcoin.Psbt.fromBase64(unsignedPsbtBase64);
  const { inputs, uncovered } = enumerateInputs(psbt, fingerprint);
  if (inputs.length === 0) throw new Error('antiExfil: no anti-exfil-coverable inputs');
  if (uncovered.length > 0) throw new Error('antiExfil: some inputs cannot be verified; refusing to start');
  if (inputs.length > MAX_ANTI_EXFIL_INPUTS) throw new Error('antiExfil: too many inputs for one session');

  const perInput: HostPerInput[] = inputs.map(inp => {
    const { rho, c } = hostCommit(randomness());
    return { index: inp.index, cHex: Buffer.from(c).toString('hex'), rhoHex: Buffer.from(rho).toString('hex') };
  });

  const session: HostSession = {
    id: newSessionId(),
    createdAt: Date.now(),
    unsignedPsbtBase64,
    inputs: inputs.map(i => i.index),
    perInput,
    stage: 'committed',
  };

  const message: AntiExfilMessage = {
    hop: 'commit',
    sessionId: session.id,
    inputs: session.inputs,
    psbt: unsignedPsbtBase64,
    commitments: perInput.map(p => p.cHex),
  };
  return { message: encodeAntiExfilMessage(message), session };
}

/**
 * Host hop 2 -> 3: record the signer's openings and produce the reveal message
 * carrying `rho`. Rejects an open message from a different session.
 */
export function hostRevealStep(open: AntiExfilMessage, session: HostSession): { message: string; session: HostSession } {
  if (open.hop !== 'open') throw new Error('antiExfil: expected an open message');
  if (open.sessionId !== session.id) throw new Error('antiExfil: open message is from a different session');
  const openings = open.openings || [];
  if (openings.length !== session.inputs.length) throw new Error('antiExfil: opening count mismatch');
  // each opening is a compressed point; anything else is refused here, before rho leaves the host
  if (!openings.every(o => /^0[23][0-9a-f]{64}$/i.test(o))) throw new Error('antiExfil: malformed opening');

  const perInput = session.perInput.map((p, i) => ({ ...p, openingHex: openings[i] }));
  const next: HostSession = { ...session, perInput, stage: 'revealed' };
  const message: AntiExfilMessage = {
    hop: 'reveal',
    sessionId: session.id,
    inputs: session.inputs,
    rhos: perInput.map(p => p.rhoHex),
  };
  return { message: encodeAntiExfilMessage(message), session: next };
}

/**
 * Host final: verify the returned signed PSBT against the committed openings
 * and revealed rho. Fails closed: `verdict` is 'ok' only when every input
 * verifies. Returns the signed PSBT base64 (for the existing combine/broadcast
 * path) and the per-input verdicts.
 *
 * The openings checked are the ones the signer committed to in hop 2, which
 * the host recorded before revealing rho. The sign message echoes openings
 * too, but they carry no weight: a signer that could substitute an opening
 * after learning rho could grind the final nonce and leak through it after
 * all. An echo that differs from the record is itself a tamper verdict.
 */
export function hostVerifyStep(
  sign: AntiExfilMessage,
  session: HostSession,
): { verdict: HostVerifyVerdict; perInput: { index: number; ok: boolean; reason?: string }[]; signedPsbtBase64?: string } {
  if (sign.hop !== 'sign') throw new Error('antiExfil: expected a sign message');
  if (sign.sessionId !== session.id) throw new Error('antiExfil: sign message is from a different session');
  if (!sign.psbt) throw new Error('antiExfil: sign message carried no signed PSBT');
  if (session.stage !== 'revealed') throw new Error('antiExfil: cannot verify before revealing rho');

  const unsigned = bitcoin.Psbt.fromBase64(session.unsignedPsbtBase64);
  const signed = bitcoin.Psbt.fromBase64(sign.psbt);

  const { inputs, uncovered } = enumerateInputs(unsigned);
  const ordered = session.inputs.map(idx => {
    const found = inputs.find(e => e.index === idx);
    if (!found) throw new Error(`antiExfil: session input ${idx} missing from retained PSBT`);
    return found;
  });
  // The hop-2 record is the authority; a missing record cannot verify anything.
  const openingsHex = session.perInput.map(p => p.openingHex || '');
  const rhosHex = session.perInput.map(p => p.rhoHex);
  const echoed = sign.openings || [];
  const echoChanged = session.perInput
    .map((p, i) => ({ index: p.index, changed: echoed[i] !== undefined && echoed[i].toLowerCase() !== (p.openingHex || '').toLowerCase() }))
    .filter(e => e.changed);

  const result = hostVerifyPsbt(unsigned, signed, ordered, openingsHex, rhosHex, uncovered);
  const perInput = result.perInput.map(p => {
    const changed = echoChanged.find(e => e.index === p.index);
    return changed ? { index: p.index, ok: false, reason: 'opening changed after commit' } : p;
  });
  const ok = result.ok && echoChanged.length === 0;
  return {
    verdict: ok ? 'ok' : 'tamper',
    perInput,
    signedPsbtBase64: ok ? sign.psbt : undefined,
  };
}

// --- Signer role ------------------------------------------------------------

/**
 * Signer hop 1 -> 2: from the host's commit, build the openings and a signer
 * session to persist (so hop 3 can sign the exact PSBT it committed to, even
 * after an app kill). Returns the open message and the session.
 */
export function signerCommitStep(
  commit: AntiExfilMessage,
  access: SignerKeyAccess,
): { message: string; session: SignerSession } {
  if (commit.hop !== 'commit') throw new Error('antiExfil: expected a commit message');
  if (!commit.psbt) throw new Error('antiExfil: commit carried no PSBT');
  const commitments = commit.commitments || [];
  if (commitments.length !== commit.inputs.length) throw new Error('antiExfil: commitment count mismatch');

  const psbt = bitcoin.Psbt.fromBase64(commit.psbt);
  const { inputs } = enumerateInputs(psbt, access.fingerprint);
  const ordered = orderInputsByMessage(inputs, commit.inputs);

  const openingsHex = signerBuildOpenings(ordered, commitments, access.derive);

  const session: SignerSession = {
    id: commit.sessionId,
    createdAt: Date.now(),
    unsignedPsbtBase64: commit.psbt,
    inputs: commit.inputs,
    openingsHex,
  };
  const message: AntiExfilMessage = {
    hop: 'open',
    sessionId: commit.sessionId,
    inputs: commit.inputs,
    openings: openingsHex,
  };
  return { message: encodeAntiExfilMessage(message), session };
}

/**
 * Signer hop 3 -> 4: with the revealed rho, sign the committed PSBT using
 * exactly the committed nonce and return the signed PSBT. Uses the signer's
 * STORED PSBT, never any PSBT in the reveal message, so a host that swaps the
 * PSBT between hops cannot get a signature over different data.
 */
export function signerSignStep(
  reveal: AntiExfilMessage,
  session: SignerSession,
  access: SignerKeyAccess,
): { message: string; signedPsbtBase64: string } {
  if (reveal.hop !== 'reveal') throw new Error('antiExfil: expected a reveal message');
  if (reveal.sessionId !== session.id) throw new Error('antiExfil: reveal message is from a different session');
  const rhos = reveal.rhos || [];
  if (rhos.length !== session.inputs.length) throw new Error('antiExfil: rho count mismatch');

  const psbt = bitcoin.Psbt.fromBase64(session.unsignedPsbtBase64);
  const { inputs } = enumerateInputs(psbt, access.fingerprint);
  const ordered = orderInputsByMessage(inputs, session.inputs);

  const openings = signerSignPsbt(psbt, ordered, rhos, access.derive);
  const signedPsbtBase64 = psbt.toBase64();
  const message: AntiExfilMessage = {
    hop: 'sign',
    sessionId: session.id,
    inputs: session.inputs,
    psbt: signedPsbtBase64,
    openings,
  };
  return { message: encodeAntiExfilMessage(message), signedPsbtBase64 };
}

/**
 * Versioned transport for the anti-exfil air-gap protocol.
 *
 * The signing protocol is interactive over 4 air-gap hops. Each hop carries a
 * batch of per-input data alongside (or instead of) the PSBT. To stop an old
 * or non-supporting signer from silently mis-parsing an anti-exfil payload as
 * a plain PSBT, every anti-exfil message is wrapped in a self-describing
 * container with a magic prefix and a schema version:
 *
 *   AEFX1:<base64(JSON)>
 *
 * A build that does not understand anti-exfil will try to read this as a PSBT
 * and fail, which is exactly what we want: the mismatch is DETECTED rather than
 * silently signed. The host turns that failure into the "unsupported signer"
 * message. A future, incompatible schema bumps the magic (AEFX2:...) so a
 * version skew is reported rather than mis-read.
 *
 * Pure module: no React, no storage, no crypto. The hex/base64 strings it
 * moves around are produced and consumed by antiExfil.ts and the PSBT driver.
 */

export const ANTI_EXFIL_VERSION = 1;
const MAGIC_PREFIX = `AEFX${ANTI_EXFIL_VERSION}:`;
// Any AEFXn: prefix, so we can tell "different anti-exfil version" apart from
// "not anti-exfil at all".
const ANY_MAGIC_RE = /^AEFX(\d+):/;

/**
 * Conservative cap on inputs per anti-exfil signing session. Each input adds a
 * 32-byte commitment, a 33-byte opening, a 32-byte rho and a signature to the
 * batched messages; the animated QR (DynamicQRCode) chunks the payload, but an
 * unbounded input count would make the hops impractical to scan. Beyond this
 * the flow fails closed with a clear message rather than producing a QR nobody
 * can scan. Revisit with measured multi-input QR capacity.
 */
export const MAX_ANTI_EXFIL_INPUTS = 20;

export type AntiExfilHop = 'commit' | 'open' | 'reveal' | 'sign';

export interface AntiExfilMessage {
  hop: AntiExfilHop;
  /** Session id tying the four hops together (host-generated). */
  sessionId: string;
  /** Global PSBT input indices the per-input arrays below correspond to. */
  inputs: number[];
  /** base64 PSBT: unsigned on `commit`, signed on `sign`. */
  psbt?: string;
  /** hop `commit`: per-input commitments c, hex. */
  commitments?: string[];
  /** hops `open` / `sign`: per-input openings R1, compressed hex. */
  openings?: string[];
  /** hop `reveal`: per-input host secrets rho, hex. */
  rhos?: string[];
}

export type DecodeResult =
  | { kind: 'ok'; message: AntiExfilMessage }
  | { kind: 'not-anti-exfil' }
  | { kind: 'unsupported-version'; version: number }
  | { kind: 'malformed'; reason: string };

function toBase64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function fromBase64(s: string): string {
  return Buffer.from(s, 'base64').toString('utf8');
}

/** True when `raw` looks like any anti-exfil container (any version). */
export function isAntiExfilContainer(raw: string): boolean {
  return typeof raw === 'string' && ANY_MAGIC_RE.test(raw.trim());
}

/** Serialise an anti-exfil message to its `AEFX1:<base64>` container string. */
export function encodeAntiExfilMessage(message: AntiExfilMessage): string {
  // Compact JSON keys to keep the QR payload small.
  const compact: Record<string, unknown> = {
    v: ANTI_EXFIL_VERSION,
    h: message.hop,
    s: message.sessionId,
    i: message.inputs,
  };
  if (message.psbt !== undefined) compact.p = message.psbt;
  if (message.commitments !== undefined) compact.c = message.commitments;
  if (message.openings !== undefined) compact.o = message.openings;
  if (message.rhos !== undefined) compact.r = message.rhos;
  return MAGIC_PREFIX + toBase64(JSON.stringify(compact));
}

const HOPS: readonly AntiExfilHop[] = ['commit', 'open', 'reveal', 'sign'];

/**
 * Parse a scanned/imported string. Never throws: callers get a discriminated
 * result so the "not anti-exfil", "wrong version" and "corrupt" cases can each
 * drive the right user-facing message (and fail closed).
 */
export function decodeAntiExfilMessage(raw: string): DecodeResult {
  if (typeof raw !== 'string') return { kind: 'not-anti-exfil' };
  const trimmed = raw.trim();
  const m = ANY_MAGIC_RE.exec(trimmed);
  if (!m) return { kind: 'not-anti-exfil' };

  const version = Number(m[1]);
  if (version !== ANTI_EXFIL_VERSION) return { kind: 'unsupported-version', version };

  const body = trimmed.slice(m[0].length);
  let parsed: any;
  try {
    parsed = JSON.parse(fromBase64(body));
  } catch (_e) {
    return { kind: 'malformed', reason: 'payload is not valid base64 JSON' };
  }
  if (!parsed || typeof parsed !== 'object') return { kind: 'malformed', reason: 'payload is not an object' };
  if (parsed.v !== ANTI_EXFIL_VERSION) return { kind: 'unsupported-version', version: Number(parsed.v) || 0 };
  if (!HOPS.includes(parsed.h)) return { kind: 'malformed', reason: 'unknown hop' };
  if (typeof parsed.s !== 'string' || parsed.s.length === 0) return { kind: 'malformed', reason: 'missing session id' };
  if (!Array.isArray(parsed.i) || !parsed.i.every((n: unknown) => Number.isInteger(n) && (n as number) >= 0)) {
    return { kind: 'malformed', reason: 'invalid input index list' };
  }
  if (parsed.i.length > MAX_ANTI_EXFIL_INPUTS) {
    return { kind: 'malformed', reason: 'too many inputs for one anti-exfil session' };
  }

  const isStrArrayOrAbsent = (x: unknown): boolean =>
    x === undefined || (Array.isArray(x) && x.every(e => typeof e === 'string'));
  if (!isStrArrayOrAbsent(parsed.c) || !isStrArrayOrAbsent(parsed.o) || !isStrArrayOrAbsent(parsed.r)) {
    return { kind: 'malformed', reason: 'per-input array is not an array of strings' };
  }

  const message: AntiExfilMessage = {
    hop: parsed.h,
    sessionId: parsed.s,
    inputs: parsed.i,
    psbt: typeof parsed.p === 'string' ? parsed.p : undefined,
    commitments: parsed.c as string[] | undefined,
    openings: parsed.o as string[] | undefined,
    rhos: parsed.r as string[] | undefined,
  };

  // Per-hop shape checks: every present per-input array must line up with the
  // input index list, so a truncated message fails closed instead of signing a
  // subset.
  const lenOk = (arr?: string[]) => arr === undefined || arr.length === message.inputs.length;
  switch (message.hop) {
    case 'commit':
      if (!message.psbt || !message.commitments || !lenOk(message.commitments)) {
        return { kind: 'malformed', reason: 'commit hop requires a psbt and one commitment per input' };
      }
      break;
    case 'open':
      if (!message.openings || !lenOk(message.openings)) {
        return { kind: 'malformed', reason: 'open hop requires one opening per input' };
      }
      break;
    case 'reveal':
      if (!message.rhos || !lenOk(message.rhos)) {
        return { kind: 'malformed', reason: 'reveal hop requires one rho per input' };
      }
      break;
    case 'sign':
      if (!message.psbt || !message.openings || !lenOk(message.openings)) {
        return { kind: 'malformed', reason: 'sign hop requires a signed psbt and one opening per input' };
      }
      break;
  }

  return { kind: 'ok', message };
}

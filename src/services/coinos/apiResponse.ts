/*
 * CoinOS reports a failed request as a non-2xx status (500 for most failures,
 * 401 for an expired session, 429 when rate limited) with a text/plain body
 * holding the reason, e.g. `user not provided`. It does not answer with JSON.
 *
 * Callers that did `return await response.json()` without reading the status
 * turned every such failure into a SyntaxError, which the screen then showed
 * as a generic "please try again" toast. The reason CoinOS gave was lost, and
 * for a session that had expired the advice to try again was wrong.
 *
 * These helpers read the status first and carry the reason to the screen.
 */
import loc from '../../../loc';

/** The subset of a fetch Response these helpers read; structural so tests can hand in a plain object. */
export type CoinosResponseLike = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<any>;
};

export class CoinosRequestError extends Error {
  readonly status: number;
  /** CoinOS's own reason, trimmed and bounded; '' when the body was empty or not readable text. */
  readonly serverMessage: string;

  constructor(status: number, serverMessage: string) {
    super(serverMessage ? `CoinOS ${status}: ${serverMessage}` : `CoinOS ${status}`);
    this.name = 'CoinosRequestError';
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

const MAX_SERVER_MESSAGE = 160;

/*
 * Characters that must never reach a toast: C0/C1 controls (NUL, escape
 * sequences, stray newlines) and the Unicode format characters that reorder
 * or hide text (zero-width, bidi embedding/override/isolate, byte order mark).
 * The reason is rendered as app copy, so it has to be plain printable text.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point: they are removed
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const TAGS = /<[^>]*>/g;

/**
 * Plain printable text only: tags and unprintable characters become spaces
 * (so a line break still separates words), whitespace collapses, length is bounded.
 */
function sanitize(text: string): string {
  return text.replace(TAGS, ' ').replace(UNPRINTABLE, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SERVER_MESSAGE);
}

/**
 * The human-readable reason in a CoinOS failure body, as plain printable
 * text. An HTML document (a Cloudflare error page) and an empty body give '';
 * a JSON body gives its message/error/reason string if it has one. Only the
 * body is read; nothing about the request is echoed.
 */
export function extractServerMessage(body: string | null | undefined): string {
  const text = (body ?? '').trim();
  if (!text || text.startsWith('<')) return '';
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const candidate = parsed?.message ?? parsed?.error ?? parsed?.reason;
      return typeof candidate === 'string' ? sanitize(candidate) : '';
    } catch {
      return '';
    }
  }
  return sanitize(text);
}

/**
 * Parse a CoinOS JSON response. A non-2xx status throws CoinosRequestError
 * with the server's reason attached instead of letting the body reach the
 * JSON parser. `onUnauthorized` runs for a 401 so the caller can expire the
 * session before the throw.
 */
export async function readCoinosJson(response: CoinosResponseLike, onUnauthorized?: () => void): Promise<any> {
  if (response.ok) return response.json();
  const body = await response.text().catch(() => '');
  if (response.status === 401) onUnauthorized?.();
  throw new CoinosRequestError(response.status, extractServerMessage(body));
}

/**
 * The toast for a failed CoinOS request. `fallback` is the screen's own
 * localized sentence. When CoinOS gave a reason it follows on a second line,
 * so the user sees why rather than a bare "try again". A gateway status (502,
 * 503, 504) means CoinOS itself is unreachable and uses the existing
 * temporarily-unavailable copy. A 401 returns null: the session expiry has
 * already told the user to log in again, and a second toast saying "try
 * again" would contradict it. Any other error keeps the fallback unchanged.
 */
export function describeCoinosFailure(err: unknown, fallback: string): string | null {
  if (err instanceof CoinosRequestError) {
    if (err.status === 401) return null;
    if (err.status === 502 || err.status === 503 || err.status === 504) {
      return loc.cypherbox.services.coinos_api.temporarily_unavailable;
    }
    if (err.serverMessage) return `${fallback}\n${err.serverMessage}`;
  }
  return fallback;
}

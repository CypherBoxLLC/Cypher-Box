/**
 * CoinOS on-chain withdrawal replies, read so the user learns why a send was
 * refused and what to do about it.
 *
 * `POST /bitcoin/send` answers a success with a JSON body ({ txid, ... }) and a
 * refusal with a non-2xx status and a plain-text reason. One such reason is a
 * hold on funds that arrived over Lightning, which CoinOS states as
 * "⚡867004 of your balance came from recent Lightning ...". The screen used to
 * show whatever text came back as a short toast, which cut the sentence off and
 * left the user with no amount they could withdraw and no idea whether waiting
 * would help. How long CoinOS holds such funds is not documented.
 *
 * Everything here is pure, so the screen's decisions can be tested without the
 * API layer or a device.
 */
import loc from '../../../loc';
import { CoinosRequestError, extractServerMessage, type CoinosResponseLike } from './apiResponse';

function isJsonObjectText(body: string): boolean {
  const text = body.trim();
  if (!text.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
}

/**
 * Read a CoinOS reply whose success body is JSON text. Returns the raw body on
 * a 2xx that holds a JSON object, so callers that parse the string keep
 * working. Anything else throws CoinosRequestError with the status and the
 * sanitized reason: a non-2xx status, or a 2xx whose body is not JSON.
 */
export async function readCoinosJsonText(response: CoinosResponseLike): Promise<string> {
  const body = await response.text().catch(() => '');
  if (response.ok && isJsonObjectText(body)) return body;
  throw new CoinosRequestError(response.status, extractServerMessage(body));
}

/**
 * Whether a CoinosRequestError from the send leaves the money's fate unknown.
 *
 * A refusal CoinOS wrote itself (a 4xx or 5xx with its own reason) is a clean
 * failure: the server answered and nothing left the account. Two shapes are
 * not that: a gateway status (502, 503, 504, or Cloudflare's 52x), where the
 * edge answered and the request may still have reached the origin, and a 2xx
 * whose body was not JSON, where the send most likely happened and only the
 * reply is unreadable. Both must be treated like a lost connection, never as
 * "failed, try again".
 */
export function refusalLeavesOutcomeUnknown(err: CoinosRequestError): boolean {
  const s = err.status;
  if (s >= 200 && s < 300) return true;
  return s === 502 || s === 503 || s === 504 || (s >= 520 && s <= 527);
}

/** CoinOS's hold on funds that arrived over Lightning, as its refusal states it. */
export type LightningHold = { heldSats: number };

/*
 * "⚡867004 of your balance came from recent Lightning ..." The bolt sits
 * directly on the number. The rest of the sentence has only been seen cut off
 * by a short toast, so match the stable head of it and nothing after.
 */
const LIGHTNING_HOLD = /(\d[\d,]*)\s*(?:sats?\s+)?of your balance came from recent lightning/i;

export function parseLightningHold(reason: string | null | undefined): LightningHold | null {
  if (!reason) return null;
  const match = LIGHTNING_HOLD.exec(reason);
  if (!match) return null;
  const heldSats = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(heldSats) && heldSats > 0 ? { heldSats } : null;
}

/**
 * The sats that can go on-chain while the hold stands: the balance minus the
 * held amount minus the fees quoted for this send. `null` when the balance is
 * not known on the screen, or when the result is not below the amount CoinOS
 * just refused (then these figures disagree with CoinOS and no amount is
 * offered). 0 when nothing is free.
 */
export function withdrawableDuringHold(args: {
  balanceSats: number | null | undefined;
  heldSats: number;
  feeSats?: number | null;
  requestedSats?: number | null;
}): number | null {
  const { balanceSats, heldSats, requestedSats } = args;
  if (balanceSats == null || !Number.isFinite(balanceSats) || balanceSats <= 0) return null;
  const fee = Math.max(0, Math.floor(args.feeSats ?? 0));
  const free = Math.max(0, Math.floor(balanceSats) - Math.ceil(heldSats) - fee);
  if (requestedSats != null && free >= requestedSats) return null;
  return free;
}

export type WithdrawRefusalAlert = {
  title: string;
  /** CoinOS's reason on its own line, then what to do. */
  message: string;
  /** Amount for the "withdraw instead" button; null when there is none to offer. */
  cappedSats: number | null;
};

function withReason(reason: string, action: string): string {
  return reason ? `${reason}\n\n${action}` : action;
}

function fill(template: string, values: Record<string, string>): string {
  return String(loc.formatString(template, values));
}

/**
 * The alert for a send CoinOS refused. The reason always comes first and in
 * full. For the Lightning hold the action names the held amount and, when the
 * screen knows the balance, the amount that can go right now; it always says
 * the rest can wait or go out over Lightning. Any other reason gets the plain
 * "nothing left your account" action, and a 401 says to log in again.
 */
export function describeWithdrawRefusal(
  err: CoinosRequestError,
  ctx: { balanceSats: number | null | undefined; feeSats?: number | null; requestedSats?: number | null },
): WithdrawRefusalAlert {
  // Full loc paths on purpose: the unused-string check matches them as text.
  const title = loc.cypherbox.payments.review_payment.coinos_refused_title;
  const reason = err.serverMessage;
  const hold = parseLightningHold(reason);

  if (!hold) {
    const action =
      err.status === 401
        ? loc.cypherbox.services.coinos_api.authorization_expired
        : loc.cypherbox.payments.review_payment.coinos_refused_action;
    return { title, message: withReason(reason, action), cappedSats: null };
  }

  const held = hold.heldSats.toLocaleString();
  const free = withdrawableDuringHold({ ...ctx, heldSats: hold.heldSats });
  if (free == null) {
    return {
      title,
      message: withReason(reason, fill(loc.cypherbox.payments.review_payment.coinos_hold_unknown_balance, { held })),
      cappedSats: null,
    };
  }
  if (free === 0) {
    return {
      title,
      message: withReason(reason, fill(loc.cypherbox.payments.review_payment.coinos_hold_nothing_free, { held })),
      cappedSats: null,
    };
  }
  return {
    title,
    message: withReason(reason, fill(loc.cypherbox.payments.review_payment.coinos_hold_partial, { held, free: free.toLocaleString() })),
    cappedSats: free,
  };
}

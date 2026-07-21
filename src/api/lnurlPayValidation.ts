/**
 * LNURL-pay response validation for custodial send paths.
 *
 * The CoinOS username-send flow previously paid whatever invoice the remote
 * service returned with no verification. These helpers enforce the same
 * checks the hardened class/lnurl.js path performs (callback scheme,
 * min/max sendable bounds, invoice amount, metadata description_hash), so a
 * malicious or compromised LNURL service cannot swap amounts, descriptions,
 * or downgrade to cleartext.
 */
import bolt11 from 'bolt11';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const createHash = require('create-hash');

/** LNURL-pay callbacks must be HTTPS (or HTTP only for .onion, per LUD-16). */
export function assertLnurlPayCallbackUrl(callback: unknown): asserts callback is string {
  if (typeof callback !== 'string' || callback.length === 0) {
    throw new Error('LNURL-pay response has no callback URL');
  }
  let parsed: URL;
  try {
    parsed = new URL(callback);
  } catch (_) {
    throw new Error('LNURL-pay callback is not a valid URL');
  }
  const isOnion = parsed.hostname.endsWith('.onion');
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && isOnion) return;
  throw new Error('LNURL-pay callback must be https (http only allowed for .onion)');
}

/** Enforce the service's declared min/max sendable bounds (msats). */
export function assertAmountWithinSendable(amountMsat: number, minSendable?: number, maxSendable?: number): void {
  if (typeof minSendable === 'number' && amountMsat < minSendable) {
    throw new Error(`Amount ${amountMsat} msat is below the service minimum of ${minSendable} msat`);
  }
  if (typeof maxSendable === 'number' && amountMsat > maxSendable) {
    throw new Error(`Amount ${amountMsat} msat is above the service maximum of ${maxSendable} msat`);
  }
}

/**
 * Verify the returned bolt11 invoice actually matches what the user asked
 * to pay: same amount, and (when the service supplied metadata) the
 * invoice's description_hash commits to that exact metadata.
 */
export function verifyLnurlPayInvoice(pr: string, expectedAmountSats: number, metadata?: string): void {
  const decoded = bolt11.decode(pr);
  const invoiceSats =
    typeof decoded.satoshis === 'number'
      ? decoded.satoshis
      : decoded.millisatoshis
        ? Math.round(Number(decoded.millisatoshis) / 1000)
        : 0;
  if (invoiceSats !== Math.round(expectedAmountSats)) {
    throw new Error(`Invoice doesn't match specified amount, got ${invoiceSats}, expected ${Math.round(expectedAmountSats)}`);
  }
  if (metadata) {
    const metadataHash = createHash('sha256').update(metadata).digest('hex');
    const invoiceHash = decoded.tagsObject.purpose_commit_hash;
    if (invoiceHash !== metadataHash) {
      throw new Error("Invoice description_hash doesn't match metadata.");
    }
  }
}

/** Correctly join the amount parameter onto a callback that may already have a query string. */
export function buildCallbackUrl(callback: string, amountMsat: number): string {
  const separator = callback.indexOf('?') === -1 ? '?' : '&';
  return `${callback}${separator}amount=${Math.floor(amountMsat)}`;
}

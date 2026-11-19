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

/** scheme://authority, where the authority runs to the first /, ? or #. */
const SCHEME_AND_AUTHORITY = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i;

/** host[:port], the host being dot-separated letters, digits and hyphens, or a bracketed IPv6 literal. */
const HOST_AND_PORT = /^(\[[0-9a-f]*:[0-9a-f:.]*\]|[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::([0-9]{1,5}))?$/i;

/**
 * Scheme and host of a callback URL, both lowercased, or null when it is not a
 * plain scheme://host[:port] URL, optionally followed by a path, query or fragment.
 *
 * Read by hand, not with the URL class. React Native ships its own URL, whose
 * hostname and protocol getters throw "not implemented". Jest runs on Node,
 * where URL is complete, so the tests passed while every callback check on the
 * phone threw.
 *
 * Stricter than a browser on purpose. This decides whether a request may go
 * out in cleartext, and URL parsers disagree at the edges (credentials,
 * backslashes, escaped hosts, stray whitespace), so the host read here could
 * differ from the one the request reaches. None of those are allowed.
 */
function readSchemeAndHost(callback: string): { scheme: string; host: string } | null {
  for (let i = 0; i < callback.length; i++) {
    const code = callback.charCodeAt(i);
    // Control characters, spaces and backslashes. A browser drops tabs,
    // newlines and surrounding spaces and reads a backslash as a slash, so
    // any of them could move the host it sees.
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return null;
  }
  const url = SCHEME_AND_AUTHORITY.exec(callback);
  if (!url) return null;
  const authority = HOST_AND_PORT.exec(url[2]);
  if (!authority) return null;
  const port = authority[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;
  return { scheme: url[1].toLowerCase(), host: authority[1].toLowerCase() };
}

/** LNURL-pay callbacks must be HTTPS (or HTTP only for .onion, per LUD-16). */
export function assertLnurlPayCallbackUrl(callback: unknown): asserts callback is string {
  if (typeof callback !== 'string' || callback.length === 0) {
    throw new Error('LNURL-pay response has no callback URL');
  }
  const target = readSchemeAndHost(callback);
  if (!target) {
    throw new Error('LNURL-pay callback is not a valid URL');
  }
  if (target.scheme === 'https') return;
  if (target.scheme === 'http' && target.host.endsWith('.onion')) return;
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
 * Verify the returned bolt11 invoice actually matches what the user asked to
 * pay: the same amount, and a mandatory description_hash committing to the
 * service metadata. Per LUD-06 the LNURL-pay response always carries metadata
 * and the invoice must commit to it, so a missing metadata or description_hash
 * is a hard failure. Skipping the check when metadata is absent would let a
 * malicious service omit it to bypass the recipient/description binding: the
 * amount alone does not bind the payee.
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
  // Mandatory: the amount alone does not bind the payee, so the invoice must
  // commit to the service metadata via a description_hash. A missing metadata
  // or description_hash is a hard failure, not a silent skip.
  if (!metadata) {
    throw new Error('LNURL-pay response has no metadata; refusing to pay an unverifiable invoice.');
  }
  const metadataHash = createHash('sha256').update(metadata).digest('hex');
  const invoiceHash = decoded.tagsObject.purpose_commit_hash;
  if (!invoiceHash) {
    throw new Error('Invoice has no description_hash to verify against the LNURL metadata.');
  }
  if (invoiceHash !== metadataHash) {
    throw new Error("Invoice description_hash doesn't match metadata.");
  }
}

/** Correctly join the amount parameter onto a callback that may already have a query string. */
export function buildCallbackUrl(callback: string, amountMsat: number): string {
  const separator = callback.indexOf('?') === -1 ? '?' : '&';
  return `${callback}${separator}amount=${Math.floor(amountMsat)}`;
}

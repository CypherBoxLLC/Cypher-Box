import assert from 'assert';
import {
  assertLnurlPayCallbackUrl,
  assertAmountWithinSendable,
  buildCallbackUrl,
  verifyLnurlPayInvoice,
} from '../../src/api/lnurlPayValidation';

// Real 10-sat invoice whose description_hash commits to the metadata below
// (same fixture as tests/unit/lnurl.test.js).
const VALID_PR =
  'lnbc100n1psj8g53pp50t7xmnvnzsm6y78kcvqqudlnnushc04sevtneessp463ndpf83qshp5nh0t5w4w5zh8jdnn5a03hk4pk279l3eex4nzazgkwmqpn7wga6hqcqzpgxqr23ssp5ddpxstde98ekccnvzms67h9uflxmpj939aj4rwc5xwru0x6nfkus9qyyssq55n5hn9gwmrzx2ekajlqshvu53u8h3p0npu7ng4d0lnttgueprzr4mtpwa83jrpz4skhdx3p0xnh9jc92ysnu8umuwa70hkxhp44svsq9u5uqr';
const VALID_METADATA = '[["text/plain","Comment on lnurl-pay chat 📝"]]';

describe('assertLnurlPayCallbackUrl', () => {
  it('accepts https callbacks', () => {
    assertLnurlPayCallbackUrl('https://lntxbot.bigsun.xyz/lnurl/pay/callback?userid=7116');
  });

  it('accepts http only for .onion', () => {
    assertLnurlPayCallbackUrl('http://hidden6j4bnxq.onion/lnurlp/callback');
  });

  it('rejects cleartext http callbacks', () => {
    assert.throws(() => assertLnurlPayCallbackUrl('http://example.com/callback'), /https/);
  });

  it('rejects non-http(s) schemes and garbage', () => {
    assert.throws(() => assertLnurlPayCallbackUrl('ftp://example.com/cb'));
    assert.throws(() => assertLnurlPayCallbackUrl('not a url'));
    assert.throws(() => assertLnurlPayCallbackUrl(''));
    assert.throws(() => assertLnurlPayCallbackUrl(undefined));
  });
});

/**
 * The same checks with React Native's URL in place.
 *
 * React Native ships its own URL, whose constructor accepts any string and
 * whose hostname, protocol and other getters throw "not implemented". Jest runs
 * on Node, where URL is complete, so the tests above passed while every
 * callback check on the phone threw. These run with the phone's version
 * installed.
 */
describe("assertLnurlPayCallbackUrl, with React Native's URL", () => {
  const runtime = globalThis as unknown as { URL: unknown };
  const NodeURL = runtime.URL;

  /** Like React Native's: the constructor takes any string, and every getter listed below throws. */
  class PhoneURL {}
  for (const name of ['hash', 'host', 'hostname', 'origin', 'password', 'pathname', 'port', 'protocol', 'search', 'username']) {
    Object.defineProperty(PhoneURL.prototype, name, {
      get() {
        throw new Error(`URL.${name} is not implemented`);
      },
    });
  }

  beforeAll(() => {
    runtime.URL = PhoneURL;
  });
  afterAll(() => {
    runtime.URL = NodeURL;
  });

  it.each([
    'https://lntxbot.bigsun.xyz/lnurl/pay/callback?userid=7116',
    'HTTPS://Pay.Example.COM/cb',
    'https://pay.example.com',
    'https://pay.example.com?userid=7116',
    'https://pay.example.com:8443/cb',
    'https://203.0.113.7/cb',
    'https://[2001:db8::1]:8443/cb',
  ])('accepts https: %j', url => {
    assertLnurlPayCallbackUrl(url);
  });

  it.each(['http://hidden6j4bnxq.onion/lnurlp/callback', 'HTTP://HIDDEN6J4BNXQ.ONION:8080/cb'])(
    'accepts http to an .onion host: %j',
    url => {
      assertLnurlPayCallbackUrl(url);
    },
  );

  it.each([
    'http://example.com/callback',
    'http://hidden6j4bnxq.onion.example.com/cb',
    'http://example.com/hidden6j4bnxq.onion',
    'http://example.com?host=hidden6j4bnxq.onion',
    'http://example.com#hidden6j4bnxq.onion',
    'http://[::1]/cb',
    'ftp://example.com/cb',
  ])('rejects anything but https, or http to an .onion host: %j', url => {
    assert.throws(() => assertLnurlPayCallbackUrl(url), /must be https/);
  });

  it.each([
    // Credentials: the host is what follows them, and not every parser agrees where they end.
    'http://hidden6j4bnxq.onion@example.com/cb',
    'http://example.com@hidden6j4bnxq.onion/cb',
    'https://user:pass@example.com/cb',
    // A browser reads a backslash as a slash, decodes an escaped host, drops tabs
    // and stray spaces, and repairs missing or extra slashes.
    'http://example.com\\@hidden6j4bnxq.onion/cb',
    'https:\\\\example.com/cb',
    'http://hidden6j4bnxq%2eonion/cb',
    ' https://example.com/cb',
    'https://exa\tmple.com/cb',
    'https:example.com/cb',
    'https:///example.com/cb',
    // Hosts and ports that are not plain.
    'http://hidden6j4bnxq.onion./cb',
    'http://.onion/cb',
    'https://bücher.example/cb',
    'https://example.com:/cb',
    'https://example.com:0/cb',
    'https://example.com:65536/cb',
    'https://[2001:db8::1/cb',
  ])('refuses what URL parsers read differently, rather than guess: %j', url => {
    assert.throws(() => assertLnurlPayCallbackUrl(url), /not a valid URL/);
  });

  it.each(['not a url', 'https://', 'mailto:pay@example.com'])('rejects junk: %j', junk => {
    assert.throws(() => assertLnurlPayCallbackUrl(junk), /not a valid URL/);
  });

  it.each(['', undefined, null, 42])('rejects a missing callback: %j', missing => {
    assert.throws(() => assertLnurlPayCallbackUrl(missing), /no callback URL/);
  });

  it('still joins the amount onto a callback', () => {
    assert.strictEqual(buildCallbackUrl('https://x.io/cb', 10000), 'https://x.io/cb?amount=10000');
    assert.strictEqual(buildCallbackUrl('https://x.io/cb?userid=7', 10000), 'https://x.io/cb?userid=7&amount=10000');
  });
});

describe('assertAmountWithinSendable', () => {
  it('enforces min and max when declared', () => {
    assertAmountWithinSendable(10000, 1000, 1000000000);
    assert.throws(() => assertAmountWithinSendable(999, 1000, undefined), /minimum/);
    assert.throws(() => assertAmountWithinSendable(1000000001, undefined, 1000000000), /maximum/);
  });

  it('passes when bounds are absent', () => {
    assertAmountWithinSendable(1);
  });
});

describe('buildCallbackUrl', () => {
  it('uses ? for a bare callback and & when a query already exists', () => {
    assert.strictEqual(buildCallbackUrl('https://x.io/cb', 10000), 'https://x.io/cb?amount=10000');
    assert.strictEqual(buildCallbackUrl('https://x.io/cb?userid=7', 10000), 'https://x.io/cb?userid=7&amount=10000');
  });
});

describe('verifyLnurlPayInvoice', () => {
  it('accepts an invoice matching amount and metadata', () => {
    verifyLnurlPayInvoice(VALID_PR, 10, VALID_METADATA);
  });

  it('rejects an amount mismatch', () => {
    assert.throws(() => verifyLnurlPayInvoice(VALID_PR, 11, VALID_METADATA), /doesn't match specified amount/);
  });

  it('rejects a metadata (description_hash) mismatch', () => {
    assert.throws(() => verifyLnurlPayInvoice(VALID_PR, 10, '[["text/plain","different"]]'), /description_hash/);
  });

  it('rejects a missing metadata (the description_hash binding is mandatory)', () => {
    assert.throws(() => verifyLnurlPayInvoice(VALID_PR, 10), /no metadata/);
  });
});

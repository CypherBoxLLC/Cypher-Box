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

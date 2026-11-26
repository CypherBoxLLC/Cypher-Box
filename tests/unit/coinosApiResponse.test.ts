/**
 * CoinOS reports a failed request as a non-2xx status with a plain-text reason
 * (`user not provided`, for one), never as JSON. Parsing that body as JSON
 * threw a SyntaxError, so the receive screens showed a generic "please try
 * again" and the reason was lost. A Liquid address that CoinOS's node cannot
 * serve is the case that surfaced it: the Bitcoin tab worked, the Liquid tab
 * only ever said try again.
 */

import loc from '../../loc';
import { CoinosRequestError, describeCoinosFailure, extractServerMessage, readCoinosJson } from '../../src/services/coinos/apiResponse';

const FALLBACK = 'Failed to generate liquid address. Please try again.';

const response = (over: Partial<{ ok: boolean; status: number; body: string; json: any }> = {}) => {
  const { ok = false, status = 500, body = 'user not provided', json = { hash: 'lq1abc' } } = over;
  return {
    ok,
    status,
    text: async () => body,
    json: async () => json,
  };
};

describe('reading a CoinOS response', () => {
  it('returns the parsed body on a 2xx', async () => {
    await expect(readCoinosJson(response({ ok: true, status: 200 }))).resolves.toEqual({ hash: 'lq1abc' });
  });

  it('turns a 500 with a plain-text reason into a CoinosRequestError that carries it', async () => {
    const err = await readCoinosJson(response()).catch(e => e);
    expect(err).toBeInstanceOf(CoinosRequestError);
    expect(err.status).toBe(500);
    expect(err.serverMessage).toBe('user not provided');
    expect(err.message).toBe('CoinOS 500: user not provided');
  });

  it('never hands a failure body to the JSON parser', async () => {
    const json = jest.fn();
    const res = { ...response(), json };
    await readCoinosJson(res).catch(() => undefined);
    expect(json).not.toHaveBeenCalled();
  });

  it('runs the unauthorized hook once for a 401 and still throws', async () => {
    const onUnauthorized = jest.fn();
    const err = await readCoinosJson(response({ status: 401, body: 'Unauthorized' }), onUnauthorized).catch(e => e);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(err.status).toBe(401);
  });

  it('leaves the unauthorized hook alone for other statuses', async () => {
    const onUnauthorized = jest.fn();
    await readCoinosJson(response(), onUnauthorized).catch(() => undefined);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('survives a body that cannot be read', async () => {
    const res = {
      ok: false,
      status: 500,
      text: async () => {
        throw new Error('stream closed');
      },
      json: async () => ({}),
    };
    const err = await readCoinosJson(res).catch(e => e);
    expect(err).toBeInstanceOf(CoinosRequestError);
    expect(err.serverMessage).toBe('');
    expect(err.message).toBe('CoinOS 500');
  });
});

describe('extracting the reason from a failure body', () => {
  it('keeps a plain-text reason', () => {
    expect(extractServerMessage('  user not provided\n')).toBe('user not provided');
  });

  it('drops an HTML error page', () => {
    expect(extractServerMessage('<!DOCTYPE html><html><body>502 Bad Gateway</body></html>')).toBe('');
  });

  it('drops an empty or missing body', () => {
    expect(extractServerMessage('')).toBe('');
    expect(extractServerMessage(undefined)).toBe('');
  });

  it('reads the message out of a JSON error body', () => {
    expect(extractServerMessage('{"message":"account not found"}')).toBe('account not found');
    expect(extractServerMessage('{"error":"invalid amount"}')).toBe('invalid amount');
  });

  it('gives nothing for JSON without a string reason', () => {
    expect(extractServerMessage('{"code":7}')).toBe('');
    expect(extractServerMessage('{not json')).toBe('');
  });

  it('bounds a very long reason', () => {
    expect(extractServerMessage('x'.repeat(1000)).length).toBe(160);
  });

  it('strips control characters and stray line breaks', () => {
    expect(extractServerMessage('user\u0000 not\u001b[31m provided\r\n\tnow')).toBe('user not [31m provided now');
  });

  it('removes bidi overrides and zero-width characters that could reorder or hide text', () => {
    expect(extractServerMessage('\u202eevil\u202c \u200bok\ufeff')).toBe('evil ok');
  });

  it('removes markup embedded in an otherwise plain reason', () => {
    expect(extractServerMessage('failed <b>loudly</b><br/> today')).toBe('failed loudly today');
  });

  it('collapses runs of whitespace to one space', () => {
    expect(extractServerMessage('too    many\n\n   spaces')).toBe('too many spaces');
  });

  it('sanitizes a JSON reason the same way', () => {
    expect(extractServerMessage('{"message":"bad\\u0007 <i>thing</i>"}')).toBe('bad thing');
  });
});

describe('describing a failure for the toast', () => {
  it('keeps the screen fallback alone for an error that is not from CoinOS', () => {
    expect(describeCoinosFailure(new TypeError('Network request failed'), FALLBACK)).toBe(FALLBACK);
    expect(describeCoinosFailure(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('puts the reason CoinOS gave under the fallback', () => {
    const err = new CoinosRequestError(500, 'user not provided');
    expect(describeCoinosFailure(err, FALLBACK)).toBe(`${FALLBACK}\nuser not provided`);
  });

  it('keeps the fallback alone when the body had no usable reason', () => {
    expect(describeCoinosFailure(new CoinosRequestError(500, ''), FALLBACK)).toBe(FALLBACK);
  });

  it('says nothing for a 401, since expiring the session already asked for a new login', () => {
    expect(describeCoinosFailure(new CoinosRequestError(401, 'Unauthorized'), FALLBACK)).toBeNull();
  });

  it('uses the temporarily-unavailable copy for a gateway status', () => {
    for (const status of [502, 503, 504]) {
      expect(describeCoinosFailure(new CoinosRequestError(status, ''), FALLBACK)).toBe(
        loc.cypherbox.services.coinos_api.temporarily_unavailable,
      );
    }
  });
});

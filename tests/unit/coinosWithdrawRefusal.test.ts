/**
 * A CoinOS on-chain withdrawal that CoinOS refuses must reach the user as the
 * full reason plus what to do, never as a truncated toast of raw server text.
 *
 * The case that surfaced it: a user withdrawing from a CoinOS account saw a
 * short toast "⚡867004 of your balance came from recent Lightning..." cut off,
 * with no amount they could withdraw and no idea whether to wait. CoinOS holds
 * funds received over Lightning before an on-chain withdrawal; the rule and its
 * duration are undocumented.
 */

import loc from '../../loc';
import { CoinosRequestError } from '../../src/services/coinos/apiResponse';
import {
  describeWithdrawRefusal,
  parseLightningHold,
  readCoinosJsonText,
  refusalLeavesOutcomeUnknown,
  withdrawableDuringHold,
} from '../../src/services/coinos/withdrawRefusal';

const HOLD_TEXT = '⚡867004 of your balance came from recent Lightning payments and cannot be withdrawn on-chain yet';

const response = (over: Partial<{ ok: boolean; status: number; body: string }> = {}) => {
  const { ok = false, status = 500, body = HOLD_TEXT } = over;
  return { ok, status, text: async () => body, json: async () => JSON.parse(body) };
};

describe('reading the reply to a CoinOS on-chain send', () => {
  it('returns the raw JSON text on a 2xx, so callers that parse the string keep working', async () => {
    const body = '{"txid":"abc123","amount":-1000000}';
    await expect(readCoinosJsonText(response({ ok: true, status: 200, body }))).resolves.toBe(body);
  });

  it('turns a non-OK plain-text refusal into a CoinosRequestError carrying the reason', async () => {
    const err = await readCoinosJsonText(response()).catch(e => e);
    expect(err).toBeInstanceOf(CoinosRequestError);
    expect(err.status).toBe(500);
    expect(err.serverMessage).toBe(HOLD_TEXT);
  });

  it('throws for an OK reply whose body is not JSON, with the status and the text', async () => {
    const err = await readCoinosJsonText(response({ ok: true, status: 200, body: 'ok' })).catch(e => e);
    expect(err).toBeInstanceOf(CoinosRequestError);
    expect(err.status).toBe(200);
    expect(err.serverMessage).toBe('ok');
  });

  it('throws for an OK reply with an empty or unreadable body', async () => {
    const empty = await readCoinosJsonText(response({ ok: true, status: 200, body: '' })).catch(e => e);
    expect(empty).toBeInstanceOf(CoinosRequestError);
    const broken = {
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('stream closed');
      },
      json: async () => ({}),
    };
    const err = await readCoinosJsonText(broken).catch(e => e);
    expect(err).toBeInstanceOf(CoinosRequestError);
    expect(err.serverMessage).toBe('');
  });

  it('does not accept a JSON array or scalar as a success body', async () => {
    const err = await readCoinosJsonText(response({ ok: true, status: 200, body: '[1,2]' })).catch(e => e);
    expect(err).toBeInstanceOf(CoinosRequestError);
  });
});

describe("whether a CoinOS reply leaves the money's fate unknown", () => {
  it("a refusal CoinOS wrote itself is a clean failure, even when its text says 'timeout'", () => {
    expect(refusalLeavesOutcomeUnknown(new CoinosRequestError(500, HOLD_TEXT))).toBe(false);
    expect(refusalLeavesOutcomeUnknown(new CoinosRequestError(500, 'payment timeout'))).toBe(false);
    expect(refusalLeavesOutcomeUnknown(new CoinosRequestError(400, 'invalid address'))).toBe(false);
    expect(refusalLeavesOutcomeUnknown(new CoinosRequestError(401, 'Unauthorized'))).toBe(false);
  });

  it('a gateway status means the request may have reached CoinOS', () => {
    for (const status of [502, 503, 504, 520, 522, 524]) {
      expect(refusalLeavesOutcomeUnknown(new CoinosRequestError(status, ''))).toBe(true);
    }
  });

  it('an OK status with an unreadable body means the send most likely happened', () => {
    expect(refusalLeavesOutcomeUnknown(new CoinosRequestError(200, 'ok'))).toBe(true);
  });
});

describe("parsing CoinOS's Lightning hold out of the reason", () => {
  it('reads the held amount off the bolt-prefixed number', () => {
    expect(parseLightningHold(HOLD_TEXT)).toEqual({ heldSats: 867004 });
  });

  it('accepts thousands separators, a sats unit and any casing', () => {
    expect(parseLightningHold('⚡867,004 sats of your balance came from recent lightning')).toEqual({ heldSats: 867004 });
    expect(parseLightningHold('12000 OF YOUR BALANCE CAME FROM RECENT LIGHTNING')).toEqual({ heldSats: 12000 });
  });

  it('falls through for any other reason', () => {
    expect(parseLightningHold('insufficient funds')).toBeNull();
    expect(parseLightningHold('Liquid deposits are temporarily disabled')).toBeNull();
    expect(parseLightningHold('')).toBeNull();
    expect(parseLightningHold(undefined)).toBeNull();
  });

  it('ignores a zero or unreadable amount', () => {
    expect(parseLightningHold('⚡0 of your balance came from recent Lightning')).toBeNull();
  });
});

describe('how much can go on-chain during the hold', () => {
  it('is the balance minus the held amount minus the quoted fees', () => {
    expect(withdrawableDuringHold({ balanceSats: 1_200_000, heldSats: 867_004, feeSats: 1_500, requestedSats: 1_000_000 })).toBe(331_496);
  });

  it('treats a missing fee as zero', () => {
    expect(withdrawableDuringHold({ balanceSats: 1_200_000, heldSats: 867_004, requestedSats: 1_000_000 })).toBe(332_996);
  });

  it('is unknown when the screen does not know the balance', () => {
    expect(withdrawableDuringHold({ balanceSats: null, heldSats: 867_004 })).toBeNull();
    expect(withdrawableDuringHold({ balanceSats: 0, heldSats: 867_004 })).toBeNull();
    expect(withdrawableDuringHold({ balanceSats: NaN, heldSats: 867_004 })).toBeNull();
  });

  it('is zero, not negative, when the hold covers the whole balance', () => {
    expect(withdrawableDuringHold({ balanceSats: 800_000, heldSats: 867_004, requestedSats: 500_000 })).toBe(0);
  });

  it('offers nothing when the result is not below what CoinOS just refused', () => {
    // Then the figures on the screen disagree with CoinOS; a confident number would mislead.
    expect(withdrawableDuringHold({ balanceSats: 2_000_000, heldSats: 867_004, requestedSats: 1_000_000 })).toBeNull();
  });
});

describe('the alert for a refused withdrawal', () => {
  const copy = loc.cypherbox.payments.review_payment;
  const hold = new CoinosRequestError(500, HOLD_TEXT);

  it('leads with the full reason on its own line, under the fixed title', () => {
    const spec = describeWithdrawRefusal(hold, { balanceSats: 1_200_000, feeSats: 1_500, requestedSats: 1_000_000 });
    expect(spec.title).toBe(copy.coinos_refused_title);
    expect(spec.message.startsWith(`${HOLD_TEXT}\n\n`)).toBe(true);
  });

  it('offers the capped amount when the balance is known, and says the rest can wait or go over Lightning', () => {
    const spec = describeWithdrawRefusal(hold, { balanceSats: 1_200_000, feeSats: 1_500, requestedSats: 1_000_000 });
    expect(spec.cappedSats).toBe(331_496);
    expect(spec.message).toContain((867_004).toLocaleString());
    expect(spec.message).toContain((331_496).toLocaleString());
    expect(spec.message).toMatch(/rest can wait/i);
    expect(spec.message).toMatch(/Lightning/);
  });

  it("says 'part of your balance' and offers no amount when the balance is unknown", () => {
    const spec = describeWithdrawRefusal(hold, { balanceSats: 0, requestedSats: 1_000_000 });
    expect(spec.cappedSats).toBeNull();
    expect(spec.message).toMatch(/part of your balance/i);
    expect(spec.message).toMatch(/Lightning/);
  });

  it('says nothing is free when the hold covers the whole balance', () => {
    const spec = describeWithdrawRefusal(hold, { balanceSats: 800_000, requestedSats: 500_000 });
    expect(spec.cappedSats).toBeNull();
    expect(spec.message).toMatch(/nothing can go on-chain/i);
    expect(spec.message).toMatch(/Lightning/);
  });

  it('shows any other reason with the plain action and no amount', () => {
    const spec = describeWithdrawRefusal(new CoinosRequestError(500, 'insufficient funds'), {
      balanceSats: 1_200_000,
      requestedSats: 1_000_000,
    });
    expect(spec.cappedSats).toBeNull();
    expect(spec.message).toBe(`insufficient funds\n\n${copy.coinos_refused_action}`);
  });

  it('tells an expired session to log in again', () => {
    const spec = describeWithdrawRefusal(new CoinosRequestError(401, 'Unauthorized'), { balanceSats: 1_200_000 });
    expect(spec.message).toBe(`Unauthorized\n\n${loc.cypherbox.services.coinos_api.authorization_expired}`);
  });

  it('shows the action alone when CoinOS gave no readable reason', () => {
    const spec = describeWithdrawRefusal(new CoinosRequestError(500, ''), { balanceSats: 1_200_000 });
    expect(spec.message).toBe(copy.coinos_refused_action);
  });

  it('uses no em dash in any of the new copy', () => {
    for (const key of [
      'coinos_refused_title',
      'coinos_refused_action',
      'coinos_hold_partial',
      'coinos_hold_nothing_free',
      'coinos_hold_unknown_balance',
      'coinos_withdraw_capped_button',
      'coinos_outcome_unknown_title',
    ]) {
      expect(typeof copy[key]).toBe('string');
      expect(copy[key]).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

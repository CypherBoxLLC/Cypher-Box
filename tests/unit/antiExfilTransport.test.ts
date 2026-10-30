import {
  encodeAntiExfilMessage,
  decodeAntiExfilMessage,
  isAntiExfilContainer,
  ANTI_EXFIL_VERSION,
  MAX_ANTI_EXFIL_INPUTS,
  AntiExfilMessage,
} from '../../src/helpers/antiExfilTransport';

const assert = require('assert');

describe('antiExfil transport', () => {
  const commit: AntiExfilMessage = {
    hop: 'commit',
    sessionId: 'sess-1',
    inputs: [0, 1],
    psbt: 'cHNidP8BAA==',
    commitments: ['aa'.repeat(32), 'bb'.repeat(32)],
  };

  it('round-trips a commit message', () => {
    const encoded = encodeAntiExfilMessage(commit);
    assert.ok(encoded.startsWith(`AEFX${ANTI_EXFIL_VERSION}:`));
    const result = decodeAntiExfilMessage(encoded);
    assert.strictEqual(result.kind, 'ok');
    if (result.kind === 'ok') {
      assert.deepStrictEqual(result.message.inputs, [0, 1]);
      assert.deepStrictEqual(result.message.commitments, commit.commitments);
      assert.strictEqual(result.message.psbt, commit.psbt);
      assert.strictEqual(result.message.hop, 'commit');
    }
  });

  it('round-trips open / reveal / sign hops', () => {
    const open: AntiExfilMessage = { hop: 'open', sessionId: 's', inputs: [0], openings: ['02' + 'cc'.repeat(32)] };
    const reveal: AntiExfilMessage = { hop: 'reveal', sessionId: 's', inputs: [0], rhos: ['dd'.repeat(32)] };
    const sign: AntiExfilMessage = { hop: 'sign', sessionId: 's', inputs: [0], psbt: 'cHNidP8BAA==', openings: ['02' + 'cc'.repeat(32)] };
    for (const msg of [open, reveal, sign]) {
      const r = decodeAntiExfilMessage(encodeAntiExfilMessage(msg));
      assert.strictEqual(r.kind, 'ok', `${msg.hop} should decode`);
    }
  });

  it('detects a plain PSBT as not anti-exfil (old signer path)', () => {
    assert.strictEqual(isAntiExfilContainer('cHNidP8BAHcCAAAAA'), false);
    assert.strictEqual(decodeAntiExfilMessage('cHNidP8BAHcCAAAAA').kind, 'not-anti-exfil');
  });

  it('reports a different anti-exfil version rather than mis-reading it', () => {
    const future = 'AEFX2:eyJ2IjoyfQ==';
    assert.strictEqual(isAntiExfilContainer(future), true);
    const r = decodeAntiExfilMessage(future);
    assert.strictEqual(r.kind, 'unsupported-version');
    if (r.kind === 'unsupported-version') assert.strictEqual(r.version, 2);
  });

  it('fails closed on a truncated per-input array', () => {
    // commit claims two inputs but carries one commitment.
    const bad: AntiExfilMessage = { hop: 'commit', sessionId: 's', inputs: [0, 1], psbt: 'x', commitments: ['aa'.repeat(32)] };
    const r = decodeAntiExfilMessage(encodeAntiExfilMessage(bad));
    assert.strictEqual(r.kind, 'malformed');
  });

  it('fails closed on corrupt base64 body', () => {
    const r = decodeAntiExfilMessage('AEFX1:@@@not-base64@@@');
    assert.strictEqual(r.kind, 'malformed');
  });

  it('rejects more inputs than the per-session cap', () => {
    const inputs = Array.from({ length: MAX_ANTI_EXFIL_INPUTS + 1 }, (_v, i) => i);
    const commitments = inputs.map(() => 'aa'.repeat(32));
    const bad: AntiExfilMessage = { hop: 'commit', sessionId: 's', inputs, psbt: 'x', commitments };
    const r = decodeAntiExfilMessage(encodeAntiExfilMessage(bad));
    assert.strictEqual(r.kind, 'malformed');
  });
});

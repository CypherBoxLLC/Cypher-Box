import assert from 'assert';
import { decrypt, encrypt, isLegacyEncryptedData } from '../../blue_modules/encryption';

const PLAINTEXT = 'wallet store payload: seeds, keys and other long secrets';

describe('encryption v2 (PBKDF2-SHA256 + AES-256-CBC + HMAC)', () => {
  it('round-trips', async () => {
    const blob = await encrypt(PLAINTEXT, 'correct horse battery staple');
    expect(isLegacyEncryptedData(blob)).toBe(false);
    expect(blob.startsWith('v2:')).toBe(true);
    expect(blob.split(':').length).toBe(5);
    expect(await decrypt(blob, 'correct horse battery staple')).toBe(PLAINTEXT);
  });

  it('rejects the wrong password deterministically (MAC, not length heuristic)', async () => {
    const blob = await encrypt(PLAINTEXT, 'right-password');
    expect(await decrypt(blob, 'wrong-password')).toBe(false);
  });

  it('rejects tampered ciphertext', async () => {
    const blob = await encrypt(PLAINTEXT, 'pw');
    const parts = blob.split(':');
    const ct = parts[3];
    // flip a character in the ciphertext body
    const flipped = (ct[5] === 'A' ? 'B' : 'A') + ct.slice(1, 0) + ct.slice(1);
    parts[3] = flipped.slice(0, ct.length) === ct ? ct.replace(/^../, 'XX') : flipped.slice(0, ct.length);
    expect(await decrypt(parts.join(':'), 'pw')).toBe(false);
  });

  it('rejects malformed v2 blobs', async () => {
    expect(await decrypt('v2:only:three', 'pw')).toBe(false);
    expect(await decrypt('v2::::', 'pw')).toBe(false);
  });

  it('still decrypts legacy OpenSSL/CryptoJS blobs (migration path)', async () => {
    // produced by CryptoJS.AES.encrypt(PLAINTEXT, 'password') with the old code
    const legacy = require('crypto-js').AES.encrypt(PLAINTEXT, 'password').toString();
    expect(isLegacyEncryptedData(legacy)).toBe(true);
    expect(await decrypt(legacy, 'password')).toBe(PLAINTEXT);
  });

  it('uses unique salt+iv per encryption (no ciphertext reuse)', async () => {
    const a = await encrypt(PLAINTEXT, 'pw');
    const b = await encrypt(PLAINTEXT, 'pw');
    expect(a).not.toBe(b);
    expect(await decrypt(a, 'pw')).toBe(PLAINTEXT);
    expect(await decrypt(b, 'pw')).toBe(PLAINTEXT);
  });
});

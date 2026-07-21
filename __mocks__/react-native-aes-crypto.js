// Node-backed react-native-aes-crypto mock for jest. Implements the same
// algorithms via the node crypto module so encryption.ts can be tested
// end-to-end: pbkdf2 (sha256), randomKey, AES-256-CBC encrypt/decrypt.
const crypto = require('crypto');

async function pbkdf2(password, salt, cost, length, algorithm) {
  // length is in BITS on the real module; hex output doubles the byte count
  return crypto.pbkdf2Sync(password, salt, cost, length / 8, algorithm || 'sha256').toString('hex');
}

async function randomKey(length) {
  return crypto.randomBytes(length).toString('hex');
}

async function encrypt(text, keyHex, ivHex) {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'));
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}

async function decrypt(ciphertextBase64, keyHex, ivHex) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextBase64, 'base64')), decipher.final()]).toString('utf8');
}

async function hmac256() {
  throw new Error('not implemented in mock');
}

async function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

module.exports = { pbkdf2, randomKey, encrypt, decrypt, hmac256, sha256 };

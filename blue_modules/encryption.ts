// @ts-ignore: Ignore import errors
import CryptoJS from 'crypto-js';
import Aes from 'react-native-aes-crypto';

/**
 * Wallet-store encryption.
 *
 * v2 format (current): PBKDF2-SHA256 (600,000 iterations, native
 * react-native-aes-crypto) -> AES-256-CBC -> HMAC-SHA256 over
 * salt|iv|ciphertext (encrypt-then-MAC). Wire format:
 *   v2:<saltHex>:<ivHex>:<ciphertextBase64>:<macHex>
 * Wrong passwords are detected deterministically via the MAC — the old
 * "decrypts to <10 chars" heuristic is gone on this path.
 *
 * Legacy format (decrypt-only, kept for migration): CryptoJS.AES.encrypt
 * OpenSSL-compatible output (EVP_BytesToKey, MD5, 1 iteration, no MAC).
 * BlueApp re-encrypts to v2 automatically on the first successful unlock
 * followed by a save (see loadFromDisk), so existing installs upgrade
 * without a password change.
 */

const V2_PREFIX = 'v2';
const PBKDF2_ITERATIONS = 600000;
const KEY_BITS = 256;

export function isLegacyEncryptedData(data: string): boolean {
  return !data.startsWith(V2_PREFIX + ':');
}

export async function encrypt(data: string, password: string): Promise<string> {
  if (data.length < 10) throw new Error('data length cant be < 10');
  const saltHex = await Aes.randomKey(16);
  const ivHex = await Aes.randomKey(16);
  const keyHex = await Aes.pbkdf2(password, saltHex, PBKDF2_ITERATIONS, KEY_BITS, 'sha256');
  const ciphertext = await Aes.encrypt(data, keyHex, ivHex, 'aes-256-cbc');
  const mac = CryptoJS.HmacSHA256(saltHex + ivHex + ciphertext, CryptoJS.enc.Hex.parse(keyHex)).toString(CryptoJS.enc.Hex);
  return [V2_PREFIX, saltHex, ivHex, ciphertext, mac].join(':');
}

export async function decrypt(data: string, password: string): Promise<string | false> {
  if (data.startsWith(V2_PREFIX + ':')) {
    const parts = data.split(':');
    if (parts.length !== 5) return false;
    const [, saltHex, ivHex, ciphertext, mac] = parts;
    const keyHex = await Aes.pbkdf2(password, saltHex, PBKDF2_ITERATIONS, KEY_BITS, 'sha256');
    const expectedMac = CryptoJS.HmacSHA256(saltHex + ivHex + ciphertext, CryptoJS.enc.Hex.parse(keyHex)).toString(
      CryptoJS.enc.Hex,
    );
    if (expectedMac !== mac) {
      // wrong password or tampered ciphertext
      return false;
    }
    try {
      const plain: string = await Aes.decrypt(ciphertext, keyHex, ivHex, 'aes-256-cbc');
      if (plain && plain.length < 10) return false;
      return plain || false;
    } catch (e) {
      return false;
    }
  }

  // legacy OpenSSL/CryptoJS format (decrypt-only; migrated to v2 on save)
  const bytes = CryptoJS.AES.decrypt(data, password);
  let str: string | false = false;
  try {
    str = bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {}

  // For some reason, sometimes decrypt would succeed with an incorrect password and return random characters.
  // In this TypeScript version, we are not allowing the encryption of data that is shorter than
  // 10 characters. If the decrypted data is less than 10 characters, we assume that the decrypt actually failed.
  if (str && str.length < 10) return false;

  return str;
}

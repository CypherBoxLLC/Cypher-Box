/**
 * Byte helpers that do not trust the Buffer on the other side of the bundle.
 *
 * React Native has no Buffer, so one is shimmed in (see shim.js), and which
 * implementation wins is decided by module resolution rather than by us. They
 * do not agree on one thing that matters here: `Buffer.prototype.subarray`.
 * Node and buffer@5+ return a Buffer; buffer@4, which is in this tree under
 * react-native-randombytes, returns a plain Uint8Array. All three are present.
 *
 * A Uint8Array is not a Buffer, and the difference is silent in the worst way:
 *
 *   - `.equals` does not exist, so a checksum check throws. That is what the
 *     card showed: "checksum(payload).equals is not a function".
 *   - `.toString('hex')` ignores the argument and gives "169,5,156,187"
 *     instead of "a9059cbb", so a hash or a method id becomes decimal text
 *     with commas and nothing throws at all.
 *
 * The second one derives addresses nobody can spend from and builds transfers
 * that call a method that does not exist. So the Tron code goes through these
 * three functions instead of Buffer's own, and none of them depends on what
 * subarray hands back. Under Node they do exactly what Buffer did, which is
 * why the tests did not catch this: they only ever ran against a real Buffer.
 */

/**
 * Hex for any byte array, written out a byte at a time.
 *
 * Never `bytes.toString('hex')`: that is correct only when `bytes` really is a
 * Buffer, and the failure when it is not is silent.
 */
import { Buffer } from 'buffer';

export function toHex(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
}

/**
 * A range of bytes, always as a real Buffer.
 *
 * Buffer.from copies the subarray's contents, so what comes back carries
 * Buffer's methods whatever subarray returned.
 */
export function sliceBytes(bytes: Uint8Array, start?: number, end?: number): Buffer {
    return Buffer.from(bytes.subarray(start, end));
}

/**
 * Whether two byte arrays are the same.
 *
 * Compares in constant time for a given length, since one caller is a checksum
 * check. Not a security boundary here, just no reason to leak the position.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a[i] ^ b[i];
    }
    return diff === 0;
}

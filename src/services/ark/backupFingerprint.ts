import Aes from 'react-native-aes-crypto';
import { Buffer } from 'buffer';
import BIP32Factory from 'bip32';

import ecc from '../../../blue_modules/noble_ecc';

/**
 * BIP32-master-fingerprint helper for multi-wallet Ark backups.
 *
 * WHY THIS EXISTS:
 * Every Ark wallet's backup file used to be named `ark-backup.cbark`. With one
 * wallet that's fine; with two it's a footgun — the second wallet's backup
 * silently overwrites the first's at every destination (local Documents,
 * Drive's appDataFolder, the user-chosen SAF folder, iCloud Drive). Confirmed
 * empirically 2026-05-10: create A → delete A → create B → recover A → fails
 * with "decryption failed; seed may not match this backup" because B's blob
 * sits at A's filename.
 *
 * The fix is to suffix backup filenames with a deterministic, seed-derived ID
 * so multiple wallets coexist at every destination. We use the standard
 * BIP32 master-key fingerprint:
 *
 *   1. mnemonic → seed (PBKDF2-SHA512 via BIP39)
 *   2. seed → bip32 root node (HMAC-SHA512 with "Bitcoin seed")
 *   3. fingerprint = HASH160(rootPubkey)[:4]   — 4 bytes / 8 hex chars
 *
 * That's the *standard* fingerprint every BIP32-aware tool computes the same
 * way, so the value is portable across wallets and tooling. ~1-in-4-billion
 * collision per pair of wallets, non-reversible to the seed.
 *
 * SECURITY POSTURE:
 * The fingerprint is a *lookup hint*, not a security primitive. The
 * cryptographic tie between seed and backup file is the encryption key
 * (PBKDF2 of the mnemonic — already in place in backup.ts). Putting the
 * fingerprint in the filename + the unencrypted envelope header makes the
 * recovery flow rename-tolerant: scan all `.cbark` files, read the header
 * to find the one matching the entered seed's fingerprint, decrypt that
 * one. Without the hint, the alternative would be try-decrypting every file
 * with the entered seed (slow, and produces "decryption failed" instead of
 * "no backup matches this seed" as the user-facing error).
 *
 * MNEMONIC NORMALIZATION:
 * Trim + lowercase before deriving anywhere. Mnemonics from `bip39.generate`
 * are already canonical, but on the recovery path we accept user-typed input
 * which may carry whitespace or accidental capitalization. Inconsistent
 * normalization between write-time and read-time would produce different
 * fingerprints and the lookup would miss its own file. Centralizing the
 * normalize step here is the only way to keep that invariant.
 */

const bip32 = BIP32Factory(ecc);

/**
 * Canonical form of a mnemonic string for hashing/deriving. Trim leading/
 * trailing whitespace, collapse to lowercase. Does NOT collapse internal
 * whitespace — bip39's seed derivation is whitespace-sensitive between
 * words by design (multiple spaces produce a different seed than single).
 * Use only for fingerprint + AES-key derivation, never for display.
 */
export function normalizeMnemonic(mnemonic: string): string {
    return mnemonic.trim().toLowerCase();
}

/**
 * Derive the 8-hex-char BIP32 master fingerprint from a mnemonic. Pure
 * function (no side effects).
 *
 * PERFORMANCE — why we don't use `bip39.mnemonicToSeed`:
 * Cypher Box runs `bip39` through rn-nodeify's pure-JS PBKDF2 polyfill
 * (the postinstall step that maps Node's `crypto` to a JS shim). The
 * BIP39 seed derivation is PBKDF2-SHA512 × 2048 iterations, which on a
 * mid-range phone (Galaxy A14 / Exynos 850) blocks the JS thread for
 * 5–15 seconds — the visible "freeze on wallet open / recover / create"
 * regression that prompted this fix.
 *
 * Instead we call `Aes.pbkdf2` from `react-native-aes-crypto`, which
 * runs natively (off the JS thread) and produces byte-identical output
 * for identical inputs (PBKDF2 is fully specified by RFC 2898). Same
 * spec, different implementation — about ~50 ms on the same device.
 *
 * BIP39 spec inputs:
 *   password = NFKD-normalized mnemonic
 *   salt     = "mnemonic" + optional passphrase, NFKD-normalized
 *   iter     = 2048
 *   length   = 64 bytes (512 bits)
 *   hash     = SHA-512
 * We have no passphrase, so the salt is just "mnemonic".
 *
 * Callers should still cache the result per-mnemonic on hot paths (the
 * 30s auto-backup tick) — `_keyCache` in backup.ts does this.
 */
export async function deriveBackupFingerprint(mnemonic: string): Promise<string> {
    const normalized = normalizeMnemonic(mnemonic);
    const seedHex = await Aes.pbkdf2(
        normalized.normalize('NFKD'),
        'mnemonic'.normalize('NFKD'),
        2048,
        512, // bits — Aes.pbkdf2 takes length in BITS; BIP39 wants 64 bytes
        'sha512',
    );
    const seed = Buffer.from(seedHex, 'hex');
    const root = bip32.fromSeed(seed);
    return root.fingerprint.toString('hex');
}

#!/usr/bin/env node
//
// _restore.cjs — internal helper for restore.sh. Decrypts a .cbark blob
// (AES-256-CBC + PBKDF2-SHA256, format defined by src/services/ark/backup.ts)
// and writes the contained manifest files into a target datadir.
//
// Mirrors the parameters in src/services/ark/backup.ts:
//   PBKDF2_SALT       = 'cypher-box-ark-datadir-v1'
//   PBKDF2_ITERATIONS = 100_000
//   AES_KEY_BITS      = 256
//
// Mnemonic normalization: trim + lowercase (matches normalizeMnemonic in
// src/services/ark/backupFingerprint.ts). The script reads the mnemonic
// from the env var named by --mnemonic-env so it never lands in argv or
// shell history.
//
// Usage (invoked by restore.sh — not meant to be called directly):
//   node _restore.cjs --cbark <path> --datadir <dir> --mnemonic-env <VAR>

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PBKDF2_SALT = 'cypher-box-ark-datadir-v1';
const PBKDF2_ITERATIONS = 100_000;
const AES_KEY_BYTES = 32; // AES-256
const SUPPORTED_VERSIONS = new Set([1, 2]);

function die(msg, code = 1) {
    process.stderr.write(`error: ${msg}\n`);
    process.exit(code);
}

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i += 2) {
        const k = argv[i];
        const v = argv[i + 1];
        if (k === '--cbark') out.cbark = v;
        else if (k === '--datadir') out.datadir = v;
        else if (k === '--mnemonic-env') out.mnemonicEnv = v;
        else die(`unknown arg: ${k}`, 64);
    }
    if (!out.cbark || !out.datadir || !out.mnemonicEnv) {
        die('missing required arg (--cbark, --datadir, --mnemonic-env)', 64);
    }
    return out;
}

const args = parseArgs(process.argv);

const mnemonic = process.env[args.mnemonicEnv];
if (!mnemonic) die(`env var ${args.mnemonicEnv} is empty or unset`, 64);
const normalized = mnemonic.trim().toLowerCase();

const blob = fs.readFileSync(args.cbark, 'utf8');
let envelope;
try {
    envelope = JSON.parse(blob);
} catch {
    die('cbark is not valid JSON');
}
if (!envelope || typeof envelope !== 'object') die('cbark envelope is malformed');
if (!SUPPORTED_VERSIONS.has(envelope.v)) {
    die(`unsupported envelope version ${envelope.v} (expected 1 or 2)`);
}
if (typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') {
    die('envelope missing iv/ct');
}

// PBKDF2 → 32-byte AES key. Note: this matches the React Native side's
// Aes.pbkdf2(...) call. PBKDF2 is fully spec'd, so different implementations
// produce byte-identical output for identical inputs.
const key = crypto.pbkdf2Sync(
    normalized,
    PBKDF2_SALT,
    PBKDF2_ITERATIONS,
    AES_KEY_BYTES,
    'sha256',
);

const iv = Buffer.from(envelope.iv, 'hex');
if (iv.length !== 16) die(`iv hex decodes to ${iv.length} bytes; expected 16`);

const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
let plaintext;
try {
    const part1 = decipher.update(envelope.ct, 'base64');
    const part2 = decipher.final();
    plaintext = Buffer.concat([part1, part2]).toString('utf8');
} catch (err) {
    die(`AES decrypt failed (wrong mnemonic for this backup?): ${err.message}`);
}

let manifest;
try {
    manifest = JSON.parse(plaintext);
} catch {
    die('decrypted manifest is not valid JSON — backup may be corrupted');
}
if (!manifest || !Array.isArray(manifest.files)) {
    die('decrypted manifest missing files array');
}

// Defense-in-depth: refuse paths that escape the datadir. Mirrors the same
// check in src/services/ark/backup.ts → restoreArkBackupBlob.
for (const f of manifest.files) {
    if (typeof f.path !== 'string' || typeof f.b64 !== 'string') {
        die('manifest entry has wrong shape');
    }
    if (f.path.includes('..') || f.path.startsWith('/')) {
        die(`manifest contains unsafe path: ${f.path}`);
    }
}

fs.mkdirSync(args.datadir, { recursive: true });

for (const f of manifest.files) {
    const full = path.join(args.datadir, f.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.from(f.b64, 'base64'));
}

const ts = manifest.createdAt
    ? new Date(manifest.createdAt).toISOString()
    : '(unknown timestamp)';
process.stdout.write(
    `restored ${manifest.files.length} file(s) from ${args.cbark}\n` +
        `  envelope.v=${envelope.v}` +
        (envelope.fingerprint ? `  fingerprint=${envelope.fingerprint}` : '') +
        `\n  manifest.createdAt=${ts}\n  → ${args.datadir}\n`,
);

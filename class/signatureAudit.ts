import * as bitcoin from 'bitcoinjs-lib';

/**
 * Raised when two signatures from the same key reuse an ECDSA nonce (same r,
 * different s), from which the private key is recoverable. Deterministic
 * nonces (RFC6979) make this impossible in correct signing, so it only ever
 * means a broken or tampered signing primitive. The caller must NOT broadcast.
 */
/** Both shown translated through src/helpers/safetyErrorText. */
export const NONCE_REUSE_MESSAGE =
    'A signing anomaly was detected and signing was stopped to protect your keys. Do not broadcast this transaction, and contact support.';
export const SIGNATURE_INVALID_MESSAGE =
    'Signature verification failed, so this transaction was not broadcast. Please try again, and if this keeps happening, contact support.';

export class NonceReuseError extends Error {
    readonly pubkey: string;
    constructor(pubkey: string) {
        super(NONCE_REUSE_MESSAGE);
        this.name = 'NonceReuseError';
        this.pubkey = pubkey;
    }
}

export class SignatureInvalidError extends Error {
    constructor(index: number) {
        super(SIGNATURE_INVALID_MESSAGE);
        this.name = 'SignatureInvalidError';
        void index;
    }
}

// Bounded, in-session map of `pubkey:r` -> `s`. A repeat of the same (pubkey, r)
// with a different s is the nonce-reuse signature pair. A repeat with the SAME
// (r, s) is an identical re-sign of the same message and is benign.
const seen = new Map<string, string>();
const MAX_ENTRIES = 20000;

/** Test-only reset of the canary's memory. */
export function __resetSignatureAuditForTest(): void {
    seen.clear();
}

function recordAndCheck(pubkeyHex: string, rHex: string, sHex: string): void {
    const key = `${pubkeyHex}:${rHex}`;
    const prev = seen.get(key);
    if (prev !== undefined) {
        if (prev !== sHex) throw new NonceReuseError(pubkeyHex);
        return; // identical re-sign, already recorded
    }
    if (seen.size >= MAX_ENTRIES) {
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
    }
    seen.set(key, sHex);
}

/**
 * Nonce-reuse canary: inspect every ECDSA partial signature in a signed (not
 * yet finalized) PSBT and throw {@link NonceReuseError} if any key reuses a
 * nonce. Non-ECDSA signatures (for example taproot/Schnorr) are skipped.
 *
 * Pass `inputIndexes` to inspect only those inputs. Only feed it signatures
 * that have been verified: an unverified one could be planted by whoever made
 * the PSBT (this key's public key with an r it saw earlier) to raise a false
 * alarm.
 */
export function auditPsbtSignatures(psbt: bitcoin.Psbt, inputIndexes?: readonly number[]): void {
    const inputs = inputIndexes ? inputIndexes.map(i => psbt.data.inputs[i]).filter(Boolean) : psbt.data.inputs;
    for (const input of inputs) {
        for (const ps of input.partialSig ?? []) {
            let decoded: { signature: Buffer; hashType: number };
            try {
                decoded = bitcoin.script.signature.decode(ps.signature); // DER -> { signature: r||s (64), hashType }
            } catch {
                continue; // not a DER ECDSA signature
            }
            const sig = decoded.signature;
            if (sig.length !== 64) continue;
            const r = sig.subarray(0, 32).toString('hex');
            const s = sig.subarray(32, 64).toString('hex');
            recordAndCheck(ps.pubkey.toString('hex'), r, s);
        }
    }
}

/**
 * Defense-in-depth gate to run on a signed PSBT right before finalizing and
 * broadcasting: verifies every partial signature against its key and message
 * ({@link SignatureInvalidError} on failure), then runs the nonce-reuse canary.
 * `ecc` is the curve backend (noble) already used for signing.
 */
export function assertSignedPsbtSafe(
    psbt: bitcoin.Psbt,
    ecc: { verify: (msghash: Buffer, pubkey: Buffer, signature: Buffer) => boolean },
): void {
    const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) => ecc.verify(msghash, pubkey, signature);
    psbt.data.inputs.forEach((input, i) => {
        if ((input.partialSig?.length ?? 0) > 0) {
            if (!psbt.validateSignaturesOfInput(i, validator)) {
                throw new SignatureInvalidError(i);
            }
        }
    });
    auditPsbtSignatures(psbt);
}

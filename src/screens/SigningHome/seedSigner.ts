import { dispatchNavigate } from "@Cypher/helpers";

/**
 * Offline Seed-Signer mode ("signingMode" in the store): an isolated phone that stays offline, used as a cold signing
 * device for a watch-only wallet. Its seed lives on SeedQR backups and is scanned in to sign, so it isn't a vault.
 *
 * Its names as English has them, for code that matches on the English, such as tests. Screens show
 * loc.cypherbox.seed_signer.title and loc.cypherbox.seed_signer.mode instead, read while they render, so they're in the
 * app's language.
 */
export const SEED_SIGNER = 'Offline Seed-Signer';
export const SEED_SIGNER_MODE = 'Offline Seed-Signer mode';

/** Wherever the mode is turned on from, it goes through the one-way gate (screens/SeedSignerGate). */
export function openSeedSignerGate() {
    dispatchNavigate('SeedSignerGate');
}

// The fingerprint of a seed just made and backed up, for one line on the signer's home when it's next shown. Only in
// memory: the home takes it once, and nothing about the seed is saved.
let backedUpFingerprint: string | null = null;

export function noteSeedBackedUp(fingerprint: string) {
    backedUpFingerprint = fingerprint;
}

export function takeSeedBackedUp(): string | null {
    const fingerprint = backedUpFingerprint;
    backedUpFingerprint = null;
    return fingerprint;
}

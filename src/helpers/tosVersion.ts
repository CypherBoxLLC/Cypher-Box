/**
 * The Terms of Service and Privacy Policy version a user has to accept.
 *
 * Bump it on every material change to either text, together with the "Last Updated" date. On the
 * next launch, a user whose stored `acceptedTosVersion` is different sees GetStartedScreen again
 * (returningUser: a Satoshi quote and "We've updated our Terms of Service & Privacy Policy") and
 * has to tick the box and press Start, which stores this value.
 *
 * 2026-11: Offline Seed-Signer and watch-only Cold Vault terms; no crash reporting; the Electrum
 * servers that see vault addresses; the Hot Vault Keychain/Keystore copy; data retention.
 */
export const CURRENT_TOS_VERSION = '2026-11';

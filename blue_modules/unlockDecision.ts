/**
 * Pure decision for which unlock path the app should take on the lock screen.
 *
 * Extracted from UnlockWith.js so the policy is unit-testable. The previous
 * implementation branched on React state (`biometricType`) that was still
 * `false` on the first render, which made the biometric branch unreachable
 * on cold start and silently self-unlocked the app with no authentication
 * for users who had biometrics enabled but storage encryption off.
 */
export type UnlockAction = 'key' | 'biometrics';

export function resolveUnlockAction(biometricType: boolean | string, storageIsEncrypted: boolean): UnlockAction {
  if (!biometricType || storageIsEncrypted) {
    return 'key';
  }
  return 'biometrics';
}

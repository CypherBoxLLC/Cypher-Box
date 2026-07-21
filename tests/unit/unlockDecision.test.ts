import { resolveUnlockAction } from '../../blue_modules/unlockDecision';

describe('resolveUnlockAction', () => {
  it('uses biometrics when biometrics are enabled and storage is not encrypted', () => {
    expect(resolveUnlockAction('Biometrics', false)).toBe('biometrics');
    expect(resolveUnlockAction('Face ID', false)).toBe('biometrics');
    expect(resolveUnlockAction('Touch ID', false)).toBe('biometrics');
  });

  it('falls back to the key (password) path when storage is encrypted', () => {
    expect(resolveUnlockAction('Biometrics', true)).toBe('key');
    expect(resolveUnlockAction('Face ID', true)).toBe('key');
  });

  it('falls back to the key path when biometrics are unavailable or disabled', () => {
    expect(resolveUnlockAction(false, false)).toBe('key');
    expect(resolveUnlockAction(false, true)).toBe('key');
  });

  it('never returns biometrics for a falsy biometric type (cold-start regression)', () => {
    // On cold start the freshly fetched capability value must drive the
    // decision; a stale falsy value must force the key path, never an
    // unauthenticated self-unlock.
    expect(resolveUnlockAction(false, false)).not.toBe('biometrics');
  });
});

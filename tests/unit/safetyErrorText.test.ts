/**
 * The wallet's safety checks throw in English; where they're shown, the app's language is used. A message the helper
 * doesn't know comes back unchanged, so wrapping an alert in it never hides another error.
 */

import loc from '../../loc';
import safetyErrorText, { safetyMessageText } from '../../src/helpers/safetyErrorText';
import { EntropyUnsafeError } from '../../class/rngHealth';
import { SeedUnsafeError } from '../../class/seedHealth';
import { NonceReuseError, SignatureInvalidError } from '../../class/signatureAudit';
import signErrorText from '../../src/screens/SignOnce/errorText';

const t = loc.cypherbox.safety_checks;

describe('safetyErrorText', () => {
    it('shows each safety check in the app\'s words', () => {
        expect(safetyErrorText(new EntropyUnsafeError('constant-output'))).toBe(t.rng_unavailable);
        expect(safetyErrorText(new SeedUnsafeError('constant-entropy'))).toBe(t.seed_unsafe);
        expect(safetyErrorText(new NonceReuseError('02ab'))).toBe(t.signing_stopped);
        expect(safetyErrorText(new SignatureInvalidError(0))).toBe(t.signature_invalid);
    });

    it('no longer tells anyone to reinstall, which on Android deletes Keystore-held seeds', () => {
        expect(new EntropyUnsafeError('x').message).not.toMatch(/reinstall/i);
        expect(t.rng_unavailable).not.toMatch(/reinstall/i);
    });

    it('passes any other message through, and uses the fallback only when there is none', () => {
        expect(safetyErrorText(new Error('Not enough balance'))).toBe('Not enough balance');
        expect(safetyErrorText(undefined, 'fallback')).toBe('fallback');
        expect(safetyErrorText({}, 'fallback')).toBe('fallback');
        expect(safetyMessageText('anything')).toBe('anything');
    });

    it('is what the signing screens fall back to', () => {
        expect(signErrorText(new NonceReuseError('02ab').message)).toBe(t.signing_stopped);
        expect(signErrorText('Some other problem')).toBe('Some other problem');
    });
});

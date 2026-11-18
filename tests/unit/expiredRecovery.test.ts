/**
 * Expired capsules: when one counts as expired, which ones get a recovery
 * action, and the single-flight latch that keeps one tap to one recovery.
 *
 * The latch is the guard for the 2026-09-20 incident, when one tap on an
 * expired capsule fired nine offboards. The screen itself pulls the native bark
 * binding and is not unit-testable here, so these pin the rules it relies on.
 */

import {
    beginExpiredRecovery,
    endExpiredRecovery,
    expiredCapsuleRecoverability,
    isExpiredRecoveryInFlight,
    isPastExpiryHeight,
} from '../../src/services/ark/expiredRecovery';

// Same values as ARK_REFRESH_MIN_SATS and ARK_VTXO_DUST_SATS in config.ts,
// which imports the SDK and so can't be loaded here.
const REFRESH_MIN_SATS = 500;
const DUST_SATS = 330;

describe('isPastExpiryHeight', () => {
    it('counts the expiry block itself as expired', () => {
        expect(isPastExpiryHeight(975_700, 975_700)).toBe(true);
        expect(isPastExpiryHeight(975_700, 975_701)).toBe(true);
    });

    it('is false while blocks remain', () => {
        expect(isPastExpiryHeight(975_700, 975_699)).toBe(false);
    });

    it('never reads a capsule with no expiry height as expired', () => {
        // Some arkoor capsules report 0. That is unknown, not expired.
        expect(isPastExpiryHeight(0, 975_700)).toBe(false);
    });

    it('never reads an unknown chain tip as expired', () => {
        expect(isPastExpiryHeight(975_700, null)).toBe(false);
        expect(isPastExpiryHeight(975_700, undefined)).toBe(false);
        expect(isPastExpiryHeight(975_700, 0)).toBe(false);
    });
});

describe('expiredCapsuleRecoverability', () => {
    it('offers recovery from the refresh floor up', () => {
        expect(expiredCapsuleRecoverability(REFRESH_MIN_SATS, REFRESH_MIN_SATS)).toBe('recoverable');
        expect(expiredCapsuleRecoverability(79_571, REFRESH_MIN_SATS)).toBe('recoverable');
    });

    it('offers nothing below the floor, dust or not', () => {
        // Between the two dust limits: the ASP would take it, but the
        // refreshed capsule would be dust again.
        expect(expiredCapsuleRecoverability(REFRESH_MIN_SATS - 1, REFRESH_MIN_SATS)).toBe('too-small');
        expect(expiredCapsuleRecoverability(DUST_SATS, REFRESH_MIN_SATS)).toBe('too-small');
        expect(expiredCapsuleRecoverability(1, REFRESH_MIN_SATS)).toBe('too-small');
    });
});

describe('the recovery latch', () => {
    afterEach(() => endExpiredRecovery());

    it('lets exactly one caller in until it is released', () => {
        expect(isExpiredRecoveryInFlight()).toBe(false);
        expect(beginExpiredRecovery()).toBe(true);
        expect(isExpiredRecoveryInFlight()).toBe(true);
        // A second tap, a re-render, or the same tap delivered twice.
        expect(beginExpiredRecovery()).toBe(false);
        expect(beginExpiredRecovery()).toBe(false);
        endExpiredRecovery();
        expect(isExpiredRecoveryInFlight()).toBe(false);
        expect(beginExpiredRecovery()).toBe(true);
    });

    it('turns nine rapid taps into one submission', async () => {
        let submissions = 0;
        let release: () => void = () => {};
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });

        // The screen's handler shape: take the latch synchronously, then await.
        const onTap = async () => {
            if (!beginExpiredRecovery()) return 'ignored';
            try {
                submissions += 1;
                await pending;
                return 'submitted';
            } finally {
                endExpiredRecovery();
            }
        };

        const taps = Array.from({ length: 9 }, () => onTap());
        release();
        const outcomes = await Promise.all(taps);

        expect(submissions).toBe(1);
        expect(outcomes.filter((o) => o === 'submitted')).toHaveLength(1);
        expect(outcomes.filter((o) => o === 'ignored')).toHaveLength(8);
        expect(isExpiredRecoveryInFlight()).toBe(false);
    });

    it('is released when the recovery throws', async () => {
        const failingTap = async () => {
            if (!beginExpiredRecovery()) return;
            try {
                throw new Error('server refused');
            } finally {
                endExpiredRecovery();
            }
        };
        await expect(failingTap()).rejects.toThrow('server refused');
        expect(isExpiredRecoveryInFlight()).toBe(false);
        expect(beginExpiredRecovery()).toBe(true);
    });
});

/**
 * The expiry-reminder schedule, and the rule that makes retiring one safe.
 *
 * Retiring a reminder is not just deleting its entry. The notification id is a
 * hash of the kind, so an alarm queued by an earlier build cannot be reached by
 * the current schedule's cancel loop, and if it fires its tap has to still be
 * recognised or the deep link is dropped. Both halves are easy to forget, and
 * the 4-day retirement is the second time this has come up (warn2h was first).
 */

jest.mock('react-native-push-notification', () => ({
    __esModule: true,
    default: {
        configure: jest.fn(),
        createChannel: jest.fn(),
        localNotificationSchedule: jest.fn(),
        cancelLocalNotification: jest.fn(),
        cancelAllLocalNotifications: jest.fn(),
    },
}));
jest.mock('@Cypher/stores/authStore', () => ({
    __esModule: true,
    default: { getState: () => ({ arkBgRefreshEnabled: true }) },
}));
jest.mock('@Cypher/stores/eventLogStore', () => ({ recordEvent: jest.fn() }));

import {
    ARK_EXPIRY_WARNING_SOURCES,
    RETIRED_WARN_KINDS,
    WARN_SCHEDULE,
    isArkExpiryWarningSource,
} from '../../src/services/ark/backgroundNotifications';

describe('expiry warning schedule', () => {
    it('sends four reminders, all within two days of expiry', () => {
        const hours = WARN_SCHEDULE.map((w) => w.offsetMs / 3_600_000);
        expect(hours).toEqual([48, 24, 12, 6]);
    });

    it('no longer schedules the 4-day reminder', () => {
        expect(WARN_SCHEDULE.map((w) => w.kind)).not.toContain('warn96h');
    });

    it('escalates: every offset is closer to expiry than the one before', () => {
        const offsets = WARN_SCHEDULE.map((w) => w.offsetMs);
        for (let i = 1; i < offsets.length; i++) {
            expect(offsets[i]).toBeLessThan(offsets[i - 1]);
        }
    });

    it('marks the reminders under a day as urgent and the 2-day one as not', () => {
        const byKind = Object.fromEntries(WARN_SCHEDULE.map((w) => [w.kind, w.urgent]));
        expect(byKind.warn48h).toBe(false);
        expect(byKind.warn24h).toBe(true);
        expect(byKind.warn12h).toBe(true);
        expect(byKind.warn6h).toBe(true);
    });
});

describe('retired reminder kinds', () => {
    it('records every kind that has ever been scheduled and is not now', () => {
        expect(RETIRED_WARN_KINDS).toContain('warn2h');
        expect(RETIRED_WARN_KINDS).toContain('warn96h');
    });

    it('never lists a kind as both scheduled and retired', () => {
        const scheduled = new Set<string>(WARN_SCHEDULE.map((w) => w.kind));
        for (const retired of RETIRED_WARN_KINDS) {
            expect(scheduled.has(retired)).toBe(false);
        }
    });

    it('still recognises a retired reminder tap, so a stale alarm deep-links', () => {
        // An OS alarm queued before the upgrade can outlive it. If its source
        // stops being recognised the tap is dropped and the user is left on
        // whatever screen they were on, told nothing.
        for (const retired of RETIRED_WARN_KINDS) {
            const source = `ark-vtxo-expiry-${retired}`;
            expect(isArkExpiryWarningSource(source)).toBe(true);
        }
    });

    it('recognises every currently scheduled source too', () => {
        for (const w of WARN_SCHEDULE) {
            expect(isArkExpiryWarningSource(w.source)).toBe(true);
            expect(ARK_EXPIRY_WARNING_SOURCES).toContain(w.source);
        }
    });

    it('rejects a source that is not one of ours', () => {
        expect(isArkExpiryWarningSource('ark-exit-ready')).toBe(false);
        expect(isArkExpiryWarningSource('something-else')).toBe(false);
        expect(isArkExpiryWarningSource(undefined)).toBe(false);
    });
});

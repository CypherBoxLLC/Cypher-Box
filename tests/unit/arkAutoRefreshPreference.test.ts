/**
 * The automatic-refresh preference.
 *
 * Two properties matter here and neither is obvious from the one-line gate in
 * foregroundSweep.ts.
 *
 * It must default ON. The flag is new, the store has no partialize so every
 * persisted state predates it, and zustand fills a missing key from the
 * initial state. A default of false would silently switch automatic refresh
 * off for every existing user on upgrade, which is the opposite of an opt-out.
 *
 * It must survive clearArkAuth. That is not only a logout: the boot path calls
 * it whenever a restore comes back `no-datadir`, so a transient read on a
 * device that does have a vault would otherwise reset a deliberate choice back
 * to on and start spending again. Same reasoning as arkArkoorPromptEnabled and
 * the kept thresholds, see arkExitSettingsSurvival.
 */

jest.mock('../../src/stores/index', () => ({
    __esModule: true,
    zustandStorage: {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
    },
}));

import useAuthStore from '../../src/stores/authStore';

describe('arkAutoRefreshEnabled', () => {
    it('defaults to on, so upgrading does not silently disable the sweep', () => {
        expect(useAuthStore.getState().arkAutoRefreshEnabled).toBe(true);
    });

    it('round-trips through its setter', () => {
        useAuthStore.getState().setArkAutoRefreshEnabled(false);
        expect(useAuthStore.getState().arkAutoRefreshEnabled).toBe(false);
        useAuthStore.getState().setArkAutoRefreshEnabled(true);
        expect(useAuthStore.getState().arkAutoRefreshEnabled).toBe(true);
    });

    it('survives clearArkAuth, which also runs on a transient no-datadir boot', () => {
        useAuthStore.getState().setArkAutoRefreshEnabled(false);
        useAuthStore.getState().clearArkAuth();
        expect(useAuthStore.getState().arkAutoRefreshEnabled).toBe(false);
    });

    it('is independent of the reminders flag', () => {
        // One spends money, the other does not. Coupling them would make
        // "stop spending" and "stop warning me" the same switch.
        useAuthStore.getState().setArkAutoRefreshEnabled(false);
        useAuthStore.getState().setArkBgRefreshEnabled(true);
        expect(useAuthStore.getState().arkAutoRefreshEnabled).toBe(false);
        expect(useAuthStore.getState().arkBgRefreshEnabled).toBe(true);

        useAuthStore.getState().setArkAutoRefreshEnabled(true);
        useAuthStore.getState().setArkBgRefreshEnabled(false);
        expect(useAuthStore.getState().arkAutoRefreshEnabled).toBe(true);
        expect(useAuthStore.getState().arkBgRefreshEnabled).toBe(false);
    });
});

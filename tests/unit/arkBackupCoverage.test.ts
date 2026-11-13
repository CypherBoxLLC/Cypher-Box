/**
 * "Backed up" on a Bark capsule has to mean a copy outside the app.
 *
 * Since a vault can be created with "Create without it", the auto-backup's
 * only destination can be the app's private folder, which goes with the app
 * or the phone. Every capsule still read "Backed up" there, because
 * `arkLastBackupAt` is stamped by any write. The copy that survives is now
 * tracked on its own (`arkLastOffDeviceBackupAt`), from what each write
 * actually reached, and it drives the capsule labels and the reminders.
 *
 * Pinned here: the pure rules, the store action every auto-backup caller goes
 * through, the reset, and the one-time carry-over for a store saved by 0.1.12,
 * which has no such field yet and must not make a vault whose iCloud or Drive
 * copy is fine read "On this phone only" until its first write.
 */

import {
    ARK_OFF_DEVICE_FAIL_LIMIT,
    arkBackupCoverage,
    legacyArkOffDeviceBackupAt,
    nextOffDeviceBackupState,
} from '../../src/services/ark/backupCoverage';
import useAuthStore from '../../src/stores/authStore';

// the store's persistence, so it hydrates to its defaults (jest hoists this above the imports)
jest.mock('../../src/stores/index', () => ({
    __esModule: true,
    zustandStorage: {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
    },
}));

const T0 = 1_760_000_000_000;

describe('arkBackupCoverage', () => {
    it('is none before anything was written', () => {
        expect(arkBackupCoverage(null, null)).toBe('none');
    });

    it('is this-phone when backups exist only inside the app', () => {
        expect(arkBackupCoverage(T0, null)).toBe('this-phone');
    });

    it('is off-device once a copy reached iCloud, Drive or the folder', () => {
        expect(arkBackupCoverage(T0, T0)).toBe('off-device');
    });
});

describe('nextOffDeviceBackupState', () => {
    it('stamps the write that reached a copy outside the app', () => {
        expect(nextOffDeviceBackupState({ at: null, failStreak: 2 }, 'written', T0)).toEqual({ at: T0, failStreak: 0 });
    });

    it('drops the copy at once when nothing outside the app is set up', () => {
        // iCloud Drive turned off, Drive disconnected: new capsules stop reaching it.
        expect(nextOffDeviceBackupState({ at: T0, failStreak: 0 }, 'none', T0 + 1)).toEqual({ at: null, failStreak: 0 });
    });

    it('keeps the copy through a failure or two, then drops it', () => {
        let state = { at: T0 as number | null, failStreak: 0 };
        for (let i = 1; i < ARK_OFF_DEVICE_FAIL_LIMIT; i++) {
            state = nextOffDeviceBackupState(state, 'failed', T0 + i);
            expect(state).toEqual({ at: T0, failStreak: i });
        }
        state = nextOffDeviceBackupState(state, 'failed', T0 + ARK_OFF_DEVICE_FAIL_LIMIT);
        expect(state.at).toBeNull();
        // and the next write that gets through counts again
        expect(nextOffDeviceBackupState(state, 'written', T0 + 99)).toEqual({ at: T0 + 99, failStreak: 0 });
    });

    it('never invents a copy from failed writes', () => {
        expect(nextOffDeviceBackupState({ at: null, failStreak: 0 }, 'failed', T0).at).toBeNull();
    });
});

describe('legacyArkOffDeviceBackupAt (stores saved by 0.1.12)', () => {
    const saved = (wallet: object | null, extra: object = {}) => ({ arkLastBackupAt: T0, arkWallet: wallet, ...extra });

    it.each([
        ['iCloud on at create (iOS)', { backupDestination: 'icloud' }],
        ['Google Drive verified (Android)', { backupDestination: 'auto+manual' }],
        ['the chosen folder (Android)', { backupDestination: 'manual' }],
        ['restored from Google Drive', { backupDestination: null, restoredFrom: 'google-drive' }],
    ])('carries over a copy for %s', (_label, wallet) => {
        expect(legacyArkOffDeviceBackupAt(saved(wallet))).toBe(T0);
    });

    it.each([
        ['created without a backup file', { backupDestination: null }],
        ['an older on-device-only wallet', { backupDestination: 'local' }],
        ['restored from a file or the iCloud folder', { backupDestination: null, restoredFrom: 'icloud-drive' }],
        ['opened from an existing datadir', { restored: true }],
    ])('carries nothing over when %s', (_label, wallet) => {
        expect(legacyArkOffDeviceBackupAt(saved(wallet))).toBeNull();
    });

    it('carries nothing over for an iOS share-sheet snapshot still waiting for iCloud Drive', () => {
        expect(
            legacyArkOffDeviceBackupAt(saved({ backupDestination: 'icloud' }, { arkIosBackupReminderActive: true })),
        ).toBeNull();
    });

    it('carries nothing over before the first backup', () => {
        expect(legacyArkOffDeviceBackupAt({ arkLastBackupAt: null, arkWallet: { backupDestination: 'icloud' } })).toBeNull();
        expect(legacyArkOffDeviceBackupAt(undefined)).toBeNull();
    });
});

describe('recordArkBackupWrite', () => {
    beforeEach(() => {
        useAuthStore.getState().clearArkAuth();
    });

    it('marks a vault created without a backup file as on this phone only', () => {
        useAuthStore.getState().recordArkBackupWrite(T0, 'none');
        const s = useAuthStore.getState();
        expect(s.arkLastBackupAt).toBe(T0);
        expect(s.arkLastOffDeviceBackupAt).toBeNull();
        expect(arkBackupCoverage(s.arkLastBackupAt, s.arkLastOffDeviceBackupAt)).toBe('this-phone');
    });

    it('clears it with the first write that reaches a copy outside the app', () => {
        const s0 = useAuthStore.getState();
        s0.setArkIosBackupReminderActive(true);
        s0.recordArkBackupWrite(T0, 'none');
        useAuthStore.getState().recordArkBackupWrite(T0 + 30_000, 'written');
        const s = useAuthStore.getState();
        expect(s.arkLastBackupAt).toBe(T0 + 30_000);
        expect(s.arkLastOffDeviceBackupAt).toBe(T0 + 30_000);
        // the iOS snapshot reminder was waiting for exactly this
        expect(s.arkIosBackupReminderActive).toBe(false);
    });

    it('leaves the iOS snapshot reminder alone when nothing reached iCloud Drive', () => {
        useAuthStore.getState().setArkIosBackupReminderActive(true);
        useAuthStore.getState().recordArkBackupWrite(T0, 'none');
        useAuthStore.getState().recordArkBackupWrite(T0 + 1, 'failed');
        expect(useAuthStore.getState().arkIosBackupReminderActive).toBe(true);
    });

    it('rides out a failed upload, and gives up after the limit', () => {
        useAuthStore.getState().recordArkBackupWrite(T0, 'written');
        useAuthStore.getState().recordArkBackupWrite(T0 + 1, 'failed');
        expect(useAuthStore.getState().arkLastOffDeviceBackupAt).toBe(T0);
        for (let i = 2; i <= ARK_OFF_DEVICE_FAIL_LIMIT; i++) {
            useAuthStore.getState().recordArkBackupWrite(T0 + i, 'failed');
        }
        expect(useAuthStore.getState().arkLastOffDeviceBackupAt).toBeNull();
        expect(useAuthStore.getState().arkLastBackupAt).toBe(T0 + ARK_OFF_DEVICE_FAIL_LIMIT);
    });

    it('is reset with the vault, so the next one starts from nothing', () => {
        useAuthStore.getState().recordArkBackupWrite(T0, 'written');
        useAuthStore.getState().recordArkBackupWrite(T0 + 1, 'failed');
        useAuthStore.getState().clearArkAuth();
        const s = useAuthStore.getState();
        expect(s.arkLastBackupAt).toBeNull();
        expect(s.arkLastOffDeviceBackupAt).toBeNull();
        expect(s.arkOffDeviceBackupFailStreak).toBe(0);
    });
});

describe('hydrating a store saved by 0.1.12', () => {
    const merge = (persisted: unknown) =>
        useAuthStore.persist.getOptions().merge!(persisted, useAuthStore.getState()) as ReturnType<typeof useAuthStore.getState>;

    it('keeps a Drive or iCloud vault backed up until its first write decides', () => {
        const next = merge({
            isArkAuth: true,
            arkLastBackupAt: T0,
            arkWallet: { id: 'ark-1', backupDestination: 'auto+manual' },
        });
        expect(next.arkLastOffDeviceBackupAt).toBe(T0);
        expect(arkBackupCoverage(next.arkLastBackupAt, next.arkLastOffDeviceBackupAt)).toBe('off-device');
    });

    it('shows a vault with no copy outside the app as on this phone only', () => {
        const next = merge({ isArkAuth: true, arkLastBackupAt: T0, arkWallet: { id: 'ark-1', backupDestination: null } });
        expect(arkBackupCoverage(next.arkLastBackupAt, next.arkLastOffDeviceBackupAt)).toBe('this-phone');
    });

    it('carries over only once: a saved value, null included, is kept as it is', () => {
        const next = merge({
            arkLastBackupAt: T0,
            arkLastOffDeviceBackupAt: null,
            arkWallet: { backupDestination: 'icloud' },
        });
        expect(next.arkLastOffDeviceBackupAt).toBeNull();
    });

    it('starts a fresh install with nothing', () => {
        expect(merge(undefined).arkLastOffDeviceBackupAt).toBeNull();
    });
});

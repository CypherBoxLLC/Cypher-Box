/**
 * The two exit-funding settings must survive clearArkAuth().
 *
 * clearArkAuth is not only a logout. The boot path calls it whenever a restore
 * comes back `no-datadir` (useArkRestoreOnBoot), so a transient read on a device
 * that DOES have a vault used to discard both of these silently.
 *
 * Observed on device 2026-08-16, and both consequences are real money:
 *
 *   - arkExitFeeReserveSats going to 0 flips sync.ts out of its
 *     "hold funds on-chain" branch and into boardAll(), i.e. boarding away the
 *     exact sats the user set aside to pay for a unilateral exit.
 *   - arkExitDestinationAddress going null lets useArkExitDestinationBackfill
 *     (which only fills when unset) substitute a fresh Hot Vault address. A
 *     live exit was seen being redirected away from the address the user chose.
 *
 * Same reasoning as arkArkoorPromptEnabled and the kept thresholds.
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

const RESERVE = 14504;
const DESTINATION = 'bc1qvr33z4mcexampledestinationchosenbytheuser';

/** Put the store in the state of a user who has armed exit funding. */
function armExitFunding() {
    const s = useAuthStore.getState();
    s.setArkExitFeeReserveSats(RESERVE);
    s.setArkExitDestinationAddress(DESTINATION);
    s.setArkAuth(true);
}

beforeEach(() => {
    armExitFunding();
});

describe('clearArkAuth preserves exit-funding settings', () => {
    it('keeps the armed exit fee reserve', () => {
        expect(useAuthStore.getState().arkExitFeeReserveSats).toBe(RESERVE);
        useAuthStore.getState().clearArkAuth();
        expect(useAuthStore.getState().arkExitFeeReserveSats).toBe(RESERVE);
    });

    it('keeps the chosen exit destination address', () => {
        expect(useAuthStore.getState().arkExitDestinationAddress).toBe(DESTINATION);
        useAuthStore.getState().clearArkAuth();
        expect(useAuthStore.getState().arkExitDestinationAddress).toBe(DESTINATION);
    });

    it('survives repeated clears, since the boot path can fire it every launch', () => {
        for (let i = 0; i < 5; i++) useAuthStore.getState().clearArkAuth();
        expect(useAuthStore.getState().arkExitFeeReserveSats).toBe(RESERVE);
        expect(useAuthStore.getState().arkExitDestinationAddress).toBe(DESTINATION);
    });

    it('still clears the wallet-scoped state it is responsible for', () => {
        // Guard against "fix" by deleting the reset entirely: clearArkAuth must
        // keep doing its actual job.
        const s = useAuthStore.getState();
        s.setArkExitInProgress(true);
        expect(useAuthStore.getState().isArkAuth).toBe(true); // precondition, not a trivial pass
        useAuthStore.getState().clearArkAuth();
        const after = useAuthStore.getState();
        expect(after.isArkAuth).toBe(false);
        expect(after.arkVtxos).toEqual([]);
        expect(after.arkExitInProgress).toBe(false);
        expect(after.allBTCWallets).not.toContain('ARK');
    });
});

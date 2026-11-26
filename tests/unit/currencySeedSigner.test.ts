/**
 * An Offline Seed-Signer makes no request of its own. BlueApp.js asks for a fiat rate as it loads, and every screen
 * that formats fiat asks again; with the signer lock on, none of that reaches a rate API (it did, at every launch).
 */

// The module under test is imported after the mocks below.
/* eslint-disable import/first */

const mockIsLocked = jest.fn();
const mockGetFiatRate = jest.fn();

jest.mock('../../src/services/seedSignerLock', () => ({ isSeedSignerLocked: () => mockIsLocked() }));
jest.mock('../../models/fiatUnit', () => ({
    ...jest.requireActual('../../models/fiatUnit'),
    getFiatRate: (...args: unknown[]) => mockGetFiatRate(...args),
}));

import { updateExchangeRate } from '../../blue_modules/currency';

describe('exchange rate on an Offline Seed-Signer', () => {
    beforeEach(() => {
        mockGetFiatRate.mockReset();
        mockGetFiatRate.mockResolvedValue(50000);
    });

    it('is not fetched while the signer lock is on', async () => {
        mockIsLocked.mockReturnValue(true);
        await updateExchangeRate();
        expect(mockGetFiatRate).not.toHaveBeenCalled();
    });

    it('is fetched as before once the lock is off', async () => {
        mockIsLocked.mockReturnValue(false);
        await updateExchangeRate();
        expect(mockGetFiatRate).toHaveBeenCalledTimes(1);
    });
});

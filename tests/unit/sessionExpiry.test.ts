/**
 * A Strike or CoinOS 401 signs the account out where the app offers the service, as before. Where the region gate
 * hides the service, its sign-in is hidden too, so signing out would make the card and balance vanish with no way
 * back: the account stays connected, and no toast repeats on each refresh.
 */

const mockStrikeAllowed = jest.fn(() => true);
const mockCoinosAllowed = jest.fn(() => true);
jest.mock('../../src/services/featureFlags', () => ({
    isStrikeAllowed: () => mockStrikeAllowed(),
    isCoinosAllowed: () => mockCoinosAllowed(),
}));
const mockToast = jest.fn();
jest.mock('react-native-simple-toast', () => ({ show: (...args: unknown[]) => mockToast(...args), SHORT: 0 }));
const mockClearStrikeAuth = jest.fn();
const mockClearAuth = jest.fn();
jest.mock('../../src/stores/authStore', () => ({
    __esModule: true,
    default: { getState: () => ({ clearStrikeAuth: mockClearStrikeAuth, clearAuth: mockClearAuth }) },
}));

import loc from '../../loc';
import { expireCoinosSession, expireStrikeSession } from '../../src/services/sessionExpiry';

beforeEach(() => {
    jest.clearAllMocks();
    mockStrikeAllowed.mockReturnValue(true);
    mockCoinosAllowed.mockReturnValue(true);
});

describe('an expired Strike session', () => {
    it('signs out with the usual toast where Strike is offered', () => {
        expireStrikeSession();
        expect(mockClearStrikeAuth).toHaveBeenCalledTimes(1);
        expect(mockToast).toHaveBeenCalledWith(loc.cypherbox.services.strike_api.authorization_expired, 0);
    });

    it('can sign out without a toast, or with another one', () => {
        expireStrikeSession(null);
        expect(mockToast).not.toHaveBeenCalled();
        expireStrikeSession(loc.cypherbox.home.strike_auth_expired);
        expect(mockToast).toHaveBeenCalledWith(loc.cypherbox.home.strike_auth_expired, 0);
        expect(mockClearStrikeAuth).toHaveBeenCalledTimes(2);
    });

    it('stays connected, quietly, where the app hides Strike', () => {
        mockStrikeAllowed.mockReturnValue(false);
        expireStrikeSession();
        expect(mockClearStrikeAuth).not.toHaveBeenCalled();
        expect(mockToast).not.toHaveBeenCalled();
    });
});

describe('an expired CoinOS session', () => {
    it('signs out with the usual toast where CoinOS is offered', () => {
        expireCoinosSession();
        expect(mockClearAuth).toHaveBeenCalledTimes(1);
        expect(mockToast).toHaveBeenCalledWith(loc.cypherbox.services.coinos_api.authorization_expired, 0);
    });

    it('stays connected, quietly, where the app hides CoinOS', () => {
        mockCoinosAllowed.mockReturnValue(false);
        expireCoinosSession();
        expect(mockClearAuth).not.toHaveBeenCalled();
        expect(mockToast).not.toHaveBeenCalled();
    });
});

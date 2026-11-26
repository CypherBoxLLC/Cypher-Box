/* global jest, describe, it, expect, beforeEach, afterEach */
/**
 * The "Network Error" alert after five failed Electrum connections has nothing to say to an app with no wallet. It
 * showed over the Terms screen of a fresh install started offline, and again over the seed-signer gate, which itself
 * asks for the phone to be offline. With no wallet the module now looks again later instead, and asks once there is
 * a wallet to serve. A signing phone stays quiet as before.
 */
const mockGetWallets = jest.fn();
const mockSigningMode = jest.fn();

jest.mock('../../BlueApp', () => ({ getWallets: () => mockGetWallets() }));
jest.mock('../../src/stores/authStore', () => ({
  __esModule: true,
  default: { getState: () => ({ signingMode: mockSigningMode() }) },
}));

const { Alert } = require('react-native');
const BlueElectrum = require('../../blue_modules/BlueElectrum');

const peer = { host: 'electrum.example', ssl: '50002' };

describe('the Electrum network error alert', () => {
  let alert;
  beforeEach(() => {
    jest.useFakeTimers();
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSigningMode.mockReturnValue(false);
  });
  afterEach(() => {
    alert.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('is not shown while the app has no wallet; the module looks again later', async () => {
    mockGetWallets.mockReturnValue([]);
    await BlueElectrum.presentNetworkErrorAlert(peer);
    expect(alert).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
  });

  it('is shown as before once there is a wallet', async () => {
    mockGetWallets.mockReturnValue([{}]);
    await BlueElectrum.presentNetworkErrorAlert(peer);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stays quiet on a signing phone, wallet or not', async () => {
    mockSigningMode.mockReturnValue(true);
    mockGetWallets.mockReturnValue([{}]);
    await BlueElectrum.presentNetworkErrorAlert(peer);
    expect(alert).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

/* global jest, expect */

// A unit test must never open a live Electrum connection. BlueApp.js calls BlueElectrum.connectMain() as soon as it
// loads, and a unit test reaches it by importing almost any screen (screen -> blue_modules/Privacy or storage-context ->
// BlueApp). The open socket keeps Jest from exiting after every test has passed, `--detectOpenHandles` doesn't report
// it, and CI then runs until its timeout. The signer screens also poll BlueElectrum.serverAnswers(), which opens fresh
// connections through testConnection().
//
// So in tests/unit those calls throw, and the error says what to do: the suite mocks BlueElectrum itself, and gives
// serverAnswers or testConnection the answer it means to test. A silent stub would hide that the suite loads the app's
// storage, and whatever it made serverAnswers() return would decide, unseen, whether a seed-signer screen lets the phone
// sign.
// tests/integration shares tests/setup.js and needs real connections, so this applies to tests/unit only.
const path = require('path');

const { testPath } = expect.getState();
const isUnitTest = typeof testPath === 'string' && path.relative(__dirname, testPath).split(path.sep)[0] === 'unit';

if (isUnitTest) {
  const refuse = call => {
    throw new Error(
      [
        `${call} in a unit test would open a live Electrum connection, which keeps Jest running after the tests pass.`,
        'Mock BlueElectrum at the top of this suite:',
        "  jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));",
        'and give serverAnswers or testConnection a result there if the code under test calls them (see tests/setupAfterEnv.js).',
      ].join('\n'),
    );
  };

  // The rest of BlueElectrum stays real: the wallet classes use its offline helpers. Its exports are patched in place,
  // not copied, because BlueElectrum and class/ require each other: a module that gets BlueElectrum halfway through that
  // cycle holds this same object, so it ends up patched too.
  jest.doMock('../blue_modules/BlueElectrum', () => {
    const BlueElectrum = jest.requireActual('../blue_modules/BlueElectrum');
    BlueElectrum.connectMain = () => refuse('BlueElectrum.connectMain()');
    BlueElectrum.testConnection = () => refuse('BlueElectrum.testConnection()');
    BlueElectrum.serverAnswers = () => refuse('BlueElectrum.serverAnswers()');
    return BlueElectrum;
  });

  // Behind that, no Electrum client can be built at all, so a suite whose own BlueElectrum mock spreads
  // jest.requireActual() still gets no socket. connectMain() catches and logs this error, so on that path what's
  // guaranteed is that no socket opens, not a clear failure.
  jest.doMock(
    'electrum-client',
    () =>
      class ElectrumClient {
        constructor() {
          refuse('new ElectrumClient()');
        }
      },
  );
}

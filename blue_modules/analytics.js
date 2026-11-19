/**
 * Crash reporting and analytics are off: nothing in this module sends data anywhere.
 *
 * Bugsnag is still linked, but it is never started, here or in native code (AppDelegate.mm,
 * MainApplication.java, the Watch extension). The key the app shipped with was BlueWallet's,
 * so every crash report went to BlueWallet's Bugsnag account, which Cypher Box cannot read.
 * If crash reporting comes back, it needs Cypher Box's own account, native code has to respect
 * the Disable Analytics setting too, and the Privacy Policy has to describe it.
 */
const A = async event => {};

A.ENUM = {
  INIT: 'INIT',
  GOT_NONZERO_BALANCE: 'GOT_NONZERO_BALANCE',
  GOT_ZERO_BALANCE: 'GOT_ZERO_BALANCE',
  CREATED_WALLET: 'CREATED_WALLET',
  CREATED_LIGHTNING_WALLET: 'CREATED_LIGHTNING_WALLET',
  APP_UNSUSPENDED: 'APP_UNSUSPENDED',
  NAVIGATED_TO_WALLETS_HODLHODL: 'NAVIGATED_TO_WALLETS_HODLHODL',
};

// Settings > Privacy > Disable Analytics still calls this. Nothing is collected, so there is nothing to stop.
A.setOptOut = value => {};

A.logError = errorString => {
  console.error(errorString);
};

module.exports = A;

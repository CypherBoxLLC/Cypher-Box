/**
 * Tron constants for the USDT balance.
 *
 * The contract address is the one Flashnet's own route data reports for
 * tron:USDT, checked against its base58 checksum by our address tests. It is
 * pinned here rather than read at runtime: an attacker-supplied contract address
 * is the cheapest way to show a user a balance that does not exist.
 */

/** Tether on Tron, TRC20. */
export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** USDT on Tron has six decimals, as the route data reports. */
export const USDT_DECIMALS = 6;

/** TRX is denominated in sun: one TRX is a million sun. */
export const SUN_PER_TRX = 1_000_000;

/** Which is six decimals, stated as one rather than derived from the other. */
export const TRX_DECIMALS = 6;

/**
 * What to call this asset in front of a user.
 *
 * Always the network with the ticker. USDT exists on Ethereum, Solana, BNB
 * Chain and others, the balances are not interchangeable, and USDT sent to a
 * Tron address over any other network is gone. "USDT" alone in a wallet that
 * holds exactly one of them is the kind of shorthand that costs somebody their
 * money, so the screens say this instead.
 */
export const USDT_ASSET_LABEL = 'USDT Tron';

/** The network on its own, for a sentence that already said USDT. */
export const USDT_NETWORK_LABEL = 'Tron';

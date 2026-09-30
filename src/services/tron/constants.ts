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

/**
 * The swap size we recommend, in USDT, not the smallest one allowed.
 *
 * Small swaps are not refused, they are just poor value: the Tron deposit
 * carries a flat cost of roughly two and a half dollars however much is sent,
 * so it is a few percent of a hundred-dollar swap and a third of a ten-dollar
 * one. That is a reason to advise, not to forbid.
 *
 * The floor that actually refuses is the backend's, published as `minimum` by
 * getTronConversionTerms and reflected in getFlashnetPair's `min`. This
 * constant never gates anything; it only decides when to mention the tradeoff.
 */
export const RECOMMENDED_SWAP_USDT = '100';

/**
 * Whether the USDT card offers a plain send. Off for now, by the owner's call.
 *
 * Every Tron transfer needs energy, which the backend rents from a small
 * prepaid balance. A swap earns its energy back through its fee; a plain send
 * earns nothing, so each one would be pure spend from that balance, and the
 * backend refuses them anyway (NOT_SPONSORED). The send flow stays built. It
 * comes back once the network fee has a source of its own, most likely the
 * user paying it in sats over Lightning, and the backend lets plain sends
 * through.
 */
export const USDT_PLAIN_SENDS_ENABLED = false;

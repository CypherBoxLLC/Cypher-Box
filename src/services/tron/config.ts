/**
 * Feature gate for Bitcoin to USDT swaps.
 *
 * Mirrors FEATURE_ARK_ENABLED in ../ark/config: one constant the screens and
 * the Home carousel read, so the whole surface can be pulled in a single edit
 * without unpicking the navigation or the store.
 *
 * There is no per-user switch: USDT comes with the Hot Vault, because its Tron
 * address is derived from the vault's phrase. This flag decides whether the
 * feature exists in the build at all, which covers the Home card, the line on
 * the Hot Vault card, and the step Hot Vault creation adds before Home.
 */

/** Whether the USDT surface is built into this app at all. */
export const FEATURE_USDT_ENABLED = true;

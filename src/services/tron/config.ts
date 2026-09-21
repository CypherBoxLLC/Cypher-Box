/**
 * Feature gate for Bitcoin to USDT swaps.
 *
 * Mirrors FEATURE_ARK_ENABLED in ../ark/config: one constant the screens and
 * the Home carousel read, so the whole surface can be pulled in a single edit
 * without unpicking the navigation or the store.
 *
 * Separate from the user's own unlock (isUsdtSwapsUnlocked in the auth store).
 * This flag decides whether the feature exists in the build at all; the store
 * flag decides whether this user has been through the introduction. Both have
 * to be true before the balance card replaces the locked one.
 */

/** Whether the USDT surface is built into this app at all. */
export const FEATURE_USDT_ENABLED = true;

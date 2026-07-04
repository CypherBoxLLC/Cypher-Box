/**
 * Template for `blue_modules/secrets.ts` (gitignored).
 *
 * To set up a fresh checkout:
 *
 *     cp blue_modules/secrets.example.ts blue_modules/secrets.ts
 *
 * then fill in real values in the copy. Do NOT add real values to
 * this template — it's tracked in git and any value here ends up
 * world-readable in repo history.
 *
 * See `blue_modules/secrets.ts` (after copying) for the rationale on
 * why we use a local-file pattern rather than react-native-config.
 */

/** X-API-Key for the CoinOS push relay at
 * https://notifications.cypherbox.io:3002. Pull the current value
 * from `/opt/groundcontrol/.env` on the VPS, var `RELAY_API_KEY`. */
export const RELAY_API_KEY = "";

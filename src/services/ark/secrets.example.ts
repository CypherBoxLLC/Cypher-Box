/**
 * Copy this file to `secrets.ts` and fill in the real value.
 *
 * `secrets.ts` is gitignored — never commit the real token.
 *
 * Source of truth: Second.tech provides the access token out of band
 * (e.g. Twitter DM, onboarding email). It's a shared client token gating
 * every Cypher Box install's access to the private mainnet ASP, not a
 * per-user credential. Rotate by replacing the value and shipping a new
 * app build.
 */
export const BARK_ACCESS_TOKEN = '';

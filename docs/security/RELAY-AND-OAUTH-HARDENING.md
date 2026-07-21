# Relay & OAuth Hardening Design Notes

Findings from the 2026-07 security review that need **server-side or design
decisions**, not just client patches. Client PRs should wait for these decisions.

## 1. Stop storing live CoinOS session tokens on the relay (RB-NET-07)

**Today:** `src/services/coinosSocket.ts` `registerPushToken()` POSTs
`{ username, coinosToken, pushToken }` to `notifications.cypherbox.io:3002/register`.
The relay keeps the user's money-moving CoinOS session token in SQLite so it can
watch for incoming payments and push them.

**Risk:** relay/VPS/SQLite compromise = full custodial account access for every
registered user. A self-hosted Express+SQLite box is a much softer target than
CoinOS itself.

**Options (pick one):**
- **A. Scoped watch credential (preferred).** CoinOS issues (or you derive) a
  read-only/watch-only credential — e.g. an LNbits-style `inkey` (invoice/read key)
  instead of the admin key, or a per-user webhook registration. The relay stores a
  credential that can observe payments but cannot spend.
- **B. Nostr/watch-only subscription.** Watch the user's public payment identifier
  (zap address / LNURL-pay static code) — no bearer token leaves the device at all.
- **C. Keep tokens, harden the relay.** If tokens must stay server-side: encrypt at
  rest with a key outside the box, bind tokens to device + expiry, rotate on push
  token change, and publish the relay source for review. Weakest option; document as
  accepted risk in SECURITY.md if chosen.

Whichever option ships, the client change (drop `coinosToken` from the register
payload) lands in the same release as the server change — they are one rollout.

## 2. The relay API key is public-by-design (RB-NET-06)

`RELAY_API_KEY` lives in the gitignored `blue_modules/secrets.ts`, which is bundled
into every distributed build. Any user can extract it from the APK. That is fine **if
the server treats it as an app-traffic filter, not authorization**: the relay must not
trust any payload merely because it carries the key. Per-user rate limits, payload
validation, and no admin endpoints behind the shared key. (The previous hardcoded
value was already leaked once in git history and rotated — good response; the design
note above is what makes the next leak a non-event.)

## 3. Strike OAuth exchange should not transit a proxy (RB-NET-05)

`src/screens/CheckingAccountLogin/index.tsx` sends the PKCE `code` + `verifier` to
`https://cypherbox-backend.onrender.com/oauth/start`, which performs the token
exchange. Whoever operates that proxy (and its host) can observe the exchange and
mint the money-moving access token. The proxy's code is not in this repo and is
currently unauditable.

**Preferred:** perform the exchange on-device. PKCE exists precisely so public
clients can exchange codes without a secret — Strike's token endpoint should accept
the exchange directly from the app. If Strike requires a confidential client (the
only legitimate reason for the proxy), then: publish the proxy source, pin it under
your own domain, log nothing at the token endpoint, and state the trust decision in
SECURITY.md so users know a first-party server observes token mint.

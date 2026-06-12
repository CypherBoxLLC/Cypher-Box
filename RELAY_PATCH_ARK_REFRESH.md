# Relay Patch — Ark Refresh Push (`coinos-relay/index.js`)

Concrete, copy-pasteable additions to `coinos-relay/index.js` to support the silent `ark.refresh.due` push wake.

**Target file:** `/opt/groundcontrol/coinos-relay/index.js` on the GroundControl host (single-file Node.js Express + WS server).

**No new npm dependencies.** Everything reuses existing primitives (`@parse/node-apn`, `firebase-admin`, `better-sqlite3`).

**No service restart of unrelated containers.** Only `coinos-relay` needs to be rebuilt + restarted: `docker compose up -d --build coinos-relay` from `/opt/groundcontrol/`.

---

## Patch order

Apply these in order, top-to-bottom, in the existing `index.js`. Section headers below match the existing comment-banner style in the file (`// ── Section ──...`).

---

## 1. Schema migration (idempotent)

**Where:** immediately after the existing `db.exec(\`CREATE TABLE IF NOT EXISTS devices ...\`)` block (currently around line 30).

**What it does:** adds four columns to the `devices` table for Ark-refresh state. SQLite throws if a column already exists, so each `ALTER TABLE` is wrapped in a try/catch — safe to run on every container start.

```js
// ── Ark refresh schema migration (idempotent) ───────────────────────────────
//
// Each ALTER is in its own try/catch because SQLite throws a hard error if
// the column already exists — there is no `IF NOT EXISTS` for ADD COLUMN.
// That makes this block safe to re-run on every container start.
for (const stmt of [
  `ALTER TABLE devices ADD COLUMN ark_refresh_opt_in INTEGER DEFAULT 0`,
  `ALTER TABLE devices ADD COLUMN ark_soonest_expiry_at INTEGER`,
  `ALTER TABLE devices ADD COLUMN ark_last_push_at INTEGER`,
]) {
  try { db.exec(stmt); } catch (e) {
    if (!String(e.message).includes('duplicate column')) {
      console.warn('[Ark schema migration]', stmt, '→', e.message);
    }
  }
}
```

---

## 2. Prepared statements

**Where:** alongside the existing `stmtUpsert` / `stmtGetByUsername` / `stmtDelete` block.

```js
// ── Ark refresh prepared statements ─────────────────────────────────────────
const stmtSetArkOptIn = db.prepare(`
  UPDATE devices SET ark_refresh_opt_in = ? WHERE username = ? AND push_token = ?
`);

const stmtSetArkExpiry = db.prepare(`
  UPDATE devices
  SET ark_soonest_expiry_at = ?
  WHERE username = ?
`);

const stmtArkPushCandidates = db.prepare(`
  SELECT username, push_token, platform, ark_soonest_expiry_at, ark_last_push_at
  FROM devices
  WHERE ark_refresh_opt_in = 1
    AND ark_soonest_expiry_at IS NOT NULL
    AND ark_soonest_expiry_at - CAST(strftime('%s','now') AS INTEGER) < 172800
    AND (ark_last_push_at IS NULL
         OR CAST(strftime('%s','now') AS INTEGER) - ark_last_push_at > 43200)
`);

const stmtArkMarkPushed = db.prepare(`
  UPDATE devices SET ark_last_push_at = CAST(strftime('%s','now') AS INTEGER)
  WHERE username = ? AND push_token = ?
`);

const stmtGetDeviceByUsername = db.prepare(`
  SELECT * FROM devices WHERE username = ? LIMIT 1
`);
```

The numeric constants:
- `172800` = 48 hours in seconds — the imminent-expiry threshold for sending a push.
- `43200` = 12 hours in seconds — per-device dedupe window.

---

## 3. Silent-push send functions

**Where:** immediately after the existing `sendFCM` function (around line 110).

```js
// ── Silent push for Ark refresh ─────────────────────────────────────────────
//
// content-available + custom `type` field with NO alert/sound/badge.
// iOS will deliver this to the app's didReceiveRemoteNotification while
// it's backgrounded/suspended without showing any banner. The client's
// AppDelegate intercepts the `type` field and routes it into the
// background-refresh orchestrator.
async function sendSilentAPNs(pushToken) {
  if (!apnProvider) return;
  const note = new apn.Notification();
  note.expiry = Math.floor(Date.now() / 1000) + 3600;
  note.priority = 5;                    // low — silent pushes should defer
  note.pushType = 'background';         // required by APNs for silent
  note.contentAvailable = 1;
  note.topic = APNS_TOPIC;
  note.payload = { type: 'ark.refresh.due' };
  try {
    const result = await apnProvider.send(note, pushToken);
    if (result.failed.length > 0) {
      console.error('[ArkPush APNs] failed:', JSON.stringify(result.failed));
      return false;
    }
    console.log('[ArkPush APNs] sent to', pushToken.substring(0, 8) + '...');
    return true;
  } catch (e) {
    console.error('[ArkPush APNs] error:', e.message);
    return false;
  }
}

// FCM data-only message. Critical: NO `notification` field (that would
// surface a banner and route through a different Android code path). We
// rely on the client's PushNotification.configure({ onNotification })
// handler to detect data.type === 'ark.refresh.due' and trigger the
// orchestrator.
async function sendSilentFCM(pushToken) {
  if (!firebaseApp) return false;
  try {
    await admin.messaging().send({
      token: pushToken,
      data: { type: 'ark.refresh.due' },
      android: { priority: 'high' },
    });
    console.log('[ArkPush FCM] sent to', pushToken.substring(0, 8) + '...');
    return true;
  } catch (e) {
    console.error('[ArkPush FCM] error:', e.message);
    return false;
  }
}
```

---

## 4. The push scanner loop

**Where:** alongside the existing CoinOS-payment poller block (after `disconnectUser`, around line 230).

```js
// ── Ark refresh push scanner ────────────────────────────────────────────────
//
// Every minute, scan registered devices for ones whose soonest VTXO
// expiry is inside the 48h window AND haven't been pushed in 12h.
// Send silent pushes; mark last_push_at on success.
//
// 60s cadence is conservative — most scans will find nothing. SQLite
// query cost on a small device table is negligible.
const ARK_SCAN_INTERVAL_MS = 60_000;

async function arkPushScan() {
  let candidates;
  try {
    candidates = stmtArkPushCandidates.all();
  } catch (e) {
    console.error('[ArkPush scan] query error:', e.message);
    return;
  }
  if (candidates.length === 0) return;

  console.log(`[ArkPush scan] ${candidates.length} candidate(s)`);
  for (const dev of candidates) {
    let ok = false;
    if (dev.platform === 'ios') {
      ok = await sendSilentAPNs(dev.push_token);
    } else if (dev.platform === 'android') {
      ok = await sendSilentFCM(dev.push_token);
    }
    if (ok) {
      try {
        stmtArkMarkPushed.run(dev.username, dev.push_token);
      } catch (e) {
        console.error('[ArkPush scan] mark-pushed error:', e.message);
      }
    }
  }
}

setInterval(() => { arkPushScan().catch(() => {}); }, ARK_SCAN_INTERVAL_MS);
console.log(`[ArkPush] scanner running every ${ARK_SCAN_INTERVAL_MS / 1000}s`);
```

---

## 5. Client-facing endpoints

**Where:** alongside the existing `/register` / `/unregister` / `/health` block (around line 290).

```js
// ── Ark refresh subscription endpoints ──────────────────────────────────────
//
// Decoupled from /register so the user can toggle background refresh
// independently of CoinOS auth. The (username, pushToken) pair must
// already exist in the devices table — the client's CoinOS registration
// step is a prerequisite.
app.post('/ark-refresh/subscribe', requireApiKey, (req, res) => {
  const { username, pushToken, optIn } = req.body;
  if (!username || !pushToken || typeof optIn !== 'boolean') {
    return res.status(400).json({
      error: 'Missing required fields: username, pushToken, optIn (boolean)',
    });
  }
  try {
    const result = stmtSetArkOptIn.run(optIn ? 1 : 0, username, pushToken);
    if (result.changes === 0) {
      return res.status(404).json({
        error: 'Device not found — register via /register first',
      });
    }
    console.log(`[Ark API] ${username} subscribe optIn=${optIn}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Ark API] subscribe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Client posts soonest-expiry on every successful foreground sync. Single
// row per username (we update all of that user's devices at once — Ark
// expiry state is wallet-scoped, not device-scoped).
app.post('/ark-refresh/expiry', requireApiKey, (req, res) => {
  const { username, soonestExpiryAt } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Missing username' });
  }
  // soonestExpiryAt: unix seconds, or null when wallet has no spendable VTXOs
  const value = (soonestExpiryAt === null || soonestExpiryAt === undefined)
    ? null
    : Math.floor(Number(soonestExpiryAt));
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    return res.status(400).json({ error: 'soonestExpiryAt must be unix-seconds or null' });
  }
  try {
    stmtSetArkExpiry.run(value, username);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Ark API] expiry error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Dev-only: trigger an immediate silent push for a username. Authed via
// the same API key (treat the existing key as admin-grade for now; if a
// separate admin key is needed later, gate this behind a different
// header). Useful for end-to-end testing the client wake path without
// waiting for real expiry.
app.post('/ark-refresh/test-trigger', requireApiKey, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Missing username' });
  const devices = stmtGetByUsername.all(username);
  if (devices.length === 0) {
    return res.status(404).json({ error: 'No registered devices for that username' });
  }
  const results = [];
  for (const dev of devices) {
    let ok = false;
    if (dev.platform === 'ios') ok = await sendSilentAPNs(dev.push_token);
    else if (dev.platform === 'android') ok = await sendSilentFCM(dev.push_token);
    results.push({ pushToken: dev.push_token.substring(0, 8) + '...', platform: dev.platform, ok });
  }
  res.json({ ok: true, results });
});
```

---

## 6. (Optional) extend `/register` to take initial Ark opt-in

Backwards-compatible addition. Existing clients without these fields keep working.

**Where:** inside the existing `/register` handler.

Replace the existing block:
```js
try {
  stmtUpsert.run(username, coinosToken, pushToken, platform);
  console.log(`[API] Registered ${platform} device for ${username}`);
  // Start or restart WS connection for this user
  connectUser(username, coinosToken);
  res.json({ ok: true });
}
```

with:
```js
try {
  stmtUpsert.run(username, coinosToken, pushToken, platform);
  // Optional Ark refresh opt-in on initial registration. Allows the
  // client to set the flag in a single round-trip when both CoinOS auth
  // and Ark toggle happen back-to-back.
  if (typeof req.body.arkRefreshOptIn === 'boolean') {
    stmtSetArkOptIn.run(req.body.arkRefreshOptIn ? 1 : 0, username, pushToken);
  }
  console.log(`[API] Registered ${platform} device for ${username}`);
  connectUser(username, coinosToken);
  res.json({ ok: true });
}
```

---

## Companion client change (Cypher Box repo, not this file)

The client needs three small additions, all in this branch (`ark-bg-refresh`):

1. **In `setArkBackgroundRefreshEnabled` (`src/services/ark/backgroundRefresh.ts`)** — after the keychain write, call `${coinosRelayUri}/ark-refresh/subscribe` with `{username, pushToken, optIn: true}`. After the keychain delete, the same call with `optIn: false`.

2. **In `useArkSync.ts`** — after the successful sync block (after `setArkLastSyncedAt(Date.now())`), compute `soonestExpiryAt` from the same `arkVtxos.spendable` + `arkChainTipHeight` math as `ArkWallet/index.tsx`, and POST to `${coinosRelayUri}/ark-refresh/expiry` (fire-and-forget, swallow errors).

3. **The push token + username sources** are already available — see `setUsername` and the `RELAY_API_KEY` import in `src/services/coinosSocket.ts`. The push token lives in the same place `registerPushToken` reads it from on the call site of `registerPushToken`.

I can write these client changes now if you want — they're ~30 lines total. Or wait until the relay patch lands so end-to-end testing is possible.

---

## Deploy + verify

```bash
# As root on the GroundControl host
cd /opt/groundcontrol
# (After applying the patch to coinos-relay/index.js)
docker compose up -d --build coinos-relay

# Tail logs to confirm:
#   - "[ArkPush] scanner running every 60s" appears once at startup
#   - No errors on the schema migration block
docker compose logs -f coinos-relay

# Smoke-test the test-trigger endpoint (substitute real RELAY_API_KEY
# and a real registered username):
curl -X POST https://notifications.cypherbox.io:3003/ark-refresh/test-trigger \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $RELAY_API_KEY" \
  -d '{"username": "your-test-username"}'
```

The test-trigger response shows per-device send results. If `ok: true` for your device but the client doesn't react, the issue is on the client side (push token registration, AppDelegate routing) — work backwards from there.

---

## Risks / caveats

- **Schema migration on existing rows:** the `ALTER TABLE ADD COLUMN` blocks add NULL columns to existing devices. `ark_refresh_opt_in DEFAULT 0` handles the boolean correctly; existing rows are correctly "opted out by default."
- **Per-username vs per-device expiry:** the schema currently stores `ark_soonest_expiry_at` per-device (column on `devices`). The expiry endpoint updates ALL devices for the username, which is correct (Ark wallet state is wallet-scoped). If a user has both an iPhone and iPad registered, both rows update on each `/ark-refresh/expiry` call.
- **Stale opt-in on token rotation:** if FCM rotates a device's token, the new row gets `ark_refresh_opt_in = 0` by default until the client re-subscribes. The client should re-call `/ark-refresh/subscribe` whenever push registration is refreshed.
- **No retry on push send failure:** if APNs/FCM returns an error, we don't mark `ark_last_push_at`, so the next scan (60s later) will retry. Could lead to a short retry storm if APNs is flaky — bound at 1 push/minute per device, which is acceptable given the existing 12h dedupe window will kick in once one succeeds.
- **`pushType: 'background'` requirement:** newer iOS APNs requires this header for content-available pushes (otherwise APNs will silently drop them). The patch sets it explicitly. If the existing payment-notification code path drops without it, that's a separate latent bug — out of scope for this patch.

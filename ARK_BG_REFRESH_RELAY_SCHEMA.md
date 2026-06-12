# Ark Background Refresh — Relay Push Schema

**Status:** draft, awaiting relay-team confirmation
**Owner (client side):** Cypher Box
**Owner (relay side):** Second.tech notifications relay (`wss://notifications.cypherbox.io:3003`)
**Client branch:** `ark-bg-refresh`

This document describes the silent-push wake protocol that the Cypher Box client expects from the relay, in support of the opt-in background VTXO refresh feature. It is the contract — changes to either side require coordination.

---

## Why this exists

iOS `BGAppRefreshTask` / `BGProcessingTask` and Android `WorkManager` periodic work are both unreliable on dormant phones. iOS in particular gives essentially no scheduling guarantees on devices the user rarely opens. The silent push from this relay is the **safety net**: when the relay observes that a registered device's soonest VTXO has fallen below an expiry threshold, it sends a content-only push that wakes the client to run a refresh round.

The client also runs scheduled wakes independently (every ~6h on Android, OS-discretion on iOS). The relay push fires **regardless** of whether scheduled wakes have been hitting; the client orchestrator de-dupes via its own rate limit (one successful round per 12h) and eligibility filter (only refreshes VTXOs within ~14d of expiry).

---

## When the relay should send

Send a refresh push when **all** of the following are true for a registered device:

1. The device is opted into background refresh (the client registers / unregisters when the user toggles the feature — separate endpoint, see `Push registration` below).
2. The relay's view of that device's soonest VTXO expiry is `<= 48h` from the current time.
3. No refresh push has been sent to this device in the last **12 hours** (relay-side dedupe; mirrors the client's rate limit).

Do **not** send when:

- The device's soonest VTXO is `> 48h` from expiry — premature wakes drain battery for no benefit.
- The device hasn't registered for background refresh — the keychain entry is missing client-side and the orchestrator will exit `no_seed`.

---

## Message format

### iOS (APNs)

A standard content-available silent push. The user MUST NOT see a banner — the client decides whether to surface a notification based on what the orchestrator finds.

```json
{
  "aps": {
    "content-available": 1
  },
  "type": "ark.refresh.due"
}
```

Field details:
- `aps.content-available: 1` — required for iOS to wake a backgrounded/suspended app.
- No `aps.alert`, no `aps.sound`, no `aps.badge` — silent.
- `type: "ark.refresh.due"` — top-level (sibling of `aps`). The client matches on this exact string.

The client's `application:didReceiveRemoteNotification:fetchCompletionHandler:` intercepts these before the standard notification pipeline and runs the orchestrator. The native handler calls APNs's completion handler with `UIBackgroundFetchResultNewData` on success, `Failed` on watchdog timeout (25s).

APNs priority: `5` (low) is appropriate. These pushes are not user-facing and we are happy for iOS to coalesce them with later traffic to save power.

### Android (FCM)

A data-only message. Avoid any `notification` payload field — that would surface a banner and route through a different code path on Android.

```json
{
  "to": "<device FCM token>",
  "priority": "high",
  "data": {
    "type": "ark.refresh.due"
  }
}
```

Field details:
- `priority: "high"` — required for FCM to deliver to a doze-mode device. Without this, delivery may be deferred indefinitely on some Android builds (Samsung One UI, Xiaomi MIUI are the known offenders).
- `data.type: "ark.refresh.due"` — the marker the client matches on inside its `PushNotification.configure({ onNotification })` handler.
- No `notification` block — data-only.

The client's onNotification routes the message to the orchestrator; the JS bridge stays alive long enough for the eligibility scan + warnings, and (under good conditions) the refresh round itself.

---

## Idempotency and dedupe

The client tolerates duplicate pushes — the orchestrator's 12h rate limit and eligibility filter will exit cleanly via `rate_limited` or `no_eligible_vtxos` if the work is unnecessary. However, the relay should still dedupe to save battery / avoid pointless wakes:

- Per-device dedupe window: **12 hours** between sent pushes for the same device.
- Reset the per-device timer when:
  - The device confirms a successful refresh (see `Refresh confirmation` below — TBD if we wire this up).
  - The relay's view of soonest expiry moves **outside** the 48h window (e.g. user did a foreground refresh, VTXOs got renewed).

If the relay has no view of when the client successfully refreshed, default to a 24h dedupe window (more conservative — avoids the risk of stacking pushes when the client and relay views diverge).

---

## Push registration

The client already calls `${coinosRelayUri}/register` (see `src/services/coinosSocket.ts:registerPushToken`) to register an FCM/APNs token. We propose extending the existing endpoint or adding a new one:

**Option A — extend the existing endpoint:**

```
POST /register
{
  "username": "<coinos username>",
  "coinosToken": "...",
  "pushToken": "...",
  "platform": "ios" | "android",
  "arkRefreshOptIn": true | false,        // NEW
  "arkPubkey": "<hex pubkey>"             // NEW: relay needs this to track expiry
}
```

The `arkPubkey` field is the device's Bark wallet pubkey, which the relay uses to query the ASP for VTXO expiry state. The client sends this whenever the toggle flips on; sends `arkRefreshOptIn: false` when the toggle flips off (and the relay should remove the device from its push list).

**Option B — separate endpoint:**

```
POST /ark-refresh/subscribe { "username": "...", "coinosToken": "...", "arkPubkey": "..." }
POST /ark-refresh/unsubscribe { "username": "...", "coinosToken": "..." }
```

Either works for us. Pick whichever fits the relay's existing structure better.

---

## Refresh confirmation (optional, future)

To improve dedupe accuracy, the client could POST a confirmation back to the relay after a successful refresh round:

```
POST /ark-refresh/refreshed
{
  "username": "...",
  "arkPubkey": "...",
  "newSoonestExpiryAt": "<ISO 8601>"
}
```

This lets the relay reset its dedupe timer and update its expiry view without polling the ASP. Not required for v1 — the relay can poll the ASP on its own cadence.

---

## Open questions for the relay team

1. **VTXO expiry observability.** The relay needs to know when a registered device's soonest VTXO is within 48h. Options: (a) relay polls the ASP's `list_by_pubkey`-style endpoint per registered device, (b) relay subscribes to ASP-emitted events when those exist, (c) client posts expiry summary to relay on every foreground sync. Which fits your architecture?

2. **Per-device push rate.** What's a comfortable per-device-per-day push count from your operational standpoint? We model 1 push every 12h as the upper bound but typical activity should be much lower.

3. **Test endpoint.** During client development we'd like a way to trigger a `ark.refresh.due` push to our own device on demand — for manual testing of the wake path. Curl-able admin endpoint or test mode flag would unblock us.

---

## References

- Spec: original prompt from Cypher Box dev (2026-05-04)
- Client orchestrator: `src/services/ark/backgroundRefresh.ts`
- iOS scheduler: `ios/BlueWallet/ArkBackgroundScheduler.{h,m}`
- Android worker chain: `android/app/src/main/java/io/bluewallet/bluewallet/Ark*.java`
- JS scheduler: `src/services/ark/scheduler.ts`
- Existing relay registration call: `src/services/coinosSocket.ts:registerPushToken`

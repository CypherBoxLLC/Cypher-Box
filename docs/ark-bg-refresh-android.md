# How Cypher Box keeps your Ark wallet alive on Android

> Source material for a public-facing article. Written for an audience of
> technical, slightly skeptical Bitcoin users who want to know whether
> the "background refresh" toggle in Cypher Box actually works — and
> what we had to do to make it work on Android in 2026.

## TL;DR

Ark wallets contain VTXOs (off-chain balances) that **expire on a fixed timeline** if not refreshed. If your phone sits idle and the wallet doesn't refresh in time, you can lose funds. Cypher Box's "Auto-refresh" toggle is what prevents that — quietly, in the background, every six hours.

On iOS, this is straightforward. On Android, getting it actually reliable in 2026 took multiple architectural pivots through three layers of OS-imposed restrictions. The final answer:

1. An **AlarmManager** alarm fires every six hours.
2. An invisible **BroadcastReceiver** wakes for ~10 seconds in a system-granted exemption window.
3. The receiver starts a brief **foreground service** that hosts the JS bridge.
4. The JS code runs the actual refresh against the Ark Service Provider, then exits.
5. The receiver re-arms the next alarm.

All of this is gated behind one user setting on Samsung devices: **Battery → Unrestricted**. Without it, Samsung's battery management overrides everything — same as for WhatsApp, banking apps, and every other Android app that needs reliable background work.

That's the summary. The rest of this document is *why*.

---

## Why VTXO refresh has to happen even when you're not using the app

Ark is a second-layer Bitcoin protocol that lets the Ark Service Provider (ASP) batch off-chain transactions into "rounds." When you receive funds via Ark, you receive a **VTXO** — a Virtual UTXO. VTXOs have an **expiry**: typically a few weeks to a few months, depending on the ASP.

If a VTXO expires, the user can still claim it back on-chain unilaterally — but doing so **requires being online and broadcasting an exit transaction in time**. The standard way to avoid that exit path is to *refresh* the VTXO before it expires: the wallet asks the ASP to re-issue it as a fresh VTXO with a new (later) expiry.

A correctly-functioning Ark wallet refreshes its VTXOs *before they expire*, automatically, without requiring the user to open the app. Otherwise, an honest user who simply forgot to open Cypher Box for a month could find themselves having to do a unilateral on-chain exit — slower, costlier, and stressful.

This is **funds-critical functionality**. It can't be flaky. It can't depend on the user remembering anything.

It also has to play nice with battery, with privacy, with Doze, and with whatever opaque vendor-specific battery management the user's phone has layered on top of stock Android.

---

## What Cypher Box does on iOS (the easy half)

iOS has `BGTaskScheduler`. You register a background task identifier, the OS picks an opportunistic moment (usually overnight while charging, on Wi-Fi, with the screen off), and your task runs for up to 30 seconds.

Cypher Box uses a single `BGAppRefreshTask` (`io.cypherbox.btc.ark-refresh`) registered for ~6h cadence. Inside the task we run the same JS function that the Android side runs (`runBackgroundRefresh`), so the actual refresh logic is **identical across platforms**. The cross-platform contract:

```
1. Read the user's Ark wallet from secure storage (Keychain / Android Keystore).
2. Connect to the configured ASP.
3. For each VTXO that's within its refresh window, ask the ASP to re-issue it.
4. Persist updated state.
5. Telemetry: append a record to a small rolling log so we can verify
   later that refreshes are actually happening.
```

iOS gives you "the OS will run this every few hours, trust us" with reasonable success. The iOS path was straightforward to implement and verify.

The hard part was Android.

---

## Why we couldn't just use WorkManager

WorkManager is Google's official, recommended API for "deferrable background work." It's the answer they tell every developer to use. We tried it first for exactly that reason. Here's what happened, in order, because each layer of failure was instructive.

### Layer 1: WorkManager's own initialization race (real but fixable)

WorkManager initializes itself eagerly via an `androidx.startup` ContentProvider that runs *before* `Application.onCreate`. When the OS spawns your process specifically to host a `SystemJobService` (i.e. WorkManager wants to dispatch a worker), WM's eager init re-reconciles its in-memory state by calling `JobScheduler.schedule()` again — which **atomically replaces the in-flight JobInfo the framework was about to bind to**.

The framework, finding the original JobInfo gone, prints `JobScheduler: Job didn't exist in JobStore` and aborts the bind. Your worker never runs. This is [issuetracker.google.com/170529030](https://issuetracker.google.com/issues/170529030) — known, real, partially fixed in WorkManager 2.10.0+.

Fix: implement `Configuration.Provider` in `MainApplication`, remove the auto-init meta-data via manifest merger, bump WorkManager to 2.11.2. With on-demand init, the reconciliation happens *after* the framework has bound the worker, so there's no race.

We did all this. We verified it worked: cold-spawned worker reaches `doWork()`. **But that wasn't enough.**

### Layer 2: Android 14's foreground-service-from-background restriction (architectural wall)

`doWork()` ran. But our worker's job is to start the headless JS task — a separate `Service` that hosts the JS bridge. When we tried, every variant of the call was denied:

```
W ActivityManager: Background started FGS: Disallowed [
  callingPackage: io.cypherbox.btc; uidState: TRNB; uidBFSL: n/a;
  code: DENIED; tempAllowListReason: <null>; targetSdkVersion: 34
]
W ArkRefreshWorker: startForegroundService blocked:
  startForegroundService() not allowed due to mAllowStartForeground false
```

`uidState: TRNB` means our process was in **transient background** state — not a foreground service, not visible, not exempted. On Android 14, that combination forbids `startForegroundService()`. We tried:

- Plain `startService()` — blocked.
- `startForegroundService()` — blocked.
- WorkManager's expedited workers (`setExpedited`) — they grant FGS *to the worker itself*, but do not propagate that exemption to other services the worker tries to start. We pivoted to a "pyramid" pattern (an expedited "doer" worker chained from a delayed "rearm timer") to sidestep WM's restriction that periodic workers can't be expedited. The pyramid dispatched correctly. The doer ran. It still couldn't start the headless service. Process importance topped out at 230 (`PERCEPTIBLE`), never reached 125 (`FOREGROUND_SERVICE`).

This isn't a bug we can engineer around. **Android 14 deliberately restricts background processes from starting foreground services**, with very narrow exemptions, for good reason: it's how malware used to abuse Android. The exemptions:

- The app is currently in foreground (irrelevant — we're a background refresh).
- The app is on the device-idle allowlist (i.e. user-granted "Unrestricted").
- The trigger is a specific OS-managed event the framework explicitly grants temporary allowlist for. **This includes alarm-fired BroadcastReceivers.**

That last bullet is the entire reason this document exists.

### Layer 3: AlarmManager (what actually works)

When `AlarmManager` fires an alarm, the framework dispatches the registered receiver in a special context: a brief temporary allowlist (~10 seconds) is granted to the app, with `tempAllowListReason: ALARM_MANAGER_ALARM_CLOCK` (and equivalents for non-clock alarms). During that window, the receiver is permitted to call `startForegroundService()`.

This isn't a hack. It's the documented mechanism for "wake up briefly in the background to do something foreground-worthy." Android exposes it precisely because every legitimate use case (alarm clocks, calendar reminders, periodic data sync) needs a way around the FGS-from-background restriction.

So we pivoted. The current architecture is:

```
AlarmManager.setAndAllowWhileIdle(t + 6h, ARK_REFRESH_ALARM, broadcastIntent)
                              │
                              ▼  (after ~6h, possibly batched in a Doze maintenance window)
ArkRefreshAlarmReceiver.onReceive()
                              │
                              ├─ startForegroundService(ArkRefreshHeadlessTaskService)
                              ├─ HeadlessJsTaskService.acquireWakeLockNow()
                              └─ ArkBackgroundSchedulerModule.armAlarm()  ← re-arm next iteration
                              │
                              ▼
ArkRefreshHeadlessTaskService.onStartCommand()
                              │
                              ├─ startForeground(notificationId, notification, FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                              └─ super.onStartCommand()  ← React Native HeadlessJsTaskService takes over
                              │
                              ▼
JS task "ArkBackgroundRefresh" runs (≤30s):
  - load wallet from secure storage
  - connect to ASP, refresh due VTXOs
  - persist new state, write telemetry record
  - exit
                              │
                              ▼
HeadlessJsTaskService stops itself; foreground service lifecycle ends.
The notification disappears. The process gets reaped within a few minutes.
```

Total wake duration: ~15-30 seconds, once every six hours, on success.

### Validation

End-to-end cold-fire on a Galaxy A14 (Android 14, One UI 6.1) after killing the app process:

```
23:13:28.415  Received BROADCAST io.cypherbox.btc.ARK_REFRESH_ALARM
23:13:28.424  ArkRefreshAlarm: alarm fired, starting headless service
23:13:28.436  Background started FGS: Allowed [code: SYSTEM_ALLOW_LISTED]
23:13:28.451  ArkRefreshAlarm: service start dispatched
23:13:28.456  ArkRefreshAlarm: armed alarm to fire in 6h (allowWhileIdle)
23:13:28.517  am_foreground_service_start
23:13:38.554  notification_enqueue: ark-bg-refresh
23:13:46.033  Stop FGS timeout: ArkRefreshHeadlessTaskService
23:13:46.039  am_foreground_service_stop
```

Worker enters → FGS approved → JS runs ≈10 seconds → service exits. Same path the user gets in production.

---

## What users see (and have to do)

### The toggle

In Cypher Box: **Settings → Auto-refresh on**. Touch ID confirmation, then a copy of the seed is staged in the OS keychain so the background task can sign refresh requests without bothering the user. The home screen shows a small banner: "Auto-refresh on, last refresh Xm ago" — or "failed at HH:MM, tap to retry" if the most recent run failed.

### The Samsung gotcha

On Samsung devices specifically, every newly-installed app defaults to **"Optimized" battery mode**. Optimized = aggressive: Samsung will kill the app, suppress alarms, defer wake-ups, and generally fight any attempt at reliable background work. This isn't unique to Cypher Box — it's why your bank app sometimes misses notifications, why Signal occasionally drops a message until you open it, why WhatsApp tells you on first launch to turn off battery optimization.

For Cypher Box on Samsung, the user must change this:

> **Settings → Apps → Cypher Box → Battery → Unrestricted**

Without it: the alarm may still fire eventually, but Samsung's battery management can defer it for hours or skip cycles. **Funds at risk if VTXOs are close to expiry.**

With it: the alarm fires within the standard `setAndAllowWhileIdle` window (~9-15 minute slack from the scheduled time, per Android's batching). The full refresh chain runs reliably.

We can't grant this for you — Android requires the user to make this choice consciously. We can detect it (`PowerManager.isIgnoringBatteryOptimizations()`) and prompt you to enable it during onboarding. That UX is a planned follow-up.

Other vendors (Xiaomi, Huawei, OnePlus, Oppo) have their own equivalents under different names ("App lock," "Auto-start," "Power-saving exclusions"). The principle is the same: a one-time setting toggle that tells the OS "yes, this app is allowed to do background work."

### What happens if you don't enable Unrestricted

The app still works perfectly while it's open. Refreshes happen via the normal foreground sync path. The toggle reflects "Auto-refresh on," but:

- The first refresh after closing the app might happen on schedule.
- Subsequent ones will be increasingly delayed by Samsung's heuristics.
- After a day or two of not opening the app, refresh may stop entirely.

If your VTXOs aren't close to expiry, this is mostly cosmetic. If they are, this is the difference between an automatic refresh and being forced to open the app to do it manually before the deadline.

---

## What we explicitly did NOT do

Several common Android background-work strategies are bad fits for a Bitcoin wallet, and we deliberately avoided them:

- **Always-running foreground service.** Some apps stay foreground 24/7 with a persistent notification ("Cypher Box is running"). This works around all the restrictions but is hostile to battery and to the user. Not acceptable for a wallet that only needs to do something for ~15 seconds every 6 hours.
- **High-frequency wake-ups.** Refreshing every hour wouldn't meaningfully improve safety (VTXOs expire on the order of weeks) but would 6× the battery cost and increase the chance of hitting Android's adaptive throttling.
- **Constant network polling.** The bg refresh only contacts the Ark Service Provider. No advertising, no analytics, no telemetry beamed to anyone. The "rolling telemetry" mentioned above is local-only — it lives in the app's encrypted storage and is for your own diagnostic use.
- **Background activity at app launch.** We considered piggybacking refreshes on every app open. We do that *too*, via the foreground sync path. But it can't be the only mechanism, because users sometimes don't open the app for weeks. The bg path exists precisely for that case.

---

## What's still ahead

The committed implementation is what was end-to-end validated on hardware. There are two near-term improvements still to land:

1. **`BOOT_COMPLETED` receiver.** AlarmManager state is wiped on device reboot. Today, if your phone reboots overnight, the alarm doesn't auto-rearm until you next open the app. The fix is a small `BOOT_COMPLETED` broadcast receiver that re-runs `armAlarm()` if you had Auto-refresh enabled. Maybe an hour of work plus a reboot test.

2. **First-toggle UX guidance.** Today the app silently sets up the schedule. We should detect `PowerManager.isIgnoringBatteryOptimizations() == false` on first toggle and walk the user through enabling Unrestricted with an `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` intent. That single dialog turns "this might work depending on your phone vendor" into "this works."

3. **Push-relay wake (longer-term).** A second wake path: a silent push from CoinOS relay when there's something for the wallet to do. This is more reliable than periodic polling because it's event-driven (only wake when needed) and the OS treats high-priority FCM messages with the same temp-allowlist mechanism as alarms. Already partially scaffolded; needs server-side wiring.

---

## Why this story matters for trust

A skeptical user reading this might reasonably ask: "if Android background work is this hard to make reliable, how do I know it's actually happening on my phone?"

Three answers:

1. **The app shows you.** The home screen banner displays "last refresh Xm ago." If that timestamp is older than ~6.5 hours, something's wrong. Tap the banner to force a refresh manually.

2. **The OS shows you.** Android tracks foreground service starts. You can see them in **Settings → Battery → Battery usage → Cypher Box**. Each successful background refresh appears as a brief foreground-service activation, ~15-30 seconds. If you see one every 6 hours, the system is running.

3. **You can verify the code yourself.** This is open source. The relevant files are:
   - `android/app/src/main/java/io/bluewallet/bluewallet/ArkBackgroundSchedulerModule.java` — the scheduler
   - `android/app/src/main/java/io/bluewallet/bluewallet/ArkRefreshAlarmReceiver.java` — the wake handler
   - `android/app/src/main/java/io/bluewallet/bluewallet/ArkRefreshHeadlessTaskService.java` — the foreground service
   - `src/services/ark/backgroundRefresh.ts` — the JS-side refresh implementation
   - `ios/.../ArkBackgroundScheduler.swift` — the iOS counterpart

The tradeoff was real and we made it deliberately: AlarmManager + a brief foreground service is more invasive (the user sees "Battery → Unrestricted" required) than a transparent WorkManager-based approach would have been. But the latter doesn't actually work on Android 14 in a way we could responsibly ship for a wallet that holds users' funds. We picked the architecture that actually does the thing it claims to do.

---

## Appendix: a brief catalog of dead ends

For anyone trying to do this themselves and wondering whether they've explored every option — they probably haven't. Here's what we ruled out and why:

| Approach | Why it failed |
| --- | --- |
| `PeriodicWorkRequest` (vanilla) | Cold-spawn dispatch race with WM init; partially fixed in WM 2.10+ but still hits the next layer. |
| `PeriodicWorkRequest` + `Configuration.Provider` | Race avoided, but worker can't `startForegroundService` (Android 14 background-FGS restriction). |
| `OneTimeWorkRequest.setExpedited` | Expedited grants FGS *to the worker itself*, not to services it starts. |
| `OneTimeWorkRequest.setExpedited` + `setInitialDelay` | Rejected at runtime: "Expedited jobs cannot be delayed." |
| Pyramid: expedited doer + non-expedited delayed rearmer | Dispatch chain works, doer cold-fires correctly, but the doer still can't `startForegroundService` (same architectural wall). |
| `cmd jobscheduler run -f` for testing | Bypasses JobScheduler's TIMING_DELAY but not WM's internal periodic-due-time check; gives misleading "rescheduling for later" results that aren't representative of natural firing. |
| `am broadcast` to manually trigger receiver | Doesn't reproduce alarm-fire context; receiver runs without the temp allowlist; same FGS denial. |
| Plain `setExactAndAllowWhileIdle` | Requires `SCHEDULE_EXACT_ALARM` permission, restricted to clocks/reminders. Inappropriate for periodic data sync. |
| Plain `setAndAllowWhileIdle` (final answer) | Works. Inexact (~9-15 min slack) which is fine for a 6-hour cadence. No special permission. Receives temp allowlist on fire. |

If a future Android version closes off the alarm-fired temp-allowlist exemption, the next move would be FCM high-priority push (already partially scaffolded as the relay path). For now, this works.

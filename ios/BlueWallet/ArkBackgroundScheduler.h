// Background-scheduling primitives for the opt-in Ark VTXO refresh.
//
// Uses BGProcessingTask rather than BGAppRefreshTask: a single refresh
// round on mainnet can run into the low minutes under network load,
// which doesn't fit BGAppRefreshTask's ~30s budget. BGProcessingTask
// gives us "longer-running" (typically minutes) at the cost of only
// firing when the device is on charger + idle. The silent-push wake
// path (Phase 3) is the safety net for users who rarely charge.
//
// AppDelegate calls +registerTaskIdentifiers in
// application:didFinishLaunchingWithOptions: BEFORE returning. iOS requires
// task identifiers to be registered during the synchronous launch path —
// registering later results in a hard crash on the next BGTaskScheduler
// submit.
//
// JS-callable surface (RCTBridge) — see ArkBackgroundScheduler.m for
// method bodies:
//
//   schedule(): Promise<void>
//     Submits a BGProcessingTaskRequest with earliestBeginDate = now+6h
//     and requiresNetworkConnectivity + requiresExternalPower set.
//     Idempotent: cancels any existing pending request first. Called from
//     setArkBackgroundRefreshEnabled(true) and from the task launchHandler
//     itself (so each completion re-arms the next wake).
//
//   cancel(): Promise<void>
//     Cancels the pending request. Called from
//     setArkBackgroundRefreshEnabled(false).
//
//   markTaskCompleted(taskId: string, success: bool): void
//     Called by the JS task handler (Phase 1 runBackgroundRefresh) when
//     the round finishes — passes success/failure back to iOS so the OS
//     scheduler can prioritise future wakes appropriately.
//
// Events emitted to JS:
//
//   "ArkBackgroundRefreshTaskFired" — body: { taskId: string }
//     Emitted from the BGTask launchHandler. The JS listener is expected
//     to invoke runBackgroundRefresh('scheduled') and then
//     markTaskCompleted(taskId, success). If JS does not respond within
//     the configured budget, the native side auto-marks failure via the
//     BGTask expirationHandler.

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface ArkBackgroundScheduler : RCTEventEmitter <RCTBridgeModule>

/**
 * Register the BGAppRefreshTask identifier. MUST be called from
 * application:didFinishLaunchingWithOptions: synchronously, before that
 * method returns. Idempotent — safe to call from cold launch and warm
 * relaunch alike.
 */
+ (void)registerTaskIdentifiers;

/**
 * Handle a remote notification that may be the relay's silent
 * "ark.refresh.due" wake. Returns YES if the notification was an Ark
 * refresh trigger (in which case the supplied completion handler is
 * captured by this class and called when the refresh round finishes
 * or times out). Returns NO otherwise — the caller should fall
 * through to its own handling.
 *
 * Schema: a notification matches if userInfo[@"type"] equals
 * @"ark.refresh.due". Other fields are ignored at this layer; the
 * orchestrator does its own eligibility check, so a stale push that
 * fires on a fresh wallet just exits via no_eligible_vtxos.
 */
+ (BOOL)handlePushNotification:(NSDictionary *)userInfo
                withCompletion:(void (^)(UIBackgroundFetchResult))completion;

@end

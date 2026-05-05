#import "ArkBackgroundScheduler.h"
#import <BackgroundTasks/BackgroundTasks.h>

// Identifier matches the JS-side scheduler module + Info.plist
// BGTaskSchedulerPermittedIdentifiers entry. Changing this requires a
// matching change in both other places or BGTaskScheduler will refuse to
// register on next launch.
static NSString * const kArkRefreshTaskID = @"io.cypherbox.ark.refresh";

// Earliest begin date offset for each refresh wake. iOS treats this as a
// hint — the OS may schedule us later (or never) based on phone usage
// patterns. 6h matches the spec; the silent-push path (Phase 3) is the
// safety net behind iOS's unreliable scheduling, particularly important
// here because BGProcessingTask requires charger + idle to fire.
static NSTimeInterval const kArkRefreshIntervalSec = 6 * 60 * 60;

// Hard time budget for the JS task handler to call back with
// markTaskCompleted. BGProcessingTask doesn't publish a strict numeric
// budget — Apple says "minutes." We watchdog at 120s so a stuck
// refresh round can't sit indefinitely in our pending dict. If a real
// mainnet round legitimately takes longer than this, the round is
// likely borked and failing it is the right outcome anyway.
static NSTimeInterval const kArkJsCompletionTimeoutSec = 120;

@interface ArkBackgroundScheduler ()

// taskId (NSUUID string) -> BGTask. Kept on a serial queue to avoid
// races between the JS callback path (markTaskCompleted) and the iOS
// expirationHandler path.
@property (nonatomic, strong) NSMutableDictionary<NSString *, BGTask *> *pendingTasks;

// taskId -> APNs completion block. Used by the silent-push wake path,
// where the OS callback shape is different (UIBackgroundFetchResult,
// not BGTask). Same serial queue gates both dicts.
@property (nonatomic, strong) NSMutableDictionary<NSString *, void (^)(BOOL)> *pendingPushCompletions;

@property (nonatomic, strong) dispatch_queue_t pendingQueue;

@end

@implementation ArkBackgroundScheduler

RCT_EXPORT_MODULE();

#pragma mark - Static registration

+ (void)registerTaskIdentifiers
{
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        if (@available(iOS 13.0, *)) {
            [[BGTaskScheduler sharedScheduler]
                registerForTaskWithIdentifier:kArkRefreshTaskID
                                   usingQueue:nil
                                launchHandler:^(BGTask * _Nonnull task) {
                                    [[ArkBackgroundScheduler sharedInstance] handleArkRefreshTask:task];
                                }];
        }
    });
}

// Singleton accessor. The RN bridge spawns a new module instance on each
// bridge init; the BGTask launchHandler needs a stable reference. We use
// the most-recently-instantiated module if there is one (so JS event
// emission works), and fall back to a process-wide singleton for the
// task-tracking dict.
+ (instancetype)sharedInstance
{
    static ArkBackgroundScheduler *shared = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        shared = [[ArkBackgroundScheduler alloc] init];
    });
    return shared;
}

#pragma mark - Lifecycle

- (instancetype)init
{
    self = [super init];
    if (self) {
        _pendingTasks = [NSMutableDictionary dictionary];
        _pendingPushCompletions = [NSMutableDictionary dictionary];
        _pendingQueue = dispatch_queue_create("io.cypherbox.ark.scheduler", DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

- (NSArray<NSString *> *)supportedEvents
{
    return @[ @"ArkBackgroundRefreshTaskFired" ];
}

#pragma mark - Task handling

- (void)handleArkRefreshTask:(BGTask *)task
{
    if (@available(iOS 13.0, *)) {
        // Always queue the next wake before this one completes. Even if the
        // JS handler errors, the chain stays intact. The OS de-duplicates
        // pending requests with the same identifier, so calling submit
        // twice (here + from JS markTaskCompleted) is fine.
        [self submitNextRefreshRequest];

        NSString *taskId = [[NSUUID UUID] UUIDString];
        dispatch_async(self.pendingQueue, ^{
            self.pendingTasks[taskId] = task;
        });

        // Expiration handler fires when iOS decides our budget is up.
        // Mark failure cleanly so we don't get throttled by the scheduler.
        __weak typeof(self) weakSelf = self;
        task.expirationHandler = ^{
            [weakSelf finalizeTask:taskId success:NO reason:@"expired"];
        };

        // Watchdog: if the JS side never responds (e.g. bridge failed to
        // start, runBackgroundRefresh got stuck), fail before iOS does so
        // we keep our scheduler reputation clean.
        dispatch_after(
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kArkJsCompletionTimeoutSec * NSEC_PER_SEC)),
            self.pendingQueue,
            ^{
                if (self.pendingTasks[taskId] != nil) {
                    [self finalizeTask:taskId success:NO reason:@"js timeout"];
                }
            });

        // Notify JS. If no listeners are attached yet (cold-launch race),
        // the event is dropped — the watchdog above will mark failure.
        // The bridge instance for this module emits to the active JS
        // bundle; we fall back to a no-op if the module wasn't instantiated.
        ArkBackgroundScheduler *liveModule = self;
        [liveModule sendEventWithName:@"ArkBackgroundRefreshTaskFired"
                                 body:@{ @"taskId": taskId }];
    } else {
        // BGTask APIs require iOS 13+. We don't list a Phase-2 fallback for
        // older OS versions — opt-in feature on a current-OS device.
        [task setTaskCompletedWithSuccess:NO];
    }
}

- (void)finalizeTask:(NSString *)taskId success:(BOOL)success reason:(NSString *)reason
{
    dispatch_async(self.pendingQueue, ^{
        BGTask *task = self.pendingTasks[taskId];
        if (task != nil) {
            [self.pendingTasks removeObjectForKey:taskId];
            if (@available(iOS 13.0, *)) {
                [task setTaskCompletedWithSuccess:success];
            }
            NSLog(@"[ArkBg] task %@ finalized success=%d reason=%@", taskId, success, reason);
            return;
        }
        // Not a BGTask — try the silent-push completion path.
        void (^pushCompletion)(BOOL) = self.pendingPushCompletions[taskId];
        if (pushCompletion != nil) {
            [self.pendingPushCompletions removeObjectForKey:taskId];
            pushCompletion(success);
            NSLog(@"[ArkBg] push %@ finalized success=%d reason=%@", taskId, success, reason);
        }
    });
}

#pragma mark - Silent push handling

+ (BOOL)handlePushNotification:(NSDictionary *)userInfo
                withCompletion:(void (^)(UIBackgroundFetchResult))completion
{
    id type = userInfo[@"type"];
    if (![type isKindOfClass:[NSString class]] ||
        ![(NSString *)type isEqualToString:@"ark.refresh.due"]) {
        return NO;
    }
    [[self sharedInstance] handleArkPushWithCompletion:completion];
    return YES;
}

- (void)handleArkPushWithCompletion:(void (^)(UIBackgroundFetchResult))completion
{
    NSString *taskId = [[NSUUID UUID] UUIDString];

    // Translate the BOOL the JS side reports back into the
    // UIBackgroundFetchResult value APNs expects. Treat any clean-exit
    // outcome as NewData so iOS doesn't downgrade our future silent-push
    // delivery priority.
    void (^bridge)(BOOL) = ^(BOOL success) {
        completion(success ? UIBackgroundFetchResultNewData : UIBackgroundFetchResultFailed);
    };

    dispatch_async(self.pendingQueue, ^{
        self.pendingPushCompletions[taskId] = bridge;
    });

    // Silent-push budget is ~30s; watchdog at 25s for the same reason
    // BGAppRefreshTask did before the BGProcessingTask switch. The
    // refresh round itself may not fit, but the orchestrator's
    // imminent-expiry warnings fire BEFORE the round, so a watchdog
    // failure still leaves the user informed.
    __weak typeof(self) weakSelf = self;
    dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(25 * NSEC_PER_SEC)),
        self.pendingQueue,
        ^{
            if (weakSelf.pendingPushCompletions[taskId] != nil) {
                [weakSelf finalizeTask:taskId success:NO reason:@"push js timeout"];
            }
        });

    [self sendEventWithName:@"ArkBackgroundRefreshTaskFired"
                       body:@{ @"taskId": taskId, @"trigger": @"push" }];
}

#pragma mark - Scheduling

- (void)submitNextRefreshRequest
{
    if (@available(iOS 13.0, *)) {
        BGProcessingTaskRequest *request =
            [[BGProcessingTaskRequest alloc] initWithIdentifier:kArkRefreshTaskID];
        request.earliestBeginDate = [NSDate dateWithTimeIntervalSinceNow:kArkRefreshIntervalSec];
        // Need network for ASP + esplora reach. Need external power because
        // BGProcessingTask only honours "long" runs when plugged in — without
        // this we'd get the same ~30s budget as BGAppRefreshTask, defeating
        // the point of the switch.
        request.requiresNetworkConnectivity = YES;
        request.requiresExternalPower = YES;

        NSError *err = nil;
        [[BGTaskScheduler sharedScheduler] submitTaskRequest:request error:&err];
        if (err) {
            // BGErrorCodeUnavailable (=3) is the most common: simulator,
            // Low Power Mode, or background app refresh disabled in
            // Settings. Log and move on — the silent-push path is the
            // intended safety net.
            NSLog(@"[ArkBg] submitTaskRequest err: %@", err);
        }
    }
}

#pragma mark - JS-callable

RCT_REMAP_METHOD(schedule,
                 scheduleWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
    if (@available(iOS 13.0, *)) {
        // Cancel any existing pending request so the earliestBeginDate is
        // pinned to "now+6h" rather than whatever was set previously.
        // BGTaskScheduler dedupes by identifier on submit, but cancel-then-
        // submit is the explicit form.
        [[BGTaskScheduler sharedScheduler] cancelTaskRequestWithIdentifier:kArkRefreshTaskID];
        [self submitNextRefreshRequest];
        resolve(nil);
    } else {
        reject(@"unsupported_os", @"BGTaskScheduler requires iOS 13+", nil);
    }
}

RCT_REMAP_METHOD(cancel,
                 cancelWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
    if (@available(iOS 13.0, *)) {
        [[BGTaskScheduler sharedScheduler] cancelTaskRequestWithIdentifier:kArkRefreshTaskID];
        resolve(nil);
    } else {
        resolve(nil);
    }
}

RCT_EXPORT_METHOD(markTaskCompleted:(NSString *)taskId success:(BOOL)success)
{
    [self finalizeTask:taskId success:success reason:@"js callback"];
}

@end

#import "CypherCloudStorage.h"

#import <React/RCTLog.h>

// The container identifier MUST match:
//   - Info.plist NSUbiquitousContainers key (iCloud.io.cypherbox.btc)
//   - Both entitlements files' icloud-container-identifiers / ubiquity-container-identifiers
//   - The container declared on the io.cypherbox.btc App ID in the Apple Developer portal
// Hard-coded here rather than read from Info.plist because the bridge is
// useless if any of the three diverge — a test against a stale string is
// loud and obvious in a debug console; a runtime read that succeeds against
// the wrong container would silently store backups in the wrong place.
static NSString * const kCypherICloudContainerID = @"iCloud.io.cypherbox.btc";

@implementation CypherCloudStorage

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

/**
 * Resolves the per-device iCloud Drive folder for this app's container.
 *
 * Apple convention: every ubiquity container has a `Documents`
 * subdirectory whose contents the Files app surfaces under iCloud Drive →
 * <NSUbiquitousContainerName>. We create that subdir on first call so
 * subsequent writers don't have to worry about parent existence; the
 * surrounding container itself is created by the OS the moment we ask
 * for its URL with the entitlement in place.
 *
 * Returns nil (resolves null on the JS side) when:
 *   - The user is signed out of iCloud system-wide
 *   - iCloud Drive is off in iOS Settings
 *   - The "Cypher Box" toggle in iCloud Drive's per-app list is off
 *   - The OS hasn't yet provisioned the container (transient — happens
 *     for a few seconds the first time after an entitlement update)
 *
 * URLForUbiquityContainerIdentifier: documented as blocking; Apple says
 * not to call it on the main thread. We dispatch to a background queue
 * so the JS bridge round-trip doesn't stall the JS thread on cold-launch
 * probes (the call has been observed to take 100-1000ms on the first
 * invocation of a process).
 */
RCT_REMAP_METHOD(getICloudDocumentsPath,
                 getICloudDocumentsPathWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSFileManager *fm = [NSFileManager defaultManager];
        NSURL *containerURL = [fm URLForUbiquityContainerIdentifier:kCypherICloudContainerID];
        if (containerURL == nil) {
            resolve([NSNull null]);
            return;
        }

        NSURL *documentsURL = [containerURL URLByAppendingPathComponent:@"Documents" isDirectory:YES];
        NSError *mkdirErr = nil;
        BOOL ok = [fm createDirectoryAtURL:documentsURL
               withIntermediateDirectories:YES
                                attributes:nil
                                     error:&mkdirErr];
        if (!ok) {
            // mkdir failure with the URL in hand is rare — usually means
            // the container directory exists as a regular file, or some
            // other corruption. We surface the error rather than swallow
            // because it indicates an unrecoverable iCloud-side issue;
            // the JS layer treats it the same as null (fall back to local
            // Documents) so user data still gets saved.
            RCTLogWarn(@"[CypherCloudStorage] mkdir Documents failed: %@", mkdirErr);
            reject(@"mkdir-failed",
                   [NSString stringWithFormat:@"Failed to create iCloud Documents directory: %@", mkdirErr.localizedDescription ?: @"unknown error"],
                   mkdirErr);
            return;
        }

        resolve(documentsURL.path);
    });
}

/**
 * Lightweight availability probe. Same null-conditions as
 * getICloudDocumentsPath but skips the Documents-subdir mkdir, so it's
 * safe to call cheaply (e.g. from the Settings → Ark Backup dismiss flow
 * to validate the user's "iCloud Drive is on" assertion).
 *
 * Same off-main-thread dispatch rationale.
 */
RCT_REMAP_METHOD(isICloudAvailable,
                 isICloudAvailableWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject) {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSURL *containerURL = [[NSFileManager defaultManager]
                               URLForUbiquityContainerIdentifier:kCypherICloudContainerID];
        resolve(@(containerURL != nil));
    });
}

@end

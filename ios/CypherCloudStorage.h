// iCloud Drive container access for the Ark backup pipeline.
//
// Cypher Box ships an iCloud Documents container declared in Info.plist
// (NSUbiquitousContainers → iCloud.io.cypherbox.btc) and matched by an
// iCloud entitlement on the bundle ID. When the user has iCloud Drive
// enabled for Cypher Box on their device, the OS provisions a per-device
// folder under ~/Library/Mobile Documents/iCloud~io~cypherbox~btc/ that
// auto-syncs to the user's iCloud Drive. Files written to its Documents
// subdirectory show up in the Files app under iCloud Drive → Cypher Box,
// and on every other Apple device signed into the same Apple ID.
//
// JS-callable surface:
//
//   getICloudDocumentsPath(): Promise<string | null>
//     Returns the absolute filesystem path to the container's Documents
//     subdirectory, creating it if necessary. Resolves to null when iCloud
//     is unavailable on the device — user signed out of iCloud, iCloud
//     Drive globally off, Cypher Box not enabled in iCloud Drive's per-app
//     toggle list, or transient network issues during the first probe of
//     a session. The first call in any process can take a moment because
//     URLForUbiquityContainerIdentifier blocks while the OS sets up the
//     container directory; we run that on a background queue.
//
//   isICloudAvailable(): Promise<bool>
//     Cheap probe — no Documents-dir mkdir, no caching. Returns whether
//     the ubiquity URL would resolve right now. Used by the Settings →
//     Ark Backup dismiss flow to validate the user's "iCloud Drive is on"
//     claim before flipping the persistent reminder flag off.

#import <React/RCTBridgeModule.h>

@interface CypherCloudStorage : NSObject <RCTBridgeModule>

@end

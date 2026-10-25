#import <React/RCTBridgeModule.h>

/**
 * Exposes the App Store storefront country of the signed-in Apple Account
 * as an ISO 3166-1 alpha-3 code ("USA", "GBR").
 *
 * This is the same country App Store Availability is decided by, which is
 * why the region gates in src/services/featureFlags.ts prefer it on iOS
 * over the device region.
 *
 * JS surface (NativeModules.CypherStorefront):
 *   - countryCode            constant, read once at module init, or null
 *   - getCountryCode()       Promise<string | null>, re-reads on demand
 */
@interface CypherStorefront : NSObject <RCTBridgeModule>
@end

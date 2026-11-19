#import "CypherStorefront.h"

#import <StoreKit/StoreKit.h>

/**
 * SKPaymentQueue.storefront is nil when no storefront is available, for
 * example with no Apple Account signed in to the App Store. Callers treat
 * nil as "unknown" and the JS gates fail closed on it.
 */
static NSString *CypherCurrentStorefrontCountry(void) {
    NSString *code = SKPaymentQueue.defaultQueue.storefront.countryCode;
    return code.length > 0 ? code : nil;
}

@implementation CypherStorefront

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

// Read once when the module is first touched, so the JS gate can answer
// synchronously during render without awaiting anything.
- (NSDictionary *)constantsToExport {
    NSString *code = CypherCurrentStorefrontCountry();
    return @{ @"countryCode": code ?: [NSNull null] };
}

// Re-read on demand. The storefront can be unavailable for a moment right
// after launch, and the constant above is fixed for the module's lifetime.
RCT_EXPORT_METHOD(getCountryCode:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSString *code = CypherCurrentStorefrontCountry();
    resolve(code ?: [NSNull null]);
}

@end

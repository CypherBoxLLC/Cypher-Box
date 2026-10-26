#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Throwaway POC bridge over Tor.framework (embedded C-Tor).
// Tor-for-Vaults spike only — not production. See .claude/scratch-tor-vaults.md.
@interface TorPoc : RCTEventEmitter <RCTBridgeModule>
@end

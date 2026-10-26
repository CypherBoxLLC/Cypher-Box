#import "TorPoc.h"
// iCepa's Tor pod ships no umbrella header; import the individual public headers.
#import <Tor/TORConfiguration.h>
#import <Tor/TORThread.h>
#import <sys/socket.h>
#import <netinet/in.h>
#import <arpa/inet.h>
#import <unistd.h>

// POC: start embedded Tor, expose a local SOCKS port, report readiness to JS.
// We deliberately do NOT use the Tor control port: on iOS its Unix control
// socket lives under the app container's long tmp path and bumps the ~104-char
// sun_path limit, so the auth cookie never appears. Instead we just wait for the
// SOCKS listener to accept, then the JS harness retries the onion connection
// until Tor has bootstrapped (a successful onion round-trip IS the proof).

@interface TorPoc ()
@property (nonatomic, strong) TORThread *torThread;
@property (nonatomic, strong) TORConfiguration *torConfig;
@property (nonatomic, assign) NSInteger socksPort;
@property (nonatomic, assign) BOOL hasListeners;
@end

@implementation TorPoc

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[@"torStatus"];
}

- (void)startObserving {
  self.hasListeners = YES;
}

- (void)stopObserving {
  self.hasListeners = NO;
}

- (void)emit:(NSString *)stage detail:(NSString *)detail {
  NSLog(@"[TorPoc] %@ %@", stage, detail ?: @"");
  if (self.hasListeners) {
    [self sendEventWithName:@"torStatus" body:@{@"stage": stage, @"detail": detail ?: @""}];
  }
}

RCT_EXPORT_METHOD(start:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
  @try {
    self.socksPort = 39055;

    NSString *dir = [NSTemporaryDirectory() stringByAppendingPathComponent:@"tor-poc"];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:nil];

    TORConfiguration *config = [TORConfiguration new];
    config.ignoreMissingTorrc = YES;
    config.avoidDiskWrites = YES;
    config.clientOnly = YES;
    config.socksPort = (NSUInteger)self.socksPort;  // pins SOCKS to 127.0.0.1:39055
    config.dataDirectory = [NSURL fileURLWithPath:dir];
    self.torConfig = config;

    [self emit:@"starting" detail:@"launching tor thread"];

    self.torThread = [[TORThread alloc] initWithConfiguration:config];
    [self.torThread start];

    // Wait for the SOCKS listener to accept; JS handles bootstrap timing.
    [self waitForSocksAttempt:0 resolve:resolve reject:reject];
  } @catch (NSException *e) {
    reject(@"tor_start_exception", e.reason, nil);
  }
}

- (BOOL)socksPortIsListening {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return NO;
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons((uint16_t)self.socksPort);
  addr.sin_addr.s_addr = inet_addr("127.0.0.1");
  int r = connect(fd, (struct sockaddr *)&addr, sizeof(addr));
  close(fd);
  return r == 0;
}

- (void)waitForSocksAttempt:(NSInteger)attempt
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
  static const NSInteger kMaxAttempts = 60;  // ~60s for the listener to come up

  if ([self socksPortIsListening]) {
    [self emit:@"ready" detail:[NSString stringWithFormat:@"SOCKS up on 127.0.0.1:%ld (try %ld)", (long)self.socksPort, (long)attempt]];
    resolve(@{@"socksPort": @(self.socksPort)});
    return;
  }
  if (attempt >= kMaxAttempts) {
    reject(@"tor_socks_timeout", @"SOCKS port never came up", nil);
    return;
  }
  if (attempt % 5 == 0) {
    [self emit:@"waiting" detail:[NSString stringWithFormat:@"socks not up (try %ld)", (long)attempt]];
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    [self waitForSocksAttempt:attempt + 1 resolve:resolve reject:reject];
  });
}

@end

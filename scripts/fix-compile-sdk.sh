#!/bin/bash
# Fix node_modules with compileSdkVersion too low for AGP 8+
# Run as part of npm run patches

echo "=== Fixing low compileSdkVersion in node_modules ==="

# Portable in-place sed. These patches must apply on dev Macs AND in the Linux
# build container (reproducible build / CI). GNU sed (Linux) uses `sed -i`;
# BSD/macOS sed uses `sed -i ''`. The wrong form silently no-ops, which is how
# the Linux CI build kept hitting unpatched (Gradle-8-incompatible) node_modules.
if sed --version >/dev/null 2>&1; then
  sedi() { sed -i "$@"; }     # GNU / Linux
else
  sedi() { sed -i '' "$@"; }  # BSD / macOS
fi

find node_modules/*/android/build.gradle node_modules/@*/*/android/build.gradle -maxdepth 0 2>/dev/null | while read f; do
  if grep -q "compileSdkVersion [0-9]" "$f" 2>/dev/null; then
    ver=$(grep -o "compileSdkVersion [0-9]*" "$f" | head -1 | awk '{print $2}')
    if [ -n "$ver" ] && [ "$ver" -lt 30 ]; then
      mod=$(echo "$f" | sed 's|node_modules/||' | sed 's|/android/build.gradle||')
      sedi "s/compileSdkVersion $ver/compileSdkVersion 35/" "$f"
      echo "  Fixed $mod: $ver -> 35"
    fi
  fi
done

# Fix Gradle 8 incompatibility: the `classifier` property was removed from the
# Jar task in Gradle 8. react-native-widget-center's androidJavadocJar /
# androidSourcesJar tasks still set `classifier = '...'`, which fails at
# configuration time on this branch (Gradle 8.10.2 / RN 0.76). Rewrite to
# archiveClassifier.set('...'). Idempotent: the grep guard skips the file once
# it has already been rewritten, so re-running postinstall is a no-op.
# NOTE: patch-package is intentionally NOT used here. patches/ holds an inert
# 4.1MB react-native-widget-center patch that captured a whole android/build/
# output tree (1211 stanzas) and would be destructive if applied. This sed is
# the only change widget-center actually needs for Gradle 8.
WIDGET_GRADLE="node_modules/react-native-widget-center/android/build.gradle"
if [ -f "$WIDGET_GRADLE" ] && grep -qE "^[[:space:]]*classifier = '" "$WIDGET_GRADLE"; then
  sedi -E "s/^([[:space:]]*)classifier = '([^']*)'/\1archiveClassifier.set('\2')/" "$WIDGET_GRADLE"
  echo "  Fixed react-native-widget-center: classifier -> archiveClassifier.set()"
fi

# rn-ldk (Lightning Dev Kit): two RN 0.76 / Gradle 8 compile blockers.
#   (1) RnLdk_kotlinVersion=1.3.50 is far too old for AGP 8 / Kotlin 1.9.
#   (2) promise.reject(e.message) passes a String? where reject(String) wants a
#       non-null String, a hard Kotlin type error on RN 0.76. Pass the Throwable
#       overload reject(e) instead. Mirrors patches/rn-ldk+0.8.4.patch, applied
#       here via sed so it survives `npm ci` without patch-package.
RNLDK_PROPS="node_modules/rn-ldk/android/gradle.properties"
if [ -f "$RNLDK_PROPS" ] && grep -q "^RnLdk_kotlinVersion=1.3.50" "$RNLDK_PROPS"; then
  sedi "s/^RnLdk_kotlinVersion=1.3.50/RnLdk_kotlinVersion=1.6.0/" "$RNLDK_PROPS"
  echo "  Fixed rn-ldk: kotlinVersion 1.3.50 -> 1.6.0"
fi
RNLDK_KT="node_modules/rn-ldk/android/src/main/java/com/rnldk/RnLdkModule.kt"
if [ -f "$RNLDK_KT" ] && grep -q "promise.reject(e.message);" "$RNLDK_KT"; then
  sedi "s/promise.reject(e.message);/promise.reject(e);/" "$RNLDK_KT"
  echo "  Fixed rn-ldk: promise.reject(e.message) -> reject(e)"
fi

# react-native-nitro-modules 0.35.6 (pulled in by react-native-mmkv 3.3.3):
# its NitroModulesPackage.kt calls ReactModuleInfo(...) with NAMED args
# (canOverrideExistingModule=, needsEagerInit=, ...). That signature only
# exists in RN >=0.77. RN 0.76.9 exposes a 6-arg ctor with underscore-prefixed
# names and a 7-arg `hasConstants` ctor, so the named call matches neither and
# Kotlin fails overload resolution. Dropping the parameter names makes the call
# POSITIONAL, which binds to whichever 6-arg ctor the installed RN provides
# (same argument meaning), so it works on 0.76 today and still compiles if RN
# is later bumped. This avoids downgrading the mmkv/nitro pair (which would
# churn the lockfile on a dependency that stores auth tokens). nitro's C++
# compiles cleanly against RN 0.76, so this Kotlin call is the only change.
NITRO_KT="node_modules/react-native-nitro-modules/android/src/main/java/com/margelo/nitro/NitroModulesPackage.kt"
if [ -f "$NITRO_KT" ] && grep -q "canOverrideExistingModule = false," "$NITRO_KT"; then
  sedi \
    -e "s/          canOverrideExistingModule = false,/          false,/" \
    -e "s/          needsEagerInit = false,/          false,/" \
    -e "s/          isCxxModule = false,/          false,/" \
    -e "s/          isTurboModule = isTurboModule,/          isTurboModule,/" \
    "$NITRO_KT"
  echo "  Fixed react-native-nitro-modules: ReactModuleInfo named -> positional args"
fi

# lottie-react-native 6.6.0 on RN 0.77 + Kotlin 2.0: ReadableArray.getMap(int)
# became @Nullable in RN 0.77, and Kotlin 2.0 enforces the annotation. The two
# getMap(i) call sites in LottieAnimationViewPropertyManager.kt feed the result
# straight into current.getString(...) (line ~107/108) and parseColorFilter(
# current, ...) (line ~217), both of which want a non-null ReadableMap -> hard
# Kotlin compile errors. Append !! at each getMap(i) site to assert non-null.
# This preserves the EXACT pre-0.77 behavior: the old non-null getMap would have
# thrown NPE on a null array element too, so no semantics change, only the type.
# Idempotent: the `.getMap(i)$` end-of-line anchor stops matching once !! is
# appended (the line then ends in `)!!`, not `)`).
LOTTIE_KT="node_modules/lottie-react-native/android/src/main/java/com/airbnb/android/react/lottie/LottieAnimationViewPropertyManager.kt"
if [ -f "$LOTTIE_KT" ] && grep -qE '\.getMap\(i\)$' "$LOTTIE_KT"; then
  sedi -E 's/\.getMap\(i\)$/.getMap(i)!!/' "$LOTTIE_KT"
  echo "  Fixed lottie-react-native: getMap(i) -> getMap(i)!! (RN 0.77 nullable)"
fi

# react-native-webview 13.6.4 on RN 0.77 + Kotlin 2.0: ReadableArray.getString(int)
# became @Nullable in RN 0.77. RNCWebViewManagerImpl.kt's "loadUrl" command feeds
# args.getString(0) straight into Android's WebView.loadUrl(@NonNull String) ->
# String? vs String mismatch (line ~340). Assert non-null with !!. Same semantics
# as before: a null URL would have crashed loadUrl at runtime anyway, and in
# practice JS always supplies a URL string. Scoped to the loadUrl call ONLY (the
# evaluateJavascriptWithFallback call on the line above takes String? and compiles
# fine, so it must NOT get !!). Idempotent: once rewritten to `(0)!!)` the search
# pattern `(0))` no longer matches.
WEBVIEW_KT="node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewManagerImpl.kt"
if [ -f "$WEBVIEW_KT" ] && grep -q "webView.loadUrl(args.getString(0))" "$WEBVIEW_KT"; then
  sedi 's/webView\.loadUrl(args\.getString(0))/webView.loadUrl(args.getString(0)!!)/' "$WEBVIEW_KT"
  echo "  Fixed react-native-webview: loadUrl(getString(0)) -> getString(0)!! (RN 0.77 nullable)"
fi

# react-native-modal 13.0.1 (latest published; unmaintained) on RN 0.77: modal.js
# componentWillUnmount calls BackHandler.removeEventListener (REMOVED in RN 0.77) ->
# "TypeError: undefined is not a function" the instant any <Modal>/<BottomModal> closes,
# crashing every screen that opens a modal (Hot Vault tabs, etc.). Keep the subscription
# from addEventListener and call .remove(). No newer version exists -> patch the dist JS.
# Idempotent: guarded on the removeEventListener line, which is gone after the first run.
RNMODAL="node_modules/react-native-modal/dist/modal.js"
if [ -f "$RNMODAL" ] && grep -q "BackHandler.removeEventListener('hardwareBackPress', this.onBackButtonPress);" "$RNMODAL"; then
  sedi \
    -e "s/        BackHandler.addEventListener('hardwareBackPress', this.onBackButtonPress);/        this.backButtonSubscription = BackHandler.addEventListener('hardwareBackPress', this.onBackButtonPress);/" \
    -e "s/        BackHandler.removeEventListener('hardwareBackPress', this.onBackButtonPress);/        if (this.backButtonSubscription) this.backButtonSubscription.remove();/" \
    "$RNMODAL"
  echo "  Fixed react-native-modal: BackHandler.removeEventListener -> subscription.remove() (RN 0.77)"
fi

# react-native-share 10.2.1 ShareSheet: same BackHandler.removeEventListener removal ->
# crash when the share sheet opens. JS-only bug, so patch both built outputs (module +
# commonjs) instead of bumping the native dep. Idempotent via the removeEventListener guard.
RNSHARE_M="node_modules/react-native-share/lib/module/components/ShareSheet.js"
if [ -f "$RNSHARE_M" ] && grep -q "BackHandler.removeEventListener('hardwareBackPress', backButtonHandler);" "$RNSHARE_M"; then
  sedi \
    -e "s/    BackHandler.addEventListener('hardwareBackPress', backButtonHandler);/    const _rnsBackSub = BackHandler.addEventListener('hardwareBackPress', backButtonHandler);/" \
    -e "s/      BackHandler.removeEventListener('hardwareBackPress', backButtonHandler);/      _rnsBackSub.remove();/" \
    "$RNSHARE_M"
  echo "  Fixed react-native-share (module): BackHandler.removeEventListener -> subscription.remove()"
fi
RNSHARE_C="node_modules/react-native-share/lib/commonjs/components/ShareSheet.js"
if [ -f "$RNSHARE_C" ] && grep -q "_reactNative.BackHandler.removeEventListener('hardwareBackPress', backButtonHandler);" "$RNSHARE_C"; then
  sedi \
    -e "s/    _reactNative.BackHandler.addEventListener('hardwareBackPress', backButtonHandler);/    const _rnsBackSub = _reactNative.BackHandler.addEventListener('hardwareBackPress', backButtonHandler);/" \
    -e "s/      _reactNative.BackHandler.removeEventListener('hardwareBackPress', backButtonHandler);/      _rnsBackSub.remove();/" \
    "$RNSHARE_C"
  echo "  Fixed react-native-share (commonjs): BackHandler.removeEventListener -> subscription.remove()"
fi

# react-native-push-notification 8.1.1 on targetSdk 35 (API 31+): scheduled local
# notifications use AlarmManager.setExact* which now require SCHEDULE_EXACT_ALARM /
# USE_EXACT_ALARM. We hold neither (both Play-restricted, not auto-granted on API
# 33+), so every scheduled notification threw SecurityException and crashed the
# process (surfaced live by a Strike->Ark swap success notification). These are
# reminders, not alarm-clock events, so fall back to an inexact alarm when
# canScheduleExactAlarms() is false. Idempotent: guarded on the canScheduleExactAlarms marker.
RNPUSH="node_modules/react-native-push-notification/android/src/main/java/com/dieam/reactnativepushnotification/modules/RNPushNotificationHelper.java"
if [ -f "$RNPUSH" ] && ! grep -q "canScheduleExactAlarms" "$RNPUSH"; then
  sedi \
    -e 's/                getAlarmManager().setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireDate, pendingIntent);/                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getAlarmManager().canScheduleExactAlarms()) { getAlarmManager().setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireDate, pendingIntent); } else { getAlarmManager().setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireDate, pendingIntent); }/' \
    -e 's/                getAlarmManager().setExact(AlarmManager.RTC_WAKEUP, fireDate, pendingIntent);/                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getAlarmManager().canScheduleExactAlarms()) { getAlarmManager().setExact(AlarmManager.RTC_WAKEUP, fireDate, pendingIntent); } else { getAlarmManager().set(AlarmManager.RTC_WAKEUP, fireDate, pendingIntent); }/' \
    "$RNPUSH"
  echo "  Fixed react-native-push-notification: exact-alarm SecurityException (targetSdk 35) -> inexact fallback"
fi

# react-native 0.77.3 Fabric leak-tolerance patch: the upstream
# RCTAssert(view.superview == nil) in RCTComponentViewRegistry hard-crashes
# with SIGABRT when any paper-only third-party native view manager attaches
# subviews via `addSubview:` under the Fabric legacy interop. Replace with
# NSLog + Bugsnag notify + skip so users don't crash mid-transaction and we
# still get alerts about future leaking modules. Applied via `patch` rather
# than sed because the change spans multiple lines with special characters.
# Idempotent: `patch --dry-run` first, only apply if it hasn't been applied
# yet. `patch -R --dry-run` would detect already-applied state too.
RNREG="node_modules/react-native/React/Fabric/Mounting/RCTComponentViewRegistry.mm"
RNREG_PATCH="patches/react-native+0.77.3.patch"
if [ -f "$RNREG" ] && [ -f "$RNREG_PATCH" ] && ! grep -q "CypherBox.FabricViewLeak" "$RNREG"; then
  if patch --dry-run -s -p1 < "$RNREG_PATCH" > /dev/null 2>&1; then
    patch -s -p1 < "$RNREG_PATCH"
    echo "  Applied react-native+0.77.3 Fabric leak-tolerance patch"
  else
    echo "  WARN: patches/react-native+0.77.3.patch did not apply cleanly — inspect manually"
  fi
fi

echo "=== Done ==="

# electrum-client: thread an options object into TlsSocketWrapper so callers can
# opt into TLS certificate validation per-server. The library historically
# hardcoded rejectUnauthorized:false, so EVERY Electrum TLS connection accepted
# ANY certificate on the balance/history/fee/broadcast path (CWE-295). The app
# (blue_modules/BlueElectrum.js) now opts into strict validation for the
# bundled first-party peers while leaving user-configured (often self-signed)
# servers permissive. Anchors are SHA-pinned by the lockfile, so FAIL LOUD if
# they disappear: a drifted anchor means the security patch silently skipped.
TLS_WRAP="node_modules/electrum-client/lib/TlsSocketWrapper.js"
EC_CLIENT="node_modules/electrum-client/lib/client.js"
if [ -f "$TLS_WRAP" ]; then
  if grep -q "rejectUnauthorized: false" "$TLS_WRAP"; then
    sedi "s/constructor(tls) {/constructor(tls, options) {/" "$TLS_WRAP"
    sedi "s|this._tls = tls; // dependency injection lol|this._tls = tls; this._options = options \|\| {}; // dependency injection lol|" "$TLS_WRAP"
    sedi "s/rejectUnauthorized: false/rejectUnauthorized: !!this._options.rejectUnauthorized/" "$TLS_WRAP"
    echo "  Patched electrum-client: per-server TLS certificate validation opt-in"
  fi
  if ! grep -q "this._options.rejectUnauthorized" "$TLS_WRAP"; then
    echo "ERROR: electrum-client TLS patch did not apply (anchor drifted; library changed?)" >&2
    exit 1
  fi
fi
if [ -f "$EC_CLIENT" ]; then
  sedi "s/new TlsSocketWrapper(this.tls)/new TlsSocketWrapper(this.tls, options)/" "$EC_CLIENT"
  if ! grep -q "new TlsSocketWrapper(this.tls, options)" "$EC_CLIENT"; then
    echo "ERROR: electrum-client client.js patch did not apply" >&2
    exit 1
  fi
fi

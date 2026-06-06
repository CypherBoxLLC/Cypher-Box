#!/bin/bash
# Fix node_modules with compileSdkVersion too low for AGP 8+
# Run as part of npm run patches

echo "=== Fixing low compileSdkVersion in node_modules ==="

find node_modules/*/android/build.gradle node_modules/@*/*/android/build.gradle -maxdepth 0 2>/dev/null | while read f; do
  if grep -q "compileSdkVersion [0-9]" "$f" 2>/dev/null; then
    ver=$(grep -o "compileSdkVersion [0-9]*" "$f" | head -1 | awk '{print $2}')
    if [ -n "$ver" ] && [ "$ver" -lt 30 ]; then
      mod=$(echo "$f" | sed 's|node_modules/||' | sed 's|/android/build.gradle||')
      sed -i '' "s/compileSdkVersion $ver/compileSdkVersion 35/" "$f"
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
  sed -i '' -E "s/^([[:space:]]*)classifier = '([^']*)'/\1archiveClassifier.set('\2')/" "$WIDGET_GRADLE"
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
  sed -i '' "s/^RnLdk_kotlinVersion=1.3.50/RnLdk_kotlinVersion=1.6.0/" "$RNLDK_PROPS"
  echo "  Fixed rn-ldk: kotlinVersion 1.3.50 -> 1.6.0"
fi
RNLDK_KT="node_modules/rn-ldk/android/src/main/java/com/rnldk/RnLdkModule.kt"
if [ -f "$RNLDK_KT" ] && grep -q "promise.reject(e.message);" "$RNLDK_KT"; then
  sed -i '' "s/promise.reject(e.message);/promise.reject(e);/" "$RNLDK_KT"
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
  sed -i '' \
    -e "s/          canOverrideExistingModule = false,/          false,/" \
    -e "s/          needsEagerInit = false,/          false,/" \
    -e "s/          isCxxModule = false,/          false,/" \
    -e "s/          isTurboModule = isTurboModule,/          isTurboModule,/" \
    "$NITRO_KT"
  echo "  Fixed react-native-nitro-modules: ReactModuleInfo named -> positional args"
fi

echo "=== Done ==="

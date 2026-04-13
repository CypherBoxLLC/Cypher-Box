#!/bin/bash
set -euo pipefail

# assumes 2 env variables: KEYSTORE_FILE_HEX & KEYSTORE_PASSWORD
# NOTE: This script is run from the android/ folder (workflow does cd android first)

echo "=== Setting up keystore ==="

# Create keystore from hex - place directly in app/ folder
echo "$KEYSTORE_FILE_HEX" > cypherbox-release-key.keystore.hex
xxd -plain -revert cypherbox-release-key.keystore.hex > app/cypherbox-release-key.keystore
rm cypherbox-release-key.keystore.hex

# Verify keystore was created
if [ ! -f app/cypherbox-release-key.keystore ]; then
    echo "ERROR: Failed to create keystore file"
    exit 1
fi
echo "Keystore created at: $(pwd)/app/cypherbox-release-key.keystore ($(wc -c < app/cypherbox-release-key.keystore) bytes)"

# Create keystore.properties for build.gradle signing config
cat > keystore.properties <<PROPS
storeFile=cypherbox-release-key.keystore
keyAlias=my-key-alias
storePassword=$KEYSTORE_PASSWORD
keyPassword=$KEYSTORE_PASSWORD
PROPS

echo "=== keystore.properties ==="
grep -v "Password" keystore.properties

# Update versionCode with timestamp (use sed -i '' for macOS BSD sed)
TIMESTAMP=$(date +%s)
sed -i '' "s/versionCode [0-9]*/versionCode $TIMESTAMP/g" app/build.gradle
echo "Set versionCode to $TIMESTAMP"

# Test JS bundle first to catch Metro errors early
echo ""
echo "=== Testing JS Bundle ==="
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output /tmp/test-bundle.js \
  --assets-dest /tmp/test-assets \
  2>&1 | tail -80

if [ ${PIPESTATUS[0]} -ne 0 ]; then
  echo "ERROR: JS bundling failed — see errors above"
  exit 1
fi
echo "JS bundle OK"

# Build release APK
echo ""
echo "=== Building Release APK ==="
./gradlew assembleRelease --no-daemon 2>&1 | tail -80

# Debug: list what was built
echo ""
echo "=== Built files ==="
ls -la ./app/build/outputs/apk/release/ 2>/dev/null || echo "No release dir"

# Find the APK
APK_PATH=$(find ./app/build/outputs/apk/release -name "app-release*.apk" 2>/dev/null | head -1)
if [ -z "$APK_PATH" ]; then
    echo "ERROR: No APK found in outputs"
    exit 1
fi

echo "Found APK at: $APK_PATH"
echo "Build successful!"

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

# Patch signing config in gradle.properties (preserve all existing settings)
# file() in build.gradle resolves relative to the app/ module dir,
# so the path must be just the filename since the keystore is in app/
sed -i '' "s|^MYAPP_RELEASE_STORE_FILE=.*|MYAPP_RELEASE_STORE_FILE=cypherbox-release-key.keystore|" gradle.properties
sed -i '' "s|^MYAPP_RELEASE_KEY_ALIAS=.*|MYAPP_RELEASE_KEY_ALIAS=my-key-alias|" gradle.properties
sed -i '' "s|^MYAPP_RELEASE_STORE_PASSWORD=.*|MYAPP_RELEASE_STORE_PASSWORD=$KEYSTORE_PASSWORD|" gradle.properties
sed -i '' "s|^MYAPP_RELEASE_KEY_PASSWORD=.*|MYAPP_RELEASE_KEY_PASSWORD=$KEYSTORE_PASSWORD|" gradle.properties

echo "=== gradle.properties signing config ==="
grep "^MYAPP_RELEASE" gradle.properties

# Update versionCode with timestamp (use sed -i '' for macOS BSD sed)
TIMESTAMP=$(date +%s)
sed -i '' "s/versionCode [0-9]*/versionCode $TIMESTAMP/g" app/build.gradle
echo "Set versionCode to $TIMESTAMP"

# Build release APK
echo ""
echo "=== Building Release APK ==="
./gradlew assembleRelease --no-daemon 2>&1 | tail -50

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

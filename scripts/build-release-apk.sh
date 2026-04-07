#!/bin/bash


# assumes 2 env variables: KEYSTORE_FILE_HEX & KEYSTORE_PASSWORD


# Create keystore from hex
echo $KEYSTORE_FILE_HEX > cypherbox-release-key.keystore.hex
xxd -plain -revert cypherbox-release-key.keystore.hex > ./android/app/cypherbox-release-key.keystore
rm cypherbox-release-key.keystore.hex

cd android

# Create gradle.properties in android/ with absolute path to keystore
cat > gradle.properties << PROPS
# Project-wide Gradle settings.
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m
org.gradle.parallel=true
android.useAndroidX=true
android.enableJetifier=true
hermesEnabled=true
newArchEnabled=false

# Override signing config - use absolute path from android/ folder
MYAPP_RELEASE_STORE_FILE=app/cypherbox-release-key.keystore
MYAPP_RELEASE_KEY_ALIAS=cypherbox
MYAPP_RELEASE_STORE_PASSWORD=$KEYSTORE_PASSWORD
MYAPP_RELEASE_KEY_PASSWORD=$KEYSTORE_PASSWORD
PROPS

# Update versionCode with timestamp
TIMESTAMP=$(date +%s)
sed -i "s/versionCode [0-9]*/versionCode $TIMESTAMP/g" app/build.gradle

# Build release APK
echo "=== Building Release APK ==="
./gradlew assembleRelease --no-daemon 2>&1 | tail -30

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

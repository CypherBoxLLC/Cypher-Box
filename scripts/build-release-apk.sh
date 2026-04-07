#!/bin/bash


# assumes 2 env variables: KEYSTORE_FILE_HEX & KEYSTORE_PASSWORD


# Create keystore from hex
echo $KEYSTORE_FILE_HEX > cypherbox-release-key.keystore.hex
xxd -plain -revert cypherbox-release-key.keystore.hex > ./android/cypherbox-release-key.keystore
rm cypherbox-release-key.keystore.hex

cd android

# Directly update gradle.properties with correct values
cat > gradle.properties << PROPS
# Project-wide Gradle settings.
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m
org.gradle.parallel=true
android.useAndroidX=true
android.enableJetifier=true
hermesEnabled=true
newArchEnabled=false
MYAPP_RELEASE_STORE_FILE=cypherbox-release-key.keystore
MYAPP_RELEASE_KEY_ALIAS=cypherbox
MYAPP_RELEASE_STORE_PASSWORD=$KEYSTORE_PASSWORD
MYAPP_RELEASE_KEY_PASSWORD=$KEYSTORE_PASSWORD
PROPS

# Update versionCode with timestamp
TIMESTAMP=$(date +%s)
sed -i "s/versionCode [0-9]*/versionCode $TIMESTAMP/g" app/build.gradle

# Build release APK
./gradlew assembleRelease --no-daemon

# Debug: list what was built
echo "=== Built files ==="
ls -la ./app/build/outputs/apk/release/ || echo "No release directory"

# Find the APK
APK_PATH=$(find ./app/build/outputs/apk/release -name "*.apk" 2>/dev/null | head -1)
if [ -z "$APK_PATH" ]; then
    echo "ERROR: No APK found in outputs"
    exit 1
fi

# Rename if needed
if [ "$APK_PATH" != "./app/build/outputs/apk/release/app-release.apk" ]; then
    mv "$APK_PATH" ./app/build/outputs/apk/release/app-release.apk
fi

# Find any available apksigner version
APKSIGNER=$(find $ANDROID_HOME/build-tools -name "apksigner" 2>/dev/null | head -1)
if [ -z "$APKSIGNER" ]; then
    echo "ERROR: No apksigner found"
    exit 1
fi

echo "Using apksigner: $APKSIGNER"
$APKSIGNER sign --ks ./cypherbox-release-key.keystore --ks-pass=pass:$KEYSTORE_PASSWORD ./app/build/outputs/apk/release/app-release.apk

echo "Build successful!"

#!/bin/bash


# assumes 2 env variables: KEYSTORE_FILE_HEX & KEYSTORE_PASSWORD
#
# PS. to turn file to hex and back:
#     $ xxd -plain test.txt > test.hex
#     $ xxd -plain -revert test.hex test2.txt


# Create keystore from hex
echo $KEYSTORE_FILE_HEX > cypherbox-release-key.keystore.hex
xxd -plain -revert cypherbox-release-key.keystore.hex > ./android/cypherbox-release-key.keystore
rm cypherbox-release-key.keystore.hex

cd android

# Update gradle.properties to use our keystore
sed -i'.original' -e "s|MYAPP_RELEASE_STORE_FILE=.*|MYAPP_RELEASE_STORE_FILE=cypherbox-release-key.keystore|" \
                   -e "s|MYAPP_RELEASE_KEY_ALIAS=.*|MYAPP_RELEASE_KEY_ALIAS=cypherbox|" \
                   -e "s|MYAPP_RELEASE_STORE_PASSWORD=.*|MYAPP_RELEASE_STORE_PASSWORD=$KEYSTORE_PASSWORD|" \
                   -e "s|MYAPP_RELEASE_KEY_PASSWORD=.*|MYAPP_RELEASE_KEY_PASSWORD=$KEYSTORE_PASSWORD|" \
                   gradle.properties

# Update versionCode with timestamp
TIMESTAMP=$(date +%s)
sed -i'.original' "s/versionCode 1/versionCode $TIMESTAMP/g" app/build.gradle

# Build release APK
./gradlew assembleRelease --no-daemon

# Debug: list what was built
echo "=== Built files ==="
ls -la ./app/build/outputs/apk/release/ || echo "No release directory"

# Find the APK
APK_PATH=$(find ./app/build/outputs/apk/release -name "*.apk" 2>/dev/null | head -1)
if [ -z "$APK_PATH" ]; then
    echo "ERROR: No APK found in outputs"
    # Try debug build
    echo "Trying debug build..."
    ./gradlew assembleDebug --no-daemon
    APK_PATH=$(find ./app/build/outputs/apk/debug -name "*.apk" 2>/dev/null | head -1)
    if [ -z "$APK_PATH" ]; then
        echo "ERROR: No APK found in debug outputs either"
        exit 1
    fi
fi

# Rename if needed
if [ "$APK_PATH" != "./app/build/outputs/apk/release/app-release.apk" ]; then
    mkdir -p ./app/build/outputs/apk/release/
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

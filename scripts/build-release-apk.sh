#!/bin/bash


# assumes 2 env variables: KEYSTORE_FILE_HEX & KEYSTORE_PASSWORD
#
# PS. to turn file to hex and back:
#     $ xxd -plain test.txt > test.hex
#     $ xxd -plain -revert test.hex test2.txt


echo $KEYSTORE_FILE_HEX > cypherbox-release-key.keystore.hex
xxd -plain -revert cypherbox-release-key.keystore.hex > ./android/cypherbox-release-key.keystore
rm cypherbox-release-key.keystore.hex

cd android
TIMESTAMP=$(date +%s)
sed -i'.original'  "s/versionCode 1/versionCode $TIMESTAMP/g" app/build.gradle
./gradlew assembleRelease

# Debug: list what was built
echo "=== Built files ==="
ls -la ./app/build/outputs/apk/release/

# Find the APK
APK_PATH=$(find ./app/build/outputs/apk/release -name "*.apk" | head -1)
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

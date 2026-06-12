# Building Cypher Box

Cypher Box is a React Native (RN 0.76, New Architecture) Bitcoin wallet. This
document covers the Android and iOS builds, and the **reproducible** Android
build path that lets anyone verify a Play Store release rebuilds from source
(security-plan §11.1, walletscrutiny goal §13).

Android reproducibility is a goal. iOS reproducibility is not (Apple re-signs
on ingest, which makes byte-for-byte reproduction intractable); for iOS we
publish the source commit SHA only.

---

## 1. Pinned toolchain

| Component | Version | Source of truth |
|---|---|---|
| JDK | Temurin 17 (LTS) | `android/*` compiled with 17 |
| Gradle | 8.10.2 | `android/gradle/wrapper/gradle-wrapper.properties` |
| Android Gradle Plugin | 8.6.0 | resolved via the RN gradle plugin |
| Kotlin | 1.9.25 | `android/build.gradle` (`ext.kotlinVersion`) |
| compileSdk / targetSdk | 35 / 34 | `android/build.gradle` |
| minSdk | 24 | `android/build.gradle` |
| build-tools | 35.0.0 | `android/build.gradle` |
| NDK | 26.1.10909125 | `android/build.gradle` (`ext.ndkVersion`) |
| CMake | 3.22.1 | RN 0.76 default |
| Node | 22.22.3 (LTS) | dev pin `node@22` (see `CLAUDE.md`) |

> The security plan §11.1 names build-tools 34.0.0 and Node 18.x. Two
> intentional deviations: the project compiles against **SDK 35**, and **Node
> 18 is EOL (2025-04)** while RN 0.76's hermes post-build tooling is validated
> on `node@22` in this repo. The pinned versions above are the real ones.

---

## 2. Prerequisites (local dev build)

- macOS or Linux, Android SDK at `$ANDROID_HOME` (`~/Library/Android/sdk` on macOS).
- JDK 17 (`brew install openjdk@17`), Node 22 (`brew install node@22`).
- `android/local.properties` with `sdk.dir=$ANDROID_HOME` (gitignored; recreate
  with `echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties`).
- Install JS deps with **`npm ci`** only (never bare `npm install` - see
  `CLAUDE.md`). `npm ci`'s `postinstall` runs `scripts/fix-compile-sdk.sh`,
  which applies the node_modules source fixes described in §5.

---

## 3. Android - standard build

Always run codegen first (RN 0.76 has a cold-build `build.ninja` race):

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd android
./gradlew :app:generateCodegenArtifactsFromSchema -PreactNativeArchitectures=arm64-v8a
```

**Debug APK** (needs Metro running + `adb reverse tcp:8081 tcp:8081`):

```sh
./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

**Release AAB / APK** (JS bundled + Hermes; unsigned unless `keystore.properties`
is present, see §6):

```sh
./gradlew :app:bundleRelease   -PreactNativeArchitectures=arm64-v8a   # -> app-release.aab
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a   # -> app-release-unsigned.apk
```

Default to `arm64-v8a` only; the full ABI matrix quadruples build time for ABIs
almost no device uses.

---

## 4. Android - reproducible build (Docker)

The reproducible path builds an **unsigned** release AAB inside a pinned
container. **No signing key ever enters the container or the build** (§5.2).

```sh
make repro-build     # one build -> ./out/app-release.aab + its SHA-256
make repro-verify    # build twice, assert the two SHA-256s match
```

- `Dockerfile.build` pins the whole toolchain (see §1). SDK packages are
  installed with `sdkmanager`, which integrity-checks each one.
- `make repro-build` mounts the repo read-only at `/src`, copies it into a
  writable build dir (including `.git`, so the bundled `current-branch.json` /
  `release-notes.json` are deterministic for a tagged checkout - see §7), runs
  `npm ci`, then `:app:bundleRelease`.

> Status: these artifacts are authored but **not yet validated on a Docker
> host** (Docker was not available on the authoring machine). Before this is the
> canonical release path, complete the three `HARDENING TODO` items in
> `Dockerfile.build` (pin the base image by digest, verify the cmdline-tools
> sha256, pin the apt repo) and confirm `make repro-verify` reports `MATCH`.

---

## 5. node_modules source fixes (`scripts/fix-compile-sdk.sh`)

This branch needs a handful of small source fixes in third-party packages to
build on RN 0.76 / Gradle 8. They are applied deterministically at
`postinstall` time by `scripts/fix-compile-sdk.sh` (idempotent seds), so they
survive `npm ci` and run identically in the container:

1. **compileSdkVersion** bumped to 35 in any lib still pinning < 30 (AGP 8).
2. **react-native-widget-center** - `classifier = '...'` -> `archiveClassifier.set('...')` (the `classifier` Jar property was removed in Gradle 8).
3. **rn-ldk** - `RnLdk_kotlinVersion` 1.3.50 -> 1.6.0, and `promise.reject(e.message)` -> `promise.reject(e)` (String? vs String on RN 0.76).
4. **react-native-nitro-modules** - `ReactModuleInfo(...)` named args -> positional, so it binds to RN 0.76's constructor (the named form only exists on RN >= 0.77). This keeps the `react-native-mmkv` / `nitro-modules` pair on their locked versions.

> `patch-package` is intentionally **not** used. The `patches/` directory
> contains two multi-megabyte patches (`react-native-widget-center`,
> `react-native-gesture-handler`) that accidentally captured whole
> `android/build/` output trees and would be destructive if applied. Treat
> `patches/` as inert; the fixes above are the authoritative source.

---

## 6. Signing (manual, off the build host - security-plan §4.2)

The release build is **unsigned** unless `android/keystore.properties` exists
(`rootProject.file("keystore.properties")` resolves under `android/`). CI,
container, and reproducible builds run without it. Signing is a separate manual
step on the release machine:

1. Decrypt the upload key into tmpfs (never to disk):
   `age -d -i <yubikey-identity> cypherbox-upload-key.jks.age > /dev/shm/upload.jks`
2. Sign the unsigned APK/AAB with `apksigner` (`$ANDROID_HOME/build-tools/35.0.0/apksigner`):
   ```sh
   apksigner sign --ks /dev/shm/upload.jks \
     --ks-pass pass:"$KS_PASS" --key-pass pass:"$KEY_PASS" \
     --in app-release-unsigned.apk --out app-release.apk
   ```
   (`$KS_PASS` / `$KEY_PASS` read from `pass`, never echoed.) For an AAB, sign
   with `jarsigner`, or let Play App Signing re-sign (Google holds the app key;
   the upload key only authorises the upload).
3. `shred -u /dev/shm/upload.jks`.

`android/keystore.properties` and `*.jks` are gitignored and must never be
committed (verified: nothing matching is tracked). Per-release, publish: source commit
SHA, container image digest, and the SHA-256 of the unsigned AAB.

---

## 7. Determinism notes (open items for walletscrutiny MATCH)

`make repro-verify` (build-twice-same-commit) is deterministic for the items
handled in `Dockerfile.build` (UTC, `C.UTF-8`, `SOURCE_DATE_EPOCH=0`, no
daemon). For a third party to rebuild a **published tag** and MATCH (§11.2),
these still need closing:

- **`.env` -> BuildConfig.** `android/app/build.gradle` bakes `.env` values
  (e.g. `GOOGLE_WEB_CLIENT_ID`) into BuildConfig via `dotenv.gradle`. `.env` is
  per-machine and gitignored, so a third-party rebuild without it differs. The
  web client ID is non-secret; commit a deterministic `.env` (or hardcode the
  constant) for release builds so this field is stable.
- **Inlined secrets (`secrets.ts` x2).** The JS bundle inlines the Second.tech
  bark access token (`src/services/ark/secrets.ts`) and the push-relay key
  (`blue_modules/secrets.ts`), both gitignored. Fresh checkouts fall back to
  the committed `.example` placeholders (Makefile `CONTAINER_BUILD` and
  `walletscrutiny/build.sh`), so the build completes and determinism is
  checkable with no secret present. An auditor can insert their own
  Second.tech token for a *functional* mainnet build - see
  `walletscrutiny/README.md`, "Inlined config inputs". A byte-match against
  the Play binary additionally requires the production values in the rebuild;
  whether to publish them is an open release decision.
- **`current-branch.json` / `release-notes.json`** are generated from git at
  `postinstall` and bundled (consumed by `screen/settings/about.js`). They are
  deterministic only when the build runs from the **exact signed tag** (with
  `.git` present). Always build releases from the tag, not a branch tip; or
  freeze + commit them per tag (security-plan §5.4).
- **Base image digest** and **cmdline-tools sha256** - see `Dockerfile.build`
  TODOs 1-2.

---

## 8. iOS (not reproducible)

- Min deployment target iOS 15.1 (RN 0.76).
- Pin Xcode's Node to `node@22` in `ios/.xcode.env.local` (gitignored):
  `echo 'export NODE_BINARY=/opt/homebrew/opt/node@22/bin/node' > ios/.xcode.env.local`
  (RN 0.76's hermes script crashes on Node 25/26).
- `cd ios && pod install`, then archive in Xcode. Apple re-signs on upload, so
  we publish the source commit SHA only.

---

## 9. Verifying a published Android build

Once `make repro-verify` reports `MATCH` and the determinism items in §7 are
closed, a third party can rebuild a tag and compare against the Play Store APK
(modulo the signature block, which `apksigner verify` / `diffoscope` strip).
The walletscrutiny verifier for this lives at `walletscrutiny/build.sh`
(see `walletscrutiny/README.md`).
(security-plan §11.2).

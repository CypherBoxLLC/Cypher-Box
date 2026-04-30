# Claude / LLM guardrails

This repo is a React Native Bitcoin wallet (BlueWallet fork). Most LLM-caused damage comes from misjudging the build environment, not the code. Read this before running shell commands.

## Branch landscape — these have *different* native build environments

| Branch | RN | Arch | Realm | Gradle | What it is |
|---|---|---|---|---|---|
| `main` / `CB-Production` | 0.72.10 | Old | 12.6.0 | 7.6 | Live production code |
| `CB-Ark` | 0.76.x | **New** | 12.14.2 | **8.10.2** | Active dev — Bark/Ark integration |
| `Bam-development` | 0.72.10 | Old | 12.6.0 | 7.6 | Pre-merge staging |

The native toolchains are *not* cross-compatible. Switching branches without rebuilding will corrupt state.

## Do not delete Gradle caches casually

`~/.gradle/caches/<version>/` directories look like wasted disk but each one corresponds to a Gradle version a branch *needs*. Specifically:

- `~/.gradle/caches/7.6/` — used by `main` / Bam-development (RN 0.72)
- `~/.gradle/caches/8.10.2/` — used by `CB-Ark` (RN 0.76)

Deleting either to free disk forces a full ~6 GB redownload + a 10–20 minute clean rebuild on next build. **Before deleting, check which branch the user is actively building.** If you must free space, prefer:

1. `~/.gradle/caches/transforms-3/` (rebuilds from `modules-2`, ~5 min recovery)
2. Old `node_modules/*/android/build/` and `node_modules/*/.cxx/` directories
3. `~/Library/Developer/Xcode/DerivedData/`
4. `android/app/build/` and `android/build/`

Never delete an in-use Gradle version cache without explicit user confirmation.

## Android build hygiene

- **Default to arm64-v8a only for device builds**: `./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a`. The full `armeabi-v7a,arm64-v8a,x86,x86_64` matrix from `gradle.properties` quadruples build time and almost no one uses the other ABIs.
- **CMake codegen race on cold builds (RN 0.76)**: `assemble*` can fail with `ninja: error: loading 'build.ninja': No such file`. Fix: run `./gradlew :app:generateCodegenArtifactsFromSchema` first, then `assemble*`.
- **Stale daemon after wiping caches**: if a build fails referencing a deleted `transforms-3/<hash>/` path, run `./gradlew --stop`, delete `android/.gradle/`, `android/build/`, `android/app/build/`, and `find node_modules -name .cxx -prune -exec rm -rf {} +`, then rebuild.
- **`android/local.properties` is gitignored** — recreate with `echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties` if missing.
- **`adb reverse tcp:8081 tcp:8081`** is required for physical-device debug builds to reach Metro. Reset every time you reconnect the device.

## The 65k-line network_security_config landmine

`android/app/src/main/res/xml/network_security_config.xml` historically enumerated every IP in `192.168.0.0/16` (65,536 entries) because Android's network-security-config doesn't support CIDR. Slow phones (e.g. Galaxy A14 / Exynos 850) ANR during `bindApplication` parsing this. If the file is ever ~65k lines again, that's the cause. Trimmed version covers `192.168.0.x` and `192.168.1.x` only — sufficient for typical home routers.

## Metro

Metro must be started from the same working directory as the APK was built from. Cross-version mismatch (e.g. Metro from `CB-Ark` serving 0.76 bundle to a `main`-built 0.72 APK) produces a clear `React Native version mismatch` error. Kill any existing Metro (`lsof -ti :8081 | xargs kill -9`) before starting a new one from a different branch.

## iOS

- Min deployment target on `CB-Ark` is iOS 15.1 (RN 0.76 requirement).
- Bugsnag v8 on `CB-Ark` is self-contained — no separate `pod 'Bugsnag'` line.
- After branch switch, run `cd ios && pod install` (and check `Podfile.lock` belongs to that branch's RN).

## When in doubt

Ask the user before:
- Deleting any `~/.gradle/caches/*` subdirectory
- Running `git clean -fdx` or wiping `node_modules/`
- Switching branches in a worktree that has uncommitted changes
- Running `./gradlew clean` on `CB-Ark` (long recovery due to CMake recompile)

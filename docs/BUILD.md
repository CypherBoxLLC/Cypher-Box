# Build environment notes

The `BUILD & RUN` section in [README.md](../README.md) is enough for a clean first build. This file is the trail of gotchas, version pins, and recovery procedures that you only learn after stepping on them once. Read it before running anything destructive against the build state.

## Branch landscape

The native build toolchains differ across branches. Switching branches without rebuilding can corrupt build state.

| Branch | RN | Arch | Realm | Gradle | What it is |
|---|---|---|---|---|---|
| `main` / `CB-Production` | 0.72.10 | Old | 12.6.0 | 7.6 | Live production code |
| `CB-Ark` | 0.76.x | **New** | 12.14.2 | **8.10.2** | Active dev — Bark/Ark integration |
| `Bam-development` | 0.72.10 | Old | 12.6.0 | 7.6 | Pre-merge staging |

The toolchains are *not* cross-compatible. After a branch switch, expect to clean and rebuild before the app launches successfully.

## Do not delete Gradle caches casually

`~/.gradle/caches/<version>/` directories look like wasted disk but each one corresponds to a Gradle version that one of the branches needs:

- `~/.gradle/caches/7.6/` — used by `main` / `Bam-development` (RN 0.72)
- `~/.gradle/caches/8.10.2/` — used by `CB-Ark` (RN 0.76)

Deleting either to free disk forces a full ~6 GB redownload + a 10–20 minute clean rebuild on the next build. **Before deleting, check which branch you're actively building.** If you need to free space, prefer (in this order):

1. `~/.gradle/caches/transforms-3/` (rebuilds from `modules-2`, ~5 min recovery)
2. Old `node_modules/*/android/build/` and `node_modules/*/.cxx/` directories
3. `~/Library/Developer/Xcode/DerivedData/`
4. `android/app/build/` and `android/build/`

Never delete an in-use Gradle version cache without a deliberate "I know I'm about to wait 20 minutes" plan.

## Android build hygiene

- **Default to arm64-v8a only for device builds:** `./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a`. The full `armeabi-v7a,arm64-v8a,x86,x86_64` matrix from `gradle.properties` quadruples build time and almost no one uses the other ABIs.
- **CMake codegen race on cold builds (RN 0.76):** `assemble*` can fail with `ninja: error: loading 'build.ninja': No such file`. Fix: run `./gradlew :app:generateCodegenArtifactsFromSchema` first, then `assemble*`.
- **Stale daemon after wiping caches:** if a build fails referencing a deleted `transforms-3/<hash>/` path, run `./gradlew --stop`, delete `android/.gradle/`, `android/build/`, `android/app/build/`, and `find node_modules -name .cxx -prune -exec rm -rf {} +`, then rebuild.
- **`android/local.properties` is gitignored** — recreate with `echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties` if missing.
- **`adb reverse tcp:8081 tcp:8081`** is required for physical-device debug builds to reach Metro. Reset every time you reconnect the device.

## The 65k-line network_security_config landmine

`android/app/src/main/res/xml/network_security_config.xml` historically enumerated every IP in `192.168.0.0/16` (65,536 entries) because Android's network-security-config doesn't support CIDR. Slow phones (e.g. Galaxy A14 / Exynos 850) ANR during `bindApplication` while parsing this. If the file is ever ~65k lines again, that's the cause. The trimmed version covers `192.168.0.x` and `192.168.1.x` only — sufficient for typical home routers.

## Metro

Metro must be started from the same working directory the APK was built from. Cross-version mismatch (e.g. Metro from `CB-Ark` serving a 0.76 bundle to a `main`-built 0.72 APK) produces a clear `React Native version mismatch` error. Kill any existing Metro (`lsof -ti :8081 | xargs kill -9`) before starting a new one from a different branch.

## iOS

- Min deployment target on `CB-Ark` is iOS 15.1 (RN 0.76 requirement).
- Bugsnag v8 on `CB-Ark` is self-contained — no separate `pod 'Bugsnag'` line.
- After a branch switch, run `cd ios && pod install` (and check `Podfile.lock` belongs to that branch's RN).
- **Node version for Xcode build scripts:** RN 0.76's hermes-engine post-build script loads `yargs`, which crashes on Node 25/26 with `TypeError: Cannot read properties of undefined (reading 'hideBin')`. The Xcode build uses `NODE_BINARY` from `ios/.xcode.env.local` (gitignored, per-machine). Pin it to Node 22 LTS:

  ```sh
  brew install node@22
  echo 'export NODE_BINARY=/opt/homebrew/opt/node@22/bin/node' > ios/.xcode.env.local
  ```

  Then `Product → Clean Build Folder` (⇧⌘K) in Xcode before retrying. Symptoms when this is wrong: the hermes-engine Script Phase fails with the yargs error above, and the failure mentions whatever stale Node binary is pinned (e.g. `/opt/homebrew/Cellar/node/25.8.1/bin/node`).

## Safety: stop and think first

These operations are reversible only by waiting out a long rebuild or a full reset. Pause and confirm before running any of them:

- Deleting any `~/.gradle/caches/*` subdirectory
- Running `git clean -fdx` or wiping `node_modules/`
- Switching branches in a worktree that has uncommitted changes
- Running `./gradlew clean` on `CB-Ark` (long recovery due to CMake recompile)

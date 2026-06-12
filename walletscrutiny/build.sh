#!/usr/bin/env bash
#
# walletscrutiny/build.sh
# -----------------------------------------------------------------------------
# Reproducibility verification for Cypher Box (io.cypherbox.btc), following the
# walletscrutiny build.sh contract:
#   https://gitlab.com/walletscrutiny/walletScrutinyCom/-/blob/master/docs/script_verifications.md
#
# Contract:
#   - Receives:  --binary <path>  --version <verName>  --arch <arch>  --type <type>
#   - Requires:  ONLY docker or podman (no sudo, no make, no host JDK/SDK/node).
#   - Emits:     ./COMPARISON_RESULTS.yaml { script_version, verdict, notes }
#                verdict in { reproducible, not_reproducible, ftbfs }.
#
# What it does:
#   Cypher Box ships on Google Play as an AAB; Play re-signs with Google's
#   app-signing key (Play App Signing) and serves per-device split APKs. This
#   script:
#     1. Builds the UNSIGNED release AAB deterministically in the pinned
#        Dockerfile.build image (the same toolchain `make repro-build` uses).
#     2. Derives a universal APK from that AAB with a sha256-pinned bundletool.
#     3. Compares every entry the Play binary serves against that universal APK,
#        IGNORING the v2/v3 signing block, META-INF signature files, Play's
#        stamp-cert, and zip compression (walletscrutiny methodology: "unzip and
#        compare; the diff is only in the compression").
#
# STATUS (read before trusting a verdict):
#   Authored WITHOUT a local Docker host or a real Play APK to test against. It
#   needs one validation pass on a Docker host + a genuine Play download before
#   it is treated as the canonical verifier. The AAB -> served-split comparison
#   is the hard part: Play ships per-device splits, while bundletool's universal
#   APK carries every split's content and a superset resources.arsc. This script
#   compares in the Play -> built direction (every served entry must be
#   reproducible from source; universal-only extras are expected) and flags
#   resources.arsc separately. Refine on a Docker host against real artifacts.
# -----------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS="$SCRIPT_DIR/COMPARISON_RESULTS.yaml"
SCRIPT_VERSION="v0.1.0"
IMAGE="cypherbox-build:repro"

# Pinned bundletool (comparison tool only; NOT part of the reproducible AAB).
# sha256 corroborated against nixpkgs pkgs/by-name/bu/bundletool/package.nix.
BT_VER="1.18.3"
BT_SHA="a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29"

NOTES=""
add_note() { NOTES="${NOTES}${1}"$'\n'; }

write_result() { # $1 = verdict
  {
    echo "script_version: ${SCRIPT_VERSION}"
    echo "verdict: ${1}"
    echo "notes: |"
    printf '%s' "${NOTES}" | sed 's/^/  /'
  } >"${RESULTS}"
  echo "===== ${RESULTS} ====="
  cat "${RESULTS}"
}

die_ftbfs() { add_note "FTBFS: $1"; write_result ftbfs; exit 1; }

# ---- args ----
BINARY="" VERSION="" ARCH="" TYPE=""
while [ $# -gt 0 ]; do
  case "${1:-}" in
    --binary)  BINARY="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --arch)    ARCH="${2:-}"; shift 2 ;;
    --type)    TYPE="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

# ---- container engine (walletscrutiny rule: only docker/podman, no sudo) ----
ENGINE=""
for e in podman docker; do
  if command -v "$e" >/dev/null 2>&1; then ENGINE="$e"; break; fi
done
[ -n "$ENGINE" ] || die_ftbfs "no container engine found (need docker or podman)."

add_note "Cypher Box (io.cypherbox.btc) ships on Google Play as an AAB; Play re-signs"
add_note "with Google's app-signing key and serves per-device split APKs. This script"
add_note "rebuilds the UNSIGNED release AAB in the pinned Dockerfile.build container,"
add_note "derives a universal APK via bundletool ${BT_VER}, and compares every entry the"
add_note "provided binary serves against it, ignoring the signing block, META-INF"
add_note "signature files, Play's stamp-cert, and zip compression."
[ -n "$VERSION" ] && add_note "Requested version: ${VERSION}"
[ -n "$ARCH" ]    && add_note "Requested arch: ${ARCH} (release builds arm64-v8a only)."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---- 1/4 build the pinned image ----
echo "==> [1/4] building image with ${ENGINE}"
"$ENGINE" build -f "$REPO_DIR/Dockerfile.build" -t "$IMAGE" "$REPO_DIR" \
  || die_ftbfs "container image build failed."

# ---- 2/4 build the unsigned release AAB (keep in sync with Makefile CONTAINER_BUILD) ----
# Fresh clones have no gitignored secrets.ts / .env; fall back to the committed
# .example templates so the build always completes. An auditor who wants a
# FUNCTIONAL Ark build inserts their own Second.tech token into
# src/services/ark/secrets.ts before running (see README.md, "Inlined config
# inputs"). The codegen prestep avoids RN's cold-build CMake race.
echo "==> [2/4] building unsigned release AAB"
"$ENGINE" run --rm -v "$REPO_DIR":/src:ro -v "$WORK":/out "$IMAGE" \
  bash -euo pipefail -c '
    cp -a /src /build/repo && cd /build/repo
    SRC=""
    if [ -f blue_modules/secrets.ts ]; then SRC="$SRC blue_modules/secrets.ts:provided"; else cp blue_modules/secrets.example.ts blue_modules/secrets.ts; SRC="$SRC blue_modules/secrets.ts:example"; fi
    if [ -f src/services/ark/secrets.ts ]; then SRC="$SRC ark/secrets.ts:provided"; else cp src/services/ark/secrets.example.ts src/services/ark/secrets.ts; SRC="$SRC ark/secrets.ts:example"; fi
    if [ -f .env ]; then SRC="$SRC .env:provided"; else cp .env.example .env; SRC="$SRC .env:example"; fi
    echo "$SRC" > /out/inlined-inputs.txt
    rm -rf node_modules android/app/build android/build android/.gradle
    npm ci
    ./android/gradlew -p android :app:generateCodegenArtifactsFromSchema
    ./android/gradlew -p android :app:bundleRelease -PreactNativeArchitectures=arm64-v8a
    cp android/app/build/outputs/bundle/release/app-release.aab /out/app-release.aab
  ' || die_ftbfs "gradle :app:bundleRelease failed in container."

AAB_SHA="$("$ENGINE" run --rm -v "$WORK":/out "$IMAGE" sha256sum /out/app-release.aab | awk '{print $1}')"
add_note "Built unsigned AAB sha256: ${AAB_SHA}"
add_note "Inlined config inputs:$(cat "$WORK/inlined-inputs.txt" 2>/dev/null || echo ' unknown')"
add_note "The app compiles config values into the binary (Second.tech bark access"
add_note "token + push-relay key in the JS bundle, .env web client ID in BuildConfig)."
add_note "If those inputs differ from the production build's values, the bundle"
add_note "differs by exactly those constants even when the toolchain output is"
add_note "otherwise reproducible. See walletscrutiny/README.md."

# ---- 3/4 AAB -> universal APK via pinned bundletool (inside the image) ----
echo "==> [3/4] deriving universal APK via bundletool ${BT_VER}"
"$ENGINE" run --rm -v "$WORK":/out "$IMAGE" bash -euo pipefail -c "
  cd /out
  curl -fsSLo bundletool.jar https://github.com/google/bundletool/releases/download/${BT_VER}/bundletool-all-${BT_VER}.jar
  echo '${BT_SHA}  bundletool.jar' | sha256sum -c -
  AAPT2=\$(ls \"\$ANDROID_HOME\"/build-tools/35.0.0/aapt2)
  java -jar bundletool.jar build-apks --bundle=app-release.aab --output=built.apks \
    --mode=universal --aapt2=\"\$AAPT2\"
  unzip -o -p built.apks universal.apk > built-universal.apk
" || die_ftbfs "bundletool AAB->APK conversion failed."

BUILT="$WORK/built-universal.apk"
[ -s "$BUILT" ] || die_ftbfs "no universal APK produced."

# ---- 4/4 compare against --binary (content-level, ignoring sig + compression) ----
echo "==> [4/4] comparing against --binary"
if [ -z "$BINARY" ]; then
  add_note "No --binary provided: built and hashed the AAB only (no comparison)."
  add_note "Re-run with --binary <Play APK or split-APK dir> for a verdict."
  write_result ftbfs
  exit 0
fi

# Resolve --binary to one APK: a file, or base*.apk / the lone .apk in a dir.
PLAY_APK=""
if [ -f "$BINARY" ]; then
  PLAY_APK="$BINARY"
elif [ -d "$BINARY" ]; then
  PLAY_APK="$(ls "$BINARY"/base*.apk 2>/dev/null | head -n1 || true)"
  [ -n "$PLAY_APK" ] || PLAY_APK="$(ls "$BINARY"/*.apk 2>/dev/null | head -n1 || true)"
  add_note "--binary is a directory of split APKs; compared the base APK"
  add_note "(${PLAY_APK##*/}). Density/ABI/language config splits are generated by"
  add_note "Google from the same AAB and are out of scope for this comparison."
fi
[ -n "$PLAY_APK" ] && [ -f "$PLAY_APK" ] || die_ftbfs "could not resolve an APK from --binary."

# Extract an APK, drop signature + Play-injected + build-metadata entries, and
# emit "<sha256>  <relpath>" for every remaining entry. Decompression is what
# normalizes the zip-compression-only differences.
norm_manifest() { # $1 = apk, $2 = extract dir  -> stdout manifest
  local apk="$1" out="$2"
  mkdir -p "$out"
  ( cd "$out" && unzip -qq -o "$apk" >/dev/null )
  find "$out" -type f \( \
       -path '*/META-INF/*.RSA' -o -path '*/META-INF/*.SF' -o -path '*/META-INF/*.MF' \
    -o -path '*/META-INF/*.version' -o -path '*/META-INF/MANIFEST.MF' \
    -o -path '*/META-INF/com/android/build/*' -o -name 'stamp-cert-sha256' \
    \) -delete 2>/dev/null || true
  ( cd "$out" && find . -type f | LC_ALL=C sort | while read -r f; do
      printf '%s  %s\n' "$(sha256sum "$f" | awk '{print $1}')" "${f#./}"
    done )
}

PLAY_M="$WORK/play.manifest"
BUILT_M="$WORK/built.manifest"
norm_manifest "$PLAY_APK" "$WORK/x-play"  >"$PLAY_M"
norm_manifest "$BUILT"    "$WORK/x-built" >"$BUILT_M"

# Play -> built: every entry Google served must be reproducible from source.
# Extra entries in the universal APK are other devices' splits and are expected.
DIFFS=""
ARSC_ONLY=1
while read -r hash path; do
  built_hash="$(awk -v p="$path" '$2==p {print $1; exit}' "$BUILT_M")"
  if [ -z "$built_hash" ]; then
    DIFFS="${DIFFS}  missing-from-build: ${path}"$'\n'; ARSC_ONLY=0
  elif [ "$built_hash" != "$hash" ]; then
    DIFFS="${DIFFS}  differs: ${path}"$'\n'
    [ "$path" = "resources.arsc" ] || ARSC_ONLY=0
  fi
done <"$PLAY_M"

if [ -z "$DIFFS" ]; then
  add_note "MATCH: every served entry is byte-identical to the built universal APK"
  add_note "after ignoring signatures and compression."
  write_result reproducible
elif [ "$ARSC_ONLY" = "1" ]; then
  add_note "Only resources.arsc differs. This is expected when comparing a served"
  add_note "base/split APK against a bundletool *universal* APK: the universal arsc"
  add_note "carries every config, the served arsc is filtered. NOT a reproducibility"
  add_note "failure on its own, but it must be confirmed by building the matching"
  add_note "split (bundletool --mode=default + device spec) on a Docker host."
  add_note "Differences:"
  add_note "$(printf '%s' "$DIFFS")"
  write_result not_reproducible
else
  add_note "DIFFER: served entries are not all reproducible from source."
  add_note "First differences (path):"
  add_note "$(printf '%s' "$DIFFS" | head -n 40)"
  write_result not_reproducible
fi

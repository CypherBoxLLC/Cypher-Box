# Cypher Box - reproducible Android build (security-plan §11.1)
#
# `make repro-build`  : build a deterministic UNSIGNED release AAB in the pinned
#                       Docker container (Dockerfile.build), output to ./out,
#                       print its SHA-256. No signing key is ever used (§5.2).
# `make repro-verify` : run the build TWICE and assert the two AAB SHA-256s
#                       match. A mismatch is a determinism bug to fix (§11.1).
#
# Signing + Play upload are deliberately NOT here - they are a separate manual
# step on the release machine with the YubiKey-protected key (§4.2). See BUILD.md.

IMAGE   := cypherbox-build:repro
OUT     := $(CURDIR)/out
# The cmdline-tools sha256 is pinned in Dockerfile.build (ARG default). Set this
# only to OVERRIDE it, e.g. when bumping CMDLINE_TOOLS_VERSION:
#   make repro-image CMDLINE_TOOLS_SHA256=<new-sha>
# When unset, no --build-arg is passed at all - passing an empty value would
# override the pinned default and silently skip the integrity check.
CMDLINE_TOOLS_SHA256 ?=

# The build steps run INSIDE the container. The repo (incl. .git, so the
# generated current-branch.json / release-notes.json are deterministic for a
# tagged checkout) is copied out of the read-only mount into a writable dir;
# node_modules + prior build output are dropped so the build starts clean.
CONTAINER_BUILD := set -euo pipefail; \
  cp -a /src /build/repo; \
  cd /build/repo; \
  [ -f blue_modules/secrets.ts ] || cp blue_modules/secrets.example.ts blue_modules/secrets.ts; \
  [ -f src/services/ark/secrets.ts ] || cp src/services/ark/secrets.example.ts src/services/ark/secrets.ts; \
  [ -f .env ] || cp .env.example .env; \
  rm -rf node_modules android/app/build android/build android/.gradle; \
  npm ci; \
  ./android/gradlew -p android :app:generateCodegenArtifactsFromSchema; \
  ./android/gradlew -p android :app:bundleRelease -PreactNativeArchitectures=arm64-v8a; \
  mkdir -p /out; \
  cp android/app/build/outputs/bundle/release/app-release.aab /out/app-release.aab; \
  sha256sum /out/app-release.aab

.PHONY: repro-image repro-build repro-verify repro-shell clean-out

repro-image:
	docker build -f Dockerfile.build \
	  $(if $(CMDLINE_TOOLS_SHA256),--build-arg CMDLINE_TOOLS_SHA256=$(CMDLINE_TOOLS_SHA256)) \
	  -t $(IMAGE) .

# One reproducible build -> ./out/app-release.aab (+ printed SHA-256).
repro-build: repro-image
	@mkdir -p $(OUT)
	docker run --rm \
	  -v "$(CURDIR)":/src:ro \
	  -v "$(OUT)":/out \
	  $(IMAGE) bash -c '$(CONTAINER_BUILD)'
	@echo "==> Unsigned release AAB + SHA-256:"
	@shasum -a 256 $(OUT)/app-release.aab

# Build twice and compare. The whole point of §11.1: same source -> same bytes.
repro-verify: repro-image
	@mkdir -p $(OUT)
	@echo "==> build 1/2"
	docker run --rm -v "$(CURDIR)":/src:ro -v "$(OUT)":/out $(IMAGE) bash -c '$(CONTAINER_BUILD)'
	@cp $(OUT)/app-release.aab $(OUT)/app-release.1.aab
	@echo "==> build 2/2"
	docker run --rm -v "$(CURDIR)":/src:ro -v "$(OUT)":/out $(IMAGE) bash -c '$(CONTAINER_BUILD)'
	@cp $(OUT)/app-release.aab $(OUT)/app-release.2.aab
	@echo "==> comparing SHA-256 of the two builds:"
	@shasum -a 256 $(OUT)/app-release.1.aab $(OUT)/app-release.2.aab
	@if [ "$$(shasum -a 256 < $(OUT)/app-release.1.aab)" = "$$(shasum -a 256 < $(OUT)/app-release.2.aab)" ]; then \
	  echo "MATCH - build is reproducible"; \
	else \
	  echo "DIFFER - determinism bug; diff the two AABs (unzip + diffoscope) to locate it"; exit 1; \
	fi

repro-shell: repro-image
	docker run --rm -it -v "$(CURDIR)":/src:ro $(IMAGE) bash

clean-out:
	rm -rf $(OUT)

# Bark CLI for Ark debugging

The Ark SDK ([`@secondts/bark-react-native@0.4.1`](../node_modules/@secondts/bark-react-native/package.json)) is a UniFFI binding over a Rust core. The same Rust core ships as a standalone CLI called `bark`. The CLI is the only independent ground-truth path into a wallet's state: the JS SDK opacifies things like `Vtxo.kind` (it returns `Pubkey` / `ServerHtlcRecv` / `ServerHtlcSend` even though the docstrings claim `"board" | "round" | "arkoor"`). When the SDK and the docs disagree, the CLI wins.

**Optional but recommended for Ark work.** Lightning- and Vault-side onboarding does not need it. The CLI is host-side; it is NOT bundled in the app, NOT in `package.json`, and must NOT be confused with the embedded SDK in `node_modules/@secondts/bark-react-native/`.

## Install (Apple Silicon)

The Rust crate version embedded in the SDK is `bark 0.1.3` (see `releaseTag: "v0.4.1+bark.0.1.3"` in [node_modules/@secondts/bark-react-native/package.json](../node_modules/@secondts/bark-react-native/package.json)). Pin the CLI to the same version.

```sh
curl -sL -o /tmp/bark "https://gitlab.com/api/v4/projects/ark-bitcoin%2Fbark/packages/generic/release-assets/bark-0%2E1%2E3/bark-0%2E1%2E3-apple-aarch64"
# Expected sha256: f055f2957126183e905c60aa4e60b880416126717456df9275d676302fcb6a83
shasum -a 256 /tmp/bark
install -m 755 /tmp/bark ~/.local/bin/bark
bark --version   # should print: bark 0.1.3 (79b2011b…)
```

For Intel Macs, swap `apple-aarch64` → `apple-x86_64` (sha `68e0043369edf4f2e9cc6e718097489580d24e054f7059a079c31c3b495fc027`). For other platforms, see the release page: <https://gitlab.com/ark-bitcoin/bark/-/releases/bark-0.1.3>.

If prebuilt binaries aren't available for your platform, fall back to `cargo install --git https://gitlab.com/ark-bitcoin/bark --tag bark-0.1.3 bark`. (The `codeberg.org/ark-bitcoin/bark` URL that appears in some early docs is a stale mirror — the canonical source is GitLab.)

## Common debugging recipes

The wrappers under [scripts/bark/](../scripts/bark) drive these recipes against a desktop datadir. **Never** point them at the on-device datadir or the iCloud-synced one — concurrent SQLite WAL writes between bark and the app corrupt state. Always restore into a temp dir first.

**Decode a VTXO hex** (e.g. one logged from `wallet.allVtxos()` at the SDK boundary):

```sh
scripts/bark/decode.sh <vtxo-hex>
```

This is the answer to "what `kind` is this VTXO really?" — the SDK's JS-side enum is misleading.

**Dump current VTXOs** from a desktop bark wallet:

```sh
export BARK_DATADIR=/tmp/bark-inspect
scripts/bark/vtxos.sh --all          # incl. expired/spent
scripts/bark/vtxos.sh --no-sync      # skip ASP sync (offline triage)
```

**Inspect round state:**

```sh
export BARK_DATADIR=/tmp/bark-inspect
scripts/bark/round-status.sh                 # round help + ASP info + VTXO snapshot
scripts/bark/round-status.sh progress        # drive an in-flight round forward
scripts/bark/round-status.sh cancel          # drop the wallet out of a round (DESTRUCTIVE)
```

Note: bark 0.1.3 does NOT expose a `dev round <id> inspect` subcommand. The wrapper combines the closest available knobs.

**Restore a `.cbark` for inspection** (mirrors `restoreArkBackupBlob` in [src/services/ark/backup.ts](../src/services/ark/backup.ts)):

```sh
export MY_TEST_SEED='word word word ... word'   # name the var so the seed stays out of argv
scripts/bark/restore.sh path/to/ark-backup-<fp>.cbark MY_TEST_SEED
# prints a temp datadir path; use it as BARK_DATADIR for the wrappers above
```

The temp dir contains decrypted wallet state (VTXO commitments, BDK SQLite). Wipe with `rm -rf` when done.

## Hard rules

- **Never** point `BARK_DATADIR` at the live device datadir while the app is running. Concurrent SQLite WAL writes corrupt state. Always restore into a fresh temp dir.
- **Never** add the CLI binary to the app bundle, to `package.json`, or to any user-facing build step. This is a developer-machine tool.
- **Never** confuse `bark` (CLI) with `@secondts/bark-react-native` (the embedded RN binding). The CLI tracks the underlying Rust crate version; the npm package tracks the FFI binding version. They version separately.

## Version drift

The CLI must match the SDK's underlying Rust core. Read it off the `releaseTag` in the SDK's `package.json`. When you bump `@secondts/bark-react-native` in the app, re-pin the CLI:

1. Read the new `releaseTag` (e.g. `v0.4.2+bark.0.1.4` → CLI tag `bark-0.1.4`).
2. Replace the install URL above with the matching release asset.
3. Update this doc with the new version + sha256.

A mismatched CLI will still decode some VTXO formats but may report different `kind` enum values or miss new fields. If decode output looks wrong after an SDK bump, check the CLI version first.

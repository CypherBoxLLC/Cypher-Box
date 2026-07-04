#!/usr/bin/env bash
#
# restore.sh — decrypt a `.cbark` backup into a fresh desktop bark datadir for
# inspection with bark CLI. Pairs with `restoreArkBackupBlob` in
# src/services/ark/backup.ts (same crypto params; see _restore.cjs).
#
# Why this exists:
#   The on-device datadir holds VTXO commitments and presigned forfeits that
#   the seed alone cannot reconstruct. When triaging a wallet, the safest
#   ground-truth path is to grab the user's `.cbark`, decrypt it on the host,
#   and inspect it with `bark` against a throwaway datadir — never against the
#   live device dir, never against the iCloud sync target.
#
# Usage:
#   export MY_TEST_SEED='word word word ... word'
#   scripts/bark/restore.sh path/to/ark-backup-<fp>.cbark MY_TEST_SEED [target-dir]
#
# Arguments:
#   1. <cbark-path>           — the encrypted backup file
#   2. <mnemonic-env-var-name> — the NAME of an env var holding the mnemonic
#                               (we read by name, not value, so the seed
#                               never lands in argv or shell history)
#   3. [target-dir]           — optional; defaults to a unique mktemp dir
#                               under $TMPDIR. Echoed at the end so callers
#                               can do: export BARK_DATADIR=$(restore.sh ...)
#
# Once restore completes, point the other bark scripts at the printed datadir:
#   export BARK_DATADIR=/tmp/bark-inspect.XXXXXX
#   scripts/bark/vtxos.sh --all
#   scripts/bark/round-status.sh
#
# Cleanup is your responsibility — the temp dir contains decrypted wallet
# state (VTXO commitments, BDK SQLite). Wipe with `rm -rf "$BARK_DATADIR"`
# when you're done triaging.

set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
    echo "usage: $0 <cbark-path> <mnemonic-env-var-name> [target-dir]" >&2
    exit 64
fi

CBARK_PATH="$1"
MNEMONIC_ENV="$2"
TARGET_DIR="${3:-}"

if [[ ! -f "$CBARK_PATH" ]]; then
    echo "error: cbark file not found: $CBARK_PATH" >&2
    exit 66
fi

# Indirect expansion — reads the value of the env var whose NAME the user
# passed. ${!MNEMONIC_ENV} expands to the value of $MNEMONIC_ENV's referent.
if [[ -z "${!MNEMONIC_ENV:-}" ]]; then
    echo "error: env var '$MNEMONIC_ENV' is unset or empty" >&2
    echo "       export it first, e.g.  export $MNEMONIC_ENV='word word ...'" >&2
    exit 64
fi

if ! command -v node >/dev/null 2>&1; then
    echo "error: node not on PATH (required for AES decrypt). Install Node 22 LTS." >&2
    exit 127
fi

if [[ -z "$TARGET_DIR" ]]; then
    TARGET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bark-inspect.XXXXXX")"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Hand the env var NAME to Node so the helper reads the seed from its own
# process.env — same indirection rationale as above.
node "$SCRIPT_DIR/_restore.cjs" \
    --cbark "$CBARK_PATH" \
    --datadir "$TARGET_DIR" \
    --mnemonic-env "$MNEMONIC_ENV"

echo
echo "Next steps:"
echo "  export BARK_DATADIR=$TARGET_DIR"
echo "  bark --datadir \"\$BARK_DATADIR\" vtxos --all --no-sync"
echo "  scripts/bark/vtxos.sh --all"
echo
echo "When done:  rm -rf \"$TARGET_DIR\""

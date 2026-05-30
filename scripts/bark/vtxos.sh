#!/usr/bin/env bash
#
# vtxos.sh — dump VTXOs from a desktop bark wallet for inspection.
#
# Why this exists:
#   Pairs with the SDK-side view of `wallet.allVtxos()`. When the app reports a
#   VTXO list that looks wrong (missing exits, wrong kinds, stale expiry), run
#   this against a CLI wallet seeded from the same `.cbark` (see restore.sh) to
#   confirm what the Rust core actually sees.
#
# Usage:
#   BARK_DATADIR=/tmp/bark-inspect scripts/bark/vtxos.sh           # spendable only
#   BARK_DATADIR=/tmp/bark-inspect scripts/bark/vtxos.sh --all     # incl. expired/spent
#   BARK_DATADIR=/tmp/bark-inspect scripts/bark/vtxos.sh --no-sync # skip ASP sync
#
# BARK_DATADIR MUST point at a desktop bark datadir (e.g. one populated by
# restore.sh). Do NOT point this at the live Cypher Box on-device datadir
# (~/Library/Developer/CoreSimulator/... or the iCloud sync target). Working
# against the device datadir while the app is running risks SQLite WAL
# corruption. Always restore into a temp dir first.

set -euo pipefail

if [[ -z "${BARK_DATADIR:-}" ]]; then
    echo "error: BARK_DATADIR is unset. Export it to a desktop bark datadir first." >&2
    echo "example: export BARK_DATADIR=/tmp/bark-inspect" >&2
    exit 64
fi

if [[ ! -d "$BARK_DATADIR" ]]; then
    echo "error: BARK_DATADIR=$BARK_DATADIR does not exist or is not a directory." >&2
    echo "       Run scripts/bark/restore.sh first to populate it from a .cbark." >&2
    exit 66
fi

if ! command -v bark >/dev/null 2>&1; then
    echo "error: bark CLI not on PATH. See CLAUDE.md → 'Bark CLI for Ark debugging' for install." >&2
    exit 127
fi

# Pass through any extra flags the user wants (--all, --no-sync, --verbose, …).
exec bark --datadir "$BARK_DATADIR" vtxos "$@"

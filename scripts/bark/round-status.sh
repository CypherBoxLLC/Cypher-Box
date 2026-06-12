#!/usr/bin/env bash
#
# round-status.sh — inspect round state on a desktop bark wallet.
#
# Why this exists:
#   The SDK doesn't expose a "show me everything about round X" endpoint, so
#   when a refresh or send appears stuck mid-round we have no SDK-side path to
#   confirm "is this round still alive, what's our role, what's our pending
#   forfeit". The CLI exposes the round-related subcommands; we surface them
#   together here.
#
# IMPORTANT — bark CLI 0.1.3 does NOT have a `bark dev round <id> inspect`
# subcommand. The closest available knobs are:
#   - `bark round progress`  — drive any unfinished round attempts forward
#   - `bark round cancel`    — drop the wallet out of a round
#   - `bark vtxos --all`     — inspect VTXO state including expired/round-bound
#   - `bark dev ark-info`    — query the ASP about its own round state
# This wrapper prints the help, runs `ark-info` for orientation, then forwards
# any args to `bark round` so you can run `progress` / `cancel` directly.
#
# Usage:
#   BARK_DATADIR=/tmp/bark-inspect scripts/bark/round-status.sh
#       — show round-relevant subcommands and current ASP round info
#
#   BARK_DATADIR=/tmp/bark-inspect scripts/bark/round-status.sh progress
#       — try to push any in-flight round to completion
#
#   BARK_DATADIR=/tmp/bark-inspect scripts/bark/round-status.sh cancel
#       — drop the wallet out of any in-flight round (DESTRUCTIVE on live datadirs)
#
# As with vtxos.sh: never point BARK_DATADIR at the on-device datadir while
# the app is running.

set -euo pipefail

if [[ -z "${BARK_DATADIR:-}" ]]; then
    echo "error: BARK_DATADIR is unset. Export it to a desktop bark datadir first." >&2
    exit 64
fi

if [[ ! -d "$BARK_DATADIR" ]]; then
    echo "error: BARK_DATADIR=$BARK_DATADIR does not exist or is not a directory." >&2
    exit 66
fi

if ! command -v bark >/dev/null 2>&1; then
    echo "error: bark CLI not on PATH. See CLAUDE.md → 'Bark CLI for Ark debugging' for install." >&2
    exit 127
fi

if [[ $# -eq 0 ]]; then
    echo "=== bark round help ==="
    bark --datadir "$BARK_DATADIR" round --help || true
    echo
    echo "=== ASP ark-info (server's view of round state) ==="
    bark --datadir "$BARK_DATADIR" dev ark-info || true
    echo
    echo "=== current VTXOs (round-bound included) ==="
    bark --datadir "$BARK_DATADIR" vtxos --all --no-sync || true
    exit 0
fi

# Forward subcommand + args to `bark round`.
exec bark --datadir "$BARK_DATADIR" round "$@"

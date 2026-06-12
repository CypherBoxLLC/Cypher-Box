#!/usr/bin/env bash
#
# decode.sh — decode a serialized VTXO hex into the bark CLI's structured view.
#
# Why this exists:
#   The JS SDK (@secondts/bark-react-native@0.4.1) returns VTXO records whose
#   `kind` field doesn't match the docstrings ("Pubkey" / "ServerHtlcRecv" /
#   "ServerHtlcSend" vs the documented "board" / "round" / "arkoor"). The CLI
#   shares the same Rust core and gives us the ground-truth kind in 30 seconds.
#
# Usage:
#   scripts/bark/decode.sh <vtxo-hex>
#
# Pull <vtxo-hex> from the SDK boundary — e.g. log a VTXO via wallet.allVtxos()
# JSON.stringify, copy the encoded blob, paste here.
#
# This script does NOT touch any datadir; it's a pure decode against the hex.

set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "usage: $0 <vtxo-hex>" >&2
    exit 64
fi

VTXO_HEX="$1"

if ! command -v bark >/dev/null 2>&1; then
    echo "error: bark CLI not on PATH. See CLAUDE.md → 'Bark CLI for Ark debugging' for install." >&2
    exit 127
fi

# `bark dev vtxo decode` accepts the hex as a positional arg. No datadir read,
# so we don't pass --datadir.
exec bark dev vtxo decode "$VTXO_HEX"

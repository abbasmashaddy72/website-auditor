#!/usr/bin/env bash
# Single public update entry point; implementation in update.py for safe ZIP handling.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$ROOT/scripts/update.py" --project "$ROOT" "$@"

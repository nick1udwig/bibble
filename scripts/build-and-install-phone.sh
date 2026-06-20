#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PBW_PATH="${BIBBLE_PHONE_PBW:-build/bibble.pbw}"

cd "$ROOT_DIR"

echo "Building Bibble PBW."
echo "Output PBW: $PBW_PATH"

if [[ "${BIBBLE_DRY_RUN:-0}" == "1" ]]; then
  echo "Dry run enabled; skipping build and phone install."
  exit 0
fi

npm run build:watch:release

if [[ ! -f "$PBW_PATH" ]]; then
  echo "Expected PBW not found: $PBW_PATH" >&2
  exit 1
fi

echo "Installing $PBW_PATH to the paired phone..."
pebble install "$PBW_PATH" --phone

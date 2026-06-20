#!/usr/bin/env bash
set -euo pipefail

pbw="${1:-build/bibble.pbw}"

if [[ ! -f "$pbw" ]]; then
  echo "PBW not found: $pbw" >&2
  exit 1
fi

if unzip -l "$pbw" pebble-js-app.js.map >/dev/null 2>&1; then
  zip -q -d "$pbw" pebble-js-app.js.map >/dev/null
fi

ls -lh "$pbw"

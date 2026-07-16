#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(dirname "$script_dir")"
pbw="${1:-$project_root/build/bibble.pbw}"

if [[ ! -f "$pbw" ]]; then
  echo "PBW not found: $pbw" >&2
  exit 1
fi

pbw="$(realpath "$pbw")"
build_dir="$(dirname "$pbw")"
source_js="$build_dir/pebble-js-app.js"
source_map="$build_dir/pebble-js-app.js.map"
release_dir="$build_dir/release"
release_js="$release_dir/pebble-js-app.js"
release_map="$release_dir/pebble-js-app.js.map"

if [[ ! -f "$source_js" || ! -f "$source_map" ]]; then
  echo "Companion JavaScript build outputs were not found beside $pbw" >&2
  exit 1
fi

node "$script_dir/minify-release-js.mjs" "$source_js" "$source_map" "$release_js" "$release_map"

if unzip -p "$pbw" pebble-js-app.js.map >/dev/null 2>&1; then
  zip -q -d "$pbw" pebble-js-app.js.map >/dev/null
fi
zip -q -d "$pbw" pebble-js-app.js >/dev/null
zip -q -0 -j "$pbw" "$release_js"

if ! unzip -p "$pbw" pebble-js-app.js | cmp -s - "$release_js"; then
  echo "Packaged companion JavaScript does not match the minified release output" >&2
  exit 1
fi

debug_bytes="$(wc -c < "$source_js")"
release_bytes="$(wc -c < "$release_js")"
echo "Companion JavaScript: $debug_bytes -> $release_bytes bytes"
echo "External release source map: $release_map"
ls -lh "$pbw"

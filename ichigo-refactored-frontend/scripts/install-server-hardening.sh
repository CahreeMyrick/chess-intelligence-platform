#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /absolute/path/to/ichigo-project" >&2
  exit 64
fi

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="$(cd "$1" && pwd)"
TARGET_SERVER="$TARGET_ROOT/server"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$TARGET_SERVER" "$TARGET_ROOT/tests/server"

for file in game-route-helpers.cjs game-routes.cjs; do
  if [[ -e "$TARGET_SERVER/$file" ]]; then
    cp "$TARGET_SERVER/$file" "$TARGET_SERVER/$file.before-$TIMESTAMP"
  fi
  cp "$SOURCE_ROOT/server/$file" "$TARGET_SERVER/$file"
done

cp -R "$SOURCE_ROOT/tests/server/." "$TARGET_ROOT/tests/server/"

echo "Copied hardened game-route modules into: $TARGET_SERVER"
echo "No route was mounted and server.js was not edited."
echo "Read frontend-docs/SERVER_JS_REVIEW.md or docs/SERVER_JS_REVIEW.md for wiring instructions."

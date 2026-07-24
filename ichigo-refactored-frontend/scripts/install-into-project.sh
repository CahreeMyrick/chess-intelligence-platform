#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /absolute/path/to/ichigo-project" >&2
  exit 64
fi

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="$(cd "$1" && pwd)"
TARGET_PUBLIC="$TARGET_ROOT/public"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$TARGET_ROOT/frontend-backup-$TIMESTAMP"

if [[ ! -d "$TARGET_PUBLIC" ]]; then
  echo "Target does not contain a public/ directory: $TARGET_ROOT" >&2
  exit 66
fi

if [[ ! -f "$TARGET_PUBLIC/chessboardjs-1.0.0/js/chessboard-1.0.0.min.js" ]]; then
  echo "Missing existing chessboard.js assets under public/chessboardjs-1.0.0/." >&2
  echo "The refactor intentionally does not duplicate that third-party directory." >&2
  exit 66
fi

mkdir -p "$BACKUP_DIR/public"
for path in index.html puzzles.html css js; do
  if [[ -e "$TARGET_PUBLIC/$path" ]]; then
    cp -R "$TARGET_PUBLIC/$path" "$BACKUP_DIR/public/"
  fi
done

cp -R "$SOURCE_ROOT/public/." "$TARGET_PUBLIC/"
mkdir -p "$TARGET_ROOT/frontend-docs"
cp -R "$SOURCE_ROOT/docs/." "$TARGET_ROOT/frontend-docs/"

mkdir -p "$TARGET_ROOT/tests/frontend" "$TARGET_ROOT/scripts"
cp -R "$SOURCE_ROOT/tests/frontend/." "$TARGET_ROOT/tests/frontend/"
cp "$SOURCE_ROOT/scripts/check-frontend.mjs" "$TARGET_ROOT/scripts/check-frontend.mjs"
cp "$SOURCE_ROOT/scripts/smoke-server.mjs" "$TARGET_ROOT/scripts/smoke-server.mjs"

echo "Installed modular frontend into: $TARGET_ROOT"
echo "Backup created at: $BACKUP_DIR"
echo "Next: cd '$TARGET_ROOT' && node scripts/check-frontend.mjs"

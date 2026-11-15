#!/usr/bin/env bash
# Build the extension and launch it in the Extension Development Host for manual testing.
#
# Usage:
#   npm run dev                 # Run with VS Code
#   EDITOR_BIN=trae npm run dev # Run with Trae
#   npm run dev -- /path/to/workspace   # Specify the workspace to open
#   CLEAN=1 npm run dev         # Disable other extensions and load only this one
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EDITOR_BIN="${EDITOR_BIN:-code}"
WORKSPACE="${1:-$ROOT/test-fixtures/workspace}"
CLEAN="${CLEAN:-}"

if ! command -v "$EDITOR_BIN" >/dev/null 2>&1; then
  echo "Editor '$EDITOR_BIN' not found. Specify it like EDITOR_BIN=trae." >&2
  exit 1
fi

echo "▶ Build (tsc)"
npm run build

echo "▶ Launching Extension Development Host: $EDITOR_BIN"
echo "  extension: $ROOT"
echo "  workspace: $WORKSPACE"

ARGS=(--extensionDevelopmentPath="$ROOT" --new-window "$WORKSPACE")
if [ -n "$CLEAN" ]; then
  echo "  mode: CLEAN (disable other installed extensions, load only this one)"
  ARGS=(--disable-extensions "${ARGS[@]}")
fi

exec "$EDITOR_BIN" "${ARGS[@]}"

#!/usr/bin/env bash
# FROST Guard — Build Script
# Creates distributable zip files for Chrome and Firefox.
#
# Usage:
#   ./build.sh          # builds both
#   ./build.sh chrome   # Chrome only
#   ./build.sh firefox  # Firefox only
#
# Output:
#   dist/frost-guard-chrome.zip
#   dist/frost-guard-firefox.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"
DIST_DIR="$SCRIPT_DIR/dist"

build_target() {
  local target="$1"
  local manifest="$SCRIPT_DIR/manifests/$target/manifest.json"
  local out_dir="$DIST_DIR/$target"
  local zip_file="$DIST_DIR/frost-guard-$target.zip"

  if [ ! -f "$manifest" ]; then
    echo "ERROR: Manifest not found: $manifest"
    exit 1
  fi

  echo "→ Building $target..."

  # Clean & create output dir
  rm -rf "$out_dir"
  mkdir -p "$out_dir/icons"

  # Copy source files
  cp "$SRC_DIR/inject.js"          "$out_dir/"
  cp "$SRC_DIR/content-script.js"  "$out_dir/"
  cp "$SRC_DIR/background.js"     "$out_dir/"
  cp "$SRC_DIR/popup.html"        "$out_dir/"
  cp "$SRC_DIR/popup.js"          "$out_dir/"
  cp "$SRC_DIR/popup.css"         "$out_dir/"
  cp "$SRC_DIR/options.html"      "$out_dir/"
  cp "$SRC_DIR/options.js"        "$out_dir/"
  cp "$SRC_DIR/options.css"       "$out_dir/"

  # Copy icons
  cp "$SRC_DIR/icons/"*.png "$out_dir/icons/" 2>/dev/null || true

  # Copy manifest
  cp "$manifest" "$out_dir/manifest.json"

  # Create zip
  rm -f "$zip_file"
  (cd "$out_dir" && zip -r "$zip_file" . -x '.*')

  echo "  ✓ $zip_file"
}

mkdir -p "$DIST_DIR"

case "${1:-all}" in
  chrome)  build_target chrome  ;;
  firefox) build_target firefox ;;
  all)
    build_target chrome
    build_target firefox
    ;;
  *)
    echo "Usage: $0 [chrome|firefox|all]"
    exit 1
    ;;
esac

echo ""
echo "Build complete! Files in $DIST_DIR/"

#!/bin/bash
# Bundle mpv_texture.node + libmpv.dylib + all transitive dylib deps for macOS distribution.
#
# After node-gyp build, mpv_texture.node has LC_LOAD_DYLIB pointing to @rpath/libmpv.dylib
# (because setup-mpv-mac.sh set the install_name before linking). This script:
#   1. Rewrites mpv_texture.node to use @loader_path/libmpv.dylib
#   2. Recursively finds all Homebrew dylib deps of libmpv
#   3. Copies them into build/Release/ (next to the .node) and rewrites all
#      inter-library references to use @loader_path/
#   4. Also copies everything to mpv-bundle/ for electron-builder extraResources
#
# Electron auto-unpacks .node files from asar. With asarUnpack configured for
# *.dylib too, the dylibs end up next to the .node in app.asar.unpacked/ and
# @loader_path resolves correctly at runtime.
#
# Compatible with bash 3 (macOS default) — no associative arrays.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/../build/Release"
BUNDLE_DIR="$SCRIPT_DIR/../../electron/mpv-bundle"

mkdir -p "$BUNDLE_DIR"

echo "[bundle] mpv_texture.node dependencies (before fixup):"
otool -L "$BUILD_DIR/mpv_texture.node" | grep -i mpv || true

# Rewrite mpv_texture.node to use @loader_path instead of @rpath
install_name_tool -change "@rpath/libmpv.dylib" "@loader_path/libmpv.dylib" \
  "$BUILD_DIR/mpv_texture.node" 2>/dev/null || true

# Also fix libmpv.dylib's install_name in build/Release
install_name_tool -id "@loader_path/libmpv.dylib" "$BUILD_DIR/libmpv.dylib"

# --- Recursively bundle transitive Homebrew dylib dependencies ---
# libmpv depends on ffmpeg, libass, freetype, etc. — all from Homebrew.
# We copy each one into build/Release/ and rewrite references.

HOMEBREW_PREFIX="$(brew --prefix)"

# Use a queue file + tracking dir (bash 3 compatible, no associative arrays)
QUEUE_FILE="$(mktemp)"
DONE_DIR="$(mktemp -d)"
trap "rm -f '$QUEUE_FILE'; rm -rf '$DONE_DIR'" EXIT

echo "$BUILD_DIR/libmpv.dylib" > "$QUEUE_FILE"

while [ -s "$QUEUE_FILE" ]; do
  # Pop first line
  CURRENT="$(head -1 "$QUEUE_FILE")"
  tail -n +2 "$QUEUE_FILE" > "$QUEUE_FILE.tmp" && mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"

  BASENAME="$(basename "$CURRENT")"

  # Skip if already processed
  if [ -f "$DONE_DIR/$BASENAME" ]; then
    continue
  fi
  touch "$DONE_DIR/$BASENAME"

  # Find all Homebrew dylib deps of this library
  DEPS=$(otool -L "$CURRENT" | tail -n +2 | awk '{print $1}' | grep "$HOMEBREW_PREFIX" || true)

  for DEP in $DEPS; do
    DEP_BASENAME="$(basename "$DEP")"

    # Copy if not already in build/Release
    if [ ! -f "$BUILD_DIR/$DEP_BASENAME" ]; then
      # Resolve symlinks to get the actual file
      REAL_DEP="$(python3 -c "import os; print(os.path.realpath('$DEP'))" 2>/dev/null || echo "$DEP")"
      if [ -f "$REAL_DEP" ]; then
        cp "$REAL_DEP" "$BUILD_DIR/$DEP_BASENAME"
        chmod 644 "$BUILD_DIR/$DEP_BASENAME"
        install_name_tool -id "@loader_path/$DEP_BASENAME" "$BUILD_DIR/$DEP_BASENAME"
        echo "[bundle]   + $DEP_BASENAME"
        echo "$BUILD_DIR/$DEP_BASENAME" >> "$QUEUE_FILE"
      else
        echo "[bundle]   ? missing: $DEP"
      fi
    fi

    # Rewrite the reference in the current library
    install_name_tool -change "$DEP" "@loader_path/$DEP_BASENAME" "$CURRENT" 2>/dev/null || true
  done
done

# Copy everything from build/Release into mpv-bundle for electron-builder extraResources
cp "$BUILD_DIR/mpv_texture.node" "$BUNDLE_DIR/"
cp "$BUILD_DIR"/*.dylib "$BUNDLE_DIR/"

echo ""
DYLIB_COUNT=$(ls "$BUILD_DIR"/*.dylib 2>/dev/null | wc -l | tr -d ' ')
echo "[bundle] Bundled $DYLIB_COUNT dylibs into build/Release/ and mpv-bundle/"
echo "[bundle] Verifying mpv_texture.node:"
otool -L "$BUILD_DIR/mpv_texture.node" | head -5
echo "[bundle] Verifying libmpv.dylib (first 10 deps):"
otool -L "$BUILD_DIR/libmpv.dylib" | head -12
echo "[bundle] Done."

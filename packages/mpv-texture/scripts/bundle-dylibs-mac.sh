#!/bin/bash
# Bundle mpv_texture.node + libmpv.dylib + all transitive dylib deps for macOS distribution.
#
# After node-gyp build, mpv_texture.node has LC_LOAD_DYLIB pointing to @rpath/libmpv.dylib
# (because setup-mpv-mac.sh set the install_name before linking). This script:
#   1. Copies mpv_texture.node and libmpv.dylib into mpv-bundle/
#   2. Recursively finds all Homebrew dylib deps of libmpv
#   3. Copies them into mpv-bundle/ and rewrites all inter-library references
#      to use @loader_path/ (so they find each other in the same directory)
#
# The final mpv-bundle/ is self-contained and gets placed into
# sbtlTV.app/Contents/Resources/mpv/ by electron-builder.
#
# Compatible with bash 3 (macOS default) — no associative arrays.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/../build/Release"
BUNDLE_DIR="$SCRIPT_DIR/../../electron/mpv-bundle"

mkdir -p "$BUNDLE_DIR"

# Copy the native addon
cp "$BUILD_DIR/mpv_texture.node" "$BUNDLE_DIR/"
cp "$BUILD_DIR/libmpv.dylib" "$BUNDLE_DIR/"

echo "[bundle] Copied mpv_texture.node and libmpv.dylib"

# Verify mpv_texture.node references @rpath/libmpv.dylib (set by setup-mpv-mac.sh)
echo "[bundle] mpv_texture.node dependencies:"
otool -L "$BUNDLE_DIR/mpv_texture.node" | grep -i mpv || true

# Rewrite mpv_texture.node to use @loader_path instead of @rpath
# (@loader_path resolves to the directory containing the binary that loaded the dylib,
#  which for a .node file loaded by require() is the .node file's own directory)
install_name_tool -change "@rpath/libmpv.dylib" "@loader_path/libmpv.dylib" \
  "$BUNDLE_DIR/mpv_texture.node" 2>/dev/null || true

# --- Recursively bundle transitive Homebrew dylib dependencies ---
# libmpv depends on ffmpeg, libass, freetype, etc. — all from Homebrew.
# We need to copy each one and rewrite references so they find each other.

HOMEBREW_PREFIX="$(brew --prefix)"

# Use a queue file + bundled-tracking dir instead of bash 4 associative arrays
QUEUE_FILE="$(mktemp)"
DONE_DIR="$(mktemp -d)"
trap "rm -f '$QUEUE_FILE'; rm -rf '$DONE_DIR'" EXIT

echo "$BUNDLE_DIR/libmpv.dylib" > "$QUEUE_FILE"

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

    # Copy if not already in bundle
    if [ ! -f "$BUNDLE_DIR/$DEP_BASENAME" ]; then
      # Resolve symlinks to get the actual file
      REAL_DEP="$(python3 -c "import os; print(os.path.realpath('$DEP'))" 2>/dev/null || echo "$DEP")"
      if [ -f "$REAL_DEP" ]; then
        cp "$REAL_DEP" "$BUNDLE_DIR/$DEP_BASENAME"
        chmod 644 "$BUNDLE_DIR/$DEP_BASENAME"
        # Set the install_name to @loader_path
        install_name_tool -id "@loader_path/$DEP_BASENAME" "$BUNDLE_DIR/$DEP_BASENAME"
        echo "[bundle]   + $DEP_BASENAME"
        echo "$BUNDLE_DIR/$DEP_BASENAME" >> "$QUEUE_FILE"
      else
        echo "[bundle]   ? missing: $DEP"
      fi
    fi

    # Rewrite the reference in the current library
    install_name_tool -change "$DEP" "@loader_path/$DEP_BASENAME" "$CURRENT" 2>/dev/null || true
  done
done

# Also fix libmpv.dylib's own install_name for the bundle
install_name_tool -id "@loader_path/libmpv.dylib" "$BUNDLE_DIR/libmpv.dylib"

echo ""
echo "[bundle] Bundled $(ls "$BUNDLE_DIR"/*.dylib 2>/dev/null | wc -l | tr -d ' ') dylibs into mpv-bundle/"
echo "[bundle] Verifying mpv_texture.node:"
otool -L "$BUNDLE_DIR/mpv_texture.node" | head -5
echo "[bundle] Verifying libmpv.dylib (first 10 deps):"
otool -L "$BUNDLE_DIR/libmpv.dylib" | head -12
echo "[bundle] Done."

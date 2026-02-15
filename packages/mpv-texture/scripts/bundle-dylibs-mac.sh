#!/bin/bash
# Bundle mpv_texture.node + libmpv.dylib + all transitive dylib deps for macOS distribution.
#
# Recursively walks the dylib dependency tree, copies everything into build/Release/
# (next to the .node), and rewrites all load commands to @loader_path/.
# Also copies the final bundle to mpv-bundle/ for electron-builder extraResources.
#
# Handles both absolute Homebrew paths AND @rpath/ references.
# Compatible with bash 3 (macOS default).

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/../build/Release"
BUNDLE_DIR="$SCRIPT_DIR/../../electron/mpv-bundle"

mkdir -p "$BUNDLE_DIR"

HOMEBREW_PREFIX="$(brew --prefix)"

# Collect all Homebrew lib directories for resolving @rpath references
BREW_LIB_DIRS="$(find "$HOMEBREW_PREFIX/opt" -name "lib" -type d -maxdepth 3 2>/dev/null | tr '\n' ':')"
BREW_LIB_DIRS="${BREW_LIB_DIRS}${HOMEBREW_PREFIX}/lib"

echo "[bundle] mpv_texture.node dependencies (before fixup):"
otool -L "$BUILD_DIR/mpv_texture.node" | grep -i mpv || true

# Rewrite mpv_texture.node to use @loader_path instead of @rpath
install_name_tool -change "@rpath/libmpv.dylib" "@loader_path/libmpv.dylib" \
  "$BUILD_DIR/mpv_texture.node" 2>/dev/null || true

# Fix libmpv.dylib's install_name
install_name_tool -id "@loader_path/libmpv.dylib" "$BUILD_DIR/libmpv.dylib"

# Resolve an @rpath/ reference by searching Homebrew lib dirs
resolve_rpath() {
  local libname="$1"
  IFS=':' read -ra DIRS <<< "$BREW_LIB_DIRS"
  for dir in "${DIRS[@]}"; do
    if [ -f "$dir/$libname" ]; then
      echo "$dir/$libname"
      return 0
    fi
  done
  return 1
}

# --- Recursively bundle all dylib dependencies ---
QUEUE_FILE="$(mktemp)"
DONE_DIR="$(mktemp -d)"
trap "rm -f '$QUEUE_FILE'; rm -rf '$DONE_DIR'" EXIT

echo "$BUILD_DIR/libmpv.dylib" > "$QUEUE_FILE"

while [ -s "$QUEUE_FILE" ]; do
  CURRENT="$(head -1 "$QUEUE_FILE")"
  tail -n +2 "$QUEUE_FILE" > "$QUEUE_FILE.tmp" && mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"

  BASENAME="$(basename "$CURRENT")"

  if [ -f "$DONE_DIR/$BASENAME" ]; then
    continue
  fi
  touch "$DONE_DIR/$BASENAME"

  # Get all non-system dependencies
  ALL_DEPS=$(otool -L "$CURRENT" | tail -n +2 | awk '{print $1}')

  for DEP in $ALL_DEPS; do
    # Skip system libraries
    case "$DEP" in
      /usr/lib/*|/System/*) continue ;;
    esac

    DEP_BASENAME="$(basename "$DEP")"

    # Skip problematic deps (Python framework from vapoursynth, etc.)
    case "$DEP_BASENAME" in
      Python|Python3) echo "[bundle]   ~ skip: $DEP_BASENAME (framework)"; continue ;;
    esac

    # Determine the real file path
    REAL_DEP=""
    case "$DEP" in
      @rpath/*|@loader_path/*)
        # Resolve by searching Homebrew lib directories
        LIBNAME="${DEP##*/}"
        REAL_DEP="$(resolve_rpath "$LIBNAME" 2>/dev/null || true)"
        if [ -z "$REAL_DEP" ]; then
          echo "[bundle]   ? cannot resolve: $DEP"
          continue
        fi
        ;;
      ${HOMEBREW_PREFIX}*)
        # Absolute Homebrew path — resolve symlinks
        REAL_DEP="$(python3 -c "import os; print(os.path.realpath('$DEP'))" 2>/dev/null || echo "$DEP")"
        ;;
      *)
        # Unknown path type, skip
        continue
        ;;
    esac

    # Copy if not already in build/Release
    if [ ! -f "$BUILD_DIR/$DEP_BASENAME" ] && [ -f "$REAL_DEP" ]; then
      cp "$REAL_DEP" "$BUILD_DIR/$DEP_BASENAME"
      chmod 644 "$BUILD_DIR/$DEP_BASENAME"
      install_name_tool -id "@loader_path/$DEP_BASENAME" "$BUILD_DIR/$DEP_BASENAME" 2>/dev/null || true
      echo "[bundle]   + $DEP_BASENAME"
      echo "$BUILD_DIR/$DEP_BASENAME" >> "$QUEUE_FILE"
    fi

    # Rewrite the reference in the current library to @loader_path
    install_name_tool -change "$DEP" "@loader_path/$DEP_BASENAME" "$CURRENT" 2>/dev/null || true
  done
done

# Copy everything to mpv-bundle for electron-builder extraResources
cp "$BUILD_DIR/mpv_texture.node" "$BUNDLE_DIR/"
cp "$BUILD_DIR"/*.dylib "$BUNDLE_DIR/" 2>/dev/null || true
# Also copy any non-.dylib shared libs (e.g. libsharpyuv might not have .dylib ext)
for f in "$BUILD_DIR"/*.so "$BUILD_DIR"/*.0; do
  [ -f "$f" ] && cp "$f" "$BUNDLE_DIR/" 2>/dev/null || true
done

echo ""
DYLIB_COUNT=$(ls "$BUILD_DIR"/*.dylib 2>/dev/null | wc -l | tr -d ' ')
echo "[bundle] Bundled $DYLIB_COUNT dylibs into build/Release/ and mpv-bundle/"
echo "[bundle] Verifying mpv_texture.node:"
otool -L "$BUILD_DIR/mpv_texture.node" | head -5
echo "[bundle] Verifying libmpv.dylib (first 10 deps):"
otool -L "$BUILD_DIR/libmpv.dylib" | head -12
echo "[bundle] Done."

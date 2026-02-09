#!/bin/bash
# Setup libmpv for macOS
# Requires Homebrew: https://brew.sh
#
# Copies libmpv + transitive dylib dependencies from Homebrew,
# rewrites install_names so the .node binary uses @rpath/libmpv.dylib
# (binding.gyp sets -Wl,-rpath,@loader_path so @rpath resolves
#  to the directory containing mpv_texture.node at runtime).

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPS_DIR="$SCRIPT_DIR/../deps/mpv/macos"

echo "Setting up libmpv for macOS..."

# Check for Homebrew
if ! command -v brew &> /dev/null; then
    echo "Error: Homebrew is required. Install from https://brew.sh"
    exit 1
fi

# Install mpv if not present
if ! brew list mpv &> /dev/null; then
    echo "Installing mpv via Homebrew..."
    brew install mpv
fi

# Get mpv prefix
MPV_PREFIX=$(brew --prefix mpv)
echo "mpv installed at: $MPV_PREFIX"

# Create deps directory
mkdir -p "$DEPS_DIR"

# Find the actual libmpv dylib (could be libmpv.2.dylib, libmpv.dylib, etc.)
MPV_DYLIB=""
if [ -f "$MPV_PREFIX/lib/libmpv.dylib" ]; then
    MPV_DYLIB="$MPV_PREFIX/lib/libmpv.dylib"
elif [ -f "$MPV_PREFIX/lib/libmpv.2.dylib" ]; then
    MPV_DYLIB="$MPV_PREFIX/lib/libmpv.2.dylib"
else
    echo "Error: Could not find libmpv dylib in $MPV_PREFIX/lib"
    ls -la "$MPV_PREFIX/lib/"
    exit 1
fi

echo "Source dylib: $MPV_DYLIB"

# Copy libmpv
cp "$MPV_DYLIB" "$DEPS_DIR/libmpv.dylib"

# Rewrite the dylib's install_name to @rpath/libmpv.dylib
# This is critical: when node-gyp links mpv_texture.node against this dylib,
# it records the install_name as the LC_LOAD_DYLIB path. By setting it to
# @rpath/libmpv.dylib, the .node will look for libmpv.dylib relative to @rpath
# (which binding.gyp sets to @loader_path, i.e. the .node file's directory).
install_name_tool -id "@rpath/libmpv.dylib" "$DEPS_DIR/libmpv.dylib"
echo "Set install_name to @rpath/libmpv.dylib"

# Copy headers if not present
INCLUDE_DIR="$SCRIPT_DIR/../deps/mpv/include/mpv"
if [ ! -f "$INCLUDE_DIR/client.h" ]; then
    mkdir -p "$INCLUDE_DIR"
    if [ -d "$MPV_PREFIX/include/mpv" ]; then
        cp "$MPV_PREFIX/include/mpv/"*.h "$INCLUDE_DIR/"
        echo "Copied mpv headers"
    fi
fi

echo ""
echo "Setup complete! Now run:"
echo "  cd packages/mpv-texture && npm run build:native"

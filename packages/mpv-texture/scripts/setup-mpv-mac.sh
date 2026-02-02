#!/bin/bash
# Setup libmpv for macOS
# Requires Homebrew: https://brew.sh

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

# Copy libmpv dylib
if [ -f "$MPV_PREFIX/lib/libmpv.dylib" ]; then
    cp "$MPV_PREFIX/lib/libmpv.dylib" "$DEPS_DIR/"
    echo "Copied libmpv.dylib to $DEPS_DIR"
elif [ -f "$MPV_PREFIX/lib/libmpv.2.dylib" ]; then
    cp "$MPV_PREFIX/lib/libmpv.2.dylib" "$DEPS_DIR/libmpv.dylib"
    echo "Copied libmpv.2.dylib to $DEPS_DIR/libmpv.dylib"
else
    echo "Error: Could not find libmpv dylib in $MPV_PREFIX/lib"
    ls -la "$MPV_PREFIX/lib/"
    exit 1
fi

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

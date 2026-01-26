#!/bin/bash
# Download mpv binaries for bundling with the app
# Run this script from the repository root
#
# Sources (both listed on https://mpv.io/installation/):
# - Windows: SourceForge mpv-player-windows (official community builds)
# - macOS: stolendata builds (arm64 only, macOS 14+)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_DIR="$REPO_ROOT/packages/electron/mpv-bundle"

mkdir -p "$BUNDLE_DIR"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    echo "Downloading mpv for Windows..."
    # SourceForge mpv-player-windows - official community builds
    # https://sourceforge.net/projects/mpv-player-windows/files/
    MPV_URL="https://downloads.sourceforge.net/project/mpv-player-windows/64bit/mpv-x86_64-20250119-git-ab78d7b.7z"
    TEMP_DIR=$(mktemp -d)
    curl -L -o "$TEMP_DIR/mpv.7z" "$MPV_URL"

    # Extract with 7z (available in GitHub Actions Windows runners)
    7z x "$TEMP_DIR/mpv.7z" -o"$TEMP_DIR/mpv-extract" -y

    # Copy only what we need
    cp "$TEMP_DIR/mpv-extract/mpv.exe" "$BUNDLE_DIR/"
    cp "$TEMP_DIR/mpv-extract/"*.dll "$BUNDLE_DIR/" 2>/dev/null || true

    rm -rf "$TEMP_DIR"
    echo "mpv for Windows downloaded to $BUNDLE_DIR"
    ;;

  Darwin)
    echo "Downloading mpv for macOS..."
    # stolendata builds - arm64 only (Apple Silicon, macOS 14+)
    # https://laboratory.stolendata.net/~djinn/mpv_osx/
    # Note: Intel Mac users will need to install mpv via Homebrew
    MPV_URL="https://laboratory.stolendata.net/~djinn/mpv_osx/mpv-arm64-0.40.0.tar.gz"
    TEMP_DIR=$(mktemp -d)
    curl -L -o "$TEMP_DIR/mpv.tar.gz" "$MPV_URL"

    # Extract
    tar -xzf "$TEMP_DIR/mpv.tar.gz" -C "$TEMP_DIR"

    # Copy the mpv binary from the app bundle
    cp "$TEMP_DIR/mpv.app/Contents/MacOS/mpv" "$BUNDLE_DIR/"
    # Copy frameworks (required dylibs)
    if [ -d "$TEMP_DIR/mpv.app/Contents/Frameworks" ]; then
      cp -R "$TEMP_DIR/mpv.app/Contents/Frameworks" "$BUNDLE_DIR/"
    fi

    rm -rf "$TEMP_DIR"
    echo "mpv for macOS (Apple Silicon) downloaded to $BUNDLE_DIR"
    ;;

  Linux)
    echo "Linux does not bundle mpv - users should install via package manager"
    # Create empty marker file so electron-builder doesn't fail
    touch "$BUNDLE_DIR/.linux-no-bundle"
    ;;

  *)
    echo "Unknown platform: $(uname -s)"
    exit 1
    ;;
esac

echo "Done!"

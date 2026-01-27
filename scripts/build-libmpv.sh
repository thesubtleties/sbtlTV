#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RAW_PLATFORM="${PLATFORM:-$(uname -s)}"
case "$RAW_PLATFORM" in
  Linux) PLATFORM="linux" ;;
  Darwin) PLATFORM="macos" ;;
  *) echo "Unsupported platform: $RAW_PLATFORM" >&2; exit 1 ;;
esac

MPV_VERSION="${MPV_VERSION:-0.41.0}"
BUNDLE_ROOT="${BUNDLE_ROOT:-$REPO_ROOT/packages/electron/mpv-bundle}"
MPV_PREFIX="${MPV_PREFIX:-$BUNDLE_ROOT/$PLATFORM/mpv}"
FFMPEG_PREFIX="${FFMPEG_PREFIX:-$BUNDLE_ROOT/$PLATFORM/ffmpeg}"
SRC_ROOT="${MPV_SRC:-$REPO_ROOT/.build/mpv-$MPV_VERSION}"
BUILD_ROOT="${MPV_BUILD_DIR:-$REPO_ROOT/.build/mpv-build-$PLATFORM}"

MPV_GPL="${MPV_GPL:-0}"

TARBALL="v${MPV_VERSION}.tar.gz"
TARBALL_URL="https://github.com/mpv-player/mpv/archive/refs/tags/${TARBALL}"

mkdir -p "$BUNDLE_ROOT" "$BUILD_ROOT" "$(dirname "$SRC_ROOT")"

if [ ! -d "$SRC_ROOT" ]; then
  TMP_DIR="$(mktemp -d)"
  echo "Downloading mpv $MPV_VERSION..."
  curl -L -o "$TMP_DIR/$TARBALL" "$TARBALL_URL"
  tar -xf "$TMP_DIR/$TARBALL" -C "$TMP_DIR"
  mv "$TMP_DIR/mpv-$MPV_VERSION" "$SRC_ROOT"
  rm -rf "$TMP_DIR"
fi

export PKG_CONFIG_PATH="$FFMPEG_PREFIX/lib/pkgconfig:${PKG_CONFIG_PATH:-}"

JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN || sysctl -n hw.ncpu || echo 4)}"

cd "$SRC_ROOT"
if [ ! -f "$SRC_ROOT/waf" ]; then
  echo "Bootstrapping mpv build..."
  ./bootstrap.py
fi

GPL_FLAG=()
if ./waf configure --help 2>/dev/null | grep -q "gpl"; then
  if [ "$MPV_GPL" = "1" ]; then
    GPL_FLAG+=("--enable-gpl")
  else
    GPL_FLAG+=("--disable-gpl")
  fi
fi

echo "Configuring mpv..."
./waf configure \
  --prefix="$MPV_PREFIX" \
  --libdir="$MPV_PREFIX/lib" \
  --enable-libmpv-shared \
  --disable-cplayer \
  --disable-manpage \
  "${GPL_FLAG[@]}"

echo "Building mpv..."
./waf build -j"$JOBS"
./waf install

echo "mpv installed to $MPV_PREFIX"

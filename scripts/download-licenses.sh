#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FFMPEG_VERSION="${FFMPEG_VERSION:-8.0.1}"
MPV_VERSION="${MPV_VERSION:-0.41.0}"
OPENSSL_VERSION="${OPENSSL_VERSION:-3.3.2}"

LICENSE_DIR="$REPO_ROOT/packages/electron/licenses"
SOURCE_DIR="$REPO_ROOT/packages/electron/sources"
TMP_DIR="$(mktemp -d)"

mkdir -p "$LICENSE_DIR" "$SOURCE_DIR"

FFMPEG_TARBALL="ffmpeg-${FFMPEG_VERSION}.tar.xz"
FFMPEG_URL="https://ffmpeg.org/releases/${FFMPEG_TARBALL}"
MPV_TARBALL="mpv-${MPV_VERSION}.tar.gz"
MPV_URL="https://github.com/mpv-player/mpv/archive/refs/tags/v${MPV_VERSION}.tar.gz"
OPENSSL_TARBALL="openssl-${OPENSSL_VERSION}.tar.gz"
OPENSSL_URL="https://www.openssl.org/source/${OPENSSL_TARBALL}"

echo "Downloading FFmpeg source..."
curl -L -o "$SOURCE_DIR/$FFMPEG_TARBALL" "$FFMPEG_URL"

echo "Downloading mpv source..."
curl -L -o "$SOURCE_DIR/$MPV_TARBALL" "$MPV_URL"

echo "Downloading OpenSSL source..."
curl -L -o "$SOURCE_DIR/$OPENSSL_TARBALL" "$OPENSSL_URL"

tar -xf "$SOURCE_DIR/$FFMPEG_TARBALL" -C "$TMP_DIR"
tar -xf "$SOURCE_DIR/$MPV_TARBALL" -C "$TMP_DIR"
tar -xf "$SOURCE_DIR/$OPENSSL_TARBALL" -C "$TMP_DIR"

cp "$TMP_DIR/ffmpeg-$FFMPEG_VERSION/COPYING."* "$LICENSE_DIR/" 2>/dev/null || true
cp "$TMP_DIR/mpv-$MPV_VERSION/LICENSE."* "$LICENSE_DIR/" 2>/dev/null || true
cp "$TMP_DIR/openssl-$OPENSSL_VERSION/LICENSE.txt" "$LICENSE_DIR/OPENSSL-LICENSE.txt"

rm -rf "$TMP_DIR"

echo "Licenses stored in $LICENSE_DIR"
echo "Sources stored in $SOURCE_DIR"

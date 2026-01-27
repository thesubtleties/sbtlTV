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

FFMPEG_VERSION="${FFMPEG_VERSION:-8.0.1}"
BUNDLE_ROOT="${BUNDLE_ROOT:-$REPO_ROOT/packages/electron/mpv-bundle}"
FFMPEG_PREFIX="${FFMPEG_PREFIX:-$BUNDLE_ROOT/$PLATFORM/ffmpeg}"
SRC_ROOT="${FFMPEG_SRC:-$REPO_ROOT/.build/ffmpeg-$FFMPEG_VERSION}"
BUILD_ROOT="${FFMPEG_BUILD_DIR:-$REPO_ROOT/.build/ffmpeg-build-$PLATFORM}"

OPENSSL_PREFIX="${OPENSSL_PREFIX:-}"

TARBALL="ffmpeg-${FFMPEG_VERSION}.tar.xz"
TARBALL_URL="https://ffmpeg.org/releases/${TARBALL}"

mkdir -p "$BUNDLE_ROOT" "$BUILD_ROOT" "$(dirname "$SRC_ROOT")"

if [ ! -d "$SRC_ROOT" ]; then
  TMP_DIR="$(mktemp -d)"
  echo "Downloading FFmpeg $FFMPEG_VERSION..."
  curl -L -o "$TMP_DIR/$TARBALL" "$TARBALL_URL"
  tar -xf "$TMP_DIR/$TARBALL" -C "$TMP_DIR"
  mv "$TMP_DIR/ffmpeg-$FFMPEG_VERSION" "$SRC_ROOT"
  rm -rf "$TMP_DIR"
fi

EXTRA_CFLAGS=("-fPIC" "-O2")
EXTRA_LDFLAGS=()
EXTRA_PKGCONFIG=()

if [ -n "$OPENSSL_PREFIX" ]; then
  EXTRA_CFLAGS+=("-I$OPENSSL_PREFIX/include")
  EXTRA_LDFLAGS+=("-L$OPENSSL_PREFIX/lib")
  EXTRA_PKGCONFIG+=("$OPENSSL_PREFIX/lib/pkgconfig")
fi

if [ "${#EXTRA_PKGCONFIG[@]}" -gt 0 ]; then
  export PKG_CONFIG_PATH="$(IFS=:; echo "${EXTRA_PKGCONFIG[*]}"):${PKG_CONFIG_PATH:-}"
fi

HWACCEL_FLAGS=()
if [ "$PLATFORM" = "linux" ]; then
  if pkg-config --exists libva; then
    HWACCEL_FLAGS+=("--enable-vaapi")
  fi
  if pkg-config --exists vdpau; then
    HWACCEL_FLAGS+=("--enable-vdpau")
  fi
fi
if [ "$PLATFORM" = "macos" ]; then
  HWACCEL_FLAGS+=("--enable-videotoolbox")
fi

JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN || sysctl -n hw.ncpu || echo 4)}"

cd "$BUILD_ROOT"

echo "Configuring FFmpeg..."
"$SRC_ROOT/configure" \
  --prefix="$FFMPEG_PREFIX" \
  --enable-shared \
  --disable-static \
  --disable-programs \
  --disable-doc \
  --disable-debug \
  --disable-everything \
  --enable-avcodec \
  --enable-avformat \
  --enable-avutil \
  --enable-swresample \
  --enable-swscale \
  --enable-network \
  --enable-openssl \
  --disable-gnutls \
  --enable-protocol=file,pipe,http,https,tcp,tls,crypto \
  --enable-demuxer=hls,mpegts,mpegtsraw,mov,aac,mp3 \
  --enable-decoder=h264,hevc,aac,mp3,opus,vorbis,mpeg2video \
  --enable-parser=h264,hevc,aac,opus,vorbis,mpegaudio \
  --enable-bsf=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb \
  "${HWACCEL_FLAGS[@]}" \
  --extra-cflags="${EXTRA_CFLAGS[*]}" \
  --extra-ldflags="${EXTRA_LDFLAGS[*]}"

echo "Building FFmpeg..."
make -j"$JOBS"
make install

echo "FFmpeg installed to $FFMPEG_PREFIX"

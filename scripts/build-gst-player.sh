#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SRC="$REPO_ROOT/packages/electron/gst-player/gst-player.c"
OUT_DIR="$REPO_ROOT/packages/electron/gst-player"
OUT="$OUT_DIR/gst-player"

mkdir -p "$OUT_DIR"

if ! command -v pkg-config >/dev/null 2>&1; then
	echo "pkg-config not found; install gstreamer dev packages" >&2
	exit 1
fi

PKG_MODULES=(gstreamer-1.0 gstreamer-video-1.0 gstreamer-audio-1.0 gstreamer-app-1.0)
if ! pkg-config --exists "${PKG_MODULES[@]}"; then
	echo "Missing GStreamer development packages (gstreamer-1.0, gstreamer-video-1.0, gstreamer-audio-1.0, gstreamer-app-1.0)" >&2
	exit 1
fi

CC=${CC:-cc}
CFLAGS="$(pkg-config --cflags "${PKG_MODULES[@]}")"
LIBS="$(pkg-config --libs "${PKG_MODULES[@]}")"

echo "[gst] Building helper..."
$CC $CFLAGS "$SRC" -o "$OUT" $LIBS
chmod +x "$OUT"
echo "[gst] Built $OUT"

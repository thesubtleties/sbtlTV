#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RAW_PLATFORM="${PLATFORM:-$(uname -s)}"
case "$RAW_PLATFORM" in
Linux) PLATFORM="linux" ;;
Darwin) PLATFORM="macos" ;;
*)
	echo "Unsupported platform: $RAW_PLATFORM" >&2
	exit 1
	;;
esac

MPV_VERSION="${MPV_VERSION:-0.41.0}"
BUNDLE_ROOT="${BUNDLE_ROOT:-$REPO_ROOT/packages/electron/mpv-bundle}"
MPV_PREFIX="${MPV_PREFIX:-$BUNDLE_ROOT/$PLATFORM/mpv}"
FFMPEG_STATIC="${FFMPEG_STATIC:-0}"
DEFAULT_FFMPEG_PREFIX="$BUNDLE_ROOT/$PLATFORM/ffmpeg"
if [ "$FFMPEG_STATIC" = "1" ]; then
	DEFAULT_FFMPEG_PREFIX="$BUNDLE_ROOT/$PLATFORM/ffmpeg-static"
fi
FFMPEG_PREFIX="${FFMPEG_PREFIX:-$DEFAULT_FFMPEG_PREFIX}"
SRC_ROOT="${MPV_SRC:-$REPO_ROOT/.build/mpv-$MPV_VERSION}"
DEFAULT_BUILD_ROOT="$REPO_ROOT/.build/mpv-build-$PLATFORM"
if [ "$FFMPEG_STATIC" = "1" ]; then
	DEFAULT_BUILD_ROOT="$REPO_ROOT/.build/mpv-build-$PLATFORM-static"
fi
BUILD_ROOT="${MPV_BUILD_DIR:-$DEFAULT_BUILD_ROOT}"

MPV_GPL="${MPV_GPL:-1}"

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
if [ "$FFMPEG_STATIC" = "1" ]; then
	if [ -n "${PKG_CONFIG:-}" ]; then
		export PKG_CONFIG="$PKG_CONFIG --static"
	else
		export PKG_CONFIG="pkg-config --static"
	fi
fi

JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN || sysctl -n hw.ncpu || echo 4)}"

if ! command -v meson >/dev/null 2>&1; then
	echo "meson not found (install meson + ninja) and retry" >&2
	exit 1
fi

if ! command -v ninja >/dev/null 2>&1; then
	echo "ninja not found (install ninja) and retry" >&2
	exit 1
fi

MESON_GPL="true"
if [ "${MPV_GPL:-1}" = "0" ]; then
	MESON_GPL="false"
fi

RPATH_SELF='$ORIGIN'
RPATH_LINK_ARGS="-Wl,-rpath,${RPATH_SELF}"

MESON_OPTS=(
	"-Dlibmpv=true"
	"-Dgpl=$MESON_GPL"
	"-Dgl=enabled"
	"-Degl=enabled"
	"-Dwayland=enabled"
	"-Degl-wayland=enabled"
	"-Ddmabuf-wayland=enabled"
	"-Dtests=false"
	"-Dfuzzers=false"
	"-Dmanpage-build=disabled"
	"-Dhtml-build=disabled"
	"-Dpdf-build=disabled"
	"-Dc_link_args=$RPATH_LINK_ARGS"
	"-Dcpp_link_args=$RPATH_LINK_ARGS"
)

if [ "$PLATFORM" = "linux" ]; then
	if pkg-config --exists libva; then
		MESON_OPTS+=("-Dvaapi=enabled")
	else
		MESON_OPTS+=("-Dvaapi=disabled")
		echo "libva not found; VAAPI disabled" >&2
	fi
	if pkg-config --exists libdrm; then
		MESON_OPTS+=("-Ddrm=enabled")
	else
		MESON_OPTS+=("-Ddrm=disabled")
		echo "libdrm not found; DRM disabled" >&2
	fi
	if pkg-config --exists gbm; then
		MESON_OPTS+=("-Dgbm=enabled")
	else
		MESON_OPTS+=("-Dgbm=disabled")
		echo "gbm not found; GBM disabled" >&2
	fi
	if ! pkg-config --exists libva-wayland; then
		echo "libva-wayland not found; VAAPI Wayland interop may fail" >&2
	fi
	if ! pkg-config --exists libva-x11; then
		echo "libva-x11 not found; VAAPI X11 interop may fail" >&2
	fi
fi

if [ "$MESON_GPL" = "true" ]; then
	MESON_OPTS+=(
		"-Dx11=enabled"
		"-Dgl-x11=enabled"
		"-Degl-x11=enabled"
	)
else
	MESON_OPTS+=(
		"-Dx11=disabled"
		"-Dgl-x11=disabled"
		"-Degl-x11=disabled"
	)
fi

if [ -f "$BUILD_ROOT/meson-private/coredata.dat" ]; then
	echo "Reconfiguring libmpv (meson)..."
	meson setup --reconfigure "$BUILD_ROOT" --prefix "$MPV_PREFIX" "${MESON_OPTS[@]}"
elif [ -d "$BUILD_ROOT" ] && [ "$(ls -A "$BUILD_ROOT" 2>/dev/null)" ]; then
	echo "Build dir exists but is not a Meson build: $BUILD_ROOT" >&2
	echo "Move it to trash and retry: trash \"$BUILD_ROOT\"" >&2
	exit 1
else
	echo "Configuring libmpv (meson)..."
	meson setup "$BUILD_ROOT" "$SRC_ROOT" --prefix "$MPV_PREFIX" "${MESON_OPTS[@]}"
fi

echo "Building libmpv..."
meson compile -C "$BUILD_ROOT" -j"$JOBS"
meson install -C "$BUILD_ROOT"

echo "mpv installed to $MPV_PREFIX"

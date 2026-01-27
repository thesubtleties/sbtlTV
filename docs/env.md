# Environment variables

read_when: adding/changing runtime flags or debugging playback/render issues

## Logging
- `SBTLTV_LOG_LEVEL=error|warn|info|debug|trace` (default: info)
- `SBTLTV_LOG_FILE=/path/to/log`
- `SBTLTV_MPV_LOG_LEVEL=v|debug|info|warn` (default: v)
- `SBTLTV_MPV_LOG_FILE=/path/to/log`

## libmpv / FFmpeg
- `SBTLTV_USE_SYSTEM_LIBMPV=1` use system libmpv instead of bundled
- `SBTLTV_DISABLE_LIBMPV=1` disable libmpv path (fallback to external mpv)
- `SBTLTV_PRELOAD_FFMPEG=1` dev only: preload bundled FFmpeg libs
- `SBTLTV_LIBMPV_PATH=/path/to/libmpv.so.2` override libmpv path

## YouTube / yt-dlp
- `SBTLTV_YTDL=yes|no` (default: auto) enable mpv ytdl integration
- `SBTLTV_YTDL_PATH=/path/to/yt-dlp` override ytdl binary
  - Unset: auto-enable for YouTube URLs only

## Hardware decode
- `SBTLTV_HWDEC=auto|auto-safe|vaapi|vdpau|nvdec` (default: auto-safe)
- `SBTLTV_HWDEC_GRACE_MS=5000` grace window before enforcing hwdec
- `SBTLTV_ALLOW_SWDEC=1` allow software decode fallback

## Renderer (Linux libmpv)
- `SBTLTV_RENDER_FPS=30` cap render loop fps
- `SBTLTV_RENDER_MAX_WIDTH=1920` cap render buffer width (0 = no cap)
- `SBTLTV_RENDER_MAX_HEIGHT=1080` cap render buffer height (0 = no cap)

## Native build/dev
- `SBTLTV_SKIP_NATIVE_BUILD=1` skip node-gyp rebuild if mpv.node exists

## Build scripts
- `FFMPEG_STATIC=0|1` static FFmpeg build toggle
- `FFMPEG_NVDEC=0|1` enable NVDEC/CUVID when ffnvcodec is available
- `FFMPEG_VERSION`, `MPV_VERSION`, `BUNDLE_ROOT`, `FFMPEG_PREFIX`, `MPV_PREFIX`
- `OPENSSL_PREFIX` (if OpenSSL not on pkg-config path)
- `MPV_GPL=0|1`

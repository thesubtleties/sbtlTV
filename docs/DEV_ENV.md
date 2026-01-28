# Dev Environment Flags

Flags for `pnpm dev` and local runs.

## Logging

- `SBTLTV_LOG_LEVEL=error|warn|info|debug|trace` log verbosity.
- `SBTLTV_LOG_FILE=/path/to/file.log` write combined main+renderer logs.

## Electron dev helpers

- `OPEN_DEVTOOLS=0` disable auto-open devtools.
- `SBTLTV_FORCE_GST_BUILD=1` force GStreamer helper rebuild.
- `SBTLTV_SKIP_GST_BUILD=1` skip helper build if present.
- `SBTLTV_FORCE_GST_COPY=1` force helper copy into `dist/`.
- `SBTLTV_SKIP_GST_COPY=1` skip helper copy.

## Linux playback

- `SBTLTV_GST_DEBUG=1` enable helper debug lines.
- `SBTLTV_GST_HTTP_DEBUG=1` log HTTP headers/metadata from souphttpsrc.
- `SBTLTV_GST_DUMP=1` dump pipeline graphs on error/warn.
- `SBTLTV_GST_DUMP_DIR=/tmp/gst-dots` set graph output dir.
- `SBTLTV_HTTP_USER_AGENT=...` override HTTP User-Agent.
- `SBTLTV_HTTP_REFERER=...` set HTTP Referer header.
- `SBTLTV_HTTP_TIMEOUT=30` souphttpsrc timeout (seconds).
- `SBTLTV_VSYNC=on|off` force vsync on/off for Electron/GPU.
- `SBTLTV_GST_FRAME_SOCKET` internal UDS path (set by app; do not set).

## YouTube resolving

- `SBTLTV_YTDL=yes|no` force yt-dlp usage (default auto for YouTube URLs).
- `SBTLTV_YTDL_PATH=/path/to/yt-dlp` override yt-dlp binary.

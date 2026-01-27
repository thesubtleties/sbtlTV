# mpv + FFmpeg bundling (Linux/macOS)

read_when: building bundled ffmpeg/libmpv or changing IPTV codec/protocol requirements

## Goals
- Bundle Linux/macOS only.
- GPU rendering (OpenGL/EGL).
- IPTV focus: HLS + MPEG-TS + M3U/M3U8 playlists.
- Codecs: H.264 + HEVC + AAC + MP3 + Opus + Vorbis (add others only when needed).
- TLS via OpenSSL.

## Licensing (not legal advice)
- FFmpeg is LGPL by default; enabling GPL parts with `--enable-gpl` makes the build GPL. OpenSSL compatibility depends on the GPL version you ship under; verify before distributing.
- mpv is GPL by default; the project notes it can be built LGPL by disabling GPL (`gpl=false`). Default here is GPL to enable X11 backends.
- Avoid `--enable-nonfree` in FFmpeg; it makes binaries unredistributable.

## Build scripts
Use:
- `scripts/build-ffmpeg.sh`
- `scripts/build-libmpv.sh` (defaults to GPL; set `MPV_GPL=0` for LGPL)
- `scripts/download-licenses.sh`

`scripts/build-mpv.sh` is a compatibility wrapper.

Static FFmpeg (recommended for Linux to avoid libav* collisions):
```bash
FFMPEG_STATIC=1 bash scripts/build-ffmpeg.sh
FFMPEG_STATIC=1 bash scripts/build-libmpv.sh
```

Notes:
- Static build defaults to `packages/electron/mpv-bundle/<platform>/ffmpeg-static/`.
- `build-libmpv.sh` uses `pkg-config --static` when `FFMPEG_STATIC=1`.
- If you need both static + shared outputs, set `FFMPEG_PREFIX`/`MPV_PREFIX` explicitly to separate paths.

Outputs go to `packages/electron/mpv-bundle/<platform>/`.

Runtime loading:
- Packaged app expects bundled libs in `resources/native/lib`.
- Dev loads from `packages/electron/mpv-bundle/<platform>/{ffmpeg,mpv}/lib` if present.
- Opt out and use system libs: `SBTLTV_USE_SYSTEM_LIBMPV=1`.
- libmpv is built with rpath to `$ORIGIN` so colocated FFmpeg libs resolve in `native/lib`.
- Static libmpv build removes `libav*` runtime dependencies (preferred).

Logging:
- `SBTLTV_MPV_LOG_LEVEL=v|debug|info|warn` controls mpv log verbosity (default: `v`).
- `SBTLTV_MPV_LOG_FILE=/path` writes mpv logs to a file.
- `SBTLTV_PRELOAD_FFMPEG=1` (dev only) preloads bundled FFmpeg libs to avoid system libs being picked first.
- `SBTLTV_LOG_FILE=/path` and `SBTLTV_LOG_LEVEL=debug` capture app logs (main + renderer).

Notes:
- X11 backends require `gpl=true` in mpv. If you must keep LGPL, X11 is disabled; Wayland/EGL only (`MPV_GPL=0`).
- GPL mpv means the combined app must be distributed under GPL‑compatible terms (AGPLv3 is compatible). Ensure you ship full corresponding source + build scripts for mpv/FFmpeg and any modifications.
- If you see `Protocol not found` from FFmpeg, ensure UDP is enabled (TLS/https depends on UDP helpers in FFmpeg).
- OpenSSL is a shared dependency; if you bundle `libssl` + `libcrypto`, include the OpenSSL license separately (not fetched by `scripts/download-licenses.sh`).

### Environment variables
- `FFMPEG_VERSION` (default in script)
- `MPV_VERSION` (default in script)
- `BUNDLE_ROOT` (default: `packages/electron/mpv-bundle`)
- `FFMPEG_PREFIX`, `MPV_PREFIX` (override install prefixes)
- `FFMPEG_STATIC=0|1` (default 0)
- `OPENSSL_PREFIX` (if OpenSSL is not in the system pkg-config path)
- `MPV_GPL=0|1` (default 1)

## IPTV feature set → FFmpeg components (baseline)
- Protocols: `file,pipe,http,https,tcp,tls,crypto,udp`
- Demuxers: `hls,mpegts,mpegtsraw,mov,aac,mp3`
- Decoders: `h264,hevc,aac,mp3,opus,vorbis,mpeg2video`
- Parsers: `h264,hevc,aac,opus,vorbis,mpegaudio`
- Bitstream filters: `aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb`

If a stream fails, add only the missing component and document it here.

## References
- FFmpeg licensing: https://ffmpeg.org/legal.html
- FFmpeg license: https://ffmpeg.org/legal.html#license
- mpv license notes: https://github.com/mpv-player/mpv

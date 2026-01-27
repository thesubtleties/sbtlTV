# mpv + FFmpeg bundling (Linux/macOS)

read_when: building bundled ffmpeg/libmpv or changing IPTV codec/protocol requirements

## Goals
- Bundle Linux/macOS only.
- GPU rendering (OpenGL/EGL).
- IPTV focus: HLS + MPEG-TS + M3U/M3U8 playlists.
- Codecs: H.264 + HEVC + AAC + MP3 + Opus + Vorbis (add others only when needed).
- TLS via OpenSSL.

## Licensing (not legal advice)
- FFmpeg is LGPL by default; enabling GPL parts with `--enable-gpl` makes the build GPL. FFmpeg license docs also note OpenSSL is incompatible with GPLv2/v3 but considered compatible with LGPL, so stay LGPL if we use OpenSSL.
- mpv is GPL by default; the project notes it can be built LGPL by disabling GPL (`gpl=false`). Use LGPL mode for libmpv.
- Avoid `--enable-nonfree` in FFmpeg; it makes binaries unredistributable.

## Build scripts
Use:
- `scripts/build-ffmpeg.sh`
- `scripts/build-mpv.sh`

Outputs go to `packages/electron/mpv-bundle/<platform>/`.

### Environment variables
- `FFMPEG_VERSION` (default in script)
- `MPV_VERSION` (default in script)
- `BUNDLE_ROOT` (default: `packages/electron/mpv-bundle`)
- `FFMPEG_PREFIX`, `MPV_PREFIX` (override install prefixes)
- `OPENSSL_PREFIX` (if OpenSSL is not in the system pkg-config path)
- `MPV_GPL=0|1` (default 0)

## IPTV feature set → FFmpeg components (baseline)
- Protocols: `file,pipe,http,https,tcp,tls,crypto`
- Demuxers: `hls,mpegts,mpegtsraw,mov,aac,mp3`
- Decoders: `h264,hevc,aac,mp3,opus,vorbis,mpeg2video`
- Parsers: `h264,hevc,aac,opus,vorbis,mpegaudio`
- Bitstream filters: `aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb`

If a stream fails, add only the missing component and document it here.

## References
- FFmpeg licensing: https://ffmpeg.org/legal.html
- FFmpeg license: https://ffmpeg.org/legal.html#license
- mpv license notes: https://github.com/mpv-player/mpv

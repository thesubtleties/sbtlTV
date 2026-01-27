# Plan

Fix Linux libmpv blank UI, prove runtime library/symbol resolution, move to static FFmpeg build while keeping shared‑lib fallback, validate on Xorg + Wayland, and align licensing/docs with actual build flags.

## Scope
- In: libmpv renderer blank UI debug, loader tracing, static FFmpeg build + shared‑lib fallback layout, symbol isolation, licensing/doc updates.
- Out: Windows/macOS renderer backends, UI feature work, cross‑platform refactor.

## Action items
- Inspect recent changes: diff last 3 commits vs prior, focus `packages/electron/native/mpv/mpv.c`, `packages/electron/src/preload.cts`, `packages/electron/native/mpv/binding.gyp`, build scripts.
- Repro blank UI on Linux with libmpv enabled; capture first error and mpv/app logs (`SBTLTV_LOG_LEVEL=debug`, `SBTLTV_MPV_LOG_LEVEL=debug`, log file path).
- Verify addon load path and init path: mpv.node selection, libmpv path, init errors, renderer init and buffer sizing.
- Confirm GL context path: EGL‑Wayland/EGL‑X11/GLX selection, FBO creation, framebuffer status, last error logs.
- Trace dynamic loader at runtime: `LD_DEBUG=libs,bindings` and capture which `libav*`, `libssl`, `libcrypto`, `libffmpeg` are loaded.
- Inspect RPATH/RUNPATH: `readelf -d` for `libmpv.so.2` and `libav*`, verify `$ORIGIN` strategy.
- Extend build scripts for static FFmpeg: adjust `scripts/build-ffmpeg.sh` (static), `scripts/build-libmpv.sh` (link against static), keep output under `packages/electron/mpv-bundle/<platform>/`.
- Keep shared‑lib fallback: co‑locate `libmpv.so.2` + `libav*` in `resources/native/lib`, set `$ORIGIN` RUNPATH at build or via `patchelf`.
- Add/verify Linux symbol isolation: `dlmopen(LM_ID_NEWLM)` on glibc with fallback `RTLD_DEEPBIND`, avoid Electron `libffmpeg` collisions.
- Validate playback with `https://content.uplynk.com/channel/3324f2467c414329b3b0cc5cd987b6be.m3u8` on Xorg + Wayland; confirm render + audio.
- If failures persist, distinguish protocol vs decoder errors and expand FFmpeg feature flags minimally; update `docs/mpv-bundling.md`.
- Licensing check: mpv GPL + FFmpeg GPL + OpenSSL, static link implications, tarball inclusion; update docs/NOTICE if mismatch.
- Verification: `pnpm build`/`pnpm typecheck` if feasible; document any gaps.

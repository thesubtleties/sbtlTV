/**
 * stub.cpp — No-op native addon for Windows.
 *
 * Why this exists:
 *   The mpv-texture native addon shares GPU textures via IOSurface (macOS)
 *   or EGL/GBM DMA-BUF (Linux). Windows still uses external mpv via the
 *   --wid flag and never loads this addon.
 *
 *   However, electron-builder's @electron/rebuild scans for packages with
 *   "gypfile": true and runs node-gyp rebuild on ALL platforms. Without
 *   this stub, the Windows build fails because mpv.lib doesn't exist
 *   (and shouldn't — Windows doesn't use the native addon).
 *
 *   This stub lets node-gyp succeed on Windows by producing a valid .node
 *   file that exports nothing. The preload layer (preload.cts) gates
 *   sharedTexture usage to darwin/linux, so this stub is never loaded at
 *   runtime.
 *
 * See also:
 *   - binding.gyp: conditionally compiles this stub vs the real addon
 *   - packages/electron/src/preload.cts: platform gate for sharedTexture
 *   - packages/electron/src/main.ts: USE_NATIVE_MPV (darwin, or linux unless
 *     --mpv-compatibility-mode was passed)
 */

#include <napi.h>

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  return exports;
}

NODE_API_MODULE(mpv_texture, Init)

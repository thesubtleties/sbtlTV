/**
 * stub.cpp — No-op native addon for non-macOS platforms.
 *
 * Why this exists:
 *   The mpv-texture native addon uses IOSurface for GPU texture sharing,
 *   which is macOS-only. Windows and Linux use external mpv via the --wid
 *   flag instead and never load this addon.
 *
 *   However, electron-builder's @electron/rebuild scans for packages with
 *   "gypfile": true and runs node-gyp rebuild on ALL platforms. Without
 *   this stub, the Windows build fails because mpv.lib doesn't exist
 *   (and shouldn't — Windows doesn't use the native addon).
 *
 *   This stub lets node-gyp succeed on non-macOS platforms by producing
 *   a valid .node file that exports nothing. The preload layer
 *   (preload.cts) gates native addon usage to darwin only, so this
 *   stub is never loaded at runtime.
 *
 * See also:
 *   - binding.gyp: conditionally compiles this stub vs the real addon
 *   - packages/electron/src/preload.cts: platform gate for sharedTexture
 *   - packages/electron/src/main.ts: USE_NATIVE_MPV = process.platform === 'darwin'
 */

#include <napi.h>

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  return exports;
}

NODE_API_MODULE(mpv_texture, Init)

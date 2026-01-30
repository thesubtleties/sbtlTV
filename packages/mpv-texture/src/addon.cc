#include <napi.h>
#include "mpv_controller.h"

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  MpvController::Init(env, exports);

  exports.Set("isSupported", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), MpvController::IsSupported());
  }));

  exports.Set("getPlatform", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
#if defined(__APPLE__)
    return Napi::String::New(info.Env(), "darwin");
#elif defined(_WIN32)
    return Napi::String::New(info.Env(), "win32");
#else
    return Napi::String::New(info.Env(), "linux");
#endif
  }));

  return exports;
}

NODE_API_MODULE(mpv_texture, Init)

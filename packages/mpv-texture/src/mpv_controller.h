#pragma once

#include <napi.h>
#include <mpv/client.h>
#include <mpv/render_gl.h>
#include <memory>
#include <functional>
#include <unordered_map>
#include <mutex>
#include <atomic>

// Forward declarations
class SharedTextureManager;
class PlatformGLContext;

class MpvController : public Napi::ObjectWrap<MpvController> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  static bool IsSupported();

  MpvController(const Napi::CallbackInfo& info);
  ~MpvController();

private:
  // N-API methods
  Napi::Value Initialize(const Napi::CallbackInfo& info);
  Napi::Value LoadFile(const Napi::CallbackInfo& info);
  Napi::Value Render(const Napi::CallbackInfo& info);
  void Resize(const Napi::CallbackInfo& info);
  Napi::Value Command(const Napi::CallbackInfo& info);
  Napi::Value GetProperty(const Napi::CallbackInfo& info);
  void SetProperty(const Napi::CallbackInfo& info);
  void ObserveProperty(const Napi::CallbackInfo& info);
  void Destroy(const Napi::CallbackInfo& info);
  Napi::Value IsInitialized(const Napi::CallbackInfo& info);

  // Internal helpers
  void HandleMpvEvent(mpv_event* event);
  static void* GetProcAddress(void* ctx, const char* name);
  static void OnMpvRenderUpdate(void* ctx);
  Napi::Object CreateTextureInfoObject(Napi::Env env);

  // State
  mpv_handle* mpv_ = nullptr;
  mpv_render_context* mpv_gl_ = nullptr;
  std::unique_ptr<PlatformGLContext> gl_context_;
  std::unique_ptr<SharedTextureManager> texture_manager_;

  uint32_t width_ = 0;
  uint32_t height_ = 0;
  std::atomic<bool> initialized_{false};
  std::atomic<bool> needs_render_{false};
  std::mutex render_mutex_;

  // Property observers
  std::unordered_map<uint64_t, Napi::ThreadSafeFunction> property_observers_;
  uint64_t next_observer_id_ = 1;
  std::mutex observers_mutex_;
};

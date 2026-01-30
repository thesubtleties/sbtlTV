#include "mpv_controller.h"
#include "shared_texture_manager.h"
#include "platform/platform.h"

#include <iostream>

Napi::Object MpvController::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "MpvController", {
    InstanceMethod("init", &MpvController::Initialize),
    InstanceMethod("loadFile", &MpvController::LoadFile),
    InstanceMethod("render", &MpvController::Render),
    InstanceMethod("resize", &MpvController::Resize),
    InstanceMethod("command", &MpvController::Command),
    InstanceMethod("getProperty", &MpvController::GetProperty),
    InstanceMethod("setProperty", &MpvController::SetProperty),
    InstanceMethod("observeProperty", &MpvController::ObserveProperty),
    InstanceMethod("destroy", &MpvController::Destroy),
    InstanceMethod("isInitialized", &MpvController::IsInitialized),
  });

  exports.Set("MpvController", func);
  return exports;
}

bool MpvController::IsSupported() {
#if defined(__APPLE__)
  return true;  // macOS with IOSurface
#elif defined(_WIN32)
  return true;  // Windows with D3D11
#else
  return false; // Linux DMA-BUF + WebGPU not ready yet
#endif
}

MpvController::MpvController(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<MpvController>(info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "Expected options object").ThrowAsJavaScriptException();
    return;
  }

  Napi::Object options = info[0].As<Napi::Object>();

  if (!options.Has("width") || !options.Has("height")) {
    Napi::TypeError::New(env, "Options must include width and height").ThrowAsJavaScriptException();
    return;
  }

  width_ = options.Get("width").As<Napi::Number>().Uint32Value();
  height_ = options.Get("height").As<Napi::Number>().Uint32Value();

  if (width_ == 0 || height_ == 0) {
    Napi::RangeError::New(env, "Width and height must be positive").ThrowAsJavaScriptException();
    return;
  }
}

MpvController::~MpvController() {
  if (mpv_gl_) {
    mpv_render_context_free(mpv_gl_);
    mpv_gl_ = nullptr;
  }
  if (mpv_) {
    mpv_terminate_destroy(mpv_);
    mpv_ = nullptr;
  }
  texture_manager_.reset();
  gl_context_.reset();
}

void* MpvController::GetProcAddress(void* ctx, const char* name) {
  auto* self = static_cast<MpvController*>(ctx);
  if (!self->gl_context_) return nullptr;
  return self->gl_context_->GetProcAddress(name);
}

void MpvController::OnMpvRenderUpdate(void* ctx) {
  auto* self = static_cast<MpvController*>(ctx);
  self->needs_render_.store(true, std::memory_order_release);
}

Napi::Value MpvController::Initialize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (initialized_.load()) {
    return Napi::Boolean::New(env, true);
  }

  // Create platform-specific GL context
  gl_context_ = PlatformGLContext::Create();
  if (!gl_context_ || !gl_context_->IsValid()) {
    Napi::Error::New(env, "Failed to create GL context").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!gl_context_->MakeCurrent()) {
    Napi::Error::New(env, "Failed to make GL context current").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Create shared texture manager
  texture_manager_ = SharedTextureManager::Create(gl_context_.get());
  if (!texture_manager_) {
    Napi::Error::New(env, "Failed to create shared texture manager").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!texture_manager_->Create(width_, height_)) {
    Napi::Error::New(env, "Failed to create shared texture").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Create mpv instance
  mpv_ = mpv_create();
  if (!mpv_) {
    Napi::Error::New(env, "Failed to create mpv instance").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Configure mpv for offscreen rendering
  mpv_set_option_string(mpv_, "vo", "libmpv");
  mpv_set_option_string(mpv_, "hwdec", "auto-safe");
  mpv_set_option_string(mpv_, "terminal", "no");
  mpv_set_option_string(mpv_, "msg-level", "all=warn");
  mpv_set_option_string(mpv_, "keep-open", "yes");
  mpv_set_option_string(mpv_, "idle", "yes");

  // Check for custom mpv path in options
  if (info.Length() > 0 && info[0].IsObject()) {
    Napi::Object options = info[0].As<Napi::Object>();
    if (options.Has("mpvConfigDir")) {
      std::string configDir = options.Get("mpvConfigDir").As<Napi::String>().Utf8Value();
      mpv_set_option_string(mpv_, "config-dir", configDir.c_str());
    }
  }

  int err = mpv_initialize(mpv_);
  if (err < 0) {
    std::string errMsg = "Failed to initialize mpv: ";
    errMsg += mpv_error_string(err);
    Napi::Error::New(env, errMsg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Create mpv render context with OpenGL
  mpv_opengl_init_params gl_init_params{};
  gl_init_params.get_proc_address = GetProcAddress;
  gl_init_params.get_proc_address_ctx = this;

  int advanced_control = 1;

  mpv_render_param params[] = {
    { MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_OPENGL) },
    { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init_params },
    { MPV_RENDER_PARAM_ADVANCED_CONTROL, &advanced_control },
    { MPV_RENDER_PARAM_INVALID, nullptr }
  };

  err = mpv_render_context_create(&mpv_gl_, mpv_, params);
  if (err < 0) {
    std::string errMsg = "Failed to create mpv render context: ";
    errMsg += mpv_error_string(err);
    Napi::Error::New(env, errMsg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Set update callback
  mpv_render_context_set_update_callback(mpv_gl_, OnMpvRenderUpdate, this);

  initialized_.store(true, std::memory_order_release);
  return Napi::Boolean::New(env, true);
}

Napi::Value MpvController::Render(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!initialized_.load(std::memory_order_acquire)) {
    return env.Null();
  }

  std::lock_guard<std::mutex> lock(render_mutex_);

  if (!gl_context_->MakeCurrent()) {
    return env.Null();
  }

  // Check if mpv needs to render
  uint64_t flags = mpv_render_context_update(mpv_gl_);
  if (!(flags & MPV_RENDER_UPDATE_FRAME)) {
    // Check our own flag (set by update callback)
    if (!needs_render_.exchange(false, std::memory_order_acq_rel)) {
      return env.Null();  // No new frame
    }
  }

  // Render to FBO
  int fbo = static_cast<int>(texture_manager_->GetFBO());
  mpv_opengl_fbo mpv_fbo{};
  mpv_fbo.fbo = fbo;
  mpv_fbo.w = static_cast<int>(width_);
  mpv_fbo.h = static_cast<int>(height_);
  mpv_fbo.internal_format = 0;  // Use default (GL_RGBA8)

  int flip_y = 1;  // Flip for correct orientation

  mpv_render_param render_params[] = {
    { MPV_RENDER_PARAM_OPENGL_FBO, &mpv_fbo },
    { MPV_RENDER_PARAM_FLIP_Y, &flip_y },
    { MPV_RENDER_PARAM_INVALID, nullptr }
  };

  int err = mpv_render_context_render(mpv_gl_, render_params);
  if (err < 0) {
    std::cerr << "[mpv-texture] Render failed: " << mpv_error_string(err) << std::endl;
    return env.Null();
  }

  // Report swap for timing
  mpv_render_context_report_swap(mpv_gl_);

  // Create result object with texture info
  return CreateTextureInfoObject(env);
}

Napi::Object MpvController::CreateTextureInfoObject(Napi::Env env) {
  Napi::Object result = Napi::Object::New(env);
  result.Set("needsDisplay", Napi::Boolean::New(env, true));

  // Get texture handle from manager
  TextureHandle handle = texture_manager_->GetHandle();

  // Create textureInfo object matching Electron's SharedTextureImported format
  Napi::Object textureInfo = Napi::Object::New(env);
  textureInfo.Set("pixelFormat", Napi::String::New(env, "bgra"));

  Napi::Object codedSize = Napi::Object::New(env);
  codedSize.Set("width", Napi::Number::New(env, handle.width));
  codedSize.Set("height", Napi::Number::New(env, handle.height));
  textureInfo.Set("codedSize", codedSize);

  Napi::Object visibleRect = Napi::Object::New(env);
  visibleRect.Set("x", Napi::Number::New(env, 0));
  visibleRect.Set("y", Napi::Number::New(env, 0));
  visibleRect.Set("width", Napi::Number::New(env, handle.width));
  visibleRect.Set("height", Napi::Number::New(env, handle.height));
  textureInfo.Set("visibleRect", visibleRect);

  // Create handle object with platform-specific data
  Napi::Object handleObj = Napi::Object::New(env);

  switch (handle.type) {
    case TextureHandle::Type::IOSurface: {
      // IOSurfaceID is a uint32_t - pack into Buffer
      auto buf = Napi::Buffer<uint8_t>::Copy(
        env,
        reinterpret_cast<const uint8_t*>(&handle.iosurface_id),
        sizeof(handle.iosurface_id)
      );
      handleObj.Set("ioSurface", buf);
      break;
    }
    case TextureHandle::Type::NTHandle: {
      // NT HANDLE - pack pointer into Buffer
      auto buf = Napi::Buffer<uint8_t>::Copy(
        env,
        reinterpret_cast<const uint8_t*>(&handle.nt_handle),
        sizeof(handle.nt_handle)
      );
      handleObj.Set("ntHandle", buf);
      break;
    }
    case TextureHandle::Type::DMABuf: {
      // DMA-BUF - create nativePixmap object
      Napi::Object pixmap = Napi::Object::New(env);
      Napi::Array planes = Napi::Array::New(env, 1);

      Napi::Object plane = Napi::Object::New(env);
      plane.Set("fd", Napi::Number::New(env, handle.dmabuf.fd));
      plane.Set("stride", Napi::Number::New(env, handle.dmabuf.stride));
      plane.Set("offset", Napi::Number::New(env, handle.dmabuf.offset));
      plane.Set("size", Napi::Number::New(env, handle.width * handle.height * 4));
      planes.Set(uint32_t(0), plane);

      pixmap.Set("planes", planes);
      pixmap.Set("modifier", Napi::String::New(env, std::to_string(handle.dmabuf.modifier)));
      pixmap.Set("supportsZeroCopyWebGpuImport", Napi::Boolean::New(env, false));

      handleObj.Set("nativePixmap", pixmap);
      break;
    }
  }

  textureInfo.Set("handle", handleObj);
  result.Set("textureInfo", textureInfo);

  return result;
}

Napi::Value MpvController::LoadFile(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!mpv_) {
    Napi::Error::New(env, "mpv not initialized").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected file path or URL string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string url = info[0].As<Napi::String>().Utf8Value();
  const char* cmd[] = { "loadfile", url.c_str(), nullptr };

  int err = mpv_command_async(mpv_, 0, cmd);
  if (err < 0) {
    std::string errMsg = "Failed to load file: ";
    errMsg += mpv_error_string(err);
    Napi::Error::New(env, errMsg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return env.Undefined();
}

void MpvController::Resize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected width and height numbers").ThrowAsJavaScriptException();
    return;
  }

  uint32_t width = info[0].As<Napi::Number>().Uint32Value();
  uint32_t height = info[1].As<Napi::Number>().Uint32Value();

  if (width == 0 || height == 0) {
    return;  // Ignore zero-size resize
  }

  if (width != width_ || height != height_) {
    std::lock_guard<std::mutex> lock(render_mutex_);

    width_ = width;
    height_ = height;

    if (texture_manager_ && gl_context_) {
      gl_context_->MakeCurrent();
      texture_manager_->Resize(width, height);
    }
  }
}

Napi::Value MpvController::Command(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!mpv_) {
    Napi::Error::New(env, "mpv not initialized").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected command string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string cmd = info[0].As<Napi::String>().Utf8Value();

  // Build args array
  std::vector<const char*> args;
  args.push_back(cmd.c_str());

  std::vector<std::string> argStrings;  // Keep strings alive
  for (size_t i = 1; i < info.Length(); i++) {
    if (info[i].IsString()) {
      argStrings.push_back(info[i].As<Napi::String>().Utf8Value());
      args.push_back(argStrings.back().c_str());
    } else if (info[i].IsNumber()) {
      argStrings.push_back(std::to_string(info[i].As<Napi::Number>().DoubleValue()));
      args.push_back(argStrings.back().c_str());
    } else if (info[i].IsBoolean()) {
      argStrings.push_back(info[i].As<Napi::Boolean>().Value() ? "yes" : "no");
      args.push_back(argStrings.back().c_str());
    }
  }
  args.push_back(nullptr);

  int err = mpv_command_async(mpv_, 0, args.data());
  if (err < 0) {
    std::string errMsg = "Command failed: ";
    errMsg += mpv_error_string(err);
    Napi::Error::New(env, errMsg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return env.Undefined();
}

Napi::Value MpvController::GetProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!mpv_) {
    Napi::Error::New(env, "mpv not initialized").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected property name string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string name = info[0].As<Napi::String>().Utf8Value();

  // Try to get as string first
  char* result = mpv_get_property_string(mpv_, name.c_str());
  if (result) {
    Napi::String str = Napi::String::New(env, result);
    mpv_free(result);
    return str;
  }

  // Try as double
  double dval;
  int err = mpv_get_property(mpv_, name.c_str(), MPV_FORMAT_DOUBLE, &dval);
  if (err >= 0) {
    return Napi::Number::New(env, dval);
  }

  // Try as int64
  int64_t ival;
  err = mpv_get_property(mpv_, name.c_str(), MPV_FORMAT_INT64, &ival);
  if (err >= 0) {
    return Napi::Number::New(env, static_cast<double>(ival));
  }

  // Try as flag (bool)
  int flag;
  err = mpv_get_property(mpv_, name.c_str(), MPV_FORMAT_FLAG, &flag);
  if (err >= 0) {
    return Napi::Boolean::New(env, flag != 0);
  }

  return env.Null();
}

void MpvController::SetProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!mpv_) {
    Napi::Error::New(env, "mpv not initialized").ThrowAsJavaScriptException();
    return;
  }

  if (info.Length() < 2 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected property name and value").ThrowAsJavaScriptException();
    return;
  }

  std::string name = info[0].As<Napi::String>().Utf8Value();

  int err = 0;
  if (info[1].IsString()) {
    std::string value = info[1].As<Napi::String>().Utf8Value();
    err = mpv_set_property_string(mpv_, name.c_str(), value.c_str());
  } else if (info[1].IsNumber()) {
    double value = info[1].As<Napi::Number>().DoubleValue();
    err = mpv_set_property(mpv_, name.c_str(), MPV_FORMAT_DOUBLE, &value);
  } else if (info[1].IsBoolean()) {
    int value = info[1].As<Napi::Boolean>().Value() ? 1 : 0;
    err = mpv_set_property(mpv_, name.c_str(), MPV_FORMAT_FLAG, &value);
  }

  if (err < 0) {
    std::string errMsg = "Failed to set property: ";
    errMsg += mpv_error_string(err);
    Napi::Error::New(env, errMsg).ThrowAsJavaScriptException();
  }
}

void MpvController::ObserveProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!mpv_) {
    Napi::Error::New(env, "mpv not initialized").ThrowAsJavaScriptException();
    return;
  }

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "Expected property name and callback function").ThrowAsJavaScriptException();
    return;
  }

  std::string name = info[0].As<Napi::String>().Utf8Value();
  Napi::Function callback = info[1].As<Napi::Function>();

  // Create thread-safe function for callback
  auto tsfn = Napi::ThreadSafeFunction::New(
    env,
    callback,
    "MpvPropertyObserver",
    0,  // Unlimited queue
    1   // Initial thread count
  );

  std::lock_guard<std::mutex> lock(observers_mutex_);
  uint64_t id = next_observer_id_++;
  property_observers_[id] = std::move(tsfn);

  // Observe the property
  int err = mpv_observe_property(mpv_, id, name.c_str(), MPV_FORMAT_STRING);
  if (err < 0) {
    property_observers_.erase(id);
    std::string errMsg = "Failed to observe property: ";
    errMsg += mpv_error_string(err);
    Napi::Error::New(env, errMsg).ThrowAsJavaScriptException();
  }
}

void MpvController::Destroy(const Napi::CallbackInfo& info) {
  std::lock_guard<std::mutex> lock(render_mutex_);

  // Clear observers
  {
    std::lock_guard<std::mutex> obs_lock(observers_mutex_);
    for (auto& pair : property_observers_) {
      pair.second.Release();
    }
    property_observers_.clear();
  }

  if (mpv_gl_) {
    mpv_render_context_free(mpv_gl_);
    mpv_gl_ = nullptr;
  }

  if (mpv_) {
    mpv_terminate_destroy(mpv_);
    mpv_ = nullptr;
  }

  texture_manager_.reset();
  gl_context_.reset();
  initialized_.store(false, std::memory_order_release);
}

Napi::Value MpvController::IsInitialized(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), initialized_.load(std::memory_order_acquire));
}

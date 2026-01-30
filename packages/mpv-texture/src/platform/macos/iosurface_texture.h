#pragma once

#ifdef __APPLE__

#include "../../shared_texture_manager.h"
#include <IOSurface/IOSurface.h>
#include <OpenGL/OpenGL.h>

class MacOSGLContext;

class IOSurfaceTexture : public SharedTextureManager {
public:
  explicit IOSurfaceTexture(MacOSGLContext* gl_context);
  ~IOSurfaceTexture() override;

  bool Create(uint32_t width, uint32_t height) override;
  bool Resize(uint32_t width, uint32_t height) override;
  TextureHandle GetHandle() const override;
  uint32_t GetGLTexture() const override { return gl_texture_; }
  uint32_t GetFBO() const override { return fbo_; }

private:
  void Cleanup();
  bool CreateIOSurface(uint32_t width, uint32_t height);
  bool BindToOpenGL();
  bool CreateFBO();

  MacOSGLContext* gl_context_;
  IOSurfaceRef io_surface_ = nullptr;
  uint32_t gl_texture_ = 0;
  uint32_t fbo_ = 0;
  uint32_t width_ = 0;
  uint32_t height_ = 0;
};

#endif // __APPLE__

#pragma once

#include "../platform.h"

#ifdef __APPLE__

#include <OpenGL/OpenGL.h>

class MacOSGLContext : public PlatformGLContext {
public:
  MacOSGLContext();
  ~MacOSGLContext() override;

  bool MakeCurrent() override;
  void* GetProcAddress(const char* name) override;
  bool IsValid() const override;

  CGLContextObj GetCGLContext() const { return cgl_context_; }

private:
  CGLContextObj cgl_context_ = nullptr;
  CGLPixelFormatObj pixel_format_ = nullptr;
};

#endif // __APPLE__

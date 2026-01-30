#include "gl_context_macos.h"

#ifdef __APPLE__

#include <OpenGL/gl3.h>
#include <dlfcn.h>
#include <iostream>

MacOSGLContext::MacOSGLContext() {
  // Try to create a hardware-accelerated OpenGL 4.1 Core context
  CGLPixelFormatAttribute attrs[] = {
    kCGLPFAAccelerated,
    kCGLPFANoRecovery,
    kCGLPFAAllowOfflineRenderers,  // Allow headless GPU
    kCGLPFAColorSize, (CGLPixelFormatAttribute)24,
    kCGLPFAAlphaSize, (CGLPixelFormatAttribute)8,
    kCGLPFADepthSize, (CGLPixelFormatAttribute)24,
    kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_GL4_Core,
    (CGLPixelFormatAttribute)0
  };

  GLint num_formats = 0;
  CGLError err = CGLChoosePixelFormat(attrs, &pixel_format_, &num_formats);

  if (err != kCGLNoError || num_formats == 0) {
    std::cerr << "[mpv-texture] GL 4.1 not available, trying GL 3.2" << std::endl;

    // Fallback to GL 3.2 Core if 4.1 not available
    CGLPixelFormatAttribute fallback_attrs[] = {
      kCGLPFAAccelerated,
      kCGLPFANoRecovery,
      kCGLPFAAllowOfflineRenderers,
      kCGLPFAColorSize, (CGLPixelFormatAttribute)24,
      kCGLPFAAlphaSize, (CGLPixelFormatAttribute)8,
      kCGLPFADepthSize, (CGLPixelFormatAttribute)24,
      kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
      (CGLPixelFormatAttribute)0
    };

    err = CGLChoosePixelFormat(fallback_attrs, &pixel_format_, &num_formats);
  }

  if (err != kCGLNoError || num_formats == 0) {
    std::cerr << "[mpv-texture] Failed to choose pixel format: " << CGLErrorString(err) << std::endl;
    return;
  }

  err = CGLCreateContext(pixel_format_, nullptr, &cgl_context_);
  if (err != kCGLNoError) {
    std::cerr << "[mpv-texture] Failed to create CGL context: " << CGLErrorString(err) << std::endl;
    CGLDestroyPixelFormat(pixel_format_);
    pixel_format_ = nullptr;
    return;
  }

  std::cout << "[mpv-texture] Created CGL context successfully" << std::endl;
}

MacOSGLContext::~MacOSGLContext() {
  if (cgl_context_) {
    // Clear current context if this is it
    if (CGLGetCurrentContext() == cgl_context_) {
      CGLSetCurrentContext(nullptr);
    }
    CGLDestroyContext(cgl_context_);
    cgl_context_ = nullptr;
  }
  if (pixel_format_) {
    CGLDestroyPixelFormat(pixel_format_);
    pixel_format_ = nullptr;
  }
}

bool MacOSGLContext::MakeCurrent() {
  if (!cgl_context_) {
    return false;
  }
  CGLError err = CGLSetCurrentContext(cgl_context_);
  if (err != kCGLNoError) {
    std::cerr << "[mpv-texture] Failed to make context current: " << CGLErrorString(err) << std::endl;
    return false;
  }
  return true;
}

void* MacOSGLContext::GetProcAddress(const char* name) {
  // Use dlsym with RTLD_DEFAULT to find OpenGL functions
  // This works because OpenGL.framework is linked
  return dlsym(RTLD_DEFAULT, name);
}

bool MacOSGLContext::IsValid() const {
  return cgl_context_ != nullptr;
}

// Factory implementation for macOS
std::unique_ptr<PlatformGLContext> PlatformGLContext::Create() {
  auto ctx = std::make_unique<MacOSGLContext>();
  if (!ctx->IsValid()) {
    return nullptr;
  }
  return ctx;
}

#endif // __APPLE__

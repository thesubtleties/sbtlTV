#include "iosurface_texture.h"
#include "gl_context_macos.h"

#ifdef __APPLE__

#include <OpenGL/gl3.h>
#include <OpenGL/CGLIOSurface.h>
#include <CoreVideo/CoreVideo.h>
#include <iostream>

IOSurfaceTexture::IOSurfaceTexture(MacOSGLContext* gl_context)
    : gl_context_(gl_context) {}

IOSurfaceTexture::~IOSurfaceTexture() {
  Cleanup();
}

void IOSurfaceTexture::Cleanup() {
  // Must have GL context current to delete GL objects
  if (gl_context_ && gl_context_->IsValid()) {
    gl_context_->MakeCurrent();
  }

  if (fbo_) {
    glDeleteFramebuffers(1, &fbo_);
    fbo_ = 0;
  }
  if (gl_texture_) {
    glDeleteTextures(1, &gl_texture_);
    gl_texture_ = 0;
  }
  if (io_surface_) {
    CFRelease(io_surface_);
    io_surface_ = nullptr;
  }

  width_ = 0;
  height_ = 0;
}

bool IOSurfaceTexture::Create(uint32_t width, uint32_t height) {
  if (width == 0 || height == 0) {
    std::cerr << "[mpv-texture] Invalid dimensions: " << width << "x" << height << std::endl;
    return false;
  }

  Cleanup();

  width_ = width;
  height_ = height;

  if (!CreateIOSurface(width, height)) {
    std::cerr << "[mpv-texture] Failed to create IOSurface" << std::endl;
    Cleanup();
    return false;
  }

  if (!BindToOpenGL()) {
    std::cerr << "[mpv-texture] Failed to bind IOSurface to OpenGL" << std::endl;
    Cleanup();
    return false;
  }

  if (!CreateFBO()) {
    std::cerr << "[mpv-texture] Failed to create FBO" << std::endl;
    Cleanup();
    return false;
  }

  std::cout << "[mpv-texture] Created IOSurface texture " << width << "x" << height
            << " (ID: " << IOSurfaceGetID(io_surface_) << ")" << std::endl;

  return true;
}

bool IOSurfaceTexture::CreateIOSurface(uint32_t width, uint32_t height) {
  // Create IOSurface with BGRA format (matches Electron's expectation)
  NSDictionary* properties = @{
    (__bridge id)kIOSurfaceWidth: @(width),
    (__bridge id)kIOSurfaceHeight: @(height),
    (__bridge id)kIOSurfaceBytesPerElement: @4,
    (__bridge id)kIOSurfaceBytesPerRow: @(width * 4),
    (__bridge id)kIOSurfaceAllocSize: @(width * height * 4),
    (__bridge id)kIOSurfacePixelFormat: @(kCVPixelFormatType_32BGRA),
    // Enable global lookup by ID (required for cross-process sharing)
    (__bridge id)kIOSurfaceIsGlobal: @YES,
  };

  io_surface_ = IOSurfaceCreate((__bridge CFDictionaryRef)properties);

  if (!io_surface_) {
    std::cerr << "[mpv-texture] IOSurfaceCreate failed" << std::endl;
    return false;
  }

  return true;
}

bool IOSurfaceTexture::BindToOpenGL() {
  if (!gl_context_ || !gl_context_->IsValid()) {
    std::cerr << "[mpv-texture] No valid GL context for binding" << std::endl;
    return false;
  }

  CGLContextObj cgl_ctx = gl_context_->GetCGLContext();
  if (!cgl_ctx) {
    std::cerr << "[mpv-texture] CGL context is null" << std::endl;
    return false;
  }

  // Generate texture
  glGenTextures(1, &gl_texture_);
  if (gl_texture_ == 0) {
    std::cerr << "[mpv-texture] glGenTextures failed" << std::endl;
    return false;
  }

  // Bind IOSurface to GL texture using GL_TEXTURE_RECTANGLE
  // Note: GL_TEXTURE_RECTANGLE is required for IOSurface on macOS
  glBindTexture(GL_TEXTURE_RECTANGLE, gl_texture_);

  CGLError err = CGLTexImageIOSurface2D(
    cgl_ctx,
    GL_TEXTURE_RECTANGLE,
    GL_RGBA8,                        // Internal format
    static_cast<GLsizei>(width_),
    static_cast<GLsizei>(height_),
    GL_BGRA,                         // Format (matches IOSurface pixel format)
    GL_UNSIGNED_INT_8_8_8_8_REV,     // Type (matches BGRA on little-endian)
    io_surface_,
    0                                // Plane
  );

  if (err != kCGLNoError) {
    std::cerr << "[mpv-texture] CGLTexImageIOSurface2D failed: " << CGLErrorString(err) << std::endl;
    glDeleteTextures(1, &gl_texture_);
    gl_texture_ = 0;
    return false;
  }

  // Set texture parameters
  glTexParameteri(GL_TEXTURE_RECTANGLE, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_RECTANGLE, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_RECTANGLE, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_RECTANGLE, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

  glBindTexture(GL_TEXTURE_RECTANGLE, 0);

  return true;
}

bool IOSurfaceTexture::CreateFBO() {
  glGenFramebuffers(1, &fbo_);
  if (fbo_ == 0) {
    std::cerr << "[mpv-texture] glGenFramebuffers failed" << std::endl;
    return false;
  }

  glBindFramebuffer(GL_FRAMEBUFFER, fbo_);

  // Attach texture to FBO
  glFramebufferTexture2D(
    GL_FRAMEBUFFER,
    GL_COLOR_ATTACHMENT0,
    GL_TEXTURE_RECTANGLE,
    gl_texture_,
    0
  );

  // Check FBO completeness
  GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
  glBindFramebuffer(GL_FRAMEBUFFER, 0);

  if (status != GL_FRAMEBUFFER_COMPLETE) {
    std::cerr << "[mpv-texture] Framebuffer not complete: 0x" << std::hex << status << std::dec << std::endl;
    glDeleteFramebuffers(1, &fbo_);
    fbo_ = 0;
    return false;
  }

  return true;
}

bool IOSurfaceTexture::Resize(uint32_t width, uint32_t height) {
  if (width == width_ && height == height_) {
    return true;
  }

  // Recreate with new size
  return Create(width, height);
}

TextureHandle IOSurfaceTexture::GetHandle() const {
  TextureHandle handle;
  handle.type = TextureHandle::Type::IOSurface;
  handle.width = width_;
  handle.height = height_;

  if (io_surface_) {
    handle.iosurface_id = IOSurfaceGetID(io_surface_);
  } else {
    handle.iosurface_id = 0;
  }

  return handle;
}

// Factory implementation for macOS
std::unique_ptr<SharedTextureManager> SharedTextureManager::Create(PlatformGLContext* gl_context) {
  auto* macos_ctx = dynamic_cast<MacOSGLContext*>(gl_context);
  if (!macos_ctx) {
    std::cerr << "[mpv-texture] Invalid GL context type for macOS" << std::endl;
    return nullptr;
  }

  return std::make_unique<IOSurfaceTexture>(macos_ctx);
}

#endif // __APPLE__

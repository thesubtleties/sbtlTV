#pragma once

#include <memory>

class PlatformGLContext {
public:
  virtual ~PlatformGLContext() = default;

  // Make this context current on the calling thread
  virtual bool MakeCurrent() = 0;

  // Get OpenGL proc address for mpv
  virtual void* GetProcAddress(const char* name) = 0;

  // Check if context is valid
  virtual bool IsValid() const = 0;

  // Factory method - creates platform-appropriate context
  static std::unique_ptr<PlatformGLContext> Create();
};

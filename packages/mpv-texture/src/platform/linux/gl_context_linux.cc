// Linux EGL context implementation
// TODO: Implement headless EGL context for DMA-BUF export

#ifdef __linux__

#include "../platform.h"
#include "../../shared_texture_manager.h"
#include <iostream>

// Stub implementation - Linux DMA-BUF + WebGPU not ready in Electron yet
class LinuxGLContext : public PlatformGLContext {
public:
  LinuxGLContext() {
    std::cerr << "[mpv-texture] Linux EGL context not yet implemented" << std::endl;
    std::cerr << "[mpv-texture] Linux DMA-BUF + WebGPU not yet supported in Electron" << std::endl;
  }

  ~LinuxGLContext() override = default;

  bool MakeCurrent() override { return false; }
  void* GetProcAddress(const char* name) override { return nullptr; }
  bool IsValid() const override { return false; }
};

std::unique_ptr<PlatformGLContext> PlatformGLContext::Create() {
  // Linux implementation for future when Electron supports DMA-BUF + WebGPU
  return nullptr;
}

#endif // __linux__

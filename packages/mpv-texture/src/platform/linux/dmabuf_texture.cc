// Linux DMA-BUF shared texture implementation
// TODO: Implement DMA-BUF export for future Electron WebGPU support

#ifdef __linux__

#include "../../shared_texture_manager.h"
#include "../platform.h"
#include <iostream>

// Stub implementation - Linux DMA-BUF + WebGPU not ready in Electron yet
class DMABufTexture : public SharedTextureManager {
public:
  DMABufTexture() {
    std::cerr << "[mpv-texture] Linux DMA-BUF texture not yet implemented" << std::endl;
  }

  ~DMABufTexture() override = default;

  bool Create(uint32_t width, uint32_t height) override { return false; }
  bool Resize(uint32_t width, uint32_t height) override { return false; }
  TextureHandle GetHandle() const override { return TextureHandle(); }
  uint32_t GetGLTexture() const override { return 0; }
  uint32_t GetFBO() const override { return 0; }
};

std::unique_ptr<SharedTextureManager> SharedTextureManager::Create(PlatformGLContext* gl_context) {
  // Linux implementation for future when Electron supports DMA-BUF + WebGPU
  return nullptr;
}

#endif // __linux__

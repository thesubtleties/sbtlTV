#pragma once

#include <cstdint>
#include <memory>

// Forward declaration
class PlatformGLContext;

struct TextureHandle {
  enum class Type { IOSurface, NTHandle, DMABuf };
  Type type;

  // Platform-specific handle data
  union {
    uint32_t iosurface_id;      // macOS: IOSurfaceID
    void* nt_handle;            // Windows: HANDLE
    struct {                    // Linux: DMA-BUF
      int fd;
      uint32_t stride;
      uint32_t offset;
      uint64_t modifier;
    } dmabuf;
  };

  uint32_t width;
  uint32_t height;

  TextureHandle() : type(Type::IOSurface), iosurface_id(0), width(0), height(0) {}
};

class SharedTextureManager {
public:
  virtual ~SharedTextureManager() = default;

  // Create shared texture of given size
  virtual bool Create(uint32_t width, uint32_t height) = 0;

  // Resize the texture (may recreate)
  virtual bool Resize(uint32_t width, uint32_t height) = 0;

  // Get handle for export to JS
  virtual TextureHandle GetHandle() const = 0;

  // Get OpenGL texture ID
  virtual uint32_t GetGLTexture() const = 0;

  // Get FBO ID
  virtual uint32_t GetFBO() const = 0;

  // Factory method - creates platform-appropriate manager
  static std::unique_ptr<SharedTextureManager> Create(PlatformGLContext* gl_context);
};

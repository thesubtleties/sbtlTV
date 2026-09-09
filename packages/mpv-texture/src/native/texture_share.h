/*
 * Platform texture-sharing seam.
 * Implementations own buffer allocation, export metadata, and frame lifetime.
 */

#ifndef TEXTURE_SHARE_H_
#define TEXTURE_SHARE_H_

#include <cstdint>
#include <string>
#include <vector>

namespace mpv_texture {

enum class TextureFormat {
    RGBA8,
    NV12,
    BGRA8
};

enum class TextureHandleType {
    IOSurface,
    NativePixmap,
    NTHandle
};

struct NativePixmapPlane {
    int fd = -1;
    uint32_t stride = 0;
    uint32_t offset = 0;
    uint64_t size = 0;
};

struct TextureInfo {
    TextureHandleType handle_type = TextureHandleType::IOSurface;
    uint64_t handle = 0;
    uint32_t buffer_id = 0;
    uint32_t width = 0;
    uint32_t height = 0;
    TextureFormat format = TextureFormat::RGBA8;
    std::vector<NativePixmapPlane> planes;
    std::string modifier;
    bool supports_zero_copy_webgpu_import = false;
    bool is_valid = false;
};

struct RenderTarget {
    uint32_t fbo = 0;
    uint32_t width = 0;
    uint32_t height = 0;
};

class ITextureShare {
public:
    virtual ~ITextureShare() = default;

    virtual bool initialize(void* gl_context) = 0;
    virtual bool createTexture(uint32_t width, uint32_t height) = 0;
    virtual bool resizeTexture(uint32_t width, uint32_t height) = 0;

    // Reserves a producer-owned slot. Returning false drops the incoming frame
    // rather than blocking or overwriting a slot still owned by Electron.
    virtual bool acquireRenderTarget(RenderTarget& target) = 0;
    virtual TextureInfo exportRenderTarget() = 0;
    virtual void abandonRenderTarget() = 0;

    virtual void releaseTexture(uint32_t buffer_id) = 0;
    virtual void destroy() = 0;
};

ITextureShare* createTextureShare();

} // namespace mpv_texture

#endif // TEXTURE_SHARE_H_

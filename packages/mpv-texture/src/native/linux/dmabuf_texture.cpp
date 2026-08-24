#ifdef __linux__

#include "../texture_share.h"
#include "egl_context.h"

#define GL_GLEXT_PROTOTYPES
#include <EGL/eglext.h>
#include <GL/gl.h>
#include <GL/glext.h>
#include <drm_fourcc.h>
#include <gbm.h>
#include <unistd.h>

#include <array>
#include <iostream>
#include <memory>
#include <mutex>
#include <vector>

namespace mpv_texture {

namespace {

constexpr size_t buffer_count = 3;

enum class SlotState {
    Free,
    Writing,
    Exported
};

struct DmaBufSlot {
    uint32_t id = 0;
    gbm_bo* bo = nullptr;
    EGLImageKHR image = EGL_NO_IMAGE_KHR;
    GLuint texture = 0;
    GLuint fbo = 0;
    uint64_t modifier = DRM_FORMAT_MOD_INVALID;
    std::vector<NativePixmapPlane> planes;
    SlotState state = SlotState::Free;
};

struct DmaBufPool {
    uint32_t width = 0;
    uint32_t height = 0;
    std::array<DmaBufSlot, buffer_count> slots;
};

bool allSlotsReleased(const DmaBufPool& pool) {
    for (const auto& slot : pool.slots) {
        if (slot.state != SlotState::Free) return false;
    }
    return true;
}

uint64_t planeSize(int fd, uint32_t stride, uint32_t height) {
    const off_t size = lseek(fd, 0, SEEK_END);
    if (size > 0) {
        lseek(fd, 0, SEEK_SET);
        return static_cast<uint64_t>(size);
    }
    return static_cast<uint64_t>(stride) * height;
}

} // namespace

class LinuxDmaBufTextureShare final : public ITextureShare {
public:
    ~LinuxDmaBufTextureShare() override { destroy(); }

    bool initialize(void* gl_context) override {
        m_context = static_cast<LinuxEglContext*>(gl_context);
        if (!m_context || !m_context->gbmDevice()) return false;

        m_createImage = reinterpret_cast<PFNEGLCREATEIMAGEKHRPROC>(
            m_context->getProcAddress("eglCreateImageKHR")
        );
        m_destroyImage = reinterpret_cast<PFNEGLDESTROYIMAGEKHRPROC>(
            m_context->getProcAddress("eglDestroyImageKHR")
        );
        m_imageTargetTexture = reinterpret_cast<PFNGLEGLIMAGETARGETTEXTURE2DOESPROC>(
            m_context->getProcAddress("glEGLImageTargetTexture2DOES")
        );
        const auto query_modifiers = reinterpret_cast<PFNEGLQUERYDMABUFMODIFIERSEXTPROC>(
            m_context->getProcAddress("eglQueryDmaBufModifiersEXT")
        );
        if (query_modifiers) {
            EGLint modifier_count = 0;
            if (query_modifiers(
                m_context->display(), DRM_FORMAT_ARGB8888, 0, nullptr, nullptr, &modifier_count
            ) && modifier_count > 0) {
                std::vector<EGLuint64KHR> modifiers(modifier_count);
                std::vector<EGLBoolean> external_only(modifier_count);
                if (query_modifiers(
                    m_context->display(),
                    DRM_FORMAT_ARGB8888,
                    modifier_count,
                    modifiers.data(),
                    external_only.data(),
                    &modifier_count
                )) {
                    for (EGLint index = 0; index < modifier_count; index++) {
                        if (!external_only[index]) m_renderModifiers.push_back(modifiers[index]);
                    }
                }
            }
        }
        return m_createImage && m_destroyImage && m_imageTargetTexture;
    }

    bool createTexture(uint32_t width, uint32_t height) override {
        auto pool = createPool(width, height);
        if (!pool) return false;

        std::lock_guard<std::mutex> lock(m_mutex);
        m_activePool = std::move(pool);
        return true;
    }

    bool resizeTexture(uint32_t width, uint32_t height) override {
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            if (m_activePool && m_activePool->width == width && m_activePool->height == height) {
                return true;
            }
        }

        // Allocate first so a failed resize leaves the current render target intact.
        auto replacement = createPool(width, height);
        if (!replacement) return false;

        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_activePool) m_retiredPools.push_back(std::move(m_activePool));
        m_activePool = std::move(replacement);
        cleanupRetiredPoolsLocked();
        return true;
    }

    bool acquireRenderTarget(RenderTarget& target) override {
        std::lock_guard<std::mutex> lock(m_mutex);
        cleanupRetiredPoolsLocked();
        if (!m_activePool || m_writingSlot) return false;

        for (auto& slot : m_activePool->slots) {
            if (slot.state != SlotState::Free) continue;
            slot.state = SlotState::Writing;
            m_writingSlot = &slot;
            target.fbo = slot.fbo;
            target.width = m_activePool->width;
            target.height = m_activePool->height;
            return true;
        }
        return false;
    }

    TextureInfo exportRenderTarget() override {
        std::lock_guard<std::mutex> lock(m_mutex);
        TextureInfo info;
        if (!m_activePool || !m_writingSlot || m_writingSlot->state != SlotState::Writing) {
            return info;
        }

        auto& slot = *m_writingSlot;
        slot.state = SlotState::Exported;
        info.handle_type = TextureHandleType::NativePixmap;
        info.buffer_id = slot.id;
        info.width = m_activePool->width;
        info.height = m_activePool->height;
        info.format = TextureFormat::BGRA8;
        info.planes = slot.planes;
        info.modifier = std::to_string(slot.modifier);
        info.supports_zero_copy_webgpu_import = false;
        info.is_valid = true;
        m_writingSlot = nullptr;
        return info;
    }

    void abandonRenderTarget() override {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_writingSlot) {
            m_writingSlot->state = SlotState::Free;
            m_writingSlot = nullptr;
        }
    }

    void releaseTexture(uint32_t buffer_id) override {
        std::lock_guard<std::mutex> lock(m_mutex);
        releaseFromPool(m_activePool.get(), buffer_id);
        for (auto& pool : m_retiredPools) {
            releaseFromPool(pool.get(), buffer_id);
        }
        // Retired GL resources are collected by the render thread on its next
        // acquire/resize, where the EGL context is current.
    }

    void destroy() override {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_writingSlot = nullptr;
        destroyPool(m_activePool.get());
        m_activePool.reset();
        for (auto& pool : m_retiredPools) destroyPool(pool.get());
        m_retiredPools.clear();
        m_context = nullptr;
    }

private:
    std::unique_ptr<DmaBufPool> createPool(uint32_t width, uint32_t height) {
        auto pool = std::make_unique<DmaBufPool>();
        pool->width = width;
        pool->height = height;

        for (auto& slot : pool->slots) {
            slot.id = m_nextBufferId++;
            if (!createSlot(slot, width, height)) {
                destroyPool(pool.get());
                return nullptr;
            }
        }

        std::cout << "[LinuxDmaBuf] Created " << buffer_count << " buffers "
                  << width << "x" << height << " on " << m_context->renderNode() << std::endl;
        return pool;
    }

    bool createSlot(DmaBufSlot& slot, uint32_t width, uint32_t height) {
        constexpr uint64_t linear_modifier = DRM_FORMAT_MOD_LINEAR;
        slot.bo = gbm_bo_create_with_modifiers2(
            m_context->gbmDevice(),
            width,
            height,
            GBM_FORMAT_ARGB8888,
            &linear_modifier,
            1,
            GBM_BO_USE_RENDERING
        );
        if (!slot.bo && !m_renderModifiers.empty()) {
            slot.bo = gbm_bo_create_with_modifiers2(
                m_context->gbmDevice(),
                width,
                height,
                GBM_FORMAT_ARGB8888,
                m_renderModifiers.data(),
                static_cast<unsigned int>(m_renderModifiers.size()),
                GBM_BO_USE_RENDERING
            );
        }
        if (!slot.bo) {
            std::cerr << "[LinuxDmaBuf] GBM buffer allocation failed" << std::endl;
            return false;
        }

        slot.modifier = gbm_bo_get_modifier(slot.bo);
        const int plane_count = gbm_bo_get_plane_count(slot.bo);
        if (plane_count <= 0 || plane_count > GBM_MAX_PLANES) return false;

        for (int plane_index = 0; plane_index < plane_count; plane_index++) {
            NativePixmapPlane plane;
            plane.fd = gbm_bo_get_fd_for_plane(slot.bo, plane_index);
            if (plane.fd < 0) return false;
            plane.stride = gbm_bo_get_stride_for_plane(slot.bo, plane_index);
            plane.offset = gbm_bo_get_offset(slot.bo, plane_index);
            plane.size = planeSize(plane.fd, plane.stride, height);
            slot.planes.push_back(plane);
        }

        slot.image = m_createImage(
            m_context->display(),
            EGL_NO_CONTEXT,
            EGL_NATIVE_PIXMAP_KHR,
            reinterpret_cast<EGLClientBuffer>(slot.bo),
            nullptr
        );
        if (slot.image == EGL_NO_IMAGE_KHR) {
            slot.image = createDmaBufImage(slot, width, height);
        }
        if (slot.image == EGL_NO_IMAGE_KHR) {
            std::cerr << "[LinuxDmaBuf] EGLImage creation failed" << std::endl;
            return false;
        }

        glGenTextures(1, &slot.texture);
        glBindTexture(GL_TEXTURE_2D, slot.texture);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        m_imageTargetTexture(GL_TEXTURE_2D, slot.image);

        glGenFramebuffers(1, &slot.fbo);
        glBindFramebuffer(GL_FRAMEBUFFER, slot.fbo);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, slot.texture, 0);
        const GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        if (status != GL_FRAMEBUFFER_COMPLETE) {
            std::cerr << "[LinuxDmaBuf] Incomplete framebuffer: 0x" << std::hex << status << std::dec << std::endl;
            return false;
        }

        if (m_context->debugLogging()) {
            std::cout << "[LinuxDmaBuf] buffer=" << slot.id
                      << " fourcc=ARGB8888 modifier=" << slot.modifier
                      << " planes=" << slot.planes.size();
            for (const auto& plane : slot.planes) {
                std::cout << " [fd=" << plane.fd << " stride=" << plane.stride
                          << " offset=" << plane.offset << " size=" << plane.size << "]";
            }
            std::cout << std::endl;
        }
        return true;
    }

    EGLImageKHR createDmaBufImage(const DmaBufSlot& slot, uint32_t width, uint32_t height) {
        if (slot.planes.size() > 4) return EGL_NO_IMAGE_KHR;

        constexpr EGLint fd_attributes[] = {
            EGL_DMA_BUF_PLANE0_FD_EXT, EGL_DMA_BUF_PLANE1_FD_EXT,
            EGL_DMA_BUF_PLANE2_FD_EXT, EGL_DMA_BUF_PLANE3_FD_EXT
        };
        constexpr EGLint offset_attributes[] = {
            EGL_DMA_BUF_PLANE0_OFFSET_EXT, EGL_DMA_BUF_PLANE1_OFFSET_EXT,
            EGL_DMA_BUF_PLANE2_OFFSET_EXT, EGL_DMA_BUF_PLANE3_OFFSET_EXT
        };
        constexpr EGLint pitch_attributes[] = {
            EGL_DMA_BUF_PLANE0_PITCH_EXT, EGL_DMA_BUF_PLANE1_PITCH_EXT,
            EGL_DMA_BUF_PLANE2_PITCH_EXT, EGL_DMA_BUF_PLANE3_PITCH_EXT
        };
        constexpr EGLint modifier_low_attributes[] = {
            EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT, EGL_DMA_BUF_PLANE1_MODIFIER_LO_EXT,
            EGL_DMA_BUF_PLANE2_MODIFIER_LO_EXT, EGL_DMA_BUF_PLANE3_MODIFIER_LO_EXT
        };
        constexpr EGLint modifier_high_attributes[] = {
            EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT, EGL_DMA_BUF_PLANE1_MODIFIER_HI_EXT,
            EGL_DMA_BUF_PLANE2_MODIFIER_HI_EXT, EGL_DMA_BUF_PLANE3_MODIFIER_HI_EXT
        };

        std::vector<EGLint> attributes = {
            EGL_WIDTH, static_cast<EGLint>(width),
            EGL_HEIGHT, static_cast<EGLint>(height),
            EGL_LINUX_DRM_FOURCC_EXT, static_cast<EGLint>(DRM_FORMAT_ARGB8888)
        };
        for (size_t index = 0; index < slot.planes.size(); index++) {
            const auto& plane = slot.planes[index];
            attributes.insert(attributes.end(), {
                fd_attributes[index], plane.fd,
                offset_attributes[index], static_cast<EGLint>(plane.offset),
                pitch_attributes[index], static_cast<EGLint>(plane.stride)
            });
            if (slot.modifier != DRM_FORMAT_MOD_INVALID) {
                attributes.insert(attributes.end(), {
                    modifier_low_attributes[index], static_cast<EGLint>(slot.modifier & 0xffffffff),
                    modifier_high_attributes[index], static_cast<EGLint>(slot.modifier >> 32)
                });
            }
        }
        attributes.push_back(EGL_NONE);

        return m_createImage(
            m_context->display(),
            EGL_NO_CONTEXT,
            EGL_LINUX_DMA_BUF_EXT,
            nullptr,
            attributes.data()
        );
    }

    void destroySlot(DmaBufSlot& slot) {
        if (slot.fbo) glDeleteFramebuffers(1, &slot.fbo);
        if (slot.texture) glDeleteTextures(1, &slot.texture);
        if (slot.image != EGL_NO_IMAGE_KHR && m_context) {
            m_destroyImage(m_context->display(), slot.image);
        }
        for (const auto& plane : slot.planes) {
            if (plane.fd >= 0) close(plane.fd);
        }
        if (slot.bo) gbm_bo_destroy(slot.bo);
        slot = DmaBufSlot{};
    }

    void destroyPool(DmaBufPool* pool) {
        if (!pool) return;
        for (auto& slot : pool->slots) destroySlot(slot);
    }

    void cleanupRetiredPoolsLocked() {
        auto pool = m_retiredPools.begin();
        while (pool != m_retiredPools.end()) {
            if (allSlotsReleased(**pool)) {
                destroyPool(pool->get());
                pool = m_retiredPools.erase(pool);
            } else {
                ++pool;
            }
        }
    }

    static void releaseFromPool(DmaBufPool* pool, uint32_t buffer_id) {
        if (!pool) return;
        for (auto& slot : pool->slots) {
            if (slot.id == buffer_id && slot.state == SlotState::Exported) {
                slot.state = SlotState::Free;
                return;
            }
        }
    }

    LinuxEglContext* m_context = nullptr;
    PFNEGLCREATEIMAGEKHRPROC m_createImage = nullptr;
    PFNEGLDESTROYIMAGEKHRPROC m_destroyImage = nullptr;
    PFNGLEGLIMAGETARGETTEXTURE2DOESPROC m_imageTargetTexture = nullptr;
    std::vector<uint64_t> m_renderModifiers;
    std::unique_ptr<DmaBufPool> m_activePool;
    std::vector<std::unique_ptr<DmaBufPool>> m_retiredPools;
    DmaBufSlot* m_writingSlot = nullptr;
    uint32_t m_nextBufferId = 1;
    std::mutex m_mutex;
};

ITextureShare* createTextureShare() {
    return new LinuxDmaBufTextureShare();
}

} // namespace mpv_texture

#endif // __linux__

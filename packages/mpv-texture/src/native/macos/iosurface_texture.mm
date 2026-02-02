/*
 * macOS IOSurface texture sharing implementation
 */

#ifdef __APPLE__

#include "../texture_share.h"
#define GL_SILENCE_DEPRECATION
#include <OpenGL/gl3.h>
#include <OpenGL/OpenGL.h>
#include <OpenGL/CGLIOSurface.h>
#include <IOSurface/IOSurface.h>
#include <CoreFoundation/CoreFoundation.h>
#include <iostream>

namespace mpv_texture {

class IOSurfaceTextureShare : public ITextureShare {
public:
    IOSurfaceTextureShare() = default;
    ~IOSurfaceTextureShare() override { destroy(); }

    bool initialize(void* gl_context) override {
        m_cglContext = static_cast<CGLContextObj>(gl_context);
        if (!m_cglContext) {
            m_cglContext = CGLGetCurrentContext();
        }

        if (!m_cglContext) {
            std::cerr << "[IOSurface] No CGL context available" << std::endl;
            return false;
        }

        m_initialized = true;
        return true;
    }

    bool createTexture(uint32_t width, uint32_t height) override {
        if (!m_initialized) return false;

        m_width = width;
        m_height = height;

        // Create IOSurface
        CFMutableDictionaryRef properties = CFDictionaryCreateMutable(
            kCFAllocatorDefault,
            0,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks
        );

        int32_t w = static_cast<int32_t>(width);
        int32_t h = static_cast<int32_t>(height);
        int32_t bytesPerElement = 4;
        int32_t bytesPerRow = width * bytesPerElement;
        int32_t pixelFormat = 'BGRA'; // kCVPixelFormatType_32BGRA

        CFNumberRef widthNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &w);
        CFNumberRef heightNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &h);
        CFNumberRef bpeNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &bytesPerElement);
        CFNumberRef bprNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &bytesPerRow);
        CFNumberRef pfNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &pixelFormat);

        CFDictionarySetValue(properties, kIOSurfaceWidth, widthNum);
        CFDictionarySetValue(properties, kIOSurfaceHeight, heightNum);
        CFDictionarySetValue(properties, kIOSurfaceBytesPerElement, bpeNum);
        CFDictionarySetValue(properties, kIOSurfaceBytesPerRow, bprNum);
        CFDictionarySetValue(properties, kIOSurfacePixelFormat, pfNum);

        m_ioSurface = IOSurfaceCreate(properties);

        CFRelease(widthNum);
        CFRelease(heightNum);
        CFRelease(bpeNum);
        CFRelease(bprNum);
        CFRelease(pfNum);
        CFRelease(properties);

        if (!m_ioSurface) {
            std::cerr << "[IOSurface] Failed to create IOSurface" << std::endl;
            return false;
        }

        // Create OpenGL texture backed by IOSurface
        glGenTextures(1, &m_glTexture);
        glBindTexture(GL_TEXTURE_RECTANGLE, m_glTexture);

        CGLError err = CGLTexImageIOSurface2D(
            m_cglContext,
            GL_TEXTURE_RECTANGLE,
            GL_RGBA8,
            width,
            height,
            GL_BGRA,
            GL_UNSIGNED_INT_8_8_8_8_REV,
            m_ioSurface,
            0
        );

        if (err != kCGLNoError) {
            std::cerr << "[IOSurface] Failed to bind IOSurface to texture: " << err << std::endl;
            return false;
        }

        // Create FBO
        glGenFramebuffers(1, &m_glFBO);
        glBindFramebuffer(GL_FRAMEBUFFER, m_glFBO);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_RECTANGLE, m_glTexture, 0);

        GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
        if (status != GL_FRAMEBUFFER_COMPLETE) {
            std::cerr << "[IOSurface] FBO incomplete: " << std::hex << status << std::endl;
            return false;
        }

        glBindFramebuffer(GL_FRAMEBUFFER, 0);

        std::cout << "[IOSurface] Created shared texture " << width << "x" << height << std::endl;
        return true;
    }

    bool resizeTexture(uint32_t width, uint32_t height) override {
        if (width == m_width && height == m_height) {
            return true;
        }

        // Destroy old resources
        if (m_glFBO) {
            glDeleteFramebuffers(1, &m_glFBO);
            m_glFBO = 0;
        }
        if (m_glTexture) {
            glDeleteTextures(1, &m_glTexture);
            m_glTexture = 0;
        }
        if (m_ioSurface) {
            CFRelease(m_ioSurface);
            m_ioSurface = nullptr;
        }

        // Create new resources
        return createTexture(width, height);
    }

    uint32_t getGLTexture() const override {
        return m_glTexture;
    }

    uint32_t getGLFBO() const override {
        return m_glFBO;
    }

    bool lockTexture() override {
        if (!m_ioSurface) return false;

        IOReturn result = IOSurfaceLock(m_ioSurface, 0, nullptr);
        if (result != kIOReturnSuccess) {
            std::cerr << "[IOSurface] Failed to lock: " << result << std::endl;
            return false;
        }

        m_locked = true;
        return true;
    }

    TextureInfo unlockAndExport() override {
        TextureInfo info = {};

        if (!m_locked) {
            return info;
        }

        IOReturn result = IOSurfaceUnlock(m_ioSurface, 0, nullptr);
        if (result != kIOReturnSuccess) {
            std::cerr << "[IOSurface] Failed to unlock: " << result << std::endl;
            return info;
        }

        m_locked = false;

        // Get IOSurface ID for sharing
        IOSurfaceID surfaceId = IOSurfaceGetID(m_ioSurface);

        info.handle = static_cast<uint64_t>(surfaceId);
        info.width = m_width;
        info.height = m_height;
        info.format = TextureFormat::BGRA8;
        info.is_valid = true;

        return info;
    }

    void releaseTexture() override {
        // Nothing special needed - IOSurface handles reference counting
    }

    void destroy() override {
        if (m_locked && m_ioSurface) {
            IOSurfaceUnlock(m_ioSurface, 0, nullptr);
            m_locked = false;
        }

        if (m_glFBO) {
            glDeleteFramebuffers(1, &m_glFBO);
            m_glFBO = 0;
        }

        if (m_glTexture) {
            glDeleteTextures(1, &m_glTexture);
            m_glTexture = 0;
        }

        if (m_ioSurface) {
            CFRelease(m_ioSurface);
            m_ioSurface = nullptr;
        }

        m_initialized = false;
    }

private:
    bool m_initialized = false;
    bool m_locked = false;
    uint32_t m_width = 0;
    uint32_t m_height = 0;

    CGLContextObj m_cglContext = nullptr;
    IOSurfaceRef m_ioSurface = nullptr;
    GLuint m_glTexture = 0;
    GLuint m_glFBO = 0;
};

// Factory function
ITextureShare* createTextureShare() {
    return new IOSurfaceTextureShare();
}

} // namespace mpv_texture

#endif // __APPLE__

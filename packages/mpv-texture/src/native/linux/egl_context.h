#ifndef LINUX_EGL_CONTEXT_H_
#define LINUX_EGL_CONTEXT_H_

#ifdef __linux__

#include <EGL/egl.h>
#include <cstdint>
#include <memory>
#include <string>

struct gbm_device;

namespace mpv_texture {

class LinuxEglContext {
public:
    // On failure returns nullptr and, when error_out is given, a short reason
    // suitable for surfacing to the user.
    static std::unique_ptr<LinuxEglContext> create(
        uint32_t preferred_vendor_id,
        uint32_t preferred_device_id,
        bool debug_logging,
        std::string* error_out = nullptr
    );

    ~LinuxEglContext();

    bool makeCurrent();
    void clearCurrent();
    void* getProcAddress(const char* name) const;

    EGLDisplay display() const { return m_display; }
    gbm_device* gbmDevice() const { return m_gbmDevice; }
    // Open file descriptor for the selected DRM render node; -1 before
    // initialization. Handed to libmpv so its VA-API interop can create a
    // VADisplay without an X11 or Wayland connection.
    int drmFd() const { return m_drmFd; }
    // Whether eglCreateImageKHR accepts EGL_DMA_BUF_PLANEn_MODIFIER_* attributes.
    bool supportsDmaBufImportModifiers() const { return m_supportsDmaBufImportModifiers; }
    const std::string& renderNode() const { return m_renderNode; }
    bool debugLogging() const { return m_debugLogging; }

private:
    LinuxEglContext() = default;

    bool initializeDevice(const std::string& render_node);
    void destroyDevice();

    int m_drmFd = -1;
    gbm_device* m_gbmDevice = nullptr;
    EGLDisplay m_display = EGL_NO_DISPLAY;
    EGLContext m_context = EGL_NO_CONTEXT;
    EGLSurface m_surface = EGL_NO_SURFACE;
    std::string m_renderNode;
    std::string m_lastFailure;
    bool m_debugLogging = false;
    bool m_supportsDmaBufImportModifiers = false;
};

} // namespace mpv_texture

#endif // __linux__

#endif // LINUX_EGL_CONTEXT_H_

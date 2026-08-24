#ifdef __linux__

#include "egl_context.h"

#include <EGL/eglext.h>
#include <GL/gl.h>
#include <fcntl.h>
#include <gbm.h>
#include <unistd.h>
#include <xf86drm.h>

#include <algorithm>
#include <cstring>
#include <dlfcn.h>
#include <iostream>
#include <vector>

namespace mpv_texture {

namespace {

struct RenderNodeCandidate {
    std::string path;
    uint32_t vendor_id = 0;
    uint32_t device_id = 0;
    bool preferred = false;
};

std::vector<RenderNodeCandidate> enumerateRenderNodes(
    uint32_t preferred_vendor_id,
    uint32_t preferred_device_id
) {
    constexpr int max_devices = 32;
    drmDevicePtr devices[max_devices] = {};
    const int count = drmGetDevices2(0, devices, max_devices);
    std::vector<RenderNodeCandidate> candidates;

    if (count < 0) {
        std::cerr << "[LinuxEGL] Failed to enumerate DRM devices" << std::endl;
        return candidates;
    }

    for (int index = 0; index < count; index++) {
        const auto* device = devices[index];
        if (!device || !(device->available_nodes & (1 << DRM_NODE_RENDER))) {
            continue;
        }

        RenderNodeCandidate candidate;
        candidate.path = device->nodes[DRM_NODE_RENDER];
        if (device->bustype == DRM_BUS_PCI && device->deviceinfo.pci) {
            candidate.vendor_id = device->deviceinfo.pci->vendor_id;
            candidate.device_id = device->deviceinfo.pci->device_id;
        }
        candidate.preferred = preferred_vendor_id != 0 &&
            candidate.vendor_id == preferred_vendor_id &&
            (preferred_device_id == 0 || candidate.device_id == preferred_device_id);
        candidates.push_back(std::move(candidate));
    }

    drmFreeDevices(devices, count);
    std::stable_sort(candidates.begin(), candidates.end(), [](const auto& left, const auto& right) {
        return left.preferred && !right.preferred;
    });
    return candidates;
}

bool hasExtension(const char* extensions, const char* extension) {
    if (!extensions || !extension) return false;
    const std::string all_extensions = extensions;
    const std::string wanted = extension;
    size_t position = 0;
    while ((position = all_extensions.find(wanted, position)) != std::string::npos) {
        const bool starts_at_boundary = position == 0 || all_extensions[position - 1] == ' ';
        const size_t end = position + wanted.size();
        const bool ends_at_boundary = end == all_extensions.size() || all_extensions[end] == ' ';
        if (starts_at_boundary && ends_at_boundary) return true;
        position = end;
    }
    return false;
}

} // namespace

std::unique_ptr<LinuxEglContext> LinuxEglContext::create(
    uint32_t preferred_vendor_id,
    uint32_t preferred_device_id,
    bool debug_logging
) {
    auto context = std::unique_ptr<LinuxEglContext>(new LinuxEglContext());
    context->m_debugLogging = debug_logging;

    const auto candidates = enumerateRenderNodes(preferred_vendor_id, preferred_device_id);
    for (const auto& candidate : candidates) {
        if (debug_logging) {
            std::cout << "[LinuxEGL] Trying " << candidate.path
                      << " vendor=0x" << std::hex << candidate.vendor_id
                      << " device=0x" << candidate.device_id << std::dec
                      << (candidate.preferred ? " (Chromium match)" : "") << std::endl;
        }
        if (context->initializeDevice(candidate.path)) {
            return context;
        }
        context->destroyDevice();
    }

    std::cerr << "[LinuxEGL] No usable DRM render node found" << std::endl;
    return nullptr;
}

LinuxEglContext::~LinuxEglContext() {
    destroyDevice();
}

bool LinuxEglContext::initializeDevice(const std::string& render_node) {
    const auto fail = [this, &render_node](const char* stage) {
        if (m_debugLogging) {
            std::cerr << "[LinuxEGL] " << render_node << " failed at " << stage
                      << " EGL error=0x" << std::hex << eglGetError() << std::dec << std::endl;
        }
        return false;
    };

    m_drmFd = open(render_node.c_str(), O_RDWR | O_CLOEXEC);
    if (m_drmFd < 0) return fail("open");

    m_gbmDevice = gbm_create_device(m_drmFd);
    if (!m_gbmDevice) return fail("gbm_create_device");

    auto get_platform_display = reinterpret_cast<PFNEGLGETPLATFORMDISPLAYEXTPROC>(
        eglGetProcAddress("eglGetPlatformDisplayEXT")
    );
    if (get_platform_display) {
        m_display = get_platform_display(EGL_PLATFORM_GBM_KHR, m_gbmDevice, nullptr);
    } else {
        m_display = eglGetDisplay(reinterpret_cast<EGLNativeDisplayType>(m_gbmDevice));
    }
    if (m_display == EGL_NO_DISPLAY) return fail("eglGetPlatformDisplay");

    EGLint major = 0;
    EGLint minor = 0;
    if (!eglInitialize(m_display, &major, &minor)) return fail("eglInitialize");
    if (!eglBindAPI(EGL_OPENGL_API)) return fail("eglBindAPI");
    const char* extensions = eglQueryString(m_display, EGL_EXTENSIONS);
    const bool supports_surfaceless = hasExtension(extensions, "EGL_KHR_surfaceless_context");

    const EGLint config_attributes[] = {
        EGL_SURFACE_TYPE, supports_surfaceless ? 0 : EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT,
        EGL_RED_SIZE, 8,
        EGL_GREEN_SIZE, 8,
        EGL_BLUE_SIZE, 8,
        EGL_ALPHA_SIZE, 8,
        EGL_NONE
    };
    EGLConfig config = nullptr;
    EGLint config_count = 0;
    if (!eglChooseConfig(m_display, config_attributes, &config, 1, &config_count) || config_count == 0) {
        return fail("eglChooseConfig");
    }

    const EGLint context_attributes[] = {
        EGL_CONTEXT_MAJOR_VERSION_KHR, 3,
        EGL_CONTEXT_MINOR_VERSION_KHR, 2,
        EGL_CONTEXT_OPENGL_PROFILE_MASK_KHR, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT_KHR,
        EGL_NONE
    };
    m_context = eglCreateContext(m_display, config, EGL_NO_CONTEXT, context_attributes);
    if (m_context == EGL_NO_CONTEXT) {
        m_context = eglCreateContext(m_display, config, EGL_NO_CONTEXT, nullptr);
    }
    if (m_context == EGL_NO_CONTEXT) return fail("eglCreateContext");

    if (!supports_surfaceless) {
        const EGLint pbuffer_attributes[] = {
            EGL_WIDTH, 1,
            EGL_HEIGHT, 1,
            EGL_NONE
        };
        m_surface = eglCreatePbufferSurface(m_display, config, pbuffer_attributes);
        if (m_surface == EGL_NO_SURFACE) return fail("eglCreatePbufferSurface");
    }

    if (!makeCurrent()) return fail("eglMakeCurrent");
    m_renderNode = render_node;

    if (m_debugLogging) {
        const auto* vendor = reinterpret_cast<const char*>(glGetString(GL_VENDOR));
        const auto* renderer = reinterpret_cast<const char*>(glGetString(GL_RENDERER));
        std::cout << "[LinuxEGL] Selected " << m_renderNode
                  << " GBM=" << gbm_device_get_backend_name(m_gbmDevice)
                  << " EGL=" << eglQueryString(m_display, EGL_VENDOR)
                  << " GL=" << (vendor ? vendor : "unknown")
                  << " renderer=" << (renderer ? renderer : "unknown") << std::endl;
    }
    return true;
}

void LinuxEglContext::destroyDevice() {
    if (m_display != EGL_NO_DISPLAY) {
        eglMakeCurrent(m_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        if (m_surface != EGL_NO_SURFACE) {
            eglDestroySurface(m_display, m_surface);
        }
        if (m_context != EGL_NO_CONTEXT) {
            eglDestroyContext(m_display, m_context);
        }
        eglTerminate(m_display);
    }
    if (m_gbmDevice) gbm_device_destroy(m_gbmDevice);
    if (m_drmFd >= 0) close(m_drmFd);

    m_surface = EGL_NO_SURFACE;
    m_context = EGL_NO_CONTEXT;
    m_display = EGL_NO_DISPLAY;
    m_gbmDevice = nullptr;
    m_drmFd = -1;
    m_renderNode.clear();
}

bool LinuxEglContext::makeCurrent() {
    if (m_display == EGL_NO_DISPLAY || m_context == EGL_NO_CONTEXT) return false;
    return eglMakeCurrent(m_display, m_surface, m_surface, m_context) == EGL_TRUE;
}

void LinuxEglContext::clearCurrent() {
    if (m_display != EGL_NO_DISPLAY) {
        eglMakeCurrent(m_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    }
}

void* LinuxEglContext::getProcAddress(const char* name) const {
    void* address = reinterpret_cast<void*>(eglGetProcAddress(name));
    return address ? address : dlsym(RTLD_DEFAULT, name);
}

} // namespace mpv_texture

#endif // __linux__

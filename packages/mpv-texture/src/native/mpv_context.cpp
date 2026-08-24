/*
 * libmpv wrapper implementation
 */

#include "mpv_context.h"
#include "mpv_api.h"
#include <cstring>
#include <iostream>
#include <memory>

#ifdef _WIN32
#include <windows.h>
#include <gl/GL.h>
// WGL function types (wglGetProcAddress is in wingdi.h)
typedef HGLRC(WINAPI* PFNWGLCREATECONTEXTATTRIBSARBPROC)(HDC, HGLRC, const int*);
typedef BOOL(WINAPI* PFNWGLMAKECURRENTPROC)(HDC, HGLRC);
typedef PROC(WINAPI* PFNWGLGETPROCADDRESSPROC)(LPCSTR);
#elif defined(__APPLE__)
#define GL_SILENCE_DEPRECATION
#include <OpenGL/gl3.h>
#include <OpenGL/OpenGL.h>
#include <dlfcn.h>
#else
#include "linux/egl_context.h"
#include <GL/gl.h>
#endif

namespace mpv_texture {

MpvContext::MpvContext() = default;

MpvContext::~MpvContext() {
    destroy();
}

// Platform-specific GL context creation
#ifdef _WIN32
static HWND g_dummyWindow = nullptr;
static HDC g_hdc = nullptr;
static HGLRC g_hglrc = nullptr;

static bool createWindowsGLContext() {
    // Register dummy window class
    WNDCLASSA wc = {};
    wc.lpfnWndProc = DefWindowProcA;
    wc.hInstance = GetModuleHandle(nullptr);
    wc.lpszClassName = "MpvTextureDummyWindow";
    RegisterClassA(&wc);

    // Create hidden window
    g_dummyWindow = CreateWindowExA(
        0, "MpvTextureDummyWindow", "", 0,
        0, 0, 1, 1, nullptr, nullptr,
        GetModuleHandle(nullptr), nullptr
    );
    if (!g_dummyWindow) {
        std::cerr << "[MpvContext] Failed to create dummy window" << std::endl;
        return false;
    }

    g_hdc = GetDC(g_dummyWindow);
    if (!g_hdc) {
        std::cerr << "[MpvContext] Failed to get DC" << std::endl;
        return false;
    }

    // Set pixel format
    PIXELFORMATDESCRIPTOR pfd = {};
    pfd.nSize = sizeof(pfd);
    pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    pfd.iPixelType = PFD_TYPE_RGBA;
    pfd.cColorBits = 32;
    pfd.cDepthBits = 24;
    pfd.iLayerType = PFD_MAIN_PLANE;

    int pixelFormat = ChoosePixelFormat(g_hdc, &pfd);
    if (!pixelFormat || !SetPixelFormat(g_hdc, pixelFormat, &pfd)) {
        std::cerr << "[MpvContext] Failed to set pixel format" << std::endl;
        return false;
    }

    // Create OpenGL context
    g_hglrc = wglCreateContext(g_hdc);
    if (!g_hglrc) {
        std::cerr << "[MpvContext] Failed to create GL context" << std::endl;
        return false;
    }

    // Make it current
    if (!wglMakeCurrent(g_hdc, g_hglrc)) {
        std::cerr << "[MpvContext] Failed to make GL context current" << std::endl;
        return false;
    }

    // Check which GPU the OpenGL context is using
    const char* vendor = (const char*)glGetString(GL_VENDOR);
    const char* renderer = (const char*)glGetString(GL_RENDERER);
    std::cout << "[MpvContext] OpenGL Vendor: " << (vendor ? vendor : "unknown") << std::endl;
    std::cout << "[MpvContext] OpenGL Renderer: " << (renderer ? renderer : "unknown") << std::endl;

    // Check if we're on NVIDIA - WGL_NV_DX_interop requires both D3D and GL on same GPU
    if (renderer && strstr(renderer, "NVIDIA") == nullptr) {
        std::cerr << "[MpvContext] WARNING: OpenGL is not on NVIDIA GPU. WGL_NV_DX_interop may fail." << std::endl;
        std::cerr << "[MpvContext] Set NVIDIA as preferred GPU for this app in NVIDIA Control Panel." << std::endl;
    }

    std::cout << "[MpvContext] Windows GL context created successfully" << std::endl;
    return true;
}

static void destroyWindowsGLContext() {
    if (g_hglrc) {
        wglMakeCurrent(nullptr, nullptr);
        wglDeleteContext(g_hglrc);
        g_hglrc = nullptr;
    }
    if (g_hdc && g_dummyWindow) {
        ReleaseDC(g_dummyWindow, g_hdc);
        g_hdc = nullptr;
    }
    if (g_dummyWindow) {
        DestroyWindow(g_dummyWindow);
        g_dummyWindow = nullptr;
    }
}
#endif

#ifdef __linux__
static std::unique_ptr<LinuxEglContext> g_linuxEglContext;
#endif

#ifdef __APPLE__
static CGLContextObj g_cglContext = nullptr;
static CGLPixelFormatObj g_cglPixelFormat = nullptr;

static bool createMacOSGLContext() {
    // Create a minimal OpenGL context for offscreen rendering
    CGLPixelFormatAttribute attributes[] = {
        kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
        kCGLPFAColorSize, (CGLPixelFormatAttribute)24,
        kCGLPFAAlphaSize, (CGLPixelFormatAttribute)8,
        kCGLPFAAccelerated,
        kCGLPFANoRecovery,
        (CGLPixelFormatAttribute)0
    };

    GLint numFormats = 0;
    CGLError err = CGLChoosePixelFormat(attributes, &g_cglPixelFormat, &numFormats);
    if (err != kCGLNoError || numFormats == 0) {
        std::cerr << "[MpvContext] Failed to choose pixel format: " << err << std::endl;
        return false;
    }

    err = CGLCreateContext(g_cglPixelFormat, nullptr, &g_cglContext);
    if (err != kCGLNoError) {
        std::cerr << "[MpvContext] Failed to create CGL context: " << err << std::endl;
        CGLDestroyPixelFormat(g_cglPixelFormat);
        g_cglPixelFormat = nullptr;
        return false;
    }

    err = CGLSetCurrentContext(g_cglContext);
    if (err != kCGLNoError) {
        std::cerr << "[MpvContext] Failed to set CGL context current: " << err << std::endl;
        CGLDestroyContext(g_cglContext);
        CGLDestroyPixelFormat(g_cglPixelFormat);
        g_cglContext = nullptr;
        g_cglPixelFormat = nullptr;
        return false;
    }

    std::cout << "[MpvContext] macOS CGL context created successfully" << std::endl;
    return true;
}

static void destroyMacOSGLContext() {
    if (g_cglContext) {
        CGLSetCurrentContext(nullptr);
        CGLDestroyContext(g_cglContext);
        g_cglContext = nullptr;
    }
    if (g_cglPixelFormat) {
        CGLDestroyPixelFormat(g_cglPixelFormat);
        g_cglPixelFormat = nullptr;
    }
}
#endif

bool MpvContext::create(const MpvConfig& config) {
    if (m_initialized) {
        return true;
    }

    m_config = config;

    std::string mpvLoadError;
    if (!mpvApi().load(mpvLoadError)) {
        if (m_errorCallback) m_errorCallback("Failed to load libmpv: " + mpvLoadError);
        return false;
    }

#ifdef _WIN32
    // Create Windows GL context first (required for WGL extensions)
    if (!createWindowsGLContext()) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create Windows GL context");
        }
        return false;
    }
    m_glContext = static_cast<void*>(g_hglrc);
#elif defined(__APPLE__)
    // Create macOS CGL context for IOSurface sharing
    if (!createMacOSGLContext()) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create macOS GL context");
        }
        return false;
    }
    m_glContext = static_cast<void*>(g_cglContext);
#elif defined(__linux__)
    g_linuxEglContext = LinuxEglContext::create(
        config.gpuVendorId,
        config.gpuDeviceId,
        config.debugLogging
    );
    if (!g_linuxEglContext) {
        if (m_errorCallback) m_errorCallback("Failed to create Linux EGL context");
        return false;
    }
    m_glContext = static_cast<void*>(g_linuxEglContext.get());
#endif

    if (config.debugLogging) std::cout << "[MpvContext] Creating libmpv handle" << std::endl;

    // Create mpv handle
    m_mpv = mpvApi().create();
    if (!m_mpv) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create mpv context");
        }
        return false;
    }

    // Set options before initialization
    mpvApi().setOptionString(m_mpv, "vo", config.vo.c_str());
    mpvApi().setOptionString(m_mpv, "hwdec", config.hwdec.c_str());
    mpvApi().setOptionString(m_mpv, "keep-open", "yes");
    mpvApi().setOptionString(m_mpv, "idle", "yes");
    mpvApi().setOptionString(m_mpv, "terminal", "no");
    mpvApi().setOptionString(m_mpv, "osc", "no");
    mpvApi().setOptionString(m_mpv, "load-scripts", "no");
    mpvApi().setOptionString(m_mpv, "load-console", "no");
    mpvApi().setOptionString(m_mpv, "load-context-menu", "no");
    mpvApi().setOptionString(m_mpv, "load-commands", "no");
    mpvApi().setOptionString(m_mpv, "load-positioning", "no");
    mpvApi().setOptionString(m_mpv, "load-select", "no");
    mpvApi().setOptionString(m_mpv, "load-stats-overlay", "no");
    mpvApi().setOptionString(m_mpv, "input-default-bindings", "no");
    mpvApi().setOptionString(m_mpv, "msg-level", "all=v");
#ifdef __linux__
    // The PipeWire client library cannot safely cross Electron's FFmpeg
    // isolation boundary. PulseAudio remains available through PipeWire's
    // compatibility server on current Linux desktops.
    mpvApi().setOptionString(m_mpv, "ao", "pulse,alsa");
#endif

    // Initialize mpv
    if (config.debugLogging) std::cout << "[MpvContext] Initializing libmpv" << std::endl;
    if (mpvApi().initialize(m_mpv) < 0) {
        if (m_errorCallback) {
            m_errorCallback("Failed to initialize mpv");
        }
        mpvApi().destroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Create texture sharing
    if (config.debugLogging) std::cout << "[MpvContext] Initializing texture adapter" << std::endl;
    m_textureShare = createTextureShare();
    if (!m_textureShare) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create texture share");
        }
        mpvApi().terminateDestroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Initialize texture sharing with current GL context
    // Note: The GL context must be created and made current before calling this
    if (!m_textureShare->initialize(m_glContext)) {
        if (m_errorCallback) {
            m_errorCallback("Failed to initialize texture sharing");
        }
        delete m_textureShare;
        m_textureShare = nullptr;
        mpvApi().terminateDestroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Create shared texture
    if (config.debugLogging) std::cout << "[MpvContext] Allocating shared textures" << std::endl;
    if (!m_textureShare->createTexture(config.width, config.height)) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create shared texture");
        }
        m_textureShare->destroy();
        delete m_textureShare;
        m_textureShare = nullptr;
        mpvApi().terminateDestroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Create render context
    if (config.debugLogging) std::cout << "[MpvContext] Creating libmpv render context" << std::endl;
    mpv_opengl_init_params gl_init_params{
        .get_proc_address = getProcAddress,
        .get_proc_address_ctx = this,
    };

    int advanced_control = 1;
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_OPENGL)},
        {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init_params},
        {MPV_RENDER_PARAM_ADVANCED_CONTROL, &advanced_control},
        {MPV_RENDER_PARAM_INVALID, nullptr}
    };

    if (mpvApi().renderContextCreate(&m_renderCtx, m_mpv, params) < 0) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create mpv render context");
        }
        m_textureShare->destroy();
        delete m_textureShare;
        m_textureShare = nullptr;
        mpvApi().terminateDestroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Set up render update callback
    mpvApi().renderContextSetUpdateCallback(m_renderCtx, renderUpdateCallback, this);

    // Set up wakeup callback for event handling
    mpvApi().setWakeupCallback(m_mpv, wakeupCallback, this);

    // Observe properties
    mpvApi().observeProperty(m_mpv, 1, "pause", MPV_FORMAT_FLAG);
    mpvApi().observeProperty(m_mpv, 2, "volume", MPV_FORMAT_DOUBLE);
    mpvApi().observeProperty(m_mpv, 3, "mute", MPV_FORMAT_FLAG);
    mpvApi().observeProperty(m_mpv, 4, "time-pos", MPV_FORMAT_DOUBLE);
    mpvApi().observeProperty(m_mpv, 5, "duration", MPV_FORMAT_DOUBLE);
    mpvApi().observeProperty(m_mpv, 6, "width", MPV_FORMAT_INT64);
    mpvApi().observeProperty(m_mpv, 7, "height", MPV_FORMAT_INT64);

    // Start threads
    m_running = true;
    m_eventThread = std::thread(&MpvContext::eventLoop, this);

#ifdef _WIN32
    // Release GL context from main thread so render thread can use it
    // (OpenGL contexts can only be current on one thread at a time)
    wglMakeCurrent(nullptr, nullptr);
#elif defined(__APPLE__)
    // Release CGL context from main thread so render thread can use it
    CGLSetCurrentContext(nullptr);
#elif defined(__linux__)
    g_linuxEglContext->clearCurrent();
#endif

    m_renderThread = std::thread(&MpvContext::renderLoop, this);

    m_initialized = true;
    return true;
}

void MpvContext::destroy() {
    m_running = false;
    m_needsRender = true;
    m_renderCV.notify_one();

    // Stop mpv first to unblock event loop
    if (m_mpv) {
        mpvApi().wakeup(m_mpv);
    }

    if (m_eventThread.joinable()) {
        m_eventThread.join();
    }

    if (m_renderThread.joinable()) {
        m_renderThread.join();
    }

#ifdef __linux__
    // mpv render and texture teardown make GL calls. Reacquire the context on
    // this thread after the render thread exits.
    if (g_linuxEglContext) g_linuxEglContext->makeCurrent();
#endif

    if (m_renderCtx) {
        mpvApi().renderContextFree(m_renderCtx);
        m_renderCtx = nullptr;
    }

    if (m_mpv) {
        mpvApi().terminateDestroy(m_mpv);
        m_mpv = nullptr;
    }

    if (m_textureShare) {
        m_textureShare->destroy();
        delete m_textureShare;
        m_textureShare = nullptr;
    }

#ifdef _WIN32
    destroyWindowsGLContext();
    m_glContext = nullptr;
#elif defined(__APPLE__)
    destroyMacOSGLContext();
    m_glContext = nullptr;
#elif defined(__linux__)
    if (g_linuxEglContext) g_linuxEglContext->clearCurrent();
    g_linuxEglContext.reset();
    m_glContext = nullptr;
#endif

    m_initialized = false;
}

bool MpvContext::load(const std::string& url, const std::string& options) {
    if (!m_mpv) return false;

    if (!options.empty()) {
        const char* cmd[] = {"loadfile", url.c_str(), "replace", options.c_str(), nullptr};
        int result = mpvApi().command(m_mpv, cmd);
        return result >= 0;
    }
    const char* cmd[] = {"loadfile", url.c_str(), nullptr};
    int result = mpvApi().command(m_mpv, cmd);
    return result >= 0;
}

void MpvContext::play() {
    if (!m_mpv) return;
    int flag = 0;
    mpvApi().setProperty(m_mpv, "pause", MPV_FORMAT_FLAG, &flag);
}

void MpvContext::pause() {
    if (!m_mpv) return;
    int flag = 1;
    mpvApi().setProperty(m_mpv, "pause", MPV_FORMAT_FLAG, &flag);
}

void MpvContext::stop() {
    if (!m_mpv) return;
    const char* cmd[] = {"stop", nullptr};
    mpvApi().command(m_mpv, cmd);
}

void MpvContext::seek(double position) {
    if (!m_mpv) return;
    std::string pos_str = std::to_string(position);
    const char* cmd[] = {"seek", pos_str.c_str(), "absolute", nullptr};
    mpvApi().command(m_mpv, cmd);
}

void MpvContext::setVolume(double volume) {
    if (!m_mpv) return;
    mpvApi().setProperty(m_mpv, "volume", MPV_FORMAT_DOUBLE, &volume);
}

void MpvContext::toggleMute() {
    if (!m_mpv) return;
    const char* cmd[] = {"cycle", "mute", nullptr};
    mpvApi().command(m_mpv, cmd);
}

void MpvContext::setFrameCallback(FrameCallback callback) {
    std::lock_guard<std::mutex> lock(m_callbackMutex);
    m_frameCallback = std::move(callback);
}

void MpvContext::setStatusCallback(StatusCallback callback) {
    std::lock_guard<std::mutex> lock(m_callbackMutex);
    m_statusCallback = std::move(callback);
}

void MpvContext::setErrorCallback(ErrorCallback callback) {
    std::lock_guard<std::mutex> lock(m_callbackMutex);
    m_errorCallback = std::move(callback);
}

void MpvContext::releaseFrame(uint32_t buffer_id) {
    if (m_textureShare) m_textureShare->releaseTexture(buffer_id);
}

MpvStatus MpvContext::getStatus() const {
    std::lock_guard<std::mutex> lock(m_statusMutex);
    return m_status;
}

void MpvContext::eventLoop() {
    while (m_running) {
        mpv_event* event = mpvApi().waitEvent(m_mpv, 0.1);
        if (event->event_id == MPV_EVENT_NONE) {
            continue;
        }
        if (event->event_id == MPV_EVENT_SHUTDOWN) {
            break;
        }
        handleEvent(event);
    }
}

void MpvContext::handleEvent(mpv_event* event) {
    switch (event->event_id) {
        case MPV_EVENT_PROPERTY_CHANGE:
            handlePropertyChange(static_cast<mpv_event_property*>(event->data));
            break;
        case MPV_EVENT_END_FILE: {
            auto* end_file = static_cast<mpv_event_end_file*>(event->data);
            if (end_file->reason == MPV_END_FILE_REASON_ERROR) {
                std::lock_guard<std::mutex> lock(m_callbackMutex);
                if (m_errorCallback) {
                    m_errorCallback("Playback error: " + std::string(mpvApi().errorString(end_file->error)));
                }
            }
            break;
        }
        case MPV_EVENT_LOG_MESSAGE: {
            auto* msg = static_cast<mpv_event_log_message*>(event->data);
            // Only report errors
            if (msg->log_level <= MPV_LOG_LEVEL_ERROR) {
                std::lock_guard<std::mutex> lock(m_callbackMutex);
                if (m_errorCallback) {
                    m_errorCallback(std::string(msg->prefix) + ": " + msg->text);
                }
            }
            break;
        }
        default:
            break;
    }
}

void MpvContext::handlePropertyChange(mpv_event_property* prop) {
    bool statusChanged = false;

    {
        std::lock_guard<std::mutex> lock(m_statusMutex);

        if (strcmp(prop->name, "pause") == 0 && prop->format == MPV_FORMAT_FLAG) {
            m_status.playing = !(*static_cast<int*>(prop->data));
            statusChanged = true;
        } else if (strcmp(prop->name, "volume") == 0 && prop->format == MPV_FORMAT_DOUBLE) {
            m_status.volume = *static_cast<double*>(prop->data);
            statusChanged = true;
        } else if (strcmp(prop->name, "mute") == 0 && prop->format == MPV_FORMAT_FLAG) {
            m_status.muted = *static_cast<int*>(prop->data);
            statusChanged = true;
        } else if (strcmp(prop->name, "time-pos") == 0 && prop->format == MPV_FORMAT_DOUBLE) {
            m_status.position = *static_cast<double*>(prop->data);
            statusChanged = true;
        } else if (strcmp(prop->name, "duration") == 0 && prop->format == MPV_FORMAT_DOUBLE) {
            m_status.duration = *static_cast<double*>(prop->data);
            statusChanged = true;
        } else if (strcmp(prop->name, "width") == 0 && prop->format == MPV_FORMAT_INT64) {
            int newWidth = static_cast<int>(*static_cast<int64_t*>(prop->data));
            if (newWidth > 0 && newWidth != m_status.width) {
                m_status.width = newWidth;
                // Signal render thread to resize (GL calls must happen there)
                if (m_status.height > 0) {
                    m_pendingWidth = static_cast<uint32_t>(m_status.width);
                    m_pendingHeight = static_cast<uint32_t>(m_status.height);
                    m_needsResize = true;
                    m_renderCV.notify_one();  // Wake render thread for resize
                }
            }
            statusChanged = true;
        } else if (strcmp(prop->name, "height") == 0 && prop->format == MPV_FORMAT_INT64) {
            int newHeight = static_cast<int>(*static_cast<int64_t*>(prop->data));
            if (newHeight > 0 && newHeight != m_status.height) {
                m_status.height = newHeight;
                // Signal render thread to resize (GL calls must happen there)
                if (m_status.width > 0) {
                    m_pendingWidth = static_cast<uint32_t>(m_status.width);
                    m_pendingHeight = static_cast<uint32_t>(m_status.height);
                    m_needsResize = true;
                    m_renderCV.notify_one();  // Wake render thread for resize
                }
            }
            statusChanged = true;
        }
    }

    if (statusChanged) {
        // Copy status under its own lock, then release before acquiring callback lock.
        // This avoids nested m_callbackMutex → m_statusMutex ordering that could
        // deadlock if any other code path ever locks them in the opposite order.
        MpvStatus statusCopy;
        {
            std::lock_guard<std::mutex> lock(m_statusMutex);
            statusCopy = m_status;
        }
        std::lock_guard<std::mutex> lock(m_callbackMutex);
        if (m_statusCallback) {
            m_statusCallback(statusCopy);
        }
    }
}

void MpvContext::renderLoop() {
#ifdef _WIN32
    // Make GL context current on this thread (required for WGL operations)
    if (g_hdc && g_hglrc) {
        if (!wglMakeCurrent(g_hdc, g_hglrc)) {
            std::cerr << "[MpvContext] Failed to make GL context current in render thread" << std::endl;
            std::lock_guard<std::mutex> lock(m_callbackMutex);
            if (m_errorCallback) {
                m_errorCallback("Render thread failed: could not make GL context current");
            }
            return;
        }
        std::cout << "[MpvContext] GL context made current in render thread" << std::endl;
    }
#elif defined(__APPLE__)
    // Make CGL context current on this thread
    if (g_cglContext) {
        CGLError err = CGLSetCurrentContext(g_cglContext);
        if (err != kCGLNoError) {
            std::cerr << "[MpvContext] Failed to make CGL context current in render thread: " << err << std::endl;
            std::lock_guard<std::mutex> lock(m_callbackMutex);
            if (m_errorCallback) {
                m_errorCallback("Render thread failed: could not make CGL context current");
            }
            return;
        }
        std::cout << "[MpvContext] CGL context made current in render thread" << std::endl;
    }
#elif defined(__linux__)
    if (!g_linuxEglContext || !g_linuxEglContext->makeCurrent()) {
        std::cerr << "[MpvContext] Failed to make EGL context current in render thread" << std::endl;
        std::lock_guard<std::mutex> lock(m_callbackMutex);
        if (m_errorCallback) {
            m_errorCallback("Render thread failed: could not make EGL context current");
        }
        return;
    }
    if (m_config.debugLogging) {
        std::cout << "[MpvContext] EGL context made current in render thread" << std::endl;
    }
#endif

    while (m_running) {
        // Wait for render update or resize request
        {
            std::unique_lock<std::mutex> lock(m_renderMutex);
            m_renderCV.wait(lock, [this] { return m_needsRender || m_needsResize || !m_running; });
            if (!m_running) break;
            m_needsRender = false;
        }

        // Handle texture resize on render thread (GL context is current here)
        if (m_needsResize && m_textureShare) {
            uint32_t newWidth = m_pendingWidth.load();
            uint32_t newHeight = m_pendingHeight.load();
            if (newWidth > 0 && newHeight > 0) {
                if (m_config.debugLogging) {
                    std::cout << "[MpvContext] Resizing texture to " << newWidth << "x" << newHeight << std::endl;
                }
                m_textureShare->resizeTexture(newWidth, newHeight);
            }
            m_needsResize = false;
        }

        // Check if we can render
        uint64_t flags = mpvApi().renderContextUpdate(m_renderCtx);
        if (!(flags & MPV_RENDER_UPDATE_FRAME)) {
            continue;
        }

        RenderTarget target;
        if (!m_textureShare->acquireRenderTarget(target)) {
            static int lockFailCount = 0;
            if (m_config.debugLogging && lockFailCount < 5) {
                std::cout << "[MpvContext] No free texture slot; dropping frame" << std::endl;
                lockFailCount++;
            }
            continue;
        }

        // Render
        mpv_opengl_fbo fbo_params{
            .fbo = static_cast<int>(target.fbo),
            .w = static_cast<int>(target.width),
            .h = static_cast<int>(target.height),
            .internal_format = 0  // Use default
        };

        int flip_y = 1;
        mpv_render_param params[] = {
            {MPV_RENDER_PARAM_OPENGL_FBO, &fbo_params},
            {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
            {MPV_RENDER_PARAM_INVALID, nullptr}
        };

        int result = mpvApi().renderContextRender(m_renderCtx, params);
        if (result < 0) {
            m_textureShare->abandonRenderTarget();
            continue;
        }

        // Report swap
        mpvApi().renderContextReportSwap(m_renderCtx);

        // Flush GL commands to ensure rendering is complete before export.
        // macOS: glFlush is sufficient for GPU-to-GPU IOSurface sharing.
        if (m_config.finishBeforeExport) glFinish();
        else glFlush();

        TextureInfo info = m_textureShare->exportRenderTarget();
        if (info.is_valid) {
            static int frameCount = 0;
            if (m_config.debugLogging && frameCount < 10) {
                std::cout << "[MpvContext] Frame " << frameCount << " exported: "
                          << info.width << "x" << info.height << std::endl;
            }
            frameCount++;

            // Notify callback
            std::lock_guard<std::mutex> cbLock(m_callbackMutex);
            if (m_frameCallback) {
                m_frameCallback(info);
            }
        }
    }
}

void MpvContext::onRenderUpdate() {
    std::lock_guard<std::mutex> lock(m_renderMutex);
    m_needsRender = true;
    m_renderCV.notify_one();
}

void* MpvContext::getProcAddress(void* ctx, const char* name) {
    (void)ctx; // Unused for now

#ifdef _WIN32
    void* addr = reinterpret_cast<void*>(wglGetProcAddress(name));
    if (!addr) {
        // Try loading from opengl32.dll for core functions
        static HMODULE gl = LoadLibraryA("opengl32.dll");
        if (gl) {
            addr = reinterpret_cast<void*>(GetProcAddress(gl, name));
        }
    }
    return addr;
#elif defined(__APPLE__)
    return dlsym(RTLD_DEFAULT, name);
#else
    return g_linuxEglContext ? g_linuxEglContext->getProcAddress(name) : nullptr;
#endif
}

void MpvContext::renderUpdateCallback(void* ctx) {
    auto* self = static_cast<MpvContext*>(ctx);
    self->onRenderUpdate();
}

void MpvContext::wakeupCallback(void* ctx) {
    (void)ctx; // Event loop uses mpv_wait_event with timeout, so no explicit wakeup needed
}

} // namespace mpv_texture

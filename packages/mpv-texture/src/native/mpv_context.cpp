/*
 * libmpv wrapper implementation
 */

#include "mpv_context.h"
#include <cstring>
#include <iostream>

#ifdef _WIN32
#include <windows.h>
#include <gl/GL.h>
// WGL function types (wglGetProcAddress is in wingdi.h)
typedef HGLRC(WINAPI* PFNWGLCREATECONTEXTATTRIBSARBPROC)(HDC, HGLRC, const int*);
typedef BOOL(WINAPI* PFNWGLMAKECURRENTPROC)(HDC, HGLRC);
typedef PROC(WINAPI* PFNWGLGETPROCADDRESSPROC)(LPCSTR);
#elif defined(__APPLE__)
#include <OpenGL/gl3.h>
#include <dlfcn.h>
#else
#include <GL/gl.h>
#include <GL/glx.h>
#endif

namespace mpv_texture {

MpvContext::MpvContext() = default;

MpvContext::~MpvContext() {
    destroy();
}

bool MpvContext::create(const MpvConfig& config) {
    if (m_initialized) {
        return true;
    }

    m_config = config;

    // Create mpv handle
    m_mpv = mpv_create();
    if (!m_mpv) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create mpv context");
        }
        return false;
    }

    // Set options before initialization
    mpv_set_option_string(m_mpv, "vo", "libmpv");
    mpv_set_option_string(m_mpv, "hwdec", config.hwdec.c_str());
    mpv_set_option_string(m_mpv, "keep-open", "yes");
    mpv_set_option_string(m_mpv, "idle", "yes");
    mpv_set_option_string(m_mpv, "terminal", "no");
    mpv_set_option_string(m_mpv, "msg-level", "all=v");

    // Initialize mpv
    if (mpv_initialize(m_mpv) < 0) {
        if (m_errorCallback) {
            m_errorCallback("Failed to initialize mpv");
        }
        mpv_destroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Create texture sharing
    m_textureShare = createTextureShare();
    if (!m_textureShare) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create texture share");
        }
        mpv_terminate_destroy(m_mpv);
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
        mpv_terminate_destroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Create shared texture
    if (!m_textureShare->createTexture(config.width, config.height)) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create shared texture");
        }
        m_textureShare->destroy();
        delete m_textureShare;
        m_textureShare = nullptr;
        mpv_terminate_destroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Create render context
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

    if (mpv_render_context_create(&m_renderCtx, m_mpv, params) < 0) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create mpv render context");
        }
        m_textureShare->destroy();
        delete m_textureShare;
        m_textureShare = nullptr;
        mpv_terminate_destroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Set up render update callback
    mpv_render_context_set_update_callback(m_renderCtx, renderUpdateCallback, this);

    // Set up wakeup callback for event handling
    mpv_set_wakeup_callback(m_mpv, wakeupCallback, this);

    // Observe properties
    mpv_observe_property(m_mpv, 1, "pause", MPV_FORMAT_FLAG);
    mpv_observe_property(m_mpv, 2, "volume", MPV_FORMAT_DOUBLE);
    mpv_observe_property(m_mpv, 3, "mute", MPV_FORMAT_FLAG);
    mpv_observe_property(m_mpv, 4, "time-pos", MPV_FORMAT_DOUBLE);
    mpv_observe_property(m_mpv, 5, "duration", MPV_FORMAT_DOUBLE);
    mpv_observe_property(m_mpv, 6, "width", MPV_FORMAT_INT64);
    mpv_observe_property(m_mpv, 7, "height", MPV_FORMAT_INT64);

    // Start threads
    m_running = true;
    m_eventThread = std::thread(&MpvContext::eventLoop, this);
    m_renderThread = std::thread(&MpvContext::renderLoop, this);

    m_initialized = true;
    return true;
}

void MpvContext::destroy() {
    if (!m_initialized) {
        return;
    }

    m_running = false;
    m_needsRender = true;
    m_renderCV.notify_one();

    // Stop mpv first to unblock event loop
    if (m_mpv) {
        mpv_wakeup(m_mpv);
    }

    if (m_eventThread.joinable()) {
        m_eventThread.join();
    }

    if (m_renderThread.joinable()) {
        m_renderThread.join();
    }

    if (m_renderCtx) {
        mpv_render_context_free(m_renderCtx);
        m_renderCtx = nullptr;
    }

    if (m_mpv) {
        mpv_terminate_destroy(m_mpv);
        m_mpv = nullptr;
    }

    if (m_textureShare) {
        m_textureShare->destroy();
        delete m_textureShare;
        m_textureShare = nullptr;
    }

    m_initialized = false;
}

bool MpvContext::load(const std::string& url) {
    if (!m_mpv) return false;

    const char* cmd[] = {"loadfile", url.c_str(), nullptr};
    int result = mpv_command(m_mpv, cmd);
    return result >= 0;
}

void MpvContext::play() {
    if (!m_mpv) return;
    int flag = 0;
    mpv_set_property(m_mpv, "pause", MPV_FORMAT_FLAG, &flag);
}

void MpvContext::pause() {
    if (!m_mpv) return;
    int flag = 1;
    mpv_set_property(m_mpv, "pause", MPV_FORMAT_FLAG, &flag);
}

void MpvContext::stop() {
    if (!m_mpv) return;
    const char* cmd[] = {"stop", nullptr};
    mpv_command(m_mpv, cmd);
}

void MpvContext::seek(double position) {
    if (!m_mpv) return;
    std::string pos_str = std::to_string(position);
    const char* cmd[] = {"seek", pos_str.c_str(), "absolute", nullptr};
    mpv_command(m_mpv, cmd);
}

void MpvContext::setVolume(double volume) {
    if (!m_mpv) return;
    mpv_set_property(m_mpv, "volume", MPV_FORMAT_DOUBLE, &volume);
}

void MpvContext::toggleMute() {
    if (!m_mpv) return;
    const char* cmd[] = {"cycle", "mute", nullptr};
    mpv_command(m_mpv, cmd);
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

void MpvContext::releaseFrame() {
    std::lock_guard<std::mutex> lock(m_frameMutex);
    if (m_frameInUse) {
        m_textureShare->releaseTexture();
        m_frameInUse = false;
    }
}

MpvStatus MpvContext::getStatus() const {
    std::lock_guard<std::mutex> lock(m_statusMutex);
    return m_status;
}

void MpvContext::eventLoop() {
    while (m_running) {
        mpv_event* event = mpv_wait_event(m_mpv, 0.1);
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
                    m_errorCallback("Playback error: " + std::string(mpv_error_string(end_file->error)));
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
                // Resize texture if needed
                if (m_textureShare && m_status.height > 0) {
                    m_textureShare->resizeTexture(m_status.width, m_status.height);
                }
            }
            statusChanged = true;
        } else if (strcmp(prop->name, "height") == 0 && prop->format == MPV_FORMAT_INT64) {
            int newHeight = static_cast<int>(*static_cast<int64_t*>(prop->data));
            if (newHeight > 0 && newHeight != m_status.height) {
                m_status.height = newHeight;
                // Resize texture if needed
                if (m_textureShare && m_status.width > 0) {
                    m_textureShare->resizeTexture(m_status.width, m_status.height);
                }
            }
            statusChanged = true;
        }
    }

    if (statusChanged) {
        std::lock_guard<std::mutex> lock(m_callbackMutex);
        if (m_statusCallback) {
            std::lock_guard<std::mutex> statusLock(m_statusMutex);
            m_statusCallback(m_status);
        }
    }
}

void MpvContext::renderLoop() {
    while (m_running) {
        // Wait for render update
        {
            std::unique_lock<std::mutex> lock(m_renderMutex);
            m_renderCV.wait(lock, [this] { return m_needsRender || !m_running; });
            if (!m_running) break;
            m_needsRender = false;
        }

        // Check if we can render
        uint64_t flags = mpv_render_context_update(m_renderCtx);
        if (!(flags & MPV_RENDER_UPDATE_FRAME)) {
            continue;
        }

        // Wait if frame is still in use
        {
            std::lock_guard<std::mutex> lock(m_frameMutex);
            if (m_frameInUse) {
                continue; // Skip frame, Electron hasn't released the previous one
            }
        }

        // Lock texture for rendering
        if (!m_textureShare->lockTexture()) {
            continue;
        }

        // Get FBO and dimensions
        int fbo = m_textureShare->getGLFBO();
        int width, height;
        {
            std::lock_guard<std::mutex> lock(m_statusMutex);
            width = m_status.width > 0 ? m_status.width : m_config.width;
            height = m_status.height > 0 ? m_status.height : m_config.height;
        }

        // Render
        mpv_opengl_fbo fbo_params{
            .fbo = fbo,
            .w = width,
            .h = height,
            .internal_format = 0  // Use default
        };

        int flip_y = 1;
        mpv_render_param params[] = {
            {MPV_RENDER_PARAM_OPENGL_FBO, &fbo_params},
            {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
            {MPV_RENDER_PARAM_INVALID, nullptr}
        };

        int result = mpv_render_context_render(m_renderCtx, params);
        if (result < 0) {
            m_textureShare->releaseTexture();
            continue;
        }

        // Report swap
        mpv_render_context_report_swap(m_renderCtx);

        // Unlock and export texture
        TextureInfo info = m_textureShare->unlockAndExport();
        if (info.is_valid) {
            std::lock_guard<std::mutex> lock(m_frameMutex);
            m_currentFrame = info;
            m_frameInUse = true;

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
    return reinterpret_cast<void*>(glXGetProcAddressARB(reinterpret_cast<const GLubyte*>(name)));
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

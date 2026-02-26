/*
 * libmpv wrapper for Electron texture sharing
 */

#ifndef MPV_CONTEXT_H_
#define MPV_CONTEXT_H_

#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>
#include <string>
#include <functional>
#include <atomic>
#include <thread>
#include <mutex>
#include <condition_variable>

#include "texture_share.h"

namespace mpv_texture {

// Status information for the renderer
struct MpvStatus {
    bool playing;
    double volume;
    bool muted;
    double position;
    double duration;
    int width;
    int height;
};

// Callback types
using FrameCallback = std::function<void(const TextureInfo&)>;
using StatusCallback = std::function<void(const MpvStatus&)>;
using ErrorCallback = std::function<void(const std::string&)>;

// Configuration for creating the context
struct MpvConfig {
    uint32_t width = 1920;
    uint32_t height = 1080;
    std::string hwdec = "auto";  // Hardware decoding: auto, d3d11va, videotoolbox, etc.
    std::string vo = "libmpv";   // Video output
};

class MpvContext {
public:
    MpvContext();
    ~MpvContext();

    // Lifecycle
    bool create(const MpvConfig& config);
    void destroy();
    bool isInitialized() const { return m_initialized; }

    // Playback control
    bool load(const std::string& url, const std::string& options = "");
    void play();
    void pause();
    void stop();
    void seek(double position);
    void setVolume(double volume);
    void toggleMute();

    // Callbacks
    void setFrameCallback(FrameCallback callback);
    void setStatusCallback(StatusCallback callback);
    void setErrorCallback(ErrorCallback callback);

    // Frame management
    void releaseFrame();

    // Get current status
    MpvStatus getStatus() const;

private:
    // Event handling thread
    void eventLoop();
    void handleEvent(mpv_event* event);
    void handlePropertyChange(mpv_event_property* prop);

    // Render thread
    void renderLoop();
    void onRenderUpdate();

    // Static callback for mpv
    static void* getProcAddress(void* ctx, const char* name);
    static void renderUpdateCallback(void* ctx);
    static void wakeupCallback(void* ctx);

    // mpv handles
    mpv_handle* m_mpv = nullptr;
    mpv_render_context* m_renderCtx = nullptr;

    // Texture sharing
    ITextureShare* m_textureShare = nullptr;

    // Threading
    std::thread m_eventThread;
    std::thread m_renderThread;
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_initialized{false};

    // Render synchronization
    std::mutex m_renderMutex;
    std::condition_variable m_renderCV;
    std::atomic<bool> m_needsRender{false};

    // Texture resize synchronization (resize must happen on render thread)
    std::atomic<bool> m_needsResize{false};
    std::atomic<uint32_t> m_pendingWidth{0};
    std::atomic<uint32_t> m_pendingHeight{0};

    // Frame synchronization
    std::mutex m_frameMutex;
    std::atomic<bool> m_frameInUse{false};
    TextureInfo m_currentFrame{};

    // Current state
    MpvStatus m_status{};
    mutable std::mutex m_statusMutex;

    // Callbacks
    // Lock ordering: never hold m_callbackMutex while acquiring m_statusMutex
    // or vice versa. Copy status under m_statusMutex, release, then lock
    // m_callbackMutex to invoke the callback.
    FrameCallback m_frameCallback;
    StatusCallback m_statusCallback;
    ErrorCallback m_errorCallback;
    std::mutex m_callbackMutex;

    // Config
    MpvConfig m_config;

    // Platform-specific GL context handle
    void* m_glContext = nullptr;
};

} // namespace mpv_texture

#endif // MPV_CONTEXT_H_

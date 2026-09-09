#ifndef MPV_API_H_
#define MPV_API_H_

#include <mpv/client.h>
#include <mpv/render.h>
#include <string>

namespace mpv_texture {

// Electron and system libmpv may use incompatible FFmpeg builds. Linux loads
// libmpv into a private, deep-bound scope so its dependency versions take
// precedence over Electron's global FFmpeg symbols.
struct MpvApi {
    decltype(&::mpv_create) create = nullptr;
    decltype(&::mpv_initialize) initialize = nullptr;
    decltype(&::mpv_destroy) destroy = nullptr;
    decltype(&::mpv_terminate_destroy) terminateDestroy = nullptr;
    decltype(&::mpv_set_option_string) setOptionString = nullptr;
    decltype(&::mpv_set_property) setProperty = nullptr;
    decltype(&::mpv_command) command = nullptr;
    decltype(&::mpv_error_string) errorString = nullptr;
    decltype(&::mpv_observe_property) observeProperty = nullptr;
    decltype(&::mpv_set_wakeup_callback) setWakeupCallback = nullptr;
    decltype(&::mpv_wait_event) waitEvent = nullptr;
    decltype(&::mpv_wakeup) wakeup = nullptr;
    decltype(&::mpv_render_context_create) renderContextCreate = nullptr;
    decltype(&::mpv_render_context_free) renderContextFree = nullptr;
    decltype(&::mpv_render_context_set_update_callback) renderContextSetUpdateCallback = nullptr;
    decltype(&::mpv_render_context_update) renderContextUpdate = nullptr;
    decltype(&::mpv_render_context_render) renderContextRender = nullptr;
    decltype(&::mpv_render_context_report_swap) renderContextReportSwap = nullptr;

    bool load(std::string& error);
};

MpvApi& mpvApi();

} // namespace mpv_texture

#endif // MPV_API_H_

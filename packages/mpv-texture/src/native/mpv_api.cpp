#ifdef __linux__
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <dlfcn.h>
#endif

#include "mpv_api.h"

#include <filesystem>

namespace mpv_texture {

MpvApi& mpvApi() {
    static MpvApi api;
    return api;
}

bool MpvApi::load(std::string& error) {
    if (create) return true;

#ifdef __linux__
    Dl_info addon;
    if (!dladdr(reinterpret_cast<void*>(&mpvApi), &addon) || !addon.dli_fname) {
        error = "could not locate the native addon allocator runtime";
        return false;
    }
    const auto directory = std::filesystem::path(addon.dli_fname).parent_path();
    // The shim, rather than libmpv itself, must be the root of the private
    // scope so even dependency constructors use the host allocator.
    void* library = nullptr;
    const char* library_names[] = {"mpv_runtime_2.so", "mpv_runtime_1.so"};
    std::string attempts;
    for (const char* library_name : library_names) {
        library = dlopen((directory / library_name).c_str(), RTLD_NOW | RTLD_LOCAL | RTLD_DEEPBIND);
        if (library) break;
        const char* reason = dlerror();
        if (!attempts.empty()) attempts += "; ";
        attempts += std::string(library_name) + ": " + (reason ? reason : "unknown error");
    }
    if (!library) {
        error = "could not load the allocator runtime and system libmpv (" + attempts + ")";
        return false;
    }

    MpvApi loaded;
#define LOAD_MPV_SYMBOL(member, symbol) \
    loaded.member = reinterpret_cast<decltype(member)>(dlsym(library, symbol)); \
    if (!loaded.member) { error = std::string("missing libmpv symbol: ") + symbol; dlclose(library); return false; }

    LOAD_MPV_SYMBOL(create, "mpv_create");
    LOAD_MPV_SYMBOL(initialize, "mpv_initialize");
    LOAD_MPV_SYMBOL(destroy, "mpv_destroy");
    LOAD_MPV_SYMBOL(terminateDestroy, "mpv_terminate_destroy");
    LOAD_MPV_SYMBOL(setOptionString, "mpv_set_option_string");
    LOAD_MPV_SYMBOL(setProperty, "mpv_set_property");
    LOAD_MPV_SYMBOL(command, "mpv_command");
    LOAD_MPV_SYMBOL(errorString, "mpv_error_string");
    LOAD_MPV_SYMBOL(observeProperty, "mpv_observe_property");
    LOAD_MPV_SYMBOL(setWakeupCallback, "mpv_set_wakeup_callback");
    LOAD_MPV_SYMBOL(requestLogMessages, "mpv_request_log_messages");
    LOAD_MPV_SYMBOL(waitEvent, "mpv_wait_event");
    LOAD_MPV_SYMBOL(wakeup, "mpv_wakeup");
    LOAD_MPV_SYMBOL(renderContextCreate, "mpv_render_context_create");
    LOAD_MPV_SYMBOL(renderContextFree, "mpv_render_context_free");
    LOAD_MPV_SYMBOL(renderContextSetUpdateCallback, "mpv_render_context_set_update_callback");
    LOAD_MPV_SYMBOL(renderContextUpdate, "mpv_render_context_update");
    LOAD_MPV_SYMBOL(renderContextRender, "mpv_render_context_render");
    LOAD_MPV_SYMBOL(renderContextReportSwap, "mpv_render_context_report_swap");

#undef LOAD_MPV_SYMBOL
    *this = loaded;
#else
    create = &::mpv_create;
    initialize = &::mpv_initialize;
    destroy = &::mpv_destroy;
    terminateDestroy = &::mpv_terminate_destroy;
    setOptionString = &::mpv_set_option_string;
    setProperty = &::mpv_set_property;
    command = &::mpv_command;
    errorString = &::mpv_error_string;
    observeProperty = &::mpv_observe_property;
    setWakeupCallback = &::mpv_set_wakeup_callback;
    requestLogMessages = &::mpv_request_log_messages;
    waitEvent = &::mpv_wait_event;
    wakeup = &::mpv_wakeup;
    renderContextCreate = &::mpv_render_context_create;
    renderContextFree = &::mpv_render_context_free;
    renderContextSetUpdateCallback = &::mpv_render_context_set_update_callback;
    renderContextUpdate = &::mpv_render_context_update;
    renderContextRender = &::mpv_render_context_render;
    renderContextReportSwap = &::mpv_render_context_report_swap;
#endif
    return true;
}

} // namespace mpv_texture

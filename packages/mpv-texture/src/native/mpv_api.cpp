#ifdef __linux__
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <dlfcn.h>
#endif

#include "mpv_api.h"

namespace mpv_texture {

MpvApi& mpvApi() {
    static MpvApi api;
    return api;
}

bool MpvApi::load(std::string& error) {
    if (create) return true;

#ifdef __linux__
    // These libraries exchange allocated memory across their own DSOs. Resolve
    // them normally before deep-binding libmpv so each uses one allocator.
    static void* pipewire = dlopen("libpipewire-0.3.so.0", RTLD_NOW | RTLD_GLOBAL);
    static void* libass = dlopen("libass.so.9", RTLD_NOW | RTLD_GLOBAL);
    static void* pulse = dlopen("libpulse.so.0", RTLD_NOW | RTLD_GLOBAL);
    (void)pipewire;
    (void)libass;
    (void)pulse;

    void* library = nullptr;
    const char* library_names[] = {"libmpv.so.2", "libmpv.so.1", "libmpv.so"};
    for (const char* library_name : library_names) {
        library = dlopen(library_name, RTLD_NOW | RTLD_LOCAL | RTLD_DEEPBIND);
        if (library) break;
    }
    if (!library) {
        const char* loader_error = dlerror();
        error = loader_error ? loader_error : "system libmpv not found";
        return false;
    }

#define LOAD_MPV_SYMBOL(member, symbol) \
    member = reinterpret_cast<decltype(member)>(dlsym(library, symbol)); \
    if (!member) { error = std::string("missing libmpv symbol: ") + symbol; return false; }

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
    LOAD_MPV_SYMBOL(waitEvent, "mpv_wait_event");
    LOAD_MPV_SYMBOL(wakeup, "mpv_wakeup");
    LOAD_MPV_SYMBOL(renderContextCreate, "mpv_render_context_create");
    LOAD_MPV_SYMBOL(renderContextFree, "mpv_render_context_free");
    LOAD_MPV_SYMBOL(renderContextSetUpdateCallback, "mpv_render_context_set_update_callback");
    LOAD_MPV_SYMBOL(renderContextUpdate, "mpv_render_context_update");
    LOAD_MPV_SYMBOL(renderContextRender, "mpv_render_context_render");
    LOAD_MPV_SYMBOL(renderContextReportSwap, "mpv_render_context_report_swap");

#undef LOAD_MPV_SYMBOL
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

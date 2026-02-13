/*
 * libmpv render API header
 * Minimal subset needed for sbtlTV mpv-texture addon
 * Full header: https://github.com/mpv-player/mpv/blob/master/libmpv/render.h
 */

#ifndef MPV_RENDER_H_
#define MPV_RENDER_H_

#include "client.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Opaque render context */
typedef struct mpv_render_context mpv_render_context;

/* Render parameter types */
typedef enum mpv_render_param_type {
    MPV_RENDER_PARAM_INVALID = 0,
    MPV_RENDER_PARAM_API_TYPE = 1,
    MPV_RENDER_PARAM_OPENGL_INIT_PARAMS = 2,
    MPV_RENDER_PARAM_OPENGL_FBO = 3,
    MPV_RENDER_PARAM_FLIP_Y = 4,
    MPV_RENDER_PARAM_DEPTH = 5,
    MPV_RENDER_PARAM_ICC_PROFILE = 6,
    MPV_RENDER_PARAM_AMBIENT_LIGHT = 7,
    MPV_RENDER_PARAM_X11_DISPLAY = 8,
    MPV_RENDER_PARAM_WL_DISPLAY = 9,
    MPV_RENDER_PARAM_ADVANCED_CONTROL = 10,
    MPV_RENDER_PARAM_NEXT_FRAME_INFO = 11,
    MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME = 12,
    MPV_RENDER_PARAM_SKIP_RENDERING = 13,
    MPV_RENDER_PARAM_DRM_DISPLAY = 14,
    MPV_RENDER_PARAM_DRM_DRAW_SURFACE_SIZE = 15,
    MPV_RENDER_PARAM_DRM_DISPLAY_V2 = 16
} mpv_render_param_type;

/* Render update flags */
typedef enum mpv_render_update_flag {
    MPV_RENDER_UPDATE_FRAME = 1 << 0
} mpv_render_update_flag;

/* Parameter structure */
typedef struct mpv_render_param {
    mpv_render_param_type type;
    void *data;
} mpv_render_param;

/* OpenGL init params */
typedef struct mpv_opengl_init_params {
    void *(*get_proc_address)(void *ctx, const char *name);
    void *get_proc_address_ctx;
} mpv_opengl_init_params;

/* OpenGL FBO params */
typedef struct mpv_opengl_fbo {
    int fbo;
    int w;
    int h;
    int internal_format;
} mpv_opengl_fbo;

/* Frame info */
typedef struct mpv_render_frame_info {
    uint64_t flags;
    int64_t target_time;
} mpv_render_frame_info;

/* Frame info flags */
typedef enum mpv_render_frame_info_flag {
    MPV_RENDER_FRAME_INFO_PRESENT = 1 << 0,
    MPV_RENDER_FRAME_INFO_REDRAW = 1 << 1,
    MPV_RENDER_FRAME_INFO_REPEAT = 1 << 2,
    MPV_RENDER_FRAME_INFO_BLOCK_VSYNC = 1 << 3
} mpv_render_frame_info_flag;

/* API type string for OpenGL */
#define MPV_RENDER_API_TYPE_OPENGL "opengl"

/* Render context functions */
int mpv_render_context_create(mpv_render_context **res, mpv_handle *mpv,
                               mpv_render_param *params);
int mpv_render_context_set_parameter(mpv_render_context *ctx,
                                      mpv_render_param param);
int mpv_render_context_get_info(mpv_render_context *ctx,
                                 mpv_render_param param);
void mpv_render_context_set_update_callback(mpv_render_context *ctx,
                                             void (*callback)(void *cb_ctx),
                                             void *cb_ctx);
uint64_t mpv_render_context_update(mpv_render_context *ctx);
int mpv_render_context_render(mpv_render_context *ctx, mpv_render_param *params);
void mpv_render_context_report_swap(mpv_render_context *ctx);
void mpv_render_context_free(mpv_render_context *ctx);

#ifdef __cplusplus
}
#endif

#endif /* MPV_RENDER_H_ */

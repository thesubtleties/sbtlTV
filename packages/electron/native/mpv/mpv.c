#define GL_GLEXT_PROTOTYPES
#include <node_api.h>
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GL/gl.h>
#include <GL/glext.h>
#include <GL/glx.h>
#include <X11/Xlib.h>
#include <wayland-client.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef enum {
  CTX_NONE = 0,
  CTX_EGL_X11,
  CTX_EGL_WAYLAND,
  CTX_GLX,
} gl_context_type;

static mpv_handle *mpv_instance = NULL;
static mpv_render_context *mpv_render = NULL;

static uint8_t *frame_buffer = NULL;
static size_t frame_buffer_size = 0;
static int frame_width = 0;
static int frame_height = 0;
static int frame_stride = 0;
static int fbo_width = 0;
static int fbo_height = 0;
static GLuint fbo = 0;
static GLuint fbo_tex = 0;

static gl_context_type gl_ctx = CTX_NONE;

static EGLDisplay egl_display = EGL_NO_DISPLAY;
static EGLContext egl_context = EGL_NO_CONTEXT;
static EGLSurface egl_surface = EGL_NO_SURFACE;
static EGLConfig egl_config;
static Display *egl_x11_display = NULL;
static struct wl_display *egl_wl_display = NULL;

static Display *glx_display = NULL;
static GLXContext glx_context = NULL;
static GLXPbuffer glx_pbuffer = 0;
static GLXFBConfig glx_fbconfig;

static atomic_int render_pending;

static void free_buffer(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  free(data);
}

static napi_value make_bool(napi_env env, int value) {
  napi_value result;
  if (napi_get_boolean(env, value ? 1 : 0, &result) != napi_ok) return NULL;
  return result;
}

static napi_value make_null(napi_env env) {
  napi_value result;
  if (napi_get_null(env, &result) != napi_ok) return NULL;
  return result;
}

static void log_error(const char *message) {
  fprintf(stderr, "%s\n", message);
}

static int set_option_string(const char *name, const char *value) {
  if (!mpv_instance) return -1;
  int res = mpv_set_option_string(mpv_instance, name, value);
  if (res < 0) {
    fprintf(stderr, "[libmpv] set option failed: %s=%s (%d)\n", name, value, res);
  }
  return res;
}

static void on_mpv_update(void *ctx) {
  (void)ctx;
  atomic_store(&render_pending, 1);
}

static int egl_create_pbuffer(int width, int height) {
  if (egl_surface != EGL_NO_SURFACE) {
    eglDestroySurface(egl_display, egl_surface);
    egl_surface = EGL_NO_SURFACE;
  }

  EGLint attrs[] = {
    EGL_WIDTH, width,
    EGL_HEIGHT, height,
    EGL_NONE,
  };

  egl_surface = eglCreatePbufferSurface(egl_display, egl_config, attrs);
  if (egl_surface == EGL_NO_SURFACE) return 0;
  if (!eglMakeCurrent(egl_display, egl_surface, egl_surface, egl_context)) return 0;
  return 1;
}

static int egl_init_display(EGLNativeDisplayType native_display) {
  egl_display = eglGetDisplay(native_display);
  if (egl_display == EGL_NO_DISPLAY) return 0;
  if (!eglInitialize(egl_display, NULL, NULL)) {
    egl_display = EGL_NO_DISPLAY;
    return 0;
  }
  if (!eglBindAPI(EGL_OPENGL_API)) {
    eglTerminate(egl_display);
    egl_display = EGL_NO_DISPLAY;
    return 0;
  }

  EGLint config_attrs[] = {
    EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
    EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT,
    EGL_RED_SIZE, 8,
    EGL_GREEN_SIZE, 8,
    EGL_BLUE_SIZE, 8,
    EGL_ALPHA_SIZE, 8,
    EGL_NONE,
  };

  EGLint num_configs = 0;
  if (!eglChooseConfig(egl_display, config_attrs, &egl_config, 1, &num_configs) || num_configs < 1) {
    eglTerminate(egl_display);
    egl_display = EGL_NO_DISPLAY;
    return 0;
  }

  egl_context = eglCreateContext(egl_display, egl_config, EGL_NO_CONTEXT, NULL);
  if (egl_context == EGL_NO_CONTEXT) {
    eglTerminate(egl_display);
    egl_display = EGL_NO_DISPLAY;
    return 0;
  }

  if (!egl_create_pbuffer(1, 1)) {
    eglDestroyContext(egl_display, egl_context);
    egl_context = EGL_NO_CONTEXT;
    eglTerminate(egl_display);
    egl_display = EGL_NO_DISPLAY;
    return 0;
  }

  return 1;
}

static int init_egl_x11(void) {
  egl_x11_display = XOpenDisplay(NULL);
  if (!egl_x11_display) return 0;
  if (!egl_init_display((EGLNativeDisplayType)egl_x11_display)) {
    XCloseDisplay(egl_x11_display);
    egl_x11_display = NULL;
    return 0;
  }
  gl_ctx = CTX_EGL_X11;
  log_error("[libmpv] GL context: x11egl");
  return 1;
}

static int init_egl_wayland(void) {
  egl_wl_display = wl_display_connect(NULL);
  if (!egl_wl_display) return 0;
  if (!egl_init_display((EGLNativeDisplayType)egl_wl_display)) {
    wl_display_disconnect(egl_wl_display);
    egl_wl_display = NULL;
    return 0;
  }
  gl_ctx = CTX_EGL_WAYLAND;
  log_error("[libmpv] GL context: wayland");
  return 1;
}

static int glx_create_pbuffer(int width, int height) {
  if (glx_pbuffer) {
    glXDestroyPbuffer(glx_display, glx_pbuffer);
    glx_pbuffer = 0;
  }

  int attrs[] = {
    GLX_PBUFFER_WIDTH, width,
    GLX_PBUFFER_HEIGHT, height,
    None,
  };

  glx_pbuffer = glXCreatePbuffer(glx_display, glx_fbconfig, attrs);
  if (!glx_pbuffer) return 0;
  if (!glXMakeContextCurrent(glx_display, glx_pbuffer, glx_pbuffer, glx_context)) return 0;
  return 1;
}

static int init_glx(void) {
  glx_display = XOpenDisplay(NULL);
  if (!glx_display) return 0;

  int fbcount = 0;
  int fb_attrs[] = {
    GLX_DRAWABLE_TYPE, GLX_PBUFFER_BIT,
    GLX_RENDER_TYPE, GLX_RGBA_BIT,
    GLX_DOUBLEBUFFER, False,
    GLX_RED_SIZE, 8,
    GLX_GREEN_SIZE, 8,
    GLX_BLUE_SIZE, 8,
    GLX_ALPHA_SIZE, 8,
    None,
  };

  GLXFBConfig *configs = glXChooseFBConfig(glx_display, DefaultScreen(glx_display), fb_attrs, &fbcount);
  if (!configs || fbcount < 1) {
    if (configs) XFree(configs);
    XCloseDisplay(glx_display);
    glx_display = NULL;
    return 0;
  }

  glx_fbconfig = configs[0];
  XFree(configs);

  glx_context = glXCreateNewContext(glx_display, glx_fbconfig, GLX_RGBA_TYPE, NULL, True);
  if (!glx_context) {
    XCloseDisplay(glx_display);
    glx_display = NULL;
    return 0;
  }

  if (!glx_create_pbuffer(1, 1)) {
    glXDestroyContext(glx_display, glx_context);
    glx_context = NULL;
    XCloseDisplay(glx_display);
    glx_display = NULL;
    return 0;
  }

  gl_ctx = CTX_GLX;
  log_error("[libmpv] GL context: x11 (glx)");
  return 1;
}

static int init_gl_context(void) {
  const char *display = getenv("DISPLAY");
  const char *wayland = getenv("WAYLAND_DISPLAY");
  const char *session = getenv("XDG_SESSION_TYPE");

  if (display && init_egl_x11()) return 1;
  if ((wayland || (session && strcmp(session, "wayland") == 0)) && init_egl_wayland()) return 1;
  if (display && init_glx()) return 1;

  log_error("[libmpv] Failed to initialize OpenGL context (x11egl, wayland, x11)");
  return 0;
}

static int make_current(void) {
  if (gl_ctx == CTX_EGL_X11 || gl_ctx == CTX_EGL_WAYLAND) {
    if (egl_display == EGL_NO_DISPLAY || egl_context == EGL_NO_CONTEXT) return 0;
    if (!eglMakeCurrent(egl_display, egl_surface, egl_surface, egl_context)) return 0;
    return 1;
  }
  if (gl_ctx == CTX_GLX) {
    if (!glx_display || !glx_context || !glx_pbuffer) return 0;
    if (!glXMakeContextCurrent(glx_display, glx_pbuffer, glx_pbuffer, glx_context)) return 0;
    return 1;
  }
  return 0;
}

static int resize_surface(int width, int height) {
  if (gl_ctx == CTX_EGL_X11 || gl_ctx == CTX_EGL_WAYLAND) {
    return egl_create_pbuffer(width, height);
  }
  if (gl_ctx == CTX_GLX) {
    return glx_create_pbuffer(width, height);
  }
  return 0;
}

static void cleanup_fbo(void) {
  if (fbo) {
    glDeleteFramebuffers(1, &fbo);
    fbo = 0;
  }
  if (fbo_tex) {
    glDeleteTextures(1, &fbo_tex);
    fbo_tex = 0;
  }
  fbo_width = 0;
  fbo_height = 0;
}

static int ensure_fbo(int width, int height) {
  if (fbo && fbo_tex && fbo_width == width && fbo_height == height) return 1;

  cleanup_fbo();

  glGenTextures(1, &fbo_tex);
  if (!fbo_tex) return 0;

  glBindTexture(GL_TEXTURE_2D, fbo_tex);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);

  glGenFramebuffers(1, &fbo);
  if (!fbo) {
    cleanup_fbo();
    return 0;
  }
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, fbo_tex, 0);

  GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
  if (status != GL_FRAMEBUFFER_COMPLETE) {
    cleanup_fbo();
    return 0;
  }

  fbo_width = width;
  fbo_height = height;
  return 1;
}

static void cleanup_gl(void) {
  if (make_current()) {
    cleanup_fbo();
  }
  if (gl_ctx == CTX_EGL_X11 || gl_ctx == CTX_EGL_WAYLAND) {
    if (egl_display != EGL_NO_DISPLAY) {
      eglMakeCurrent(egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
      if (egl_surface != EGL_NO_SURFACE) {
        eglDestroySurface(egl_display, egl_surface);
        egl_surface = EGL_NO_SURFACE;
      }
      if (egl_context != EGL_NO_CONTEXT) {
        eglDestroyContext(egl_display, egl_context);
        egl_context = EGL_NO_CONTEXT;
      }
      eglTerminate(egl_display);
      egl_display = EGL_NO_DISPLAY;
    }
    if (gl_ctx == CTX_EGL_X11 && egl_x11_display) {
      XCloseDisplay(egl_x11_display);
      egl_x11_display = NULL;
    }
    if (gl_ctx == CTX_EGL_WAYLAND && egl_wl_display) {
      wl_display_disconnect(egl_wl_display);
      egl_wl_display = NULL;
    }
  }

  if (gl_ctx == CTX_GLX) {
    if (glx_display) {
      glXMakeContextCurrent(glx_display, None, None, NULL);
      if (glx_pbuffer) {
        glXDestroyPbuffer(glx_display, glx_pbuffer);
        glx_pbuffer = 0;
      }
      if (glx_context) {
        glXDestroyContext(glx_display, glx_context);
        glx_context = NULL;
      }
      XCloseDisplay(glx_display);
      glx_display = NULL;
    }
  }

  gl_ctx = CTX_NONE;
}

static void *get_proc_address(void *ctx, const char *name) {
  (void)ctx;
  if (gl_ctx == CTX_GLX) {
    return (void *)glXGetProcAddress((const GLubyte *)name);
  }
  return (void *)eglGetProcAddress(name);
}

static napi_value mpv_init(napi_env env, napi_callback_info info) {
  (void)info;
  if (mpv_instance) return make_bool(env, 1);

  if (!init_gl_context()) {
    return make_bool(env, 0);
  }

  mpv_instance = mpv_create();
  if (!mpv_instance) {
    cleanup_gl();
    return make_bool(env, 0);
  }

  int ok = 1;
  ok &= set_option_string("terminal", "no") >= 0;
  ok &= set_option_string("msg-level", "all=warn") >= 0;
  ok &= set_option_string("idle", "yes") >= 0;
  ok &= set_option_string("keep-open", "yes") >= 0;
  ok &= set_option_string("osc", "no") >= 0;
  ok &= set_option_string("osd-bar", "no") >= 0;
  ok &= set_option_string("osd-level", "0") >= 0;
  ok &= set_option_string("input-default-bindings", "no") >= 0;
  ok &= set_option_string("cursor-autohide", "no") >= 0;
  ok &= set_option_string("hwdec", "auto-safe") >= 0;
  ok &= set_option_string("vo", "libmpv") >= 0;
  ok &= set_option_string("gpu-api", "opengl") >= 0;

  if (gl_ctx == CTX_EGL_X11) ok &= set_option_string("gpu-context", "x11egl") >= 0;
  if (gl_ctx == CTX_EGL_WAYLAND) ok &= set_option_string("gpu-context", "wayland") >= 0;
  if (gl_ctx == CTX_GLX) ok &= set_option_string("gpu-context", "x11") >= 0;

  if (!ok) {
    mpv_terminate_destroy(mpv_instance);
    mpv_instance = NULL;
    cleanup_gl();
    return make_bool(env, 0);
  }

  if (mpv_initialize(mpv_instance) < 0) {
    mpv_terminate_destroy(mpv_instance);
    mpv_instance = NULL;
    cleanup_gl();
    return make_bool(env, 0);
  }

  if (mpv_observe_property(mpv_instance, 0, "pause", MPV_FORMAT_FLAG) < 0) {
    log_error("[libmpv] observe pause failed");
  }
  if (mpv_observe_property(mpv_instance, 0, "volume", MPV_FORMAT_DOUBLE) < 0) {
    log_error("[libmpv] observe volume failed");
  }
  if (mpv_observe_property(mpv_instance, 0, "mute", MPV_FORMAT_FLAG) < 0) {
    log_error("[libmpv] observe mute failed");
  }
  if (mpv_observe_property(mpv_instance, 0, "time-pos", MPV_FORMAT_DOUBLE) < 0) {
    log_error("[libmpv] observe time-pos failed");
  }
  if (mpv_observe_property(mpv_instance, 0, "duration", MPV_FORMAT_DOUBLE) < 0) {
    log_error("[libmpv] observe duration failed");
  }

  if (!make_current()) {
    mpv_terminate_destroy(mpv_instance);
    mpv_instance = NULL;
    cleanup_gl();
    return make_bool(env, 0);
  }

  mpv_opengl_init_params gl_init = {
    .get_proc_address = get_proc_address,
    .get_proc_address_ctx = NULL,
  };

  mpv_render_param params[] = {
    { MPV_RENDER_PARAM_API_TYPE, (void *)MPV_RENDER_API_TYPE_OPENGL },
    { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init },
    { MPV_RENDER_PARAM_INVALID, NULL },
  };

  if (mpv_render_context_create(&mpv_render, mpv_instance, params) < 0) {
    mpv_terminate_destroy(mpv_instance);
    mpv_instance = NULL;
    mpv_render = NULL;
    cleanup_gl();
    return make_bool(env, 0);
  }

  atomic_store(&render_pending, 1);
  mpv_render_context_set_update_callback(mpv_render, on_mpv_update, NULL);

  return make_bool(env, 1);
}

static napi_value mpv_shutdown(napi_env env, napi_callback_info info) {
  (void)info;
  if (mpv_render) {
    mpv_render_context_set_update_callback(mpv_render, NULL, NULL);
    mpv_render_context_free(mpv_render);
    mpv_render = NULL;
  }
  if (mpv_instance) {
    mpv_terminate_destroy(mpv_instance);
    mpv_instance = NULL;
  }

  cleanup_gl();

  frame_buffer = NULL;
  frame_buffer_size = 0;
  frame_width = 0;
  frame_height = 0;
  frame_stride = 0;
  return make_bool(env, 1);
}

static napi_value mpv_set_size(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok) return NULL;

  if (argc < 2 || !mpv_render) return make_null(env);

  int32_t width = 0;
  int32_t height = 0;
  if (napi_get_value_int32(env, args[0], &width) != napi_ok) return make_null(env);
  if (napi_get_value_int32(env, args[1], &height) != napi_ok) return make_null(env);

  if (width <= 0 || height <= 0) return make_null(env);

  if (!make_current()) {
    log_error("[libmpv] make current failed");
    return make_null(env);
  }

  if (!ensure_fbo(width, height)) {
    log_error("[libmpv] FBO resize failed");
    return make_null(env);
  }

  frame_width = width;
  frame_height = height;
  frame_stride = frame_width * 4;
  frame_buffer_size = (size_t)frame_stride * (size_t)frame_height;
  atomic_store(&render_pending, 1);

  uint8_t *buffer = (uint8_t *)malloc(frame_buffer_size);
  if (!buffer) return make_null(env);
  memset(buffer, 0, frame_buffer_size);

  frame_buffer = buffer;

  napi_value arraybuffer;
  if (napi_create_external_arraybuffer(env, buffer, frame_buffer_size, free_buffer, NULL, &arraybuffer) != napi_ok) {
    free(buffer);
    frame_buffer = NULL;
    return make_null(env);
  }

  napi_value obj;
  if (napi_create_object(env, &obj) != napi_ok) return make_null(env);

  napi_value width_val;
  napi_value height_val;
  napi_value stride_val;
  if (napi_create_int32(env, frame_width, &width_val) != napi_ok) return make_null(env);
  if (napi_create_int32(env, frame_height, &height_val) != napi_ok) return make_null(env);
  if (napi_create_int32(env, frame_stride, &stride_val) != napi_ok) return make_null(env);

  if (napi_set_named_property(env, obj, "buffer", arraybuffer) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "width", width_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "height", height_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "stride", stride_val) != napi_ok) return make_null(env);

  return obj;
}

static napi_value mpv_render_frame(napi_env env, napi_callback_info info) {
  (void)info;
  if (!mpv_render || !frame_buffer || frame_width <= 0 || frame_height <= 0) {
    return make_bool(env, 0);
  }

  if (!atomic_exchange(&render_pending, 0)) {
    return make_bool(env, 0);
  }

  if (!make_current()) return make_bool(env, 0);

  uint64_t flags = mpv_render_context_update(mpv_render);
  if (!(flags & MPV_RENDER_UPDATE_FRAME)) {
    return make_bool(env, 0);
  }

  if (!fbo) return make_bool(env, 0);

  mpv_opengl_fbo target = {
    .fbo = (int)fbo,
    .w = frame_width,
    .h = frame_height,
    .internal_format = 0,
  };

  int flip = 1;
  mpv_render_param params[] = {
    { MPV_RENDER_PARAM_OPENGL_FBO, &target },
    { MPV_RENDER_PARAM_FLIP_Y, &flip },
    { MPV_RENDER_PARAM_INVALID, NULL },
  };

  glViewport(0, 0, frame_width, frame_height);
  mpv_render_context_render(mpv_render, params);

  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glReadPixels(0, 0, frame_width, frame_height, GL_RGBA, GL_UNSIGNED_BYTE, frame_buffer);

  return make_bool(env, 1);
}

static napi_value mpv_command_simple(napi_env env, const char *cmd, const char *arg) {
  if (!mpv_instance) return make_bool(env, 0);
  const char *cmd_args[3] = { cmd, arg, NULL };
  int res = mpv_command(mpv_instance, cmd_args);
  return make_bool(env, res >= 0);
}

static napi_value mpv_load(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok) return make_bool(env, 0);
  if (argc < 1 || !mpv_instance) return make_bool(env, 0);

  size_t len = 0;
  if (napi_get_value_string_utf8(env, args[0], NULL, 0, &len) != napi_ok) return make_bool(env, 0);

  char *url = (char *)malloc(len + 1);
  if (!url) return make_bool(env, 0);
  if (napi_get_value_string_utf8(env, args[0], url, len + 1, &len) != napi_ok) {
    free(url);
    return make_bool(env, 0);
  }

  const char *cmd_args[3] = { "loadfile", url, NULL };
  int res = mpv_command(mpv_instance, cmd_args);
  free(url);
  return make_bool(env, res >= 0);
}

static napi_value mpv_play(napi_env env, napi_callback_info info) {
  (void)info;
  if (!mpv_instance) return make_bool(env, 0);
  int flag = 0;
  int res = mpv_set_property(mpv_instance, "pause", MPV_FORMAT_FLAG, &flag);
  return make_bool(env, res >= 0);
}

static napi_value mpv_pause(napi_env env, napi_callback_info info) {
  (void)info;
  if (!mpv_instance) return make_bool(env, 0);
  int flag = 1;
  int res = mpv_set_property(mpv_instance, "pause", MPV_FORMAT_FLAG, &flag);
  return make_bool(env, res >= 0);
}

static napi_value mpv_toggle_pause(napi_env env, napi_callback_info info) {
  (void)info;
  return mpv_command_simple(env, "cycle", "pause");
}

static napi_value mpv_stop(napi_env env, napi_callback_info info) {
  (void)info;
  return mpv_command_simple(env, "stop", "keep-open");
}

static napi_value mpv_set_volume(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok) return make_bool(env, 0);

  if (argc < 1 || !mpv_instance) return make_bool(env, 0);

  double volume = 0.0;
  if (napi_get_value_double(env, args[0], &volume) != napi_ok) return make_bool(env, 0);
  int res = mpv_set_property(mpv_instance, "volume", MPV_FORMAT_DOUBLE, &volume);
  return make_bool(env, res >= 0);
}

static napi_value mpv_toggle_mute(napi_env env, napi_callback_info info) {
  (void)info;
  return mpv_command_simple(env, "cycle", "mute");
}

static napi_value mpv_seek(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok) return make_bool(env, 0);

  if (argc < 1 || !mpv_instance) return make_bool(env, 0);

  double seconds = 0.0;
  if (napi_get_value_double(env, args[0], &seconds) != napi_ok) return make_bool(env, 0);

  char offset[64];
  snprintf(offset, sizeof(offset), "%f", seconds);
  const char *cmd_args[4] = { "seek", offset, "absolute", NULL };
  int res = mpv_command(mpv_instance, cmd_args);
  return make_bool(env, res >= 0);
}

static napi_value mpv_get_status(napi_env env, napi_callback_info info) {
  (void)info;
  if (!mpv_instance) return make_null(env);

  int pause = 0;
  int mute = 0;
  double volume = 0.0;
  double position = 0.0;
  double duration = 0.0;

  if (mpv_get_property(mpv_instance, "pause", MPV_FORMAT_FLAG, &pause) < 0) pause = 0;
  if (mpv_get_property(mpv_instance, "mute", MPV_FORMAT_FLAG, &mute) < 0) mute = 0;
  if (mpv_get_property(mpv_instance, "volume", MPV_FORMAT_DOUBLE, &volume) < 0) volume = 0.0;
  if (mpv_get_property(mpv_instance, "time-pos", MPV_FORMAT_DOUBLE, &position) < 0) position = 0.0;
  if (mpv_get_property(mpv_instance, "duration", MPV_FORMAT_DOUBLE, &duration) < 0) duration = 0.0;

  napi_value obj;
  if (napi_create_object(env, &obj) != napi_ok) return make_null(env);

  napi_value playing_val;
  napi_value volume_val;
  napi_value muted_val;
  napi_value position_val;
  napi_value duration_val;

  if (napi_get_boolean(env, pause ? 0 : 1, &playing_val) != napi_ok) return make_null(env);
  if (napi_create_double(env, volume, &volume_val) != napi_ok) return make_null(env);
  if (napi_get_boolean(env, mute ? 1 : 0, &muted_val) != napi_ok) return make_null(env);
  if (napi_create_double(env, position, &position_val) != napi_ok) return make_null(env);
  if (napi_create_double(env, duration, &duration_val) != napi_ok) return make_null(env);

  if (napi_set_named_property(env, obj, "playing", playing_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "volume", volume_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "muted", muted_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "position", position_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "duration", duration_val) != napi_ok) return make_null(env);

  return obj;
}

static napi_value mpv_is_initialized(napi_env env, napi_callback_info info) {
  (void)info;
  return make_bool(env, mpv_instance != NULL);
}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
    { "init", NULL, mpv_init, NULL, NULL, NULL, napi_default, NULL },
    { "shutdown", NULL, mpv_shutdown, NULL, NULL, NULL, napi_default, NULL },
    { "setSize", NULL, mpv_set_size, NULL, NULL, NULL, napi_default, NULL },
    { "renderFrame", NULL, mpv_render_frame, NULL, NULL, NULL, napi_default, NULL },
    { "load", NULL, mpv_load, NULL, NULL, NULL, napi_default, NULL },
    { "play", NULL, mpv_play, NULL, NULL, NULL, napi_default, NULL },
    { "pause", NULL, mpv_pause, NULL, NULL, NULL, napi_default, NULL },
    { "togglePause", NULL, mpv_toggle_pause, NULL, NULL, NULL, napi_default, NULL },
    { "stop", NULL, mpv_stop, NULL, NULL, NULL, napi_default, NULL },
    { "setVolume", NULL, mpv_set_volume, NULL, NULL, NULL, napi_default, NULL },
    { "toggleMute", NULL, mpv_toggle_mute, NULL, NULL, NULL, napi_default, NULL },
    { "seek", NULL, mpv_seek, NULL, NULL, NULL, napi_default, NULL },
    { "getStatus", NULL, mpv_get_status, NULL, NULL, NULL, napi_default, NULL },
    { "isInitialized", NULL, mpv_is_initialized, NULL, NULL, NULL, napi_default, NULL },
  };

  if (napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors) != napi_ok) {
    return NULL;
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

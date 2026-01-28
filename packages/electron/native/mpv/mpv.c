#define GL_GLEXT_PROTOTYPES
#include <node_api.h>
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>
#include <libavformat/avformat.h>
#include <locale.h>
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
#include <stdarg.h>
#include <string.h>
#include <strings.h>

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
static int gl_fbo_loaded = 0;
static PFNGLGENFRAMEBUFFERSPROC p_glGenFramebuffers = NULL;
static PFNGLDELETEFRAMEBUFFERSPROC p_glDeleteFramebuffers = NULL;
static PFNGLBINDFRAMEBUFFERPROC p_glBindFramebuffer = NULL;
static PFNGLFRAMEBUFFERTEXTURE2DPROC p_glFramebufferTexture2D = NULL;
static PFNGLCHECKFRAMEBUFFERSTATUSPROC p_glCheckFramebufferStatus = NULL;
static PFNGLGENFRAMEBUFFERSEXTPROC p_glGenFramebuffersEXT = NULL;
static PFNGLDELETEFRAMEBUFFERSEXTPROC p_glDeleteFramebuffersEXT = NULL;
static PFNGLBINDFRAMEBUFFEREXTPROC p_glBindFramebufferEXT = NULL;
static PFNGLFRAMEBUFFERTEXTURE2DEXTPROC p_glFramebufferTexture2DEXT = NULL;
static PFNGLCHECKFRAMEBUFFERSTATUSEXTPROC p_glCheckFramebufferStatusEXT = NULL;

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
static char last_error[256];
static int set_size_call_count = 0;
static int g_file_loaded = 0;
static int g_end_file_error = 0;
static char g_end_file_error_text[512] = {0};
static char g_last_log[1024] = {0};
static char g_last_error_log[1024] = {0};
static const char *SBTLTV_MPV_BUILD_ID = __DATE__ " " __TIME__;
static char g_last_hwdec_current[64] = {0};
static char g_last_hwdec_interop[64] = {0};
static char g_last_gpu_hwdec_interop[64] = {0};
static char g_last_hwdec[64] = {0};
static char g_last_hwdec_available[256] = {0};
static char g_last_hwdec_codecs[256] = {0};
static char g_last_vo[64] = {0};
static char g_last_gpu_api[64] = {0};
static char g_last_gpu_context[64] = {0};
static char g_last_video_codec[64] = {0};

static void load_gl_fbo(void);
static int gl_has_fbo(void);
static void gl_gen_framebuffers(GLsizei n, GLuint *ids);
static void gl_delete_framebuffers(GLsizei n, const GLuint *ids);
static void gl_bind_framebuffer(GLenum target, GLuint framebuffer);
static void gl_framebuffer_texture_2d(GLenum target, GLenum attachment, GLenum textarget, GLuint texture, GLint level);
static GLenum gl_check_framebuffer_status(GLenum target);

static void set_last_error(const char *message) {
  if (!message) {
    last_error[0] = '\0';
    return;
  }
  strncpy(last_error, message, sizeof(last_error) - 1);
  last_error[sizeof(last_error) - 1] = '\0';
}

static void log_error_message(const char *message) {
  if (message && message[0]) {
    fprintf(stderr, "%s\n", message);
    fflush(stderr);
  }
}

static void log_info_message(const char *message) {
  if (message && message[0]) {
    fprintf(stderr, "%s\n", message);
    fflush(stderr);
  }
}

static void log_debug_message(const char *message) {
  if (message && message[0]) {
    fprintf(stderr, "%s\n", message);
    fflush(stderr);
  }
}

static void log_debugf(const char *fmt, ...) {
  char buffer[512];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);
  log_debug_message(buffer);
}

static int get_string_property(const char *name, char *out, size_t out_size) {
  if (!mpv_instance || !out || out_size == 0) return 0;
  out[0] = '\0';
  char *value = NULL;
  if (mpv_get_property(mpv_instance, name, MPV_FORMAT_STRING, &value) >= 0 && value) {
    snprintf(out, out_size, "%s", value);
    mpv_free(value);
    return 1;
  }
  return 0;
}

static void log_prop_change(const char *label, const char *value, char *last, size_t last_size) {
  if (!label || !value || !last || last_size == 0) return;
  if (strncmp(last, value, last_size) != 0) {
    snprintf(last, last_size, "%s", value);
    fprintf(stderr, "%s%s\n", label, value);
    fflush(stderr);
  }
}

static void log_versions(void) {
  const char *ffmpeg_ver = av_version_info();
  unsigned avformat_ver = avformat_version();
  fprintf(stderr, "[libmpv] mpv client api: %lu\n", (unsigned long)mpv_client_api_version());
  if (ffmpeg_ver) fprintf(stderr, "[libmpv] ffmpeg version: %s\n", ffmpeg_ver);
  fprintf(stderr, "[libmpv] avformat version: %u\n", avformat_ver);
  fflush(stderr);
}

static void set_last_error_from_mpv(const char *context, int code) {
  const char *msg = mpv_error_string(code);
  if (!msg) msg = "unknown";
  if (context && context[0]) {
    snprintf(last_error, sizeof(last_error), "%s: %s", context, msg);
  } else {
    snprintf(last_error, sizeof(last_error), "%s", msg);
  }
  last_error[sizeof(last_error) - 1] = '\0';
  fprintf(stderr, "[libmpv] %s\n", last_error);
  fflush(stderr);
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
  log_error_message(message);
}

static int env_is_truthy(const char *value) {
  if (!value || !value[0]) return 0;
  return !strcasecmp(value, "1") || !strcasecmp(value, "true") || !strcasecmp(value, "yes");
}

static int env_is_falsey(const char *value) {
  if (!value || !value[0]) return 0;
  return !strcasecmp(value, "0") || !strcasecmp(value, "false") || !strcasecmp(value, "no");
}

static int set_option_string_required(const char *name, const char *value) {
  if (!mpv_instance) return 0;
  int res = mpv_set_option_string(mpv_instance, name, value);
  if (res < 0) {
    set_last_error_from_mpv(name, res);
    return 0;
  }
  return 1;
}

static int set_option_string_optional(const char *name, const char *value) {
  if (!mpv_instance) return 0;
  int res = mpv_set_option_string(mpv_instance, name, value);
  if (res < 0) {
    const char *msg = mpv_error_string(res);
    if (!msg) msg = "unknown";
    fprintf(stderr, "[libmpv] optional option failed: %s=%s (%s)\n", name, value, msg);
    fflush(stderr);
    return 0;
  }
  return 1;
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
    fprintf(stderr, "[libmpv] EGL X11 init failed (egl error: 0x%04x)\n", eglGetError());
    fflush(stderr);
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
    fprintf(stderr, "[libmpv] EGL Wayland init failed (egl error: 0x%04x)\n", eglGetError());
    fflush(stderr);
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
    fprintf(stderr, "[libmpv] GLX context create failed\n");
    fflush(stderr);
    XCloseDisplay(glx_display);
    glx_display = NULL;
    return 0;
  }

  if (!glx_create_pbuffer(1, 1)) {
    fprintf(stderr, "[libmpv] GLX pbuffer create failed\n");
    fflush(stderr);
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
  int prefer_wayland = (wayland && wayland[0]) || (session && strcmp(session, "wayland") == 0);

  if (prefer_wayland && init_egl_wayland()) return 1;
  if (display && init_egl_x11()) return 1;
  if (display && init_glx()) return 1;

  log_error("[libmpv] Failed to initialize OpenGL context (x11egl, wayland, x11)");
  set_last_error("gl context init failed");
  return 0;
}

static int make_current(void) {
  if (gl_ctx == CTX_EGL_X11 || gl_ctx == CTX_EGL_WAYLAND) {
    if (egl_display == EGL_NO_DISPLAY || egl_context == EGL_NO_CONTEXT) return 0;
    if (!eglMakeCurrent(egl_display, egl_surface, egl_surface, egl_context)) {
      fprintf(stderr, "[libmpv] eglMakeCurrent failed (egl error: 0x%04x)\n", eglGetError());
      fflush(stderr);
      return 0;
    }
    return 1;
  }
  if (gl_ctx == CTX_GLX) {
    if (!glx_display || !glx_context || !glx_pbuffer) return 0;
    if (!glXMakeContextCurrent(glx_display, glx_pbuffer, glx_pbuffer, glx_context)) {
      fprintf(stderr, "[libmpv] glXMakeContextCurrent failed\n");
      fflush(stderr);
      return 0;
    }
    return 1;
  }
  return 0;
}

static void cleanup_fbo(void) {
  if (fbo) {
    gl_delete_framebuffers(1, &fbo);
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
  load_gl_fbo();
  if (!gl_has_fbo()) {
    log_error("[libmpv] FBO functions unavailable");
    set_last_error("fbo functions unavailable");
    return 0;
  }

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
  {
    GLenum err = glGetError();
    if (err != GL_NO_ERROR) {
      fprintf(stderr, "[libmpv] GL error after glTexImage2D: 0x%04x\n", err);
      fflush(stderr);
      set_last_error("glTexImage2D failed");
      cleanup_fbo();
      return 0;
    }
  }

  gl_gen_framebuffers(1, &fbo);
  if (!fbo) {
    set_last_error("glGenFramebuffers failed");
    cleanup_fbo();
    return 0;
  }
  gl_bind_framebuffer(GL_FRAMEBUFFER, fbo);
  gl_framebuffer_texture_2d(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, fbo_tex, 0);

  GLenum status = gl_check_framebuffer_status(GL_FRAMEBUFFER);
  if (status != GL_FRAMEBUFFER_COMPLETE) {
    fprintf(stderr, "[libmpv] FBO status=0x%04x\n", status);
    fflush(stderr);
    set_last_error("fbo incomplete");
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

static void load_gl_fbo(void) {
  if (gl_fbo_loaded) return;
  gl_fbo_loaded = 1;
  p_glGenFramebuffers = (PFNGLGENFRAMEBUFFERSPROC)get_proc_address(NULL, "glGenFramebuffers");
  p_glDeleteFramebuffers = (PFNGLDELETEFRAMEBUFFERSPROC)get_proc_address(NULL, "glDeleteFramebuffers");
  p_glBindFramebuffer = (PFNGLBINDFRAMEBUFFERPROC)get_proc_address(NULL, "glBindFramebuffer");
  p_glFramebufferTexture2D = (PFNGLFRAMEBUFFERTEXTURE2DPROC)get_proc_address(NULL, "glFramebufferTexture2D");
  p_glCheckFramebufferStatus = (PFNGLCHECKFRAMEBUFFERSTATUSPROC)get_proc_address(NULL, "glCheckFramebufferStatus");

  p_glGenFramebuffersEXT = (PFNGLGENFRAMEBUFFERSEXTPROC)get_proc_address(NULL, "glGenFramebuffersEXT");
  p_glDeleteFramebuffersEXT = (PFNGLDELETEFRAMEBUFFERSEXTPROC)get_proc_address(NULL, "glDeleteFramebuffersEXT");
  p_glBindFramebufferEXT = (PFNGLBINDFRAMEBUFFEREXTPROC)get_proc_address(NULL, "glBindFramebufferEXT");
  p_glFramebufferTexture2DEXT = (PFNGLFRAMEBUFFERTEXTURE2DEXTPROC)get_proc_address(NULL, "glFramebufferTexture2DEXT");
  p_glCheckFramebufferStatusEXT = (PFNGLCHECKFRAMEBUFFERSTATUSEXTPROC)get_proc_address(NULL, "glCheckFramebufferStatusEXT");
}

static int gl_has_fbo(void) {
  return (p_glGenFramebuffers && p_glBindFramebuffer && p_glFramebufferTexture2D && p_glCheckFramebufferStatus) ||
    (p_glGenFramebuffersEXT && p_glBindFramebufferEXT && p_glFramebufferTexture2DEXT && p_glCheckFramebufferStatusEXT);
}

static void gl_gen_framebuffers(GLsizei n, GLuint *ids) {
  if (p_glGenFramebuffers) {
    p_glGenFramebuffers(n, ids);
    return;
  }
  if (p_glGenFramebuffersEXT) {
    p_glGenFramebuffersEXT(n, ids);
  }
}

static void gl_delete_framebuffers(GLsizei n, const GLuint *ids) {
  if (p_glDeleteFramebuffers) {
    p_glDeleteFramebuffers(n, ids);
    return;
  }
  if (p_glDeleteFramebuffersEXT) {
    p_glDeleteFramebuffersEXT(n, ids);
  }
}

static void gl_bind_framebuffer(GLenum target, GLuint framebuffer) {
  if (p_glBindFramebuffer) {
    p_glBindFramebuffer(target, framebuffer);
    return;
  }
  if (p_glBindFramebufferEXT) {
    p_glBindFramebufferEXT(target, framebuffer);
  }
}

static void gl_framebuffer_texture_2d(GLenum target, GLenum attachment, GLenum textarget, GLuint texture, GLint level) {
  if (p_glFramebufferTexture2D) {
    p_glFramebufferTexture2D(target, attachment, textarget, texture, level);
    return;
  }
  if (p_glFramebufferTexture2DEXT) {
    p_glFramebufferTexture2DEXT(target, attachment, textarget, texture, level);
  }
}

static GLenum gl_check_framebuffer_status(GLenum target) {
  if (p_glCheckFramebufferStatus) {
    return p_glCheckFramebufferStatus(target);
  }
  if (p_glCheckFramebufferStatusEXT) {
    return p_glCheckFramebufferStatusEXT(target);
  }
  return 0;
}

static napi_value mpv_init(napi_env env, napi_callback_info info) {
  (void)info;
  if (mpv_instance) {
    log_info_message("[libmpv] mpv_init called (already initialized)");
    return make_bool(env, 1);
  }

  set_last_error(NULL);
  set_size_call_count = 0;
  setlocale(LC_NUMERIC, "C");
  log_info_message("[libmpv] mpv_init called");
  log_versions();
  if (avformat_network_init() < 0) {
    log_error("[libmpv] avformat_network_init failed");
  }
  if (!init_gl_context()) {
    return make_bool(env, 0);
  }

  mpv_instance = mpv_create();
  if (!mpv_instance) {
    set_last_error("mpv_create failed");
    cleanup_gl();
    return make_bool(env, 0);
  }


  int ok = 1;
  set_option_string_optional("terminal", "no");
  set_option_string_optional("config", "no");
  const char *log_file = getenv("SBTLTV_MPV_LOG_FILE");
  if (log_file && log_file[0]) {
    set_option_string_optional("log-file", log_file);
  }
  const char *log_level = getenv("SBTLTV_MPV_LOG_LEVEL");
  if (!log_level || !log_level[0]) log_level = "v";
  char msg_level[64];
  snprintf(msg_level, sizeof(msg_level), "all=%s", log_level);
  set_option_string_optional("msg-level", msg_level);
  set_option_string_optional("idle", "yes");
  set_option_string_optional("keep-open", "yes");
  set_option_string_optional("osc", "no");
  set_option_string_optional("osd-bar", "no");
  set_option_string_optional("osd-level", "0");
  set_option_string_optional("input-default-bindings", "no");
  set_option_string_optional("cursor-autohide", "no");
  set_option_string_optional("network", "yes");
  const char *ytdl = getenv("SBTLTV_YTDL");
  if (!ytdl || !ytdl[0]) ytdl = "no";
  set_option_string_optional("ytdl", ytdl);
  const char *ytdl_path = getenv("SBTLTV_YTDL_PATH");
  if (ytdl_path && ytdl_path[0]) {
    set_option_string_optional("ytdl-path", ytdl_path);
  }
  const char *video_rotate = getenv("SBTLTV_VIDEO_ROTATE");
  if (!video_rotate || !video_rotate[0]) video_rotate = "0";
  set_option_string_optional("video-rotate", video_rotate);
  ok &= set_option_string_required("vo", "libmpv");
  ok &= set_option_string_required("gpu-api", "opengl");

  int ctx_ok = 1;
  if (gl_ctx == CTX_EGL_X11) ctx_ok = set_option_string_optional("gpu-context", "x11egl");
  if (gl_ctx == CTX_EGL_WAYLAND) ctx_ok = set_option_string_optional("gpu-context", "wayland");
  if (gl_ctx == CTX_GLX) ctx_ok = set_option_string_optional("gpu-context", "x11");
  if (!ctx_ok) {
    set_option_string_optional("gpu-context", "auto");
  }

  const char *hwdec = getenv("SBTLTV_HWDEC");
  const char *enforce_env = getenv("SBTLTV_HWDEC_ENFORCE");
  int enforce_hwdec = !env_is_falsey(enforce_env);
  if (!hwdec || !hwdec[0]) hwdec = enforce_hwdec ? "vaapi-copy" : "auto-copy";
  set_option_string_optional("hwdec", hwdec);
  const char *hwdec_interop = getenv("SBTLTV_HWDEC_INTEROP");
  if (!hwdec_interop || !hwdec_interop[0]) hwdec_interop = "auto";
  set_option_string_optional("hwdec-interop", hwdec_interop);
  set_option_string_optional("gpu-hwdec-interop", hwdec_interop);
  const char *hwdec_codecs = getenv("SBTLTV_HWDEC_CODECS");
  if (hwdec_codecs && hwdec_codecs[0]) {
    set_option_string_optional("hwdec-codecs", hwdec_codecs);
  }
  {
    char summary[256];
    snprintf(summary, sizeof(summary), "[libmpv] options: vo=libmpv gpu-api=opengl gpu-context=%s hwdec=%s hwdec-interop=%s",
      gl_ctx == CTX_EGL_X11 ? "x11egl" : (gl_ctx == CTX_EGL_WAYLAND ? "wayland" : (gl_ctx == CTX_GLX ? "x11" : "auto")),
      hwdec,
      hwdec_interop);
    log_info_message(summary);
  }

  if (!ok) {
    if (!last_error[0]) {
      set_last_error("mpv option set failed");
    }
    mpv_terminate_destroy(mpv_instance);
    mpv_instance = NULL;
    cleanup_gl();
    return make_bool(env, 0);
  }

  if (mpv_initialize(mpv_instance) < 0) {
    set_last_error("mpv_initialize failed");
    log_error_message("[libmpv] mpv_initialize failed");
    mpv_terminate_destroy(mpv_instance);
    mpv_instance = NULL;
    cleanup_gl();
    return make_bool(env, 0);
  }

  log_info_message("[libmpv] mpv_initialize ok");

  if (mpv_request_log_messages(mpv_instance, log_level) < 0) {
    log_error("[libmpv] mpv_request_log_messages failed");
  }

  {
    char build_info[256];
    snprintf(build_info, sizeof(build_info), "[libmpv] build: %s", SBTLTV_MPV_BUILD_ID);
    log_info_message(build_info);
    char context_info[256];
    snprintf(context_info, sizeof(context_info), "[libmpv] gl_ctx=%s gpu-context=%s hwdec=%s",
      gl_ctx == CTX_EGL_X11 ? "x11egl" : (gl_ctx == CTX_EGL_WAYLAND ? "wayland" : (gl_ctx == CTX_GLX ? "x11" : "none")),
      gl_ctx == CTX_EGL_X11 ? "x11egl" : (gl_ctx == CTX_EGL_WAYLAND ? "wayland" : (gl_ctx == CTX_GLX ? "x11" : "auto")),
      hwdec);
    log_info_message(context_info);
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

  mpv_render_param display_param = { MPV_RENDER_PARAM_INVALID, NULL };
  const char *display_label = NULL;
  if (gl_ctx == CTX_EGL_WAYLAND && egl_wl_display) {
    display_param.type = MPV_RENDER_PARAM_WL_DISPLAY;
    display_param.data = (void *)egl_wl_display;
    display_label = "wl_display";
  } else if (gl_ctx == CTX_EGL_X11 && egl_x11_display) {
    display_param.type = MPV_RENDER_PARAM_X11_DISPLAY;
    display_param.data = (void *)egl_x11_display;
    display_label = "x11_display";
  } else if (gl_ctx == CTX_GLX && glx_display) {
    display_param.type = MPV_RENDER_PARAM_X11_DISPLAY;
    display_param.data = (void *)glx_display;
    display_label = "x11_display";
  }
  if (display_label) {
    char msg[128];
    snprintf(msg, sizeof(msg), "[libmpv] render display param: %s", display_label);
    log_info_message(msg);
  }

  mpv_render_param params[4];
  int param_count = 0;
  params[param_count++] = (mpv_render_param){ MPV_RENDER_PARAM_API_TYPE, (void *)MPV_RENDER_API_TYPE_OPENGL };
  params[param_count++] = (mpv_render_param){ MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init };
  if (display_param.type != MPV_RENDER_PARAM_INVALID) {
    params[param_count++] = display_param;
  }
  params[param_count++] = (mpv_render_param){ MPV_RENDER_PARAM_INVALID, NULL };

  {
    int render_res = mpv_render_context_create(&mpv_render, mpv_instance, params);
    if (render_res < 0) {
      char msg[256];
      snprintf(msg, sizeof(msg), "[libmpv] mpv_render_context_create failed: %s (%d)",
        mpv_error_string(render_res), render_res);
      set_last_error("mpv_render_context_create failed");
      log_error_message(msg);
      mpv_terminate_destroy(mpv_instance);
      mpv_instance = NULL;
      mpv_render = NULL;
      cleanup_gl();
      return make_bool(env, 0);
    }
  }

  atomic_store(&render_pending, 1);
  mpv_render_context_set_update_callback(mpv_render, on_mpv_update, NULL);

  set_last_error(NULL);
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
  avformat_network_deinit();

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
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok) {
    set_last_error("napi_get_cb_info failed");
    return make_null(env);
  }

  if (argc < 2) {
    set_last_error("missing size args");
    return make_null(env);
  }
  if (!mpv_render) {
    set_last_error("render context missing");
    return make_null(env);
  }

  set_size_call_count += 1;

  int32_t width = 0;
  int32_t height = 0;
  if (napi_get_value_int32(env, args[0], &width) != napi_ok) {
    set_last_error("width parse failed");
    return make_null(env);
  }
  if (napi_get_value_int32(env, args[1], &height) != napi_ok) {
    set_last_error("height parse failed");
    return make_null(env);
  }

  if (set_size_call_count <= 3) {
    fprintf(stderr, "[libmpv] setSize call %d: %dx%d ctx=%d\\n", set_size_call_count, width, height, gl_ctx);
    fflush(stderr);
  }

  if (width <= 0 || height <= 0) {
    set_last_error("invalid size");
    return make_null(env);
  }

  if (!make_current()) {
    log_error("[libmpv] make current failed");
    set_last_error("make current failed");
    return make_null(env);
  }

  if (!ensure_fbo(width, height)) {
    log_error("[libmpv] FBO resize failed");
    if (!last_error[0]) set_last_error("fbo resize failed");
    return make_null(env);
  }

  frame_width = width;
  frame_height = height;
  frame_stride = frame_width * 4;
  frame_buffer_size = (size_t)frame_stride * (size_t)frame_height;
  atomic_store(&render_pending, 1);

  void *buffer = NULL;
  napi_value arraybuffer;
  if (napi_create_arraybuffer(env, frame_buffer_size, &buffer, &arraybuffer) != napi_ok || !buffer) {
    set_last_error("napi_create_arraybuffer failed");
    return make_null(env);
  }
  memset(buffer, 0, frame_buffer_size);

  frame_buffer = (uint8_t *)buffer;

  napi_value obj;
  if (napi_create_object(env, &obj) != napi_ok) {
    set_last_error("napi_create_object failed");
    return make_null(env);
  }

  napi_value width_val;
  napi_value height_val;
  napi_value stride_val;
  if (napi_create_int32(env, frame_width, &width_val) != napi_ok) {
    set_last_error("napi_create_int32 width failed");
    return make_null(env);
  }
  if (napi_create_int32(env, frame_height, &height_val) != napi_ok) {
    set_last_error("napi_create_int32 height failed");
    return make_null(env);
  }
  if (napi_create_int32(env, frame_stride, &stride_val) != napi_ok) {
    set_last_error("napi_create_int32 stride failed");
    return make_null(env);
  }

  if (napi_set_named_property(env, obj, "buffer", arraybuffer) != napi_ok) {
    set_last_error("napi_set_named_property buffer failed");
    return make_null(env);
  }
  if (napi_set_named_property(env, obj, "width", width_val) != napi_ok) {
    set_last_error("napi_set_named_property width failed");
    return make_null(env);
  }
  if (napi_set_named_property(env, obj, "height", height_val) != napi_ok) {
    set_last_error("napi_set_named_property height failed");
    return make_null(env);
  }
  if (napi_set_named_property(env, obj, "stride", stride_val) != napi_ok) {
    set_last_error("napi_set_named_property stride failed");
    return make_null(env);
  }

  set_last_error(NULL);
  return obj;
}

static napi_value mpv_render_frame(napi_env env, napi_callback_info info) {
  (void)info;
  if (!mpv_render || !frame_buffer || frame_width <= 0 || frame_height <= 0) {
    set_last_error("render context or frame buffer missing");
    return make_bool(env, 0);
  }

  int did_render = 0;

  if (!make_current()) {
    set_last_error("make_current failed in render");
    log_error_message("[libmpv] make_current failed in render");
    return make_bool(env, 0);
  }

  uint64_t flags = mpv_render_context_update(mpv_render);
  static uint64_t last_flags = 0;
  if (flags != last_flags) {
    log_debugf("[libmpv] render flags: 0x%llx", (unsigned long long)flags);
    last_flags = flags;
  }

  if (!fbo) {
    set_last_error("fbo not initialized");
    return make_bool(env, 0);
  }

  mpv_opengl_fbo target = {
    .fbo = (int)fbo,
    .w = frame_width,
    .h = frame_height,
    .internal_format = 0,
  };

  mpv_render_param params[] = {
    { MPV_RENDER_PARAM_OPENGL_FBO, &target },
    { MPV_RENDER_PARAM_INVALID, NULL },
  };

  glViewport(0, 0, frame_width, frame_height);
  mpv_render_context_render(mpv_render, params);
  did_render = 1;

  gl_bind_framebuffer(GL_FRAMEBUFFER, fbo);
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glReadPixels(0, 0, frame_width, frame_height, GL_RGBA, GL_UNSIGNED_BYTE, frame_buffer);
  {
    GLenum err = glGetError();
    if (err != GL_NO_ERROR) {
      char msg[128];
      snprintf(msg, sizeof(msg), "[libmpv] glReadPixels error: 0x%04x", err);
      log_error_message(msg);
    }
  }

  if (did_render) {
    atomic_store(&render_pending, 0);
  }
  return make_bool(env, did_render);
}

static napi_value mpv_needs_render(napi_env env, napi_callback_info info) {
  (void)info;
  return make_bool(env, atomic_load(&render_pending) != 0);
}

static napi_value mpv_command_simple(napi_env env, const char *cmd, const char *arg) {
  if (!mpv_instance) return make_bool(env, 0);
  const char *cmd_args[3] = { cmd, arg, NULL };
  int res = mpv_command(mpv_instance, cmd_args);
  if (res < 0) {
    set_last_error_from_mpv(cmd, res);
  }
  return make_bool(env, res >= 0);
}

static int set_property_string_optional(const char *name, const char *value) {
  if (!mpv_instance) return 0;
  int res = mpv_set_property_string(mpv_instance, name, value);
  if (res < 0) {
    const char *msg = mpv_error_string(res);
    fprintf(stderr, "[libmpv] optional property failed: %s=%s (%s)\n", name, value, msg);
    fflush(stderr);
  }
  return res >= 0;
}

static int contains_ci(const char *haystack, const char *needle) {
  if (!haystack || !needle || !needle[0]) return 0;
  size_t nlen = strlen(needle);
  for (const char *p = haystack; *p; p++) {
    if (strncasecmp(p, needle, nlen) == 0) return 1;
  }
  return 0;
}

static int is_youtube_url(const char *url) {
  if (!url) return 0;
  return contains_ci(url, "youtube.com/") ||
    contains_ci(url, "youtu.be/") ||
    contains_ci(url, "youtube-nocookie.com/") ||
    contains_ci(url, "music.youtube.com/");
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

  const char *ytdl_env = getenv("SBTLTV_YTDL");
  int use_ytdl = is_youtube_url(url);
  if (ytdl_env && ytdl_env[0]) {
    if (!strcasecmp(ytdl_env, "no") || !strcasecmp(ytdl_env, "0") || !strcasecmp(ytdl_env, "false")) {
      use_ytdl = 0;
    } else if (!strcasecmp(ytdl_env, "yes") || !strcasecmp(ytdl_env, "1") || !strcasecmp(ytdl_env, "true")) {
      use_ytdl = 1;
    }
  }
  if (!set_property_string_optional("ytdl", use_ytdl ? "yes" : "no")) {
    // Ignore; continue load with current mpv setting.
  }
  if (use_ytdl) {
    const char *ytdl_path = getenv("SBTLTV_YTDL_PATH");
    if (ytdl_path && ytdl_path[0]) {
      if (!set_property_string_optional("ytdl-path", ytdl_path)) {
        // Ignore; continue load with current mpv setting.
      }
    }
  }

  const char *cmd_args[3] = { "loadfile", url, NULL };
  int res = mpv_command(mpv_instance, cmd_args);
  free(url);
  if (res < 0) {
    set_last_error_from_mpv("loadfile", res);
  }
  return make_bool(env, res >= 0);
}

static napi_value mpv_play(napi_env env, napi_callback_info info) {
  (void)info;
  if (!mpv_instance) return make_bool(env, 0);
  int flag = 0;
  int res = mpv_set_property(mpv_instance, "pause", MPV_FORMAT_FLAG, &flag);
  if (res < 0) {
    set_last_error_from_mpv("play", res);
  }
  return make_bool(env, res >= 0);
}

static napi_value mpv_pause(napi_env env, napi_callback_info info) {
  (void)info;
  if (!mpv_instance) return make_bool(env, 0);
  int flag = 1;
  int res = mpv_set_property(mpv_instance, "pause", MPV_FORMAT_FLAG, &flag);
  if (res < 0) {
    set_last_error_from_mpv("pause", res);
  }
  return make_bool(env, res >= 0);
}

static napi_value mpv_toggle_pause(napi_env env, napi_callback_info info) {
  (void)info;
  return mpv_command_simple(env, "cycle", "pause");
}

static napi_value mpv_stop(napi_env env, napi_callback_info info) {
  (void)info;
  return mpv_command_simple(env, "stop", NULL);
}

static napi_value mpv_set_volume(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok) return make_bool(env, 0);

  if (argc < 1 || !mpv_instance) return make_bool(env, 0);

  double volume = 0.0;
  if (napi_get_value_double(env, args[0], &volume) != napi_ok) return make_bool(env, 0);
  int res = mpv_set_property(mpv_instance, "volume", MPV_FORMAT_DOUBLE, &volume);
  if (res < 0) {
    set_last_error_from_mpv("volume", res);
  }
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
  if (res < 0) {
    set_last_error_from_mpv("seek", res);
  }
  return make_bool(env, res >= 0);
}

static napi_value mpv_get_status(napi_env env, napi_callback_info info) {
  (void)info;
  if (!mpv_instance) return make_null(env);

  int pause = 0;
  int mute = 0;
  double volume = 0.0;
  double position = -1.0;
  double duration = 0.0;
  char hwdec_value[64] = "no";
  char hwdec_setting[64] = "";
  char hwdec_interop[64] = "";
  char hwdec_available[256] = "";
  char hwdec_codecs[256] = "";
  char gpu_hwdec_interop[64] = "";
  char vo_value[64] = "";
  char gpu_api_value[64] = "";
  char gpu_context_value[64] = "";
  char video_codec_value[64] = "";

  if (mpv_get_property(mpv_instance, "pause", MPV_FORMAT_FLAG, &pause) < 0) pause = 0;
  if (mpv_get_property(mpv_instance, "mute", MPV_FORMAT_FLAG, &mute) < 0) mute = 0;
  if (mpv_get_property(mpv_instance, "volume", MPV_FORMAT_DOUBLE, &volume) < 0) volume = 0.0;
  if (mpv_get_property(mpv_instance, "time-pos", MPV_FORMAT_DOUBLE, &position) < 0) position = -1.0;
  if (mpv_get_property(mpv_instance, "duration", MPV_FORMAT_DOUBLE, &duration) < 0) duration = 0.0;
  char *hwdec_current = NULL;
  if (mpv_get_property(mpv_instance, "hwdec-current", MPV_FORMAT_STRING, &hwdec_current) >= 0 && hwdec_current) {
    snprintf(hwdec_value, sizeof(hwdec_value), "%s", hwdec_current);
    mpv_free(hwdec_current);
  }

  get_string_property("hwdec", hwdec_setting, sizeof(hwdec_setting));
  get_string_property("hwdec-interop", hwdec_interop, sizeof(hwdec_interop));
  get_string_property("gpu-hwdec-interop", gpu_hwdec_interop, sizeof(gpu_hwdec_interop));
  get_string_property("hwdec-available", hwdec_available, sizeof(hwdec_available));
  get_string_property("hwdec-codecs", hwdec_codecs, sizeof(hwdec_codecs));
  get_string_property("vo", vo_value, sizeof(vo_value));
  get_string_property("gpu-api", gpu_api_value, sizeof(gpu_api_value));
  get_string_property("gpu-context", gpu_context_value, sizeof(gpu_context_value));
  get_string_property("video-codec", video_codec_value, sizeof(video_codec_value));

  {
    char buf[128];
    log_prop_change("[libmpv] hwdec-current=", hwdec_value, g_last_hwdec_current, sizeof(g_last_hwdec_current));
    if (get_string_property("hwdec-interop", buf, sizeof(buf))) {
      log_prop_change("[libmpv] hwdec-interop=", buf, g_last_hwdec_interop, sizeof(g_last_hwdec_interop));
    }
    if (get_string_property("gpu-hwdec-interop", buf, sizeof(buf))) {
      log_prop_change("[libmpv] gpu-hwdec-interop=", buf, g_last_gpu_hwdec_interop, sizeof(g_last_gpu_hwdec_interop));
    }
    if (get_string_property("hwdec", buf, sizeof(buf))) {
      log_prop_change("[libmpv] hwdec=", buf, g_last_hwdec, sizeof(g_last_hwdec));
    }
    if (get_string_property("hwdec-available", buf, sizeof(buf))) {
      log_prop_change("[libmpv] hwdec-available=", buf, g_last_hwdec_available, sizeof(g_last_hwdec_available));
    }
    if (get_string_property("hwdec-codecs", buf, sizeof(buf))) {
      log_prop_change("[libmpv] hwdec-codecs=", buf, g_last_hwdec_codecs, sizeof(g_last_hwdec_codecs));
    }
    if (get_string_property("vo", buf, sizeof(buf))) {
      log_prop_change("[libmpv] vo=", buf, g_last_vo, sizeof(g_last_vo));
    }
    if (get_string_property("gpu-api", buf, sizeof(buf))) {
      log_prop_change("[libmpv] gpu-api=", buf, g_last_gpu_api, sizeof(g_last_gpu_api));
    }
    if (get_string_property("gpu-context", buf, sizeof(buf))) {
      log_prop_change("[libmpv] gpu-context=", buf, g_last_gpu_context, sizeof(g_last_gpu_context));
    }
    if (get_string_property("video-codec", buf, sizeof(buf))) {
      log_prop_change("[libmpv] video-codec=", buf, g_last_video_codec, sizeof(g_last_video_codec));
    }
  }

  napi_value obj;
  if (napi_create_object(env, &obj) != napi_ok) return make_null(env);

  napi_value playing_val;
  napi_value volume_val;
  napi_value muted_val;
  napi_value position_val;
  napi_value duration_val;
  napi_value hwdec_val;
  napi_value hwdec_setting_val;
  napi_value hwdec_interop_val;
  napi_value hwdec_available_val;
  napi_value hwdec_codecs_val;
  napi_value gpu_hwdec_interop_val;
  napi_value vo_val;
  napi_value gpu_api_val;
  napi_value gpu_context_val;
  napi_value video_codec_val;

  if (napi_get_boolean(env, (!pause && position >= 0.0) ? 1 : 0, &playing_val) != napi_ok) return make_null(env);
  if (napi_create_double(env, volume, &volume_val) != napi_ok) return make_null(env);
  if (napi_get_boolean(env, mute ? 1 : 0, &muted_val) != napi_ok) return make_null(env);
  if (napi_create_double(env, position, &position_val) != napi_ok) return make_null(env);
  if (napi_create_double(env, duration, &duration_val) != napi_ok) return make_null(env);
  if (napi_create_string_utf8(env, hwdec_value, NAPI_AUTO_LENGTH, &hwdec_val) != napi_ok) return make_null(env);
  if (napi_create_string_utf8(env, hwdec_setting, NAPI_AUTO_LENGTH, &hwdec_setting_val) != napi_ok) return make_null(env);
  if (napi_create_string_utf8(env, hwdec_interop, NAPI_AUTO_LENGTH, &hwdec_interop_val) != napi_ok) return make_null(env);
  if (napi_create_string_utf8(env, hwdec_available, NAPI_AUTO_LENGTH, &hwdec_available_val) != napi_ok) return make_null(env);
  if (napi_create_string_utf8(env, hwdec_codecs, NAPI_AUTO_LENGTH, &hwdec_codecs_val) != napi_ok) return make_null(env);
  if (napi_create_string_utf8(env, gpu_hwdec_interop, NAPI_AUTO_LENGTH, &gpu_hwdec_interop_val) != napi_ok) return make_null(env);
  if (napi_create_string_utf8(env, vo_value, NAPI_AUTO_LENGTH, &vo_val) != napi_ok) return make_null(env);
  if (napi_create_string_utf8(env, gpu_api_value, NAPI_AUTO_LENGTH, &gpu_api_val) != napi_ok) return make_null(env);
  if (napi_create_string_utf8(env, gpu_context_value, NAPI_AUTO_LENGTH, &gpu_context_val) != napi_ok) return make_null(env);
  if (napi_create_string_utf8(env, video_codec_value, NAPI_AUTO_LENGTH, &video_codec_val) != napi_ok) return make_null(env);

  if (napi_set_named_property(env, obj, "playing", playing_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "volume", volume_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "muted", muted_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "position", position_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "duration", duration_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "hwdec", hwdec_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "hwdecSetting", hwdec_setting_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "hwdecInterop", hwdec_interop_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "hwdecAvailable", hwdec_available_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "hwdecCodecs", hwdec_codecs_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "gpuHwdecInterop", gpu_hwdec_interop_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "vo", vo_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "gpuApi", gpu_api_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "gpuContext", gpu_context_val) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "videoCodec", video_codec_val) != napi_ok) return make_null(env);

  return obj;
}

static napi_value mpv_is_initialized(napi_env env, napi_callback_info info) {
  (void)info;
  return make_bool(env, mpv_instance != NULL);
}

static napi_value mpv_get_last_error(napi_env env, napi_callback_info info) {
  (void)info;
  if (!last_error[0]) return make_null(env);
  napi_value value;
  if (napi_create_string_utf8(env, last_error, NAPI_AUTO_LENGTH, &value) != napi_ok) return make_null(env);
  return value;
}

static napi_value mpv_get_build_info(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value value;
  if (napi_create_string_utf8(env, SBTLTV_MPV_BUILD_ID, NAPI_AUTO_LENGTH, &value) != napi_ok) return make_null(env);
  return value;
}

static void drain_mpv_events(void) {
  if (!mpv_instance) return;

  for (;;) {
    mpv_event *event = mpv_wait_event(mpv_instance, 0);
    if (!event || event->event_id == MPV_EVENT_NONE) break;

    switch (event->event_id) {
      case MPV_EVENT_FILE_LOADED:
        g_file_loaded = 1;
        break;
      case MPV_EVENT_END_FILE: {
        mpv_event_end_file *end = (mpv_event_end_file *)event->data;
        if (end && end->reason == MPV_END_FILE_REASON_ERROR) {
          g_end_file_error = end->error;
          fprintf(stderr, "[libmpv] end-file error: %s (%d)\n",
            mpv_error_string(end->error), end->error);
          fflush(stderr);
          if (g_last_error_log[0]) {
            snprintf(g_end_file_error_text, sizeof(g_end_file_error_text),
              "%s", g_last_error_log);
          } else {
            snprintf(g_end_file_error_text, sizeof(g_end_file_error_text),
              "%s", mpv_error_string(end->error));
          }
        }
        break;
      }
      case MPV_EVENT_LOG_MESSAGE: {
        mpv_event_log_message *msg = (mpv_event_log_message *)event->data;
        if (!msg || !msg->text) break;
        snprintf(g_last_log, sizeof(g_last_log),
          "[%s] %s: %s",
          msg->level ? msg->level : "?",
          msg->prefix ? msg->prefix : "mpv",
          msg->text);
        if (msg->level && (!strcmp(msg->level, "error") || !strcmp(msg->level, "fatal"))) {
          snprintf(g_last_error_log, sizeof(g_last_error_log),
            "[%s] %s: %s",
            msg->level,
            msg->prefix ? msg->prefix : "mpv",
            msg->text);
        }
        fprintf(stderr, "%s", g_last_log);
        fflush(stderr);
        break;
      }
      default:
        break;
    }
  }
}

static napi_value mpv_poll_events(napi_env env, napi_callback_info info) {
  (void)info;
  if (!mpv_instance) return make_null(env);

  drain_mpv_events();
  int had_error = g_end_file_error != 0;

  napi_value obj;
  if (napi_create_object(env, &obj) != napi_ok) return make_null(env);

  napi_value v;
  if (napi_get_boolean(env, g_file_loaded, &v) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "fileLoaded", v) != napi_ok) return make_null(env);

  if (napi_create_int32(env, g_end_file_error, &v) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "endFileErrorCode", v) != napi_ok) return make_null(env);

  if (napi_create_string_utf8(env, g_end_file_error_text, NAPI_AUTO_LENGTH, &v) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "endFileError", v) != napi_ok) return make_null(env);

  if (napi_create_string_utf8(env, g_last_log, NAPI_AUTO_LENGTH, &v) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "lastLog", v) != napi_ok) return make_null(env);

  if (napi_create_string_utf8(env, g_last_error_log, NAPI_AUTO_LENGTH, &v) != napi_ok) return make_null(env);
  if (napi_set_named_property(env, obj, "lastErrorLog", v) != napi_ok) return make_null(env);

  g_file_loaded = 0;
  g_end_file_error = 0;
  g_end_file_error_text[0] = '\0';
  g_last_log[0] = '\0';
  if (had_error) {
    g_last_error_log[0] = '\0';
  }

  return obj;
}

static napi_value init(napi_env env, napi_value exports) {
  fprintf(stderr, "[libmpv] module init build: %s\n", SBTLTV_MPV_BUILD_ID);
  fflush(stderr);
  napi_property_descriptor descriptors[] = {
    { "init", NULL, mpv_init, NULL, NULL, NULL, napi_default, NULL },
    { "shutdown", NULL, mpv_shutdown, NULL, NULL, NULL, napi_default, NULL },
    { "setSize", NULL, mpv_set_size, NULL, NULL, NULL, napi_default, NULL },
    { "renderFrame", NULL, mpv_render_frame, NULL, NULL, NULL, napi_default, NULL },
    { "needsRender", NULL, mpv_needs_render, NULL, NULL, NULL, napi_default, NULL },
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
    { "getLastError", NULL, mpv_get_last_error, NULL, NULL, NULL, napi_default, NULL },
    { "getBuildInfo", NULL, mpv_get_build_info, NULL, NULL, NULL, napi_default, NULL },
    { "pollEvents", NULL, mpv_poll_events, NULL, NULL, NULL, napi_default, NULL },
  };

  if (napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors) != napi_ok) {
    return NULL;
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

#include <node_api.h>
#include <mpv/client.h>
#include <mpv/render.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static mpv_handle *mpv_instance = NULL;
static mpv_render_context *mpv_render = NULL;
static uint8_t *frame_buffer = NULL;
static size_t frame_buffer_size = 0;
static int frame_width = 0;
static int frame_height = 0;
static int frame_stride = 0;

static void free_buffer(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  free(data);
}

static napi_value make_bool(napi_env env, int value) {
  napi_value result;
  napi_get_boolean(env, value ? 1 : 0, &result);
  return result;
}

static int set_option_string(const char *name, const char *value) {
  if (!mpv_instance) return -1;
  return mpv_set_option_string(mpv_instance, name, value);
}

static napi_value mpv_init(napi_env env, napi_callback_info info) {
  (void)info;
  if (mpv_instance) return make_bool(env, 1);

  mpv_instance = mpv_create();
  if (!mpv_instance) return make_bool(env, 0);

  set_option_string("terminal", "no");
  set_option_string("msg-level", "all=warn");
  set_option_string("idle", "yes");
  set_option_string("keep-open", "yes");
  set_option_string("osc", "no");
  set_option_string("osd-bar", "no");
  set_option_string("osd-level", "0");
  set_option_string("input-default-bindings", "no");
  set_option_string("cursor-autohide", "no");
  set_option_string("hwdec", "auto-safe");
  set_option_string("vo", "libmpv");

  if (mpv_initialize(mpv_instance) < 0) {
    mpv_terminate_destroy(mpv_instance);
    mpv_instance = NULL;
    return make_bool(env, 0);
  }

  mpv_observe_property(mpv_instance, 0, "pause", MPV_FORMAT_FLAG);
  mpv_observe_property(mpv_instance, 0, "volume", MPV_FORMAT_DOUBLE);
  mpv_observe_property(mpv_instance, 0, "mute", MPV_FORMAT_FLAG);
  mpv_observe_property(mpv_instance, 0, "time-pos", MPV_FORMAT_DOUBLE);
  mpv_observe_property(mpv_instance, 0, "duration", MPV_FORMAT_DOUBLE);

  mpv_render_param params[] = {
    { MPV_RENDER_PARAM_API_TYPE, (void *)MPV_RENDER_API_TYPE_SW },
    { MPV_RENDER_PARAM_INVALID, NULL }
  };

  if (mpv_render_context_create(&mpv_render, mpv_instance, params) < 0) {
    mpv_terminate_destroy(mpv_instance);
    mpv_instance = NULL;
    mpv_render = NULL;
    return make_bool(env, 0);
  }

  return make_bool(env, 1);
}

static napi_value mpv_shutdown(napi_env env, napi_callback_info info) {
  (void)info;
  if (mpv_render) {
    mpv_render_context_free(mpv_render);
    mpv_render = NULL;
  }
  if (mpv_instance) {
    mpv_terminate_destroy(mpv_instance);
    mpv_instance = NULL;
  }
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
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  if (argc < 2 || !mpv_render) {
    napi_value result;
    napi_get_null(env, &result);
    return result;
  }

  int32_t width = 0;
  int32_t height = 0;
  napi_get_value_int32(env, args[0], &width);
  napi_get_value_int32(env, args[1], &height);

  if (width <= 0 || height <= 0) {
    napi_value result;
    napi_get_null(env, &result);
    return result;
  }

  frame_width = width;
  frame_height = height;
  frame_stride = frame_width * 4;
  frame_buffer_size = (size_t)frame_stride * (size_t)frame_height;

  uint8_t *buffer = (uint8_t *)malloc(frame_buffer_size);
  if (!buffer) {
    napi_value result;
    napi_get_null(env, &result);
    return result;
  }
  memset(buffer, 0, frame_buffer_size);

  frame_buffer = buffer;

  napi_value arraybuffer;
  napi_create_external_arraybuffer(env, buffer, frame_buffer_size, free_buffer, NULL, &arraybuffer);

  napi_value obj;
  napi_create_object(env, &obj);

  napi_value width_val;
  napi_value height_val;
  napi_value stride_val;
  napi_create_int32(env, frame_width, &width_val);
  napi_create_int32(env, frame_height, &height_val);
  napi_create_int32(env, frame_stride, &stride_val);

  napi_set_named_property(env, obj, "buffer", arraybuffer);
  napi_set_named_property(env, obj, "width", width_val);
  napi_set_named_property(env, obj, "height", height_val);
  napi_set_named_property(env, obj, "stride", stride_val);

  return obj;
}

static napi_value mpv_render_frame(napi_env env, napi_callback_info info) {
  (void)info;
  if (!mpv_render || !frame_buffer || frame_width <= 0 || frame_height <= 0) {
    return make_bool(env, 0);
  }

  uint64_t flags = mpv_render_context_update(mpv_render);
  if (!(flags & MPV_RENDER_UPDATE_FRAME)) {
    return make_bool(env, 0);
  }

  int size[2] = { frame_width, frame_height };
  int stride = frame_stride;
  mpv_render_param params[] = {
    { MPV_RENDER_PARAM_SW_SIZE, size },
    { MPV_RENDER_PARAM_SW_STRIDE, &stride },
    { MPV_RENDER_PARAM_SW_FORMAT, (void *)"rgba" },
    { MPV_RENDER_PARAM_SW_POINTER, frame_buffer },
    { MPV_RENDER_PARAM_INVALID, NULL }
  };

  mpv_render_context_render(mpv_render, params);
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
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  if (argc < 1 || !mpv_instance) return make_bool(env, 0);

  size_t len = 0;
  napi_get_value_string_utf8(env, args[0], NULL, 0, &len);
  char *url = (char *)malloc(len + 1);
  if (!url) return make_bool(env, 0);
  napi_get_value_string_utf8(env, args[0], url, len + 1, &len);

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
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  if (argc < 1 || !mpv_instance) return make_bool(env, 0);

  double volume = 0.0;
  napi_get_value_double(env, args[0], &volume);
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
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  if (argc < 1 || !mpv_instance) return make_bool(env, 0);

  double seconds = 0.0;
  napi_get_value_double(env, args[0], &seconds);

  char offset[64];
  snprintf(offset, sizeof(offset), "%f", seconds);
  const char *cmd_args[4] = { "seek", offset, "absolute", NULL };
  int res = mpv_command(mpv_instance, cmd_args);
  return make_bool(env, res >= 0);
}

static napi_value mpv_get_status(napi_env env, napi_callback_info info) {
  (void)info;
  if (!mpv_instance) {
    napi_value result;
    napi_get_null(env, &result);
    return result;
  }

  int pause = 0;
  int mute = 0;
  double volume = 0.0;
  double position = 0.0;
  double duration = 0.0;

  mpv_get_property(mpv_instance, "pause", MPV_FORMAT_FLAG, &pause);
  mpv_get_property(mpv_instance, "mute", MPV_FORMAT_FLAG, &mute);
  mpv_get_property(mpv_instance, "volume", MPV_FORMAT_DOUBLE, &volume);
  mpv_get_property(mpv_instance, "time-pos", MPV_FORMAT_DOUBLE, &position);
  mpv_get_property(mpv_instance, "duration", MPV_FORMAT_DOUBLE, &duration);

  napi_value obj;
  napi_create_object(env, &obj);

  napi_value playing_val;
  napi_value volume_val;
  napi_value muted_val;
  napi_value position_val;
  napi_value duration_val;

  napi_get_boolean(env, pause ? 0 : 1, &playing_val);
  napi_create_double(env, volume, &volume_val);
  napi_get_boolean(env, mute ? 1 : 0, &muted_val);
  napi_create_double(env, position, &position_val);
  napi_create_double(env, duration, &duration_val);

  napi_set_named_property(env, obj, "playing", playing_val);
  napi_set_named_property(env, obj, "volume", volume_val);
  napi_set_named_property(env, obj, "muted", muted_val);
  napi_set_named_property(env, obj, "position", position_val);
  napi_set_named_property(env, obj, "duration", duration_val);

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

  napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

#include <gst/gst.h>
#include <gst/video/videooverlay.h>
#include <gst/video/video.h>
#include <gst/audio/streamvolume.h>
#include <gst/app/gstappsink.h>
#include <gst/gstdebugutils.h>
#include <glib.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>

static GstElement *playbin = NULL;
static GstElement *video_sink = NULL;
static GstElement *audio_sink = NULL;
static GMainLoop *main_loop = NULL;
static guint status_timer_id = 0;
static guintptr window_handle = 0;
static gboolean have_rect = 0;
static gint rect_x = 0;
static gint rect_y = 0;
static gint rect_w = 0;
static gint rect_h = 0;
static gboolean buffering = 0;
static gboolean is_playing = 0;
static gboolean want_playing = 0;
static int gst_debug_enabled = 0;
static int gst_http_debug_enabled = 0;
static int gst_dump_enabled = 0;
static int frame_socket_fd = -1;

enum {
  SBTLTV_FRAME_MAGIC = 0x5342544c,
  SBTLTV_FRAME_VERSION = 1,
  SBTLTV_FRAME_FORMAT_RGBA = 1,
};

// Fixed wire header for frame transport over the Unix socket.
// Packed to keep layout stable across compiler settings.
typedef struct __attribute__((packed)) {
  guint32 magic;
  guint16 version;
  guint16 header_size;
  guint32 width;
  guint32 height;
  guint32 stride;
  guint32 format;
  guint64 pts;
  guint32 payload_size;
  guint32 frame_id;
} FrameHeader;

static guint32 frame_id_counter = 0;
// Appsink callbacks run on the streaming thread. Queue + writer thread
// prevents blocking GStreamer while the socket drains.
static GAsyncQueue *frame_queue = NULL;
// Approximate queue size for backpressure decisions (atomic via g_atomic_int_*).
static gint frame_queue_size = 0;
static int frame_writer_running = 0;
static GThread *frame_writer_thread = NULL;
// Small queue to cap latency; newer frames win.
static const gint FRAME_QUEUE_MAX = 3;

typedef struct {
  GstVideoInfo info;
  guint8 *data;
  gsize size;
  GstClockTime pts;
  guint32 frame_id;
} FramePacket;

static GstFlowReturn on_new_sample(GstAppSink *appsink, gpointer user_data);

static int env_flag(const char *name) {
  const char *value = g_getenv(name);
  if (!value || value[0] == '\0') return 0;
  if (g_ascii_strcasecmp(value, "1") == 0) return 1;
  if (g_ascii_strcasecmp(value, "true") == 0) return 1;
  if (g_ascii_strcasecmp(value, "yes") == 0) return 1;
  if (g_ascii_strcasecmp(value, "on") == 0) return 1;
  return 0;
}

static GstElement *try_make_sink(const char *name) {
  if (!name || name[0] == '\0') return NULL;
  return gst_element_factory_make(name, "video_sink");
}

static void set_bool_property(GstElement *element, const char *name, gboolean value) {
  if (!element || !name) return;
  GObjectClass *klass = G_OBJECT_GET_CLASS(element);
  if (!klass) return;
  if (!g_object_class_find_property(klass, name)) return;
  g_object_set(element, name, value, NULL);
}

static void set_string_property(GstElement *element, const char *name, const char *value) {
  if (!element || !name || !value) return;
  if (value[0] == '\0') return;
  GObjectClass *klass = G_OBJECT_GET_CLASS(element);
  if (!klass) return;
  if (!g_object_class_find_property(klass, name)) return;
  g_object_set(element, name, value, NULL);
}

static void set_int_property(GstElement *element, const char *name, gint value) {
  if (!element || !name) return;
  GObjectClass *klass = G_OBJECT_GET_CLASS(element);
  if (!klass) return;
  if (!g_object_class_find_property(klass, name)) return;
  g_object_set(element, name, value, NULL);
}

static gboolean is_wayland_session(void) {
  const char *session = g_getenv("XDG_SESSION_TYPE");
  if (session && g_ascii_strcasecmp(session, "wayland") == 0) return 1;
  const char *wayland_display = g_getenv("WAYLAND_DISPLAY");
  return wayland_display && wayland_display[0] != '\0';
}

static void send_line(const char *prefix, const char *message) {
  if (message) {
    fprintf(stdout, "%s %s\n", prefix, message);
  } else {
    fprintf(stdout, "%s\n", prefix);
  }
  fflush(stdout);
}

static void send_debug(const char *format, ...) {
  if (!gst_debug_enabled && !gst_http_debug_enabled) return;
  char buffer[1024];
  va_list args;
  va_start(args, format);
  vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);
  send_line("debug", buffer);
}

static void format_uri_host(const char *uri, char *buffer, size_t size) {
  if (!buffer || size == 0) return;
  buffer[0] = '\0';
  if (!uri || uri[0] == '\0') return;
  const char *start = strstr(uri, "://");
  start = start ? start + 3 : uri;
  const char *end = strchr(start, '/');
  size_t len = end ? (size_t)(end - start) : strlen(start);
  if (len >= size) len = size - 1;
  memcpy(buffer, start, len);
  buffer[len] = '\0';
}

static void log_structure_fields(const GstStructure *structure, const char *label) {
  if (!gst_http_debug_enabled || !structure) return;
  int count = gst_structure_n_fields(structure);
  GString *fields = g_string_sized_new(64);
  for (int i = 0; i < count; i += 1) {
    const char *name = gst_structure_nth_field_name(structure, i);
    if (!name) continue;
    if (fields->len > 0) g_string_append(fields, ",");
    g_string_append(fields, name);
  }
  send_debug("%s fields=%s", label, fields->str);
  g_string_free(fields, 1);
}

static void log_http_header_value(const GstStructure *structure, const char *field, const char *label) {
  if (!gst_http_debug_enabled || !structure || !field || !label) return;
  const GValue *value = gst_structure_get_value(structure, field);
  if (!value) return;
  if (G_VALUE_HOLDS_STRING(value)) {
    const char *str = g_value_get_string(value);
    if (str) send_debug("%s=%s", label, str);
    return;
  }
  if (GST_VALUE_HOLDS_STRUCTURE(value)) {
    const GstStructure *nested = gst_value_get_structure(value);
    if (!nested) return;
    gchar *nested_str = gst_structure_to_string(nested);
    if (nested_str) {
      send_debug("%s=%s", label, nested_str);
      g_free(nested_str);
    }
    return;
  }
  const char *type_name = G_VALUE_TYPE_NAME(value);
  send_debug("%s type=%s", label, type_name ? type_name : "unknown");
}

static void log_http_headers_structure(const GstStructure *structure) {
  if (!gst_http_debug_enabled || !structure) return;
  gint status = 0;
  gint64 content_length = -1;
  const char *reason = NULL;
  const char *uri = NULL;
  const char *location = NULL;
  const char *content_type = NULL;
  int has_status = 0;
  int has_length = 0;
  char uri_host[256];
  char location_host[256];
  char status_buf[16];
  char length_buf[32];
  const char *status_str = "-";
  const char *length_str = "-";

  has_status = gst_structure_get_int(structure, "status", &status) ||
    gst_structure_get_int(structure, "status-code", &status) ||
    gst_structure_get_int(structure, "http-status-code", &status) ||
    gst_structure_get_int(structure, "response-code", &status);
  reason = gst_structure_get_string(structure, "reason-phrase");
  uri = gst_structure_get_string(structure, "uri");
  location = gst_structure_get_string(structure, "location");
  content_type = gst_structure_get_string(structure, "content-type");
  has_length = gst_structure_get_int64(structure, "content-length", &content_length);

  format_uri_host(uri, uri_host, sizeof(uri_host));
  format_uri_host(location, location_host, sizeof(location_host));

  if (has_status) {
    snprintf(status_buf, sizeof(status_buf), "%d", status);
    status_str = status_buf;
  }
  if (has_length) {
    snprintf(length_buf, sizeof(length_buf), "%lld", (long long)content_length);
    length_str = length_buf;
  }

  send_debug("http-headers status=%s reason=%s uri_host=%s location_host=%s content-type=%s content-length=%s",
    status_str,
    reason ? reason : "-",
    uri_host[0] ? uri_host : "-",
    location_host[0] ? location_host : "-",
    content_type ? content_type : "-",
    length_str);

  log_http_header_value(structure, "request-headers", "http-request-headers");
  log_http_header_value(structure, "response-headers", "http-response-headers");
  log_structure_fields(structure, "http-headers");
}

static void send_result(gint request_id, gboolean ok, const char *message) {
  if (request_id < 0) return;
  if (ok) {
    fprintf(stdout, "result %d ok\n", request_id);
  } else if (message) {
    fprintf(stdout, "result %d error %s\n", request_id, message);
  } else {
    fprintf(stdout, "result %d error unknown\n", request_id);
  }
  fflush(stdout);
}

// Overlay is unused in appsink mode; keep stub for protocol compatibility.
static void apply_video_overlay(void) {
  return;
}

static int connect_frame_socket(void) {
  // Socket path is provided by Electron main via env.
  const char *path = g_getenv("SBTLTV_GST_FRAME_SOCKET");
  if (!path || path[0] == '\0') {
    send_line("error", "SBTLTV_GST_FRAME_SOCKET not set");
    return -1;
  }

  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    send_line("error", "Failed to create frame socket");
    return -1;
  }

  struct sockaddr_un addr;
  memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  strncpy(addr.sun_path, path, sizeof(addr.sun_path) - 1);

  if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    close(fd);
    send_line("error", "Failed to connect to frame socket");
    return -1;
  }

  frame_socket_fd = fd;
  return 0;
}

static gboolean send_frame_payload(const guint8 *data, gsize size) {
  // Blocking writes keep frame boundaries intact; dropping mid-frame corrupts the stream.
  if (frame_socket_fd < 0) return FALSE;
  gsize sent = 0;
  while (sent < size) {
    ssize_t written = send(frame_socket_fd, data + sent, size - sent, MSG_NOSIGNAL);
    if (written < 0) {
      if (errno == EINTR) continue;
      return FALSE;
    }
    if (written == 0) return FALSE;
    sent += (gsize)written;
  }
  return TRUE;
}

static gboolean send_frame_packet(const FramePacket *packet) {
  if (!packet) return FALSE;
  if (frame_socket_fd < 0) return FALSE;

  // Header is fixed-size and packed so the reader can parse without negotiation.
  FrameHeader header;
  header.magic = SBTLTV_FRAME_MAGIC;
  header.version = SBTLTV_FRAME_VERSION;
  header.header_size = (guint16)sizeof(FrameHeader);
  header.width = (guint32)GST_VIDEO_INFO_WIDTH(&packet->info);
  header.height = (guint32)GST_VIDEO_INFO_HEIGHT(&packet->info);
  header.stride = (guint32)GST_VIDEO_INFO_PLANE_STRIDE(&packet->info, 0);
  header.format = SBTLTV_FRAME_FORMAT_RGBA;
  header.pts = (guint64)packet->pts;
  header.payload_size = (guint32)packet->size;
  header.frame_id = packet->frame_id;

  if (!send_frame_payload((const guint8 *)&header, sizeof(header))) return FALSE;
  if (!send_frame_payload(packet->data, packet->size)) return FALSE;
  return TRUE;
}

static void frame_packet_free(FramePacket *packet) {
  if (!packet) return;
  g_free(packet->data);
  g_free(packet);
}

static gpointer frame_writer_thread_fn(gpointer data) {
  (void)data;
  // Dedicated writer thread decouples appsink callbacks from socket backpressure.
  while (frame_writer_running) {
    FramePacket *packet = g_async_queue_pop(frame_queue);
    if (!packet) {
      if (!frame_writer_running) break;
      continue;
    }
    if (!frame_writer_running) {
      frame_packet_free(packet);
      break;
    }
    if (!send_frame_packet(packet)) {
      send_debug("frame write failed; stopping writer");
      frame_packet_free(packet);
      close(frame_socket_fd);
      frame_socket_fd = -1;
      break;
    }
    frame_packet_free(packet);
    g_atomic_int_add(&frame_queue_size, -1);
  }
  return NULL;
}

static GstFlowReturn on_new_sample(GstAppSink *appsink, gpointer user_data) {
  (void)user_data;
  // Pulling the sample here keeps GStreamer in push mode; we copy into a queue.
  GstSample *sample = gst_app_sink_pull_sample(appsink);
  if (!sample) return GST_FLOW_ERROR;

  GstCaps *caps = gst_sample_get_caps(sample);
  GstBuffer *buffer = gst_sample_get_buffer(sample);
  if (!caps || !buffer) {
    gst_sample_unref(sample);
    return GST_FLOW_ERROR;
  }

  GstVideoInfo info;
  if (!gst_video_info_from_caps(&info, caps)) {
    gst_sample_unref(sample);
    return GST_FLOW_ERROR;
  }

  if (GST_VIDEO_INFO_FORMAT(&info) != GST_VIDEO_FORMAT_RGBA) {
    gst_sample_unref(sample);
    return GST_FLOW_ERROR;
  }

  GstMapInfo map;
  if (!gst_buffer_map(buffer, &map, GST_MAP_READ)) {
    gst_sample_unref(sample);
    return GST_FLOW_ERROR;
  }

  // Drop oldest frames when the queue is full to keep latency bounded.
  while (g_atomic_int_get(&frame_queue_size) >= FRAME_QUEUE_MAX) {
    FramePacket *old = g_async_queue_try_pop(frame_queue);
    if (!old) break;
    frame_packet_free(old);
    g_atomic_int_add(&frame_queue_size, -1);
  }

  // Copy buffer contents because the sample is released after this callback.
  FramePacket *packet = g_new0(FramePacket, 1);
  packet->info = info;
  packet->size = map.size;
  packet->data = g_malloc(packet->size);
  memcpy(packet->data, map.data, packet->size);
  packet->pts = GST_BUFFER_PTS(buffer);
  packet->frame_id = ++frame_id_counter;

  g_async_queue_push(frame_queue, packet);
  g_atomic_int_add(&frame_queue_size, 1);

  gst_buffer_unmap(buffer, &map);
  gst_sample_unref(sample);
  return GST_FLOW_OK;
}

static void apply_http_settings(GstElement *source) {
  const char *user_agent = g_getenv("SBTLTV_HTTP_USER_AGENT");
  if (user_agent && user_agent[0] != '\0') {
    set_string_property(source, "user-agent", user_agent);
  }

  const char *timeout_env = g_getenv("SBTLTV_HTTP_TIMEOUT");
  if (timeout_env && timeout_env[0] != '\0') {
    gint timeout = (gint)g_ascii_strtoll(timeout_env, NULL, 10);
    if (timeout > 0) {
      set_int_property(source, "timeout", timeout);
    }
  }

  const char *referer = g_getenv("SBTLTV_HTTP_REFERER");
  if (referer && referer[0] != '\0') {
    GObjectClass *klass = G_OBJECT_GET_CLASS(source);
    if (klass && g_object_class_find_property(klass, "extra-headers")) {
      GstStructure *headers = gst_structure_new("headers", "Referer", G_TYPE_STRING, referer, NULL);
      g_object_set(source, "extra-headers", headers, NULL);
      gst_structure_free(headers);
    }
  }

  if (gst_http_debug_enabled) {
    gchar *current_ua = NULL;
    if (G_OBJECT_GET_CLASS(source) && g_object_class_find_property(G_OBJECT_GET_CLASS(source), "user-agent")) {
      g_object_get(source, "user-agent", &current_ua, NULL);
    }
    if (current_ua) {
      send_debug("http user-agent=%s", current_ua);
      g_free(current_ua);
    } else {
      send_debug("http user-agent=unset");
    }
    send_debug("http referer=%s", (referer && referer[0] != '\0') ? "set" : "unset");
  }
}

static void on_status_code_notify(GObject *object, GParamSpec *pspec, gpointer user_data) {
  (void)pspec;
  (void)user_data;
  if (!gst_http_debug_enabled) return;
  if (!G_IS_OBJECT(object)) return;
  guint status = 0;
  gchar *reason = NULL;
  GObjectClass *klass = G_OBJECT_GET_CLASS(object);
  if (!klass) return;
  if (g_object_class_find_property(klass, "status-code")) {
    g_object_get(object, "status-code", &status, NULL);
  }
  if (g_object_class_find_property(klass, "reason-phrase")) {
    g_object_get(object, "reason-phrase", &reason, NULL);
  }
  if (reason) {
    send_debug("http status=%u reason=%s", status, reason);
    g_free(reason);
  } else {
    send_debug("http status=%u", status);
  }
}

static void on_response_headers_notify(GObject *object, GParamSpec *pspec, gpointer user_data) {
  (void)pspec;
  (void)user_data;
  if (!gst_http_debug_enabled) return;
  if (!G_IS_OBJECT(object)) return;
  GstStructure *headers = NULL;
  GObjectClass *klass = G_OBJECT_GET_CLASS(object);
  if (!klass) return;
  if (!g_object_class_find_property(klass, "response-headers")) return;
  g_object_get(object, "response-headers", &headers, NULL);
  if (!headers) return;
  gchar *headers_str = gst_structure_to_string(headers);
  if (headers_str) {
    send_debug("http response-headers=%s", headers_str);
    g_free(headers_str);
  }
  gst_structure_free(headers);
}

static void on_source_setup(GstElement *playbin_element, GstElement *source, gpointer user_data) {
  (void)playbin_element;
  (void)user_data;
  if (!source) return;
  apply_http_settings(source);
  if (gst_debug_enabled) {
    const char *type_name = G_OBJECT_TYPE_NAME(source);
    const char *element_name = GST_OBJECT_NAME(source);
    GObjectClass *klass = G_OBJECT_GET_CLASS(source);
    int has_user_agent = klass && g_object_class_find_property(klass, "user-agent");
    int has_timeout = klass && g_object_class_find_property(klass, "timeout");
    int has_extra_headers = klass && g_object_class_find_property(klass, "extra-headers");
    send_debug("source-setup type=%s name=%s ua=%d timeout=%d headers=%d",
      type_name ? type_name : "unknown",
      element_name ? element_name : "unknown",
      has_user_agent,
      has_timeout,
      has_extra_headers);
  }
  if (gst_http_debug_enabled) {
    GObjectClass *klass = G_OBJECT_GET_CLASS(source);
    if (klass && g_object_class_find_property(klass, "status-code")) {
      g_signal_connect(source, "notify::status-code", G_CALLBACK(on_status_code_notify), NULL);
    }
    if (klass && g_object_class_find_property(klass, "response-headers")) {
      g_signal_connect(source, "notify::response-headers", G_CALLBACK(on_response_headers_notify), NULL);
    }
  }
}

static gboolean query_position_duration(gdouble *position, gdouble *duration) {
  gint64 pos = 0;
  gint64 dur = 0;
  gboolean ok_pos = gst_element_query_position(playbin, GST_FORMAT_TIME, &pos);
  gboolean ok_dur = gst_element_query_duration(playbin, GST_FORMAT_TIME, &dur);
  if (position) *position = ok_pos ? ((gdouble)pos / GST_SECOND) : 0.0;
  if (duration) *duration = ok_dur ? ((gdouble)dur / GST_SECOND) : 0.0;
  return ok_pos || ok_dur;
}

static void emit_status(void) {
  gdouble position = 0.0;
  gdouble duration = 0.0;
  query_position_duration(&position, &duration);

  gdouble volume = 1.0;
  gboolean muted = 0;
  if (GST_IS_STREAM_VOLUME(playbin)) {
    volume = gst_stream_volume_get_volume(GST_STREAM_VOLUME(playbin), GST_STREAM_VOLUME_FORMAT_LINEAR);
    muted = gst_stream_volume_get_mute(GST_STREAM_VOLUME(playbin));
  } else {
    g_object_get(playbin, "volume", &volume, "mute", &muted, NULL);
  }

  fprintf(stdout,
          "status playing=%d volume=%d muted=%d position=%.3f duration=%.3f buffering=%d\n",
          is_playing ? 1 : 0,
          (int)(volume * 100.0 + 0.5),
          muted ? 1 : 0,
          position,
          duration,
          buffering ? 1 : 0);
  fflush(stdout);
}

static gboolean status_timer_cb(gpointer data) {
  (void)data;
  emit_status();
  return G_SOURCE_CONTINUE;
}

static GstBusSyncReply bus_sync_handler(GstBus *bus, GstMessage *message, gpointer user_data) {
  (void)bus;
  (void)user_data;
  if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ELEMENT) {
    const GstStructure *structure = gst_message_get_structure(message);
    if (structure && gst_structure_has_name(structure, "prepare-window-handle")) {
      return GST_BUS_PASS;
    }
  }
  return GST_BUS_PASS;
}

static void bus_message_handler(GstBus *bus, GstMessage *message, gpointer user_data) {
  (void)bus;
  (void)user_data;
  switch (GST_MESSAGE_TYPE(message)) {
    case GST_MESSAGE_ERROR: {
      GError *err = NULL;
      gchar *debug = NULL;
      gst_message_parse_error(message, &err, &debug);
      if (gst_debug_enabled) {
        const char *domain = err ? g_quark_to_string(err->domain) : "unknown";
        int code = err ? err->code : -1;
        const char *element = message->src ? GST_OBJECT_NAME(message->src) : "unknown";
        const char *dbg = debug ? debug : "";
        const char *msg = err ? err->message : "unknown";
        send_debug("error domain=%s code=%d element=%s msg=%s debug=%s",
          domain ? domain : "unknown",
          code,
          element ? element : "unknown",
          msg,
          dbg);
      }
      if (gst_dump_enabled) {
        gst_debug_bin_to_dot_file(GST_BIN(playbin), GST_DEBUG_GRAPH_SHOW_ALL, "gst-error");
      }
      if (err) {
        send_line("error", err->message);
        g_error_free(err);
      } else {
        send_line("error", "Unknown GStreamer error");
      }
      if (debug) g_free(debug);
      is_playing = 0;
      want_playing = 0;
      buffering = 0;
      gst_element_set_state(playbin, GST_STATE_READY);
      emit_status();
      break;
    }
    case GST_MESSAGE_WARNING: {
      GError *err = NULL;
      gchar *debug = NULL;
      gst_message_parse_warning(message, &err, &debug);
      if (gst_debug_enabled) {
        const char *domain = err ? g_quark_to_string(err->domain) : "unknown";
        int code = err ? err->code : -1;
        const char *element = message->src ? GST_OBJECT_NAME(message->src) : "unknown";
        const char *dbg = debug ? debug : "";
        const char *msg = err ? err->message : "unknown";
        send_debug("warning domain=%s code=%d element=%s msg=%s debug=%s",
          domain ? domain : "unknown",
          code,
          element ? element : "unknown",
          msg,
          dbg);
      }
      if (gst_dump_enabled) {
        gst_debug_bin_to_dot_file(GST_BIN(playbin), GST_DEBUG_GRAPH_SHOW_ALL, "gst-warning");
      }
      if (err) g_error_free(err);
      if (debug) g_free(debug);
      break;
    }
    case GST_MESSAGE_EOS:
      send_line("warning", "Playback ended");
      is_playing = 0;
      want_playing = 0;
      buffering = 0;
      emit_status();
      break;
    case GST_MESSAGE_STATE_CHANGED: {
      if (GST_MESSAGE_SRC(message) == GST_OBJECT(playbin)) {
        GstState old_state;
        GstState new_state;
        GstState pending;
        gst_message_parse_state_changed(message, &old_state, &new_state, &pending);
        is_playing = (new_state == GST_STATE_PLAYING);
        if (gst_debug_enabled) {
          const char *old_name = gst_element_state_get_name(old_state);
          const char *new_name = gst_element_state_get_name(new_state);
          const char *pending_name = gst_element_state_get_name(pending);
          send_debug("state old=%s new=%s pending=%s",
            old_name ? old_name : "unknown",
            new_name ? new_name : "unknown",
            pending_name ? pending_name : "unknown");
        }
        emit_status();
      }
      break;
    }
    case GST_MESSAGE_BUFFERING: {
      gint percent = 0;
      gst_message_parse_buffering(message, &percent);
      if (gst_debug_enabled) {
        send_debug("buffering percent=%d", percent);
      }
      if (percent < 100) {
        buffering = 1;
        gst_element_set_state(playbin, GST_STATE_PAUSED);
      } else {
        buffering = 0;
        if (want_playing) {
          gst_element_set_state(playbin, GST_STATE_PLAYING);
        }
      }
      emit_status();
      break;
    }
    case GST_MESSAGE_ELEMENT: {
      const GstStructure *structure = gst_message_get_structure(message);
      const char *name = structure ? gst_structure_get_name(structure) : "unknown";
      if (gst_http_debug_enabled && structure && name && g_strcmp0(name, "http-headers") == 0) {
        log_http_headers_structure(structure);
      } else if (gst_debug_enabled) {
        send_debug("element-message name=%s", name ? name : "unknown");
      }
      break;
    }
    default:
      break;
  }
}

static gboolean handle_command_line(GIOChannel *source, GIOCondition cond, gpointer data) {
  (void)data;
  if (cond & (G_IO_HUP | G_IO_ERR)) {
    g_main_loop_quit(main_loop);
    return 0;
  }

  gchar *line = NULL;
  gsize len = 0;
  GError *error = NULL;
  GIOStatus status = g_io_channel_read_line(source, &line, &len, NULL, &error);
  if (status == G_IO_STATUS_EOF) {
    g_free(line);
    g_main_loop_quit(main_loop);
    return 0;
  }
  if (status == G_IO_STATUS_ERROR) {
    if (error) {
      send_line("error", error->message);
      g_error_free(error);
    }
    g_free(line);
    return 1;
  }
  if (!line) return 1;
  g_strchomp(line);
  if (line[0] == '\0') {
    g_free(line);
    return 1;
  }

  gchar **parts = g_strsplit(line, " ", 0);
  gint count = g_strv_length(parts);
  if (count == 0) {
    g_strfreev(parts);
    g_free(line);
    return 1;
  }

  const gchar *cmd = parts[0];
  gint idx = 1;
  gint request_id = -1;
  if (count > 1 && g_ascii_isdigit(parts[1][0])) {
    request_id = (gint)g_ascii_strtoll(parts[1], NULL, 10);
    idx = 2;
  }

  if (g_strcmp0(cmd, "window") == 0) {
    if (count > idx) {
      window_handle = (guintptr)g_ascii_strtoull(parts[idx], NULL, 10);
      send_result(request_id, 1, NULL);
    } else {
      send_result(request_id, 0, "missing window handle");
    }
  } else if (g_strcmp0(cmd, "rect") == 0) {
    if (count > idx + 3) {
      rect_x = (gint)g_ascii_strtoll(parts[idx], NULL, 10);
      rect_y = (gint)g_ascii_strtoll(parts[idx + 1], NULL, 10);
      rect_w = (gint)g_ascii_strtoll(parts[idx + 2], NULL, 10);
      rect_h = (gint)g_ascii_strtoll(parts[idx + 3], NULL, 10);
      have_rect = 1;
      send_result(request_id, 1, NULL);
    } else {
      send_result(request_id, 0, "missing rect args");
    }
  } else if (g_strcmp0(cmd, "load") == 0) {
    if (count > idx) {
      gchar *url = g_strjoinv(" ", parts + idx);
      gst_element_set_state(playbin, GST_STATE_READY);
      g_object_set(playbin, "uri", url, NULL);
      gst_element_set_state(playbin, GST_STATE_PLAYING);
      want_playing = 1;
      is_playing = 1;
      buffering = 0;
      send_result(request_id, 1, NULL);
      emit_status();
      g_free(url);
    } else {
      send_result(request_id, 0, "missing url");
    }
  } else if (g_strcmp0(cmd, "play") == 0) {
    gst_element_set_state(playbin, GST_STATE_PLAYING);
    want_playing = 1;
    is_playing = 1;
    buffering = 0;
    send_result(request_id, 1, NULL);
    emit_status();
  } else if (g_strcmp0(cmd, "pause") == 0) {
    gst_element_set_state(playbin, GST_STATE_PAUSED);
    is_playing = 0;
    want_playing = 0;
    send_result(request_id, 1, NULL);
    emit_status();
  } else if (g_strcmp0(cmd, "toggle") == 0) {
    if (want_playing) {
      gst_element_set_state(playbin, GST_STATE_PAUSED);
      is_playing = 0;
      want_playing = 0;
    } else {
      gst_element_set_state(playbin, GST_STATE_PLAYING);
      want_playing = 1;
      is_playing = 1;
      buffering = 0;
    }
    send_result(request_id, 1, NULL);
    emit_status();
  } else if (g_strcmp0(cmd, "stop") == 0) {
    gst_element_set_state(playbin, GST_STATE_READY);
    is_playing = 0;
    want_playing = 0;
    buffering = 0;
    send_result(request_id, 1, NULL);
    emit_status();
  } else if (g_strcmp0(cmd, "seek") == 0) {
    if (count > idx) {
      gdouble seconds = g_ascii_strtod(parts[idx], NULL);
      gboolean ok = gst_element_seek_simple(playbin, GST_FORMAT_TIME,
        GST_SEEK_FLAG_FLUSH | GST_SEEK_FLAG_KEY_UNIT,
        (gint64)(seconds * GST_SECOND));
      send_result(request_id, ok, ok ? NULL : "seek failed");
      emit_status();
    } else {
      send_result(request_id, 0, "missing seek time");
    }
  } else if (g_strcmp0(cmd, "volume") == 0) {
    if (count > idx) {
      gdouble volume = g_ascii_strtod(parts[idx], NULL) / 100.0;
      if (volume < 0.0) volume = 0.0;
      if (volume > 10.0) volume = 10.0;
      if (GST_IS_STREAM_VOLUME(playbin)) {
        gst_stream_volume_set_volume(GST_STREAM_VOLUME(playbin), GST_STREAM_VOLUME_FORMAT_LINEAR, volume);
      } else {
        g_object_set(playbin, "volume", volume, NULL);
      }
      send_result(request_id, 1, NULL);
      emit_status();
    } else {
      send_result(request_id, 0, "missing volume value");
    }
  } else if (g_strcmp0(cmd, "mute") == 0) {
    if (count > idx) {
      int mute = g_ascii_strtoll(parts[idx], NULL, 10) ? 1 : 0;
      if (GST_IS_STREAM_VOLUME(playbin)) {
        gst_stream_volume_set_mute(GST_STREAM_VOLUME(playbin), mute);
      } else {
        g_object_set(playbin, "mute", mute, NULL);
      }
      send_result(request_id, 1, NULL);
      emit_status();
    } else {
      send_result(request_id, 0, "missing mute value");
    }
  } else if (g_strcmp0(cmd, "status") == 0) {
    emit_status();
    send_result(request_id, 1, NULL);
  } else if (g_strcmp0(cmd, "quit") == 0) {
    send_result(request_id, 1, NULL);
    g_main_loop_quit(main_loop);
  } else {
    send_result(request_id, 0, "unknown command");
  }

  g_strfreev(parts);
  g_free(line);
  return 1;
}

static GstElement *create_video_sink(void) {
  GstElement *sink = gst_element_factory_make("appsink", "video_sink");
  if (!sink) return NULL;

  // RGBA keeps the renderer path simple for the first appsink pass.
  GstCaps *caps = gst_caps_new_simple(
    "video/x-raw",
    "format", G_TYPE_STRING, "RGBA",
    NULL
  );
  gst_app_sink_set_caps(GST_APP_SINK(sink), caps);
  gst_caps_unref(caps);

  // sync=true keeps video timing tied to the pipeline clock.
  g_object_set(sink,
    "emit-signals", TRUE,
    "sync", TRUE,
    "max-buffers", FRAME_QUEUE_MAX,
    "drop", TRUE,
    NULL);

  return sink;
}

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;
  setvbuf(stdout, NULL, _IOLBF, 0);

  gst_debug_enabled = env_flag("SBTLTV_GST_DEBUG");
  gst_http_debug_enabled = env_flag("SBTLTV_GST_HTTP_DEBUG");
  gst_dump_enabled = env_flag("SBTLTV_GST_DUMP");
  if (gst_dump_enabled) {
    const char *dump_dir = g_getenv("SBTLTV_GST_DUMP_DIR");
    if (dump_dir && dump_dir[0] != '\0') {
      g_setenv("GST_DEBUG_DUMP_DOT_DIR", dump_dir, 1);
    }
  }

  gst_init(NULL, NULL);

  if (connect_frame_socket() != 0) {
    return 1;
  }

  frame_queue = g_async_queue_new();
  frame_writer_running = 1;
  frame_writer_thread = g_thread_new("frame-writer", frame_writer_thread_fn, NULL);

  playbin = gst_element_factory_make("playbin", "playbin");
  if (!playbin) {
    send_line("error", "Failed to create playbin");
    return 1;
  }

  video_sink = create_video_sink();
  if (!video_sink) {
    send_line("error", "Failed to create video sink");
    return 1;
  }

  audio_sink = gst_element_factory_make("autoaudiosink", "audio_sink");
  if (!audio_sink) {
    send_line("error", "Failed to create audio sink");
    return 1;
  }

  g_object_set(playbin, "video-sink", video_sink, "audio-sink", audio_sink, NULL);

  GstAppSinkCallbacks callbacks = { 0 };
  callbacks.new_sample = on_new_sample;
  gst_app_sink_set_callbacks(GST_APP_SINK(video_sink), &callbacks, NULL, NULL);

  g_signal_connect(playbin, "source-setup", G_CALLBACK(on_source_setup), NULL);

  GstBus *bus = gst_element_get_bus(playbin);
  gst_bus_add_signal_watch(bus);
  g_signal_connect(bus, "message", G_CALLBACK(bus_message_handler), NULL);
  gst_bus_set_sync_handler(bus, bus_sync_handler, NULL, NULL);
  gst_object_unref(bus);

  main_loop = g_main_loop_new(NULL, 0);

  GIOChannel *stdin_channel = g_io_channel_unix_new(fileno(stdin));
  g_io_channel_set_flags(stdin_channel, G_IO_FLAG_NONBLOCK, NULL);
  g_io_channel_set_encoding(stdin_channel, NULL, NULL);
  g_io_add_watch(stdin_channel, G_IO_IN | G_IO_HUP | G_IO_ERR, handle_command_line, NULL);

  status_timer_id = g_timeout_add(250, status_timer_cb, NULL);

  send_line("ready", "1");
  g_main_loop_run(main_loop);

  if (status_timer_id) g_source_remove(status_timer_id);
  g_io_channel_unref(stdin_channel);
  gst_element_set_state(playbin, GST_STATE_NULL);
  gst_object_unref(playbin);
  frame_writer_running = 0;
  if (frame_queue) {
    g_async_queue_push(frame_queue, NULL);
  }
  if (frame_writer_thread) {
    g_thread_join(frame_writer_thread);
    frame_writer_thread = NULL;
  }
  if (frame_queue) {
    g_async_queue_unref(frame_queue);
    frame_queue = NULL;
  }
  if (frame_socket_fd >= 0) {
    close(frame_socket_fd);
    frame_socket_fd = -1;
  }
  g_main_loop_unref(main_loop);
  return 0;
}

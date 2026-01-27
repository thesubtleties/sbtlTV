{
  "targets": [
    {
      "target_name": "mpv",
      "sources": ["mpv.c"],
      "cflags": ["<!@(pkg-config --cflags mpv egl x11 wayland-client)", "-std=c17"],
      "libraries": ["<!@(pkg-config --libs mpv egl gl x11 wayland-client)"]
    }
  ]
}

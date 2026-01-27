{
  "targets": [
    {
      "target_name": "mpv",
      "sources": ["mpv.c"],
      "cflags": ["<!@(pkg-config --cflags mpv)", "-std=c11"],
      "libraries": ["<!@(pkg-config --libs mpv)"]
    }
  ]
}

{
  "targets": [
    {
      "target_name": "mpv",
      "sources": ["mpv.c"],
      "cflags": ["<!@(pkg-config --cflags mpv egl x11 wayland-client)", "-std=c17"],
      "libraries": ["<!@(pkg-config --libs mpv egl gl x11 wayland-client)"],
      "conditions": [
        ["OS==\"linux\"", {
          "libraries": ["-ldl"],
          "ldflags": ["-Wl,-rpath,'$$ORIGIN/lib'"]
        }],
        ["OS==\"mac\"", {
          "ldflags": ["-Wl,-rpath,@loader_path/lib"]
        }]
      ]
    }
  ]
}

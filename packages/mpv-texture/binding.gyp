{
  "targets": [
    {
      "target_name": "mpv_texture",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],

      "conditions": [
        # ── macOS: build the real native addon (IOSurface GPU texture sharing) ──
        ["OS=='mac'", {
          "sources": [
            "src/native/addon.cpp",
            "src/native/mpv_context.cpp",
            "src/native/macos/iosurface_texture.mm"
          ],
          "include_dirs": [
            "deps/mpv/include"
          ],
          "libraries": [
            "-L<(module_root_dir)/deps/mpv/macos",
            "-lmpv",
            "-framework OpenGL",
            "-framework IOSurface",
            "-framework CoreFoundation"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_LDFLAGS": [
              "-Wl,-rpath,@loader_path"
            ]
          },
          "copies": [
            {
              "destination": "<(module_root_dir)/build/Release",
              "files": ["<(module_root_dir)/deps/mpv/macos/libmpv.dylib"]
            }
          ]
        }],

        # Linux: libmpv Render API -> EGL/GBM DMA-BUF -> Electron NativePixmap.
        # Use system headers and libraries so the libmpv ABI matches the host.
        ["OS=='linux'", {
          "sources": [
            "src/native/addon.cpp",
            "src/native/mpv_context.cpp",
            "src/native/linux/egl_context.cpp",
            "src/native/linux/dmabuf_texture.cpp"
          ],
          "cflags": [
            "<!@(pkg-config --cflags mpv egl gbm libdrm gl)"
          ],
          "cflags_cc": [
            "-std=c++17"
          ],
          "libraries": [
            "<!@(pkg-config --libs mpv egl gbm libdrm gl)",
            "-ldl"
          ]
        }],

        # Windows continues to use external mpv via --wid.
        ["OS=='win'", {
          "sources": [
            "src/native/stub.cpp"
          ]
        }]
      ]
    }
  ]
}

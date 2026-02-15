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

        # ── Non-macOS: build a no-op stub (see src/native/stub.cpp for details) ──
        # Windows uses external mpv via --wid flag, Linux uses separate window.
        # The stub lets node-gyp and @electron/rebuild succeed without requiring
        # mpv dev libraries on platforms that don't use the native addon.
        ["OS!='mac'", {
          "sources": [
            "src/native/stub.cpp"
          ]
        }]
      ]
    }
  ]
}

{
  "targets": [
    {
      "target_name": "mpv_texture",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "sources": [
        "src/native/addon.cpp",
        "src/native/mpv_context.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "deps/mpv/include"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='win'", {
          "sources": [
            "src/native/win32/dxgi_texture.cpp"
          ],
          "libraries": [
            "-l<(module_root_dir)/deps/mpv/win64/mpv.lib",
            "-ld3d11",
            "-ldxgi",
            "-lopengl32"
          ],
          "copies": [
            {
              "destination": "<(module_root_dir)/build/Release",
              "files": ["<(module_root_dir)/deps/mpv/win64/libmpv-2.dll"]
            }
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++20"]
            }
          }
        }],
        ["OS=='mac'", {
          "sources": [
            "src/native/macos/iosurface_texture.mm"
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
        }]
      ]
    }
  ]
}

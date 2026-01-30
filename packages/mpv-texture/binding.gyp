{
  "targets": [
    {
      "target_name": "mpv_texture",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "sources": [
        "src/addon.cc",
        "src/mpv_controller.cc",
        "src/shared_texture_manager.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
          "sources": [
            "src/platform/macos/gl_context_macos.mm",
            "src/platform/macos/iosurface_texture.mm"
          ],
          "libraries": [
            "-framework OpenGL",
            "-framework IOSurface",
            "-framework CoreFoundation",
            "-framework CoreGraphics",
            "-framework CoreVideo"
          ],
          "include_dirs": [
            "/opt/homebrew/include",
            "/usr/local/include",
            "<!@(node -p \"process.env.MPV_INCLUDE_DIR || '/opt/homebrew/include'\")"
          ],
          "link_settings": {
            "libraries": [
              "-lmpv",
              "-L/opt/homebrew/lib",
              "-L/usr/local/lib",
              "<!@(node -p \"'-L' + (process.env.MPV_LIB_DIR || '/opt/homebrew/lib')\")"
            ]
          },
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++17"],
            "OTHER_LDFLAGS": [
              "-Wl,-rpath,@loader_path/../../../mpv-bundle",
              "-Wl,-rpath,@executable_path/../Resources/mpv"
            ]
          }
        }],
        ["OS=='win'", {
          "sources": [
            "src/platform/windows/gl_context_windows.cc",
            "src/platform/windows/d3d11_texture.cc"
          ],
          "libraries": [
            "d3d11.lib",
            "dxgi.lib",
            "opengl32.lib",
            "mpv.lib"
          ],
          "include_dirs": [
            "<!@(node -p \"process.env.MPV_INCLUDE_DIR || ''\")"
          ],
          "library_dirs": [
            "<!@(node -p \"process.env.MPV_LIB_DIR || ''\")"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++17"]
            }
          },
          "copies": [
            {
              "destination": "<(module_root_dir)/build/Release",
              "files": [
                "<!@(node -p \"process.env.MPV_DLL_PATH || ''\")"
              ]
            }
          ]
        }],
        ["OS=='linux'", {
          "sources": [
            "src/platform/linux/gl_context_linux.cc",
            "src/platform/linux/dmabuf_texture.cc"
          ],
          "libraries": [
            "<!@(pkg-config --libs mpv)",
            "<!@(pkg-config --libs egl)",
            "<!@(pkg-config --libs gl)",
            "-lgbm"
          ],
          "include_dirs": [
            "<!@(pkg-config --cflags-only-I mpv | sed 's/-I//g')"
          ],
          "cflags_cc": ["-std=c++17", "-fPIC"]
        }]
      ]
    }
  ]
}

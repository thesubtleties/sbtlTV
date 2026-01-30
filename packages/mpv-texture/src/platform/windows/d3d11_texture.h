#pragma once

#ifdef _WIN32

#include "../../shared_texture_manager.h"
#include "gl_context_windows.h"
#include <d3d11.h>
#include <d3d11_1.h>
#include <wrl/client.h>

using Microsoft::WRL::ComPtr;

// WGL_NV_DX_interop function types
typedef BOOL(WINAPI* PFNWGLDXSETRESOURCESHAREHANDLENVPROC)(void*, HANDLE);
typedef HANDLE(WINAPI* PFNWGLDXOPENDEVICENVPROC)(void*);
typedef BOOL(WINAPI* PFNWGLDXCLOSEDEVICENVPROC)(HANDLE);
typedef HANDLE(WINAPI* PFNWGLDXREGISTEROBJECTNVPROC)(HANDLE, void*, GLuint, GLenum, GLenum);
typedef BOOL(WINAPI* PFNWGLDXUNREGISTEROBJECTNVPROC)(HANDLE, HANDLE);
typedef BOOL(WINAPI* PFNWGLDXOBJECTACCESSNVPROC)(HANDLE, GLenum);
typedef BOOL(WINAPI* PFNWGLDXLOCKOBJECTSNVPROC)(HANDLE, GLint, HANDLE*);
typedef BOOL(WINAPI* PFNWGLDXUNLOCKOBJECTSNVPROC)(HANDLE, GLint, HANDLE*);

// OpenGL types if not defined
#ifndef GL_TEXTURE_2D
#define GL_TEXTURE_2D 0x0DE1
#endif
#ifndef GL_RGBA8
#define GL_RGBA8 0x8058
#endif

class D3D11Texture : public SharedTextureManager {
public:
  explicit D3D11Texture(WindowsGLContext* gl_context);
  ~D3D11Texture() override;

  bool Create(uint32_t width, uint32_t height) override;
  bool Resize(uint32_t width, uint32_t height) override;
  TextureHandle GetHandle() const override;
  uint32_t GetGLTexture() const override { return gl_texture_; }
  uint32_t GetFBO() const override { return fbo_; }

private:
  void Cleanup();
  bool CreateD3D11Texture(uint32_t width, uint32_t height);
  bool InitInterop();
  bool RegisterTexture();
  bool CreateFBO();

  WindowsGLContext* gl_context_;

  // D3D11 resources
  ComPtr<ID3D11Texture2D> d3d_texture_;
  HANDLE shared_handle_ = nullptr;

  // WGL_NV_DX_interop resources
  HANDLE interop_device_ = nullptr;
  HANDLE interop_object_ = nullptr;

  // OpenGL resources
  uint32_t gl_texture_ = 0;
  uint32_t fbo_ = 0;

  uint32_t width_ = 0;
  uint32_t height_ = 0;

  // Interop function pointers
  PFNWGLDXOPENDEVICENVPROC wglDXOpenDeviceNV = nullptr;
  PFNWGLDXCLOSEDEVICENVPROC wglDXCloseDeviceNV = nullptr;
  PFNWGLDXREGISTEROBJECTNVPROC wglDXRegisterObjectNV = nullptr;
  PFNWGLDXUNREGISTEROBJECTNVPROC wglDXUnregisterObjectNV = nullptr;
  PFNWGLDXLOCKOBJECTSNVPROC wglDXLockObjectsNV = nullptr;
  PFNWGLDXUNLOCKOBJECTSNVPROC wglDXUnlockObjectsNV = nullptr;

  bool interop_available_ = false;
};

#endif // _WIN32

#ifdef _WIN32

#include "d3d11_texture.h"
#include <iostream>

// OpenGL constants
#ifndef GL_FRAMEBUFFER
#define GL_FRAMEBUFFER 0x8D40
#endif
#ifndef GL_COLOR_ATTACHMENT0
#define GL_COLOR_ATTACHMENT0 0x8CE0
#endif
#ifndef GL_FRAMEBUFFER_COMPLETE
#define GL_FRAMEBUFFER_COMPLETE 0x8CD5
#endif
#ifndef GL_LINEAR
#define GL_LINEAR 0x2601
#endif
#ifndef GL_CLAMP_TO_EDGE
#define GL_CLAMP_TO_EDGE 0x812F
#endif
#ifndef GL_TEXTURE_MIN_FILTER
#define GL_TEXTURE_MIN_FILTER 0x2801
#endif
#ifndef GL_TEXTURE_MAG_FILTER
#define GL_TEXTURE_MAG_FILTER 0x2800
#endif
#ifndef GL_TEXTURE_WRAP_S
#define GL_TEXTURE_WRAP_S 0x2802
#endif
#ifndef GL_TEXTURE_WRAP_T
#define GL_TEXTURE_WRAP_T 0x2803
#endif

// WGL_NV_DX_interop constants
#define WGL_ACCESS_READ_ONLY_NV 0x0000
#define WGL_ACCESS_READ_WRITE_NV 0x0001
#define WGL_ACCESS_WRITE_DISCARD_NV 0x0002

// OpenGL function types
typedef void (APIENTRY* PFNGLGENTEXTURESPROC)(GLsizei, GLuint*);
typedef void (APIENTRY* PFNGLDELETETEXTURESPROC)(GLsizei, const GLuint*);
typedef void (APIENTRY* PFNGLBINDTEXTUREPROC)(GLenum, GLuint);
typedef void (APIENTRY* PFNGLTEXPARAMETERIPROC)(GLenum, GLenum, GLint);
typedef void (APIENTRY* PFNGLGENFRAMEBUFFERSPROC)(GLsizei, GLuint*);
typedef void (APIENTRY* PFNGLDELETEFRAMEBUFFERSPROC)(GLsizei, const GLuint*);
typedef void (APIENTRY* PFNGLBINDFRAMEBUFFERPROC)(GLenum, GLuint);
typedef void (APIENTRY* PFNGLFRAMEBUFFERTEXTURE2DPROC)(GLenum, GLenum, GLenum, GLuint, GLint);
typedef GLenum (APIENTRY* PFNGLCHECKFRAMEBUFFERSTATUSPROC)(GLenum);

// GL function pointers
static PFNGLGENTEXTURESPROC glGenTextures_ptr = nullptr;
static PFNGLDELETETEXTURESPROC glDeleteTextures_ptr = nullptr;
static PFNGLBINDTEXTUREPROC glBindTexture_ptr = nullptr;
static PFNGLTEXPARAMETERIPROC glTexParameteri_ptr = nullptr;
static PFNGLGENFRAMEBUFFERSPROC glGenFramebuffers_ptr = nullptr;
static PFNGLDELETEFRAMEBUFFERSPROC glDeleteFramebuffers_ptr = nullptr;
static PFNGLBINDFRAMEBUFFERPROC glBindFramebuffer_ptr = nullptr;
static PFNGLFRAMEBUFFERTEXTURE2DPROC glFramebufferTexture2D_ptr = nullptr;
static PFNGLCHECKFRAMEBUFFERSTATUSPROC glCheckFramebufferStatus_ptr = nullptr;

D3D11Texture::D3D11Texture(WindowsGLContext* gl_context)
    : gl_context_(gl_context) {
  // Load GL function pointers
  if (gl_context_) {
    glGenTextures_ptr = (PFNGLGENTEXTURESPROC)gl_context_->GetProcAddress("glGenTextures");
    glDeleteTextures_ptr = (PFNGLDELETETEXTURESPROC)gl_context_->GetProcAddress("glDeleteTextures");
    glBindTexture_ptr = (PFNGLBINDTEXTUREPROC)gl_context_->GetProcAddress("glBindTexture");
    glTexParameteri_ptr = (PFNGLTEXPARAMETERIPROC)gl_context_->GetProcAddress("glTexParameteri");
    glGenFramebuffers_ptr = (PFNGLGENFRAMEBUFFERSPROC)gl_context_->GetProcAddress("glGenFramebuffers");
    glDeleteFramebuffers_ptr = (PFNGLDELETEFRAMEBUFFERSPROC)gl_context_->GetProcAddress("glDeleteFramebuffers");
    glBindFramebuffer_ptr = (PFNGLBINDFRAMEBUFFERPROC)gl_context_->GetProcAddress("glBindFramebuffer");
    glFramebufferTexture2D_ptr = (PFNGLFRAMEBUFFERTEXTURE2DPROC)gl_context_->GetProcAddress("glFramebufferTexture2D");
    glCheckFramebufferStatus_ptr = (PFNGLCHECKFRAMEBUFFERSTATUSPROC)gl_context_->GetProcAddress("glCheckFramebufferStatus");
  }

  // Try to initialize WGL_NV_DX_interop
  InitInterop();
}

D3D11Texture::~D3D11Texture() {
  Cleanup();
}

bool D3D11Texture::InitInterop() {
  if (!gl_context_) return false;

  // Get WGL_NV_DX_interop function pointers
  wglDXOpenDeviceNV = (PFNWGLDXOPENDEVICENVPROC)gl_context_->GetProcAddress("wglDXOpenDeviceNV");
  wglDXCloseDeviceNV = (PFNWGLDXCLOSEDEVICENVPROC)gl_context_->GetProcAddress("wglDXCloseDeviceNV");
  wglDXRegisterObjectNV = (PFNWGLDXREGISTEROBJECTNVPROC)gl_context_->GetProcAddress("wglDXRegisterObjectNV");
  wglDXUnregisterObjectNV = (PFNWGLDXUNREGISTEROBJECTNVPROC)gl_context_->GetProcAddress("wglDXUnregisterObjectNV");
  wglDXLockObjectsNV = (PFNWGLDXLOCKOBJECTSNVPROC)gl_context_->GetProcAddress("wglDXLockObjectsNV");
  wglDXUnlockObjectsNV = (PFNWGLDXUNLOCKOBJECTSNVPROC)gl_context_->GetProcAddress("wglDXUnlockObjectsNV");

  if (!wglDXOpenDeviceNV || !wglDXCloseDeviceNV || !wglDXRegisterObjectNV ||
      !wglDXUnregisterObjectNV || !wglDXLockObjectsNV || !wglDXUnlockObjectsNV) {
    std::cerr << "[mpv-texture] WGL_NV_DX_interop not available" << std::endl;
    return false;
  }

  // Open interop device
  ID3D11Device* d3d_device = gl_context_->GetD3DDevice();
  if (!d3d_device) {
    std::cerr << "[mpv-texture] No D3D11 device available" << std::endl;
    return false;
  }

  interop_device_ = wglDXOpenDeviceNV(d3d_device);
  if (!interop_device_) {
    std::cerr << "[mpv-texture] wglDXOpenDeviceNV failed" << std::endl;
    return false;
  }

  interop_available_ = true;
  std::cout << "[mpv-texture] WGL_NV_DX_interop initialized" << std::endl;
  return true;
}

void D3D11Texture::Cleanup() {
  // Unregister interop object first
  if (interop_object_ && interop_device_) {
    wglDXUnregisterObjectNV(interop_device_, interop_object_);
    interop_object_ = nullptr;
  }

  // Delete GL resources
  if (fbo_ && glDeleteFramebuffers_ptr) {
    glDeleteFramebuffers_ptr(1, &fbo_);
    fbo_ = 0;
  }

  if (gl_texture_ && glDeleteTextures_ptr) {
    glDeleteTextures_ptr(1, &gl_texture_);
    gl_texture_ = 0;
  }

  // Close D3D11 shared handle
  if (shared_handle_) {
    CloseHandle(shared_handle_);
    shared_handle_ = nullptr;
  }

  // Release D3D11 texture
  d3d_texture_.Reset();

  // Close interop device
  if (interop_device_ && wglDXCloseDeviceNV) {
    wglDXCloseDeviceNV(interop_device_);
    interop_device_ = nullptr;
  }

  width_ = 0;
  height_ = 0;
}

bool D3D11Texture::Create(uint32_t width, uint32_t height) {
  if (width == 0 || height == 0) {
    std::cerr << "[mpv-texture] Invalid dimensions: " << width << "x" << height << std::endl;
    return false;
  }

  Cleanup();

  width_ = width;
  height_ = height;

  if (!CreateD3D11Texture(width, height)) {
    std::cerr << "[mpv-texture] Failed to create D3D11 texture" << std::endl;
    Cleanup();
    return false;
  }

  if (interop_available_) {
    if (!RegisterTexture()) {
      std::cerr << "[mpv-texture] Failed to register texture with interop" << std::endl;
      Cleanup();
      return false;
    }
  }

  if (!CreateFBO()) {
    std::cerr << "[mpv-texture] Failed to create FBO" << std::endl;
    Cleanup();
    return false;
  }

  std::cout << "[mpv-texture] Created D3D11 texture " << width << "x" << height << std::endl;
  return true;
}

bool D3D11Texture::CreateD3D11Texture(uint32_t width, uint32_t height) {
  ID3D11Device1* device = gl_context_->GetD3DDevice1();
  if (!device) {
    std::cerr << "[mpv-texture] No D3D11 device available" << std::endl;
    return false;
  }

  // Create D3D11 texture with shared handle support
  D3D11_TEXTURE2D_DESC desc = {};
  desc.Width = width;
  desc.Height = height;
  desc.MipLevels = 1;
  desc.ArraySize = 1;
  desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  desc.SampleDesc.Count = 1;
  desc.SampleDesc.Quality = 0;
  desc.Usage = D3D11_USAGE_DEFAULT;
  desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
  desc.CPUAccessFlags = 0;
  desc.MiscFlags = D3D11_RESOURCE_MISC_SHARED_NTHANDLE | D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX;

  HRESULT hr = device->CreateTexture2D(&desc, nullptr, &d3d_texture_);
  if (FAILED(hr)) {
    // Try without keyed mutex
    desc.MiscFlags = D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
    hr = device->CreateTexture2D(&desc, nullptr, &d3d_texture_);
  }

  if (FAILED(hr)) {
    // Try with legacy shared flag
    desc.MiscFlags = D3D11_RESOURCE_MISC_SHARED;
    hr = device->CreateTexture2D(&desc, nullptr, &d3d_texture_);
  }

  if (FAILED(hr)) {
    std::cerr << "[mpv-texture] CreateTexture2D failed: 0x" << std::hex << hr << std::dec << std::endl;
    return false;
  }

  // Get the shared handle (NT HANDLE for Electron)
  ComPtr<IDXGIResource1> dxgi_resource;
  hr = d3d_texture_.As(&dxgi_resource);
  if (SUCCEEDED(hr)) {
    hr = dxgi_resource->CreateSharedHandle(
      nullptr,
      DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
      nullptr,
      &shared_handle_
    );
  }

  if (FAILED(hr) || !shared_handle_) {
    // Try legacy method
    ComPtr<IDXGIResource> legacy_resource;
    hr = d3d_texture_.As(&legacy_resource);
    if (SUCCEEDED(hr)) {
      hr = legacy_resource->GetSharedHandle(&shared_handle_);
    }
  }

  if (FAILED(hr) || !shared_handle_) {
    std::cerr << "[mpv-texture] Failed to get shared handle: 0x" << std::hex << hr << std::dec << std::endl;
    return false;
  }

  std::cout << "[mpv-texture] D3D11 texture created with shared handle" << std::endl;
  return true;
}

bool D3D11Texture::RegisterTexture() {
  if (!interop_device_ || !d3d_texture_) {
    return false;
  }

  if (!glGenTextures_ptr || !glBindTexture_ptr) {
    std::cerr << "[mpv-texture] GL function pointers not available" << std::endl;
    return false;
  }

  // Create GL texture
  glGenTextures_ptr(1, &gl_texture_);
  if (gl_texture_ == 0) {
    std::cerr << "[mpv-texture] glGenTextures failed" << std::endl;
    return false;
  }

  // Register D3D11 texture with OpenGL via interop
  interop_object_ = wglDXRegisterObjectNV(
    interop_device_,
    d3d_texture_.Get(),
    gl_texture_,
    GL_TEXTURE_2D,
    WGL_ACCESS_READ_WRITE_NV
  );

  if (!interop_object_) {
    std::cerr << "[mpv-texture] wglDXRegisterObjectNV failed" << std::endl;
    glDeleteTextures_ptr(1, &gl_texture_);
    gl_texture_ = 0;
    return false;
  }

  // Lock the texture to set parameters
  if (!wglDXLockObjectsNV(interop_device_, 1, &interop_object_)) {
    std::cerr << "[mpv-texture] wglDXLockObjectsNV failed" << std::endl;
    return false;
  }

  glBindTexture_ptr(GL_TEXTURE_2D, gl_texture_);
  glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri_ptr(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glBindTexture_ptr(GL_TEXTURE_2D, 0);

  wglDXUnlockObjectsNV(interop_device_, 1, &interop_object_);

  return true;
}

bool D3D11Texture::CreateFBO() {
  if (!glGenFramebuffers_ptr || !glBindFramebuffer_ptr ||
      !glFramebufferTexture2D_ptr || !glCheckFramebufferStatus_ptr) {
    std::cerr << "[mpv-texture] FBO function pointers not available" << std::endl;
    return false;
  }

  // Lock interop for FBO creation
  if (interop_object_) {
    if (!wglDXLockObjectsNV(interop_device_, 1, &interop_object_)) {
      std::cerr << "[mpv-texture] Failed to lock for FBO creation" << std::endl;
      return false;
    }
  }

  glGenFramebuffers_ptr(1, &fbo_);
  if (fbo_ == 0) {
    if (interop_object_) wglDXUnlockObjectsNV(interop_device_, 1, &interop_object_);
    std::cerr << "[mpv-texture] glGenFramebuffers failed" << std::endl;
    return false;
  }

  glBindFramebuffer_ptr(GL_FRAMEBUFFER, fbo_);
  glFramebufferTexture2D_ptr(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, gl_texture_, 0);

  GLenum status = glCheckFramebufferStatus_ptr(GL_FRAMEBUFFER);
  glBindFramebuffer_ptr(GL_FRAMEBUFFER, 0);

  if (interop_object_) {
    wglDXUnlockObjectsNV(interop_device_, 1, &interop_object_);
  }

  if (status != GL_FRAMEBUFFER_COMPLETE) {
    std::cerr << "[mpv-texture] Framebuffer not complete: 0x" << std::hex << status << std::dec << std::endl;
    glDeleteFramebuffers_ptr(1, &fbo_);
    fbo_ = 0;
    return false;
  }

  return true;
}

bool D3D11Texture::Resize(uint32_t width, uint32_t height) {
  if (width == width_ && height == height_) {
    return true;
  }
  return Create(width, height);
}

TextureHandle D3D11Texture::GetHandle() const {
  TextureHandle handle;
  handle.type = TextureHandle::Type::NTHandle;
  handle.width = width_;
  handle.height = height_;
  handle.nt_handle = shared_handle_;
  return handle;
}

// Factory implementation for Windows
std::unique_ptr<SharedTextureManager> SharedTextureManager::Create(PlatformGLContext* gl_context) {
  auto* windows_ctx = dynamic_cast<WindowsGLContext*>(gl_context);
  if (!windows_ctx) {
    std::cerr << "[mpv-texture] Invalid GL context type for Windows" << std::endl;
    return nullptr;
  }

  auto texture = std::make_unique<D3D11Texture>(windows_ctx);
  return texture;
}

#endif // _WIN32

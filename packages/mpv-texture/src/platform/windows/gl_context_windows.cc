#ifdef _WIN32

#include "gl_context_windows.h"
#include <iostream>

// WGL function types
typedef HGLRC(WINAPI* PFNWGLCREATECONTEXTPROC)(HDC);
typedef BOOL(WINAPI* PFNWGLDELETECONTEXTPROC)(HGLRC);
typedef BOOL(WINAPI* PFNWGLMAKECURRENTPROC)(HDC, HGLRC);
typedef PROC(WINAPI* PFNWGLGETPROCADDRESSPROC)(LPCSTR);
typedef HGLRC(WINAPI* PFNWGLCREATECONTEXTATTRIBSARBPROC)(HDC, HGLRC, const int*);

// WGL constants
#define WGL_CONTEXT_MAJOR_VERSION_ARB 0x2091
#define WGL_CONTEXT_MINOR_VERSION_ARB 0x2092
#define WGL_CONTEXT_PROFILE_MASK_ARB 0x9126
#define WGL_CONTEXT_CORE_PROFILE_BIT_ARB 0x00000001

// Function pointers
static PFNWGLCREATECONTEXTPROC pfnWglCreateContext = nullptr;
static PFNWGLDELETECONTEXTPROC pfnWglDeleteContext = nullptr;
static PFNWGLMAKECURRENTPROC pfnWglMakeCurrent = nullptr;
static PFNWGLGETPROCADDRESSPROC pfnWglGetProcAddress = nullptr;
static PFNWGLCREATECONTEXTATTRIBSARBPROC pfnWglCreateContextAttribsARB = nullptr;

// Hidden window class name
static const wchar_t* WINDOW_CLASS_NAME = L"MpvTextureHiddenWindow";
static bool window_class_registered = false;

LRESULT CALLBACK HiddenWindowProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

WindowsGLContext::WindowsGLContext() {
  if (!InitD3D11()) {
    std::cerr << "[mpv-texture] Failed to initialize D3D11" << std::endl;
    return;
  }

  if (!InitWGL()) {
    std::cerr << "[mpv-texture] Failed to initialize WGL" << std::endl;
    Cleanup();
    return;
  }

  valid_ = true;
  std::cout << "[mpv-texture] Windows GL context created successfully" << std::endl;
}

WindowsGLContext::~WindowsGLContext() {
  Cleanup();
}

bool WindowsGLContext::InitD3D11() {
  // Create D3D11 device
  D3D_FEATURE_LEVEL feature_levels[] = {
    D3D_FEATURE_LEVEL_11_1,
    D3D_FEATURE_LEVEL_11_0,
  };

  UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
#ifdef _DEBUG
  flags |= D3D11_CREATE_DEVICE_DEBUG;
#endif

  D3D_FEATURE_LEVEL actual_level;
  HRESULT hr = D3D11CreateDevice(
    nullptr,                    // Default adapter
    D3D_DRIVER_TYPE_HARDWARE,
    nullptr,                    // No software rasterizer
    flags,
    feature_levels,
    ARRAYSIZE(feature_levels),
    D3D11_SDK_VERSION,
    &d3d_device_,
    &actual_level,
    &d3d_context_
  );

  if (FAILED(hr)) {
    std::cerr << "[mpv-texture] D3D11CreateDevice failed: 0x" << std::hex << hr << std::dec << std::endl;
    return false;
  }

  // Get ID3D11Device1 for shared texture creation
  hr = d3d_device_.As(&d3d_device1_);
  if (FAILED(hr)) {
    std::cerr << "[mpv-texture] Failed to get ID3D11Device1: 0x" << std::hex << hr << std::dec << std::endl;
    return false;
  }

  // Get DXGI adapter for potential future use
  ComPtr<IDXGIDevice> dxgi_device;
  hr = d3d_device_.As(&dxgi_device);
  if (SUCCEEDED(hr)) {
    dxgi_device->GetAdapter(&dxgi_adapter_);
  }

  std::cout << "[mpv-texture] D3D11 initialized (feature level: 0x" << std::hex << actual_level << std::dec << ")" << std::endl;
  return true;
}

bool WindowsGLContext::InitWGL() {
  // Load OpenGL library
  opengl_lib_ = LoadLibraryW(L"opengl32.dll");
  if (!opengl_lib_) {
    std::cerr << "[mpv-texture] Failed to load opengl32.dll" << std::endl;
    return false;
  }

  // Get WGL function pointers
  pfnWglCreateContext = (PFNWGLCREATECONTEXTPROC)::GetProcAddress(opengl_lib_, "wglCreateContext");
  pfnWglDeleteContext = (PFNWGLDELETECONTEXTPROC)::GetProcAddress(opengl_lib_, "wglDeleteContext");
  pfnWglMakeCurrent = (PFNWGLMAKECURRENTPROC)::GetProcAddress(opengl_lib_, "wglMakeCurrent");
  pfnWglGetProcAddress = (PFNWGLGETPROCADDRESSPROC)::GetProcAddress(opengl_lib_, "wglGetProcAddress");

  if (!pfnWglCreateContext || !pfnWglDeleteContext || !pfnWglMakeCurrent || !pfnWglGetProcAddress) {
    std::cerr << "[mpv-texture] Failed to get WGL function pointers" << std::endl;
    return false;
  }

  // Register window class if needed
  if (!window_class_registered) {
    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = HiddenWindowProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = WINDOW_CLASS_NAME;

    if (!RegisterClassExW(&wc)) {
      std::cerr << "[mpv-texture] Failed to register window class" << std::endl;
      return false;
    }
    window_class_registered = true;
  }

  // Create hidden window for WGL context
  hidden_window_ = CreateWindowExW(
    0,
    WINDOW_CLASS_NAME,
    L"MpvTexture",
    0,
    0, 0, 1, 1,
    nullptr, nullptr,
    GetModuleHandleW(nullptr),
    nullptr
  );

  if (!hidden_window_) {
    std::cerr << "[mpv-texture] Failed to create hidden window" << std::endl;
    return false;
  }

  hdc_ = GetDC(hidden_window_);
  if (!hdc_) {
    std::cerr << "[mpv-texture] Failed to get DC" << std::endl;
    return false;
  }

  // Set pixel format
  PIXELFORMATDESCRIPTOR pfd = {};
  pfd.nSize = sizeof(pfd);
  pfd.nVersion = 1;
  pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
  pfd.iPixelType = PFD_TYPE_RGBA;
  pfd.cColorBits = 32;
  pfd.cDepthBits = 24;
  pfd.cStencilBits = 8;

  int format = ChoosePixelFormat(hdc_, &pfd);
  if (format == 0) {
    std::cerr << "[mpv-texture] ChoosePixelFormat failed" << std::endl;
    return false;
  }

  if (!SetPixelFormat(hdc_, format, &pfd)) {
    std::cerr << "[mpv-texture] SetPixelFormat failed" << std::endl;
    return false;
  }

  // Create legacy context first to get wglCreateContextAttribsARB
  HGLRC temp_context = pfnWglCreateContext(hdc_);
  if (!temp_context) {
    std::cerr << "[mpv-texture] Failed to create temp GL context" << std::endl;
    return false;
  }

  if (!pfnWglMakeCurrent(hdc_, temp_context)) {
    pfnWglDeleteContext(temp_context);
    std::cerr << "[mpv-texture] Failed to make temp context current" << std::endl;
    return false;
  }

  // Get wglCreateContextAttribsARB
  pfnWglCreateContextAttribsARB = (PFNWGLCREATECONTEXTATTRIBSARBPROC)
    pfnWglGetProcAddress("wglCreateContextAttribsARB");

  if (pfnWglCreateContextAttribsARB) {
    // Create modern OpenGL 4.1 core context
    int attribs[] = {
      WGL_CONTEXT_MAJOR_VERSION_ARB, 4,
      WGL_CONTEXT_MINOR_VERSION_ARB, 1,
      WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_CORE_PROFILE_BIT_ARB,
      0
    };

    hglrc_ = pfnWglCreateContextAttribsARB(hdc_, nullptr, attribs);

    if (!hglrc_) {
      // Try OpenGL 3.2 as fallback
      attribs[1] = 3;
      attribs[3] = 2;
      hglrc_ = pfnWglCreateContextAttribsARB(hdc_, nullptr, attribs);
    }
  }

  // Clean up temp context
  pfnWglMakeCurrent(nullptr, nullptr);
  pfnWglDeleteContext(temp_context);

  if (!hglrc_) {
    // Fallback to legacy context
    hglrc_ = pfnWglCreateContext(hdc_);
    std::cout << "[mpv-texture] Using legacy OpenGL context" << std::endl;
  } else {
    std::cout << "[mpv-texture] Using modern OpenGL context" << std::endl;
  }

  if (!hglrc_) {
    std::cerr << "[mpv-texture] Failed to create GL context" << std::endl;
    return false;
  }

  // Make context current
  if (!pfnWglMakeCurrent(hdc_, hglrc_)) {
    std::cerr << "[mpv-texture] Failed to make context current" << std::endl;
    return false;
  }

  return true;
}

void WindowsGLContext::Cleanup() {
  if (hglrc_) {
    pfnWglMakeCurrent(nullptr, nullptr);
    pfnWglDeleteContext(hglrc_);
    hglrc_ = nullptr;
  }

  if (hdc_ && hidden_window_) {
    ReleaseDC(hidden_window_, hdc_);
    hdc_ = nullptr;
  }

  if (hidden_window_) {
    DestroyWindow(hidden_window_);
    hidden_window_ = nullptr;
  }

  if (opengl_lib_) {
    FreeLibrary(opengl_lib_);
    opengl_lib_ = nullptr;
  }

  d3d_context_.Reset();
  d3d_device1_.Reset();
  d3d_device_.Reset();
  dxgi_adapter_.Reset();

  valid_ = false;
}

bool WindowsGLContext::MakeCurrent() {
  if (!valid_ || !hdc_ || !hglrc_) {
    return false;
  }
  return pfnWglMakeCurrent(hdc_, hglrc_) == TRUE;
}

void* WindowsGLContext::GetProcAddress(const char* name) {
  if (!opengl_lib_) return nullptr;

  // Try WGL first
  void* proc = pfnWglGetProcAddress ? (void*)pfnWglGetProcAddress(name) : nullptr;

  // Fall back to GetProcAddress for OpenGL 1.1 functions
  if (!proc) {
    proc = (void*)::GetProcAddress(opengl_lib_, name);
  }

  return proc;
}

bool WindowsGLContext::IsValid() const {
  return valid_;
}

// Factory implementation for Windows
std::unique_ptr<PlatformGLContext> PlatformGLContext::Create() {
  auto ctx = std::make_unique<WindowsGLContext>();
  if (!ctx->IsValid()) {
    return nullptr;
  }
  return ctx;
}

#endif // _WIN32

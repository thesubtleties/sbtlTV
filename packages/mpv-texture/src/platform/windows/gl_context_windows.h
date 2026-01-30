#pragma once

#ifdef _WIN32

#include "../platform.h"
#include <windows.h>
#include <d3d11.h>
#include <d3d11_1.h>
#include <dxgi1_2.h>
#include <wrl/client.h>

using Microsoft::WRL::ComPtr;

class WindowsGLContext : public PlatformGLContext {
public:
  WindowsGLContext();
  ~WindowsGLContext() override;

  bool MakeCurrent() override;
  void* GetProcAddress(const char* name) override;
  bool IsValid() const override;

  // D3D11 access for texture sharing
  ID3D11Device* GetD3DDevice() const { return d3d_device_.Get(); }
  ID3D11DeviceContext* GetD3DContext() const { return d3d_context_.Get(); }
  ID3D11Device1* GetD3DDevice1() const { return d3d_device1_.Get(); }

private:
  bool InitD3D11();
  bool InitWGL();
  void Cleanup();

  // D3D11 resources
  ComPtr<ID3D11Device> d3d_device_;
  ComPtr<ID3D11Device1> d3d_device1_;
  ComPtr<ID3D11DeviceContext> d3d_context_;
  ComPtr<IDXGIAdapter> dxgi_adapter_;

  // WGL resources for OpenGL context
  HWND hidden_window_ = nullptr;
  HDC hdc_ = nullptr;
  HGLRC hglrc_ = nullptr;
  HMODULE opengl_lib_ = nullptr;

  bool valid_ = false;
};

#endif // _WIN32

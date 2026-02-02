/*
 * Windows DXGI texture sharing implementation
 * Uses WGL_NV_DX_interop for OpenGL/D3D11 interop
 */

#ifdef _WIN32

#include "../texture_share.h"
#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <gl/GL.h>
#include <iostream>

// WGL_NV_DX_interop extension functions
typedef BOOL(WINAPI* PFNWGLDXSETRESOURCESHAREHANDLENVPROC)(void*, HANDLE);
typedef HANDLE(WINAPI* PFNWGLDXOPENDEVICENVPROC)(void*);
typedef BOOL(WINAPI* PFNWGLDXCLOSEDEVICENVPROC)(HANDLE);
typedef HANDLE(WINAPI* PFNWGLDXREGISTEROBJECTNVPROC)(HANDLE, void*, GLuint, GLenum, GLenum);
typedef BOOL(WINAPI* PFNWGLDXUNREGISTEROBJECTNVPROC)(HANDLE, HANDLE);
typedef BOOL(WINAPI* PFNWGLDXOBJECTACCESSNVPROC)(HANDLE, GLenum);
typedef BOOL(WINAPI* PFNWGLDXLOCKOBJECTSNVPROC)(HANDLE, GLint, HANDLE*);
typedef BOOL(WINAPI* PFNWGLDXUNLOCKOBJECTSNVPROC)(HANDLE, GLint, HANDLE*);

// OpenGL extension functions
typedef void(APIENTRY* PFNGLGENFRAMEBUFFERSPROC)(GLsizei, GLuint*);
typedef void(APIENTRY* PFNGLDELETEFRAMEBUFFERSPROC)(GLsizei, const GLuint*);
typedef void(APIENTRY* PFNGLBINDFRAMEBUFFERPROC)(GLenum, GLuint);
typedef void(APIENTRY* PFNGLFRAMEBUFFERTEXTURE2DPROC)(GLenum, GLenum, GLenum, GLuint, GLint);
typedef GLenum(APIENTRY* PFNGLCHECKFRAMEBUFFERSTATUSPROC)(GLenum);
typedef void(APIENTRY* PFNGLGENTEXTURESPROC)(GLsizei, GLuint*);
typedef void(APIENTRY* PFNGLDELETETEXTURESPROC)(GLsizei, const GLuint*);
typedef void(APIENTRY* PFNGLBINDTEXTUREPROC)(GLenum, GLuint);

// OpenGL constants
#define GL_FRAMEBUFFER 0x8D40
#define GL_COLOR_ATTACHMENT0 0x8CE0
#define GL_FRAMEBUFFER_COMPLETE 0x8CD5
#define GL_TEXTURE_2D 0x0DE1
#define GL_RGBA8 0x8058

// WGL_NV_DX_interop constants
#define WGL_ACCESS_READ_WRITE_NV 0x0001
#define WGL_ACCESS_READ_ONLY_NV 0x0000
#define WGL_ACCESS_WRITE_DISCARD_NV 0x0002

namespace mpv_texture {

class DXGITextureShare : public ITextureShare {
public:
    DXGITextureShare() = default;
    ~DXGITextureShare() override { destroy(); }

    bool initialize(void* gl_context) override {
        m_hglrc = static_cast<HGLRC>(gl_context);

        // Load WGL extension functions
        if (!loadWGLExtensions()) {
            std::cerr << "[DXGI] Failed to load WGL_NV_DX_interop extension" << std::endl;
            return false;
        }

        // Load OpenGL extension functions
        if (!loadGLExtensions()) {
            std::cerr << "[DXGI] Failed to load OpenGL extensions" << std::endl;
            return false;
        }

        // Create D3D11 device
        D3D_FEATURE_LEVEL featureLevels[] = {
            D3D_FEATURE_LEVEL_11_1,
            D3D_FEATURE_LEVEL_11_0,
            D3D_FEATURE_LEVEL_10_1,
            D3D_FEATURE_LEVEL_10_0
        };

        UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
#ifdef _DEBUG
        flags |= D3D11_CREATE_DEVICE_DEBUG;
#endif

        HRESULT hr = D3D11CreateDevice(
            nullptr,
            D3D_DRIVER_TYPE_HARDWARE,
            nullptr,
            flags,
            featureLevels,
            ARRAYSIZE(featureLevels),
            D3D11_SDK_VERSION,
            &m_d3dDevice,
            nullptr,
            &m_d3dContext
        );

        if (FAILED(hr)) {
            std::cerr << "[DXGI] Failed to create D3D11 device: " << std::hex << hr << std::endl;
            return false;
        }

        // Open WGL/DX interop device
        m_wglDxDevice = m_wglDXOpenDeviceNV(m_d3dDevice);
        if (!m_wglDxDevice) {
            std::cerr << "[DXGI] Failed to open WGL/DX interop device" << std::endl;
            return false;
        }

        m_initialized = true;
        return true;
    }

    bool createTexture(uint32_t width, uint32_t height) override {
        if (!m_initialized) return false;

        m_width = width;
        m_height = height;

        // Create D3D11 texture with shared handle
        D3D11_TEXTURE2D_DESC desc = {};
        desc.Width = width;
        desc.Height = height;
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
        desc.SampleDesc.Count = 1;
        desc.Usage = D3D11_USAGE_DEFAULT;
        desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
        desc.MiscFlags = D3D11_RESOURCE_MISC_SHARED;

        HRESULT hr = m_d3dDevice->CreateTexture2D(&desc, nullptr, &m_d3dTexture);
        if (FAILED(hr)) {
            std::cerr << "[DXGI] Failed to create D3D11 texture: " << std::hex << hr << std::endl;
            return false;
        }

        // Get DXGI shared handle
        IDXGIResource* dxgiResource = nullptr;
        hr = m_d3dTexture->QueryInterface(__uuidof(IDXGIResource), (void**)&dxgiResource);
        if (FAILED(hr)) {
            std::cerr << "[DXGI] Failed to get DXGI resource: " << std::hex << hr << std::endl;
            return false;
        }

        hr = dxgiResource->GetSharedHandle(&m_sharedHandle);
        dxgiResource->Release();
        if (FAILED(hr)) {
            std::cerr << "[DXGI] Failed to get shared handle: " << std::hex << hr << std::endl;
            return false;
        }

        // Create OpenGL texture
        glGenTextures(1, &m_glTexture);
        glBindTexture(GL_TEXTURE_2D, m_glTexture);

        // Register D3D texture with OpenGL via WGL_NV_DX_interop
        m_wglDxObject = m_wglDXRegisterObjectNV(
            m_wglDxDevice,
            m_d3dTexture,
            m_glTexture,
            GL_TEXTURE_2D,
            WGL_ACCESS_WRITE_DISCARD_NV
        );

        if (!m_wglDxObject) {
            std::cerr << "[DXGI] Failed to register DX object with WGL" << std::endl;
            return false;
        }

        // Create FBO
        m_glGenFramebuffers(1, &m_glFBO);
        m_glBindFramebuffer(GL_FRAMEBUFFER, m_glFBO);
        m_glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, m_glTexture, 0);

        GLenum status = m_glCheckFramebufferStatus(GL_FRAMEBUFFER);
        if (status != GL_FRAMEBUFFER_COMPLETE) {
            std::cerr << "[DXGI] FBO incomplete: " << std::hex << status << std::endl;
            return false;
        }

        m_glBindFramebuffer(GL_FRAMEBUFFER, 0);

        std::cout << "[DXGI] Created shared texture " << width << "x" << height << std::endl;
        return true;
    }

    bool resizeTexture(uint32_t width, uint32_t height) override {
        if (width == m_width && height == m_height) {
            return true;
        }

        // Destroy old resources
        if (m_wglDxObject) {
            m_wglDXUnregisterObjectNV(m_wglDxDevice, m_wglDxObject);
            m_wglDxObject = nullptr;
        }
        if (m_glFBO) {
            m_glDeleteFramebuffers(1, &m_glFBO);
            m_glFBO = 0;
        }
        if (m_glTexture) {
            glDeleteTextures(1, &m_glTexture);
            m_glTexture = 0;
        }
        if (m_d3dTexture) {
            m_d3dTexture->Release();
            m_d3dTexture = nullptr;
        }

        // Create new resources
        return createTexture(width, height);
    }

    uint32_t getGLTexture() const override {
        return m_glTexture;
    }

    uint32_t getGLFBO() const override {
        return m_glFBO;
    }

    bool lockTexture() override {
        if (!m_wglDxObject) return false;

        HANDLE objects[] = { m_wglDxObject };
        if (!m_wglDXLockObjectsNV(m_wglDxDevice, 1, objects)) {
            std::cerr << "[DXGI] Failed to lock DX object" << std::endl;
            return false;
        }

        m_locked = true;
        return true;
    }

    TextureInfo unlockAndExport() override {
        TextureInfo info = {};

        if (!m_locked) {
            return info;
        }

        // Unlock the object
        HANDLE objects[] = { m_wglDxObject };
        if (!m_wglDXUnlockObjectsNV(m_wglDxDevice, 1, objects)) {
            std::cerr << "[DXGI] Failed to unlock DX object" << std::endl;
            return info;
        }

        m_locked = false;

        // Fill info
        info.handle = reinterpret_cast<uint64_t>(m_sharedHandle);
        info.width = m_width;
        info.height = m_height;
        info.format = TextureFormat::RGBA8;
        info.is_valid = true;

        return info;
    }

    void releaseTexture() override {
        // Nothing special needed - texture is ready for next frame
    }

    void destroy() override {
        if (m_locked) {
            HANDLE objects[] = { m_wglDxObject };
            m_wglDXUnlockObjectsNV(m_wglDxDevice, 1, objects);
            m_locked = false;
        }

        if (m_wglDxObject) {
            m_wglDXUnregisterObjectNV(m_wglDxDevice, m_wglDxObject);
            m_wglDxObject = nullptr;
        }

        if (m_glFBO) {
            m_glDeleteFramebuffers(1, &m_glFBO);
            m_glFBO = 0;
        }

        if (m_glTexture) {
            glDeleteTextures(1, &m_glTexture);
            m_glTexture = 0;
        }

        if (m_wglDxDevice) {
            m_wglDXCloseDeviceNV(m_wglDxDevice);
            m_wglDxDevice = nullptr;
        }

        if (m_d3dTexture) {
            m_d3dTexture->Release();
            m_d3dTexture = nullptr;
        }

        if (m_d3dContext) {
            m_d3dContext->Release();
            m_d3dContext = nullptr;
        }

        if (m_d3dDevice) {
            m_d3dDevice->Release();
            m_d3dDevice = nullptr;
        }

        m_initialized = false;
    }

private:
    bool loadWGLExtensions() {
        // Get wglGetProcAddress
        HMODULE opengl32 = LoadLibraryA("opengl32.dll");
        if (!opengl32) return false;

        auto wglGetProcAddress = reinterpret_cast<PROC(WINAPI*)(LPCSTR)>(
            GetProcAddress(opengl32, "wglGetProcAddress"));
        if (!wglGetProcAddress) return false;

        // Load WGL_NV_DX_interop functions
        m_wglDXOpenDeviceNV = reinterpret_cast<PFNWGLDXOPENDEVICENVPROC>(
            wglGetProcAddress("wglDXOpenDeviceNV"));
        m_wglDXCloseDeviceNV = reinterpret_cast<PFNWGLDXCLOSEDEVICENVPROC>(
            wglGetProcAddress("wglDXCloseDeviceNV"));
        m_wglDXRegisterObjectNV = reinterpret_cast<PFNWGLDXREGISTEROBJECTNVPROC>(
            wglGetProcAddress("wglDXRegisterObjectNV"));
        m_wglDXUnregisterObjectNV = reinterpret_cast<PFNWGLDXUNREGISTEROBJECTNVPROC>(
            wglGetProcAddress("wglDXUnregisterObjectNV"));
        m_wglDXLockObjectsNV = reinterpret_cast<PFNWGLDXLOCKOBJECTSNVPROC>(
            wglGetProcAddress("wglDXLockObjectsNV"));
        m_wglDXUnlockObjectsNV = reinterpret_cast<PFNWGLDXUNLOCKOBJECTSNVPROC>(
            wglGetProcAddress("wglDXUnlockObjectsNV"));

        return m_wglDXOpenDeviceNV && m_wglDXCloseDeviceNV &&
               m_wglDXRegisterObjectNV && m_wglDXUnregisterObjectNV &&
               m_wglDXLockObjectsNV && m_wglDXUnlockObjectsNV;
    }

    bool loadGLExtensions() {
        HMODULE opengl32 = LoadLibraryA("opengl32.dll");
        if (!opengl32) return false;

        auto wglGetProcAddress = reinterpret_cast<PROC(WINAPI*)(LPCSTR)>(
            GetProcAddress(opengl32, "wglGetProcAddress"));
        if (!wglGetProcAddress) return false;

        m_glGenFramebuffers = reinterpret_cast<PFNGLGENFRAMEBUFFERSPROC>(
            wglGetProcAddress("glGenFramebuffers"));
        m_glDeleteFramebuffers = reinterpret_cast<PFNGLDELETEFRAMEBUFFERSPROC>(
            wglGetProcAddress("glDeleteFramebuffers"));
        m_glBindFramebuffer = reinterpret_cast<PFNGLBINDFRAMEBUFFERPROC>(
            wglGetProcAddress("glBindFramebuffer"));
        m_glFramebufferTexture2D = reinterpret_cast<PFNGLFRAMEBUFFERTEXTURE2DPROC>(
            wglGetProcAddress("glFramebufferTexture2D"));
        m_glCheckFramebufferStatus = reinterpret_cast<PFNGLCHECKFRAMEBUFFERSTATUSPROC>(
            wglGetProcAddress("glCheckFramebufferStatus"));

        return m_glGenFramebuffers && m_glDeleteFramebuffers &&
               m_glBindFramebuffer && m_glFramebufferTexture2D &&
               m_glCheckFramebufferStatus;
    }

    // State
    bool m_initialized = false;
    bool m_locked = false;
    uint32_t m_width = 0;
    uint32_t m_height = 0;

    // D3D11
    ID3D11Device* m_d3dDevice = nullptr;
    ID3D11DeviceContext* m_d3dContext = nullptr;
    ID3D11Texture2D* m_d3dTexture = nullptr;
    HANDLE m_sharedHandle = nullptr;

    // OpenGL
    HGLRC m_hglrc = nullptr;
    GLuint m_glTexture = 0;
    GLuint m_glFBO = 0;

    // WGL/DX interop
    HANDLE m_wglDxDevice = nullptr;
    HANDLE m_wglDxObject = nullptr;

    // WGL extension functions
    PFNWGLDXOPENDEVICENVPROC m_wglDXOpenDeviceNV = nullptr;
    PFNWGLDXCLOSEDEVICENVPROC m_wglDXCloseDeviceNV = nullptr;
    PFNWGLDXREGISTEROBJECTNVPROC m_wglDXRegisterObjectNV = nullptr;
    PFNWGLDXUNREGISTEROBJECTNVPROC m_wglDXUnregisterObjectNV = nullptr;
    PFNWGLDXLOCKOBJECTSNVPROC m_wglDXLockObjectsNV = nullptr;
    PFNWGLDXUNLOCKOBJECTSNVPROC m_wglDXUnlockObjectsNV = nullptr;

    // OpenGL extension functions
    PFNGLGENFRAMEBUFFERSPROC m_glGenFramebuffers = nullptr;
    PFNGLDELETEFRAMEBUFFERSPROC m_glDeleteFramebuffers = nullptr;
    PFNGLBINDFRAMEBUFFERPROC m_glBindFramebuffer = nullptr;
    PFNGLFRAMEBUFFERTEXTURE2DPROC m_glFramebufferTexture2D = nullptr;
    PFNGLCHECKFRAMEBUFFERSTATUSPROC m_glCheckFramebufferStatus = nullptr;
};

// Factory function
ITextureShare* createTextureShare() {
    return new DXGITextureShare();
}

} // namespace mpv_texture

#endif // _WIN32

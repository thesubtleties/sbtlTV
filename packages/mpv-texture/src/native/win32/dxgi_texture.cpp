/*
 * Windows DXGI texture sharing implementation
 * Uses WGL_NV_DX_interop for OpenGL/D3D11 interop
 * Double-buffered: mpv writes to one texture while Electron reads the other
 */

#ifdef _WIN32

#include "../texture_share.h"
#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <dxgi1_2.h>  // For IDXGIResource1 (NT shared handles)
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
#define GL_RGBA 0x1908
#define GL_UNSIGNED_BYTE 0x1401

// WGL_NV_DX_interop constants
#define WGL_ACCESS_READ_WRITE_NV 0x0001
#define WGL_ACCESS_READ_ONLY_NV 0x0000
#define WGL_ACCESS_WRITE_DISCARD_NV 0x0002

namespace mpv_texture {

static const int BUFFER_COUNT = 2;

// Per-texture resources for double buffering
struct TextureSlot {
    ID3D11Texture2D* d3dTexture = nullptr;
    IDXGIKeyedMutex* keyedMutex = nullptr;
    HANDLE sharedHandle = nullptr;
    GLuint glTexture = 0;
    GLuint glFBO = 0;
    HANDLE wglDxObject = nullptr;
};

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

        // Create D3D11 device on the NVIDIA adapter (required for WGL_NV_DX_interop)
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

        // Enumerate adapters to find NVIDIA GPU
        IDXGIFactory1* factory = nullptr;
        IDXGIAdapter1* nvidiaAdapter = nullptr;
        HRESULT hr = CreateDXGIFactory1(__uuidof(IDXGIFactory1), (void**)&factory);

        if (SUCCEEDED(hr)) {
            IDXGIAdapter1* adapter = nullptr;
            for (UINT i = 0; factory->EnumAdapters1(i, &adapter) != DXGI_ERROR_NOT_FOUND; i++) {
                DXGI_ADAPTER_DESC1 desc;
                adapter->GetDesc1(&desc);

                // Check for NVIDIA in the description
                std::wstring descStr(desc.Description);
                if (descStr.find(L"NVIDIA") != std::wstring::npos) {
                    nvidiaAdapter = adapter;
                    std::wcout << L"[DXGI] Using NVIDIA adapter: " << desc.Description << std::endl;
                    break;
                }
                adapter->Release();
            }
            factory->Release();
        }

        // Create device on NVIDIA adapter, or fall back to default
        if (nvidiaAdapter) {
            hr = D3D11CreateDevice(
                nvidiaAdapter,
                D3D_DRIVER_TYPE_UNKNOWN,  // Must be UNKNOWN when specifying adapter
                nullptr,
                flags,
                featureLevels,
                ARRAYSIZE(featureLevels),
                D3D11_SDK_VERSION,
                &m_d3dDevice,
                nullptr,
                &m_d3dContext
            );
            nvidiaAdapter->Release();
        } else {
            std::cerr << "[DXGI] NVIDIA adapter not found, using default" << std::endl;
            hr = D3D11CreateDevice(
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
        }

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

        for (int i = 0; i < BUFFER_COUNT; i++) {
            if (!createSlot(m_slots[i], width, height)) {
                // Clean up any slots already created
                for (int j = 0; j < i; j++) {
                    destroySlot(m_slots[j]);
                }
                return false;
            }
        }

        m_writeIndex = 0;
        std::cout << "[DXGI] Created " << BUFFER_COUNT << " double-buffered textures "
                  << width << "x" << height << std::endl;
        return true;
    }

    bool resizeTexture(uint32_t width, uint32_t height) override {
        if (width == m_width && height == m_height) {
            return true;
        }

        // Destroy all slots and recreate
        for (int i = 0; i < BUFFER_COUNT; i++) {
            destroySlot(m_slots[i]);
        }

        return createTexture(width, height);
    }

    uint32_t getGLTexture() const override {
        return m_slots[m_writeIndex].glTexture;
    }

    uint32_t getGLFBO() const override {
        return m_slots[m_writeIndex].glFBO;
    }

    bool lockTexture() override {
        auto& slot = m_slots[m_writeIndex];
        if (!slot.wglDxObject) {
            std::cerr << "[DXGI] lockTexture: No DX object" << std::endl;
            return false;
        }

        if (m_locked) {
            return true;
        }

        HANDLE objects[] = { slot.wglDxObject };
        if (!m_wglDXLockObjectsNV(m_wglDxDevice, 1, objects)) {
            DWORD err = GetLastError();
            std::cerr << "[DXGI] Failed to lock DX object, error: " << err << std::endl;
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

        auto& slot = m_slots[m_writeIndex];

        // Unlock via WGL interop
        HANDLE objects[] = { slot.wglDxObject };
        if (!m_wglDXUnlockObjectsNV(m_wglDxDevice, 1, objects)) {
            std::cerr << "[DXGI] Failed to unlock DX object" << std::endl;
        }

        m_locked = false;

        // Export this slot's handle
        info.handle = reinterpret_cast<uint64_t>(slot.sharedHandle);
        info.width = m_width;
        info.height = m_height;
        info.format = TextureFormat::RGBA8;
        info.is_valid = true;

        // Swap to other buffer for next frame
        m_writeIndex = (m_writeIndex + 1) % BUFFER_COUNT;

        return info;
    }

    void releaseTexture() override {
        // No-op with double buffering - mpv always has a free slot to write to
    }

    void destroy() override {
        if (m_locked) {
            auto& slot = m_slots[m_writeIndex];
            if (slot.wglDxObject) {
                HANDLE objects[] = { slot.wglDxObject };
                m_wglDXUnlockObjectsNV(m_wglDxDevice, 1, objects);
            }
            m_locked = false;
        }

        for (int i = 0; i < BUFFER_COUNT; i++) {
            destroySlot(m_slots[i]);
        }

        if (m_wglDxDevice) {
            m_wglDXCloseDeviceNV(m_wglDxDevice);
            m_wglDxDevice = nullptr;
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
    bool createSlot(TextureSlot& slot, uint32_t width, uint32_t height) {
        // Create D3D11 texture with NT shared handle (required for Electron's importSharedTexture)
        D3D11_TEXTURE2D_DESC desc = {};
        desc.Width = width;
        desc.Height = height;
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
        desc.SampleDesc.Count = 1;
        desc.Usage = D3D11_USAGE_DEFAULT;
        desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
        desc.MiscFlags = D3D11_RESOURCE_MISC_SHARED_NTHANDLE | D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX;

        HRESULT hr = m_d3dDevice->CreateTexture2D(&desc, nullptr, &slot.d3dTexture);
        if (FAILED(hr)) {
            std::cerr << "[DXGI] Failed to create D3D11 texture: " << std::hex << hr << std::endl;
            return false;
        }

        // Get NT shared handle via IDXGIResource1::CreateSharedHandle
        IDXGIResource1* dxgiResource1 = nullptr;
        hr = slot.d3dTexture->QueryInterface(__uuidof(IDXGIResource1), (void**)&dxgiResource1);
        if (FAILED(hr)) {
            std::cerr << "[DXGI] Failed to get IDXGIResource1: " << std::hex << hr << std::endl;
            return false;
        }

        hr = dxgiResource1->CreateSharedHandle(
            nullptr,
            DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
            nullptr,
            &slot.sharedHandle
        );
        dxgiResource1->Release();
        if (FAILED(hr)) {
            std::cerr << "[DXGI] Failed to create NT shared handle: " << std::hex << hr << std::endl;
            return false;
        }

        // Get keyed mutex (required by D3D11 for NT shared handles)
        hr = slot.d3dTexture->QueryInterface(__uuidof(IDXGIKeyedMutex), (void**)&slot.keyedMutex);
        if (FAILED(hr)) {
            std::cerr << "[DXGI] Failed to get keyed mutex: " << std::hex << hr << std::endl;
            return false;
        }

        // Set the share handle on the D3D resource BEFORE registering with WGL
        // Required by WGL_NV_DX_interop spec for shared resources
        if (m_wglDXSetResourceShareHandleNV) {
            if (!m_wglDXSetResourceShareHandleNV(slot.d3dTexture, slot.sharedHandle)) {
                DWORD err = GetLastError();
                std::cerr << "[DXGI] Failed to set share handle, error: " << err << std::endl;
                // Continue anyway - some drivers may not require this
            }
        }

        // Create OpenGL texture
        glGenTextures(1, &slot.glTexture);
        glBindTexture(GL_TEXTURE_2D, slot.glTexture);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);

        // Register D3D texture with OpenGL via WGL_NV_DX_interop
        slot.wglDxObject = m_wglDXRegisterObjectNV(
            m_wglDxDevice,
            slot.d3dTexture,
            slot.glTexture,
            GL_TEXTURE_2D,
            WGL_ACCESS_WRITE_DISCARD_NV
        );

        if (!slot.wglDxObject) {
            DWORD err = GetLastError();
            std::cerr << "[DXGI] Failed to register DX object with WGL, error: " << err << std::endl;
            return false;
        }

        // Lock for FBO setup
        HANDLE objects[] = { slot.wglDxObject };
        if (!m_wglDXLockObjectsNV(m_wglDxDevice, 1, objects)) {
            std::cerr << "[DXGI] Failed to lock DX object for FBO setup" << std::endl;
            return false;
        }

        // Create FBO
        m_glGenFramebuffers(1, &slot.glFBO);
        m_glBindFramebuffer(GL_FRAMEBUFFER, slot.glFBO);
        m_glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, slot.glTexture, 0);

        GLenum status = m_glCheckFramebufferStatus(GL_FRAMEBUFFER);

        // Unlock after FBO setup
        m_wglDXUnlockObjectsNV(m_wglDxDevice, 1, objects);

        if (status != GL_FRAMEBUFFER_COMPLETE) {
            std::cerr << "[DXGI] FBO incomplete: " << std::hex << status << std::endl;
            return false;
        }

        m_glBindFramebuffer(GL_FRAMEBUFFER, 0);
        return true;
    }

    void destroySlot(TextureSlot& slot) {
        if (slot.wglDxObject) {
            m_wglDXUnregisterObjectNV(m_wglDxDevice, slot.wglDxObject);
            slot.wglDxObject = nullptr;
        }
        if (slot.glFBO) {
            m_glDeleteFramebuffers(1, &slot.glFBO);
            slot.glFBO = 0;
        }
        if (slot.glTexture) {
            glDeleteTextures(1, &slot.glTexture);
            slot.glTexture = 0;
        }
        if (slot.keyedMutex) {
            slot.keyedMutex->Release();
            slot.keyedMutex = nullptr;
        }
        if (slot.sharedHandle) {
            CloseHandle(slot.sharedHandle);
            slot.sharedHandle = nullptr;
        }
        if (slot.d3dTexture) {
            slot.d3dTexture->Release();
            slot.d3dTexture = nullptr;
        }
    }

    bool loadWGLExtensions() {
        // Get wglGetProcAddress
        HMODULE opengl32 = LoadLibraryA("opengl32.dll");
        if (!opengl32) return false;

        auto wglGetProcAddress = reinterpret_cast<PROC(WINAPI*)(LPCSTR)>(
            GetProcAddress(opengl32, "wglGetProcAddress"));
        if (!wglGetProcAddress) return false;

        // Load WGL_NV_DX_interop functions
        m_wglDXSetResourceShareHandleNV = reinterpret_cast<PFNWGLDXSETRESOURCESHAREHANDLENVPROC>(
            wglGetProcAddress("wglDXSetResourceShareHandleNV"));
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

        // Note: wglDXSetResourceShareHandleNV may be null on older drivers, we'll check before use
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

    // Double-buffered texture slots
    TextureSlot m_slots[BUFFER_COUNT];
    int m_writeIndex = 0;

    // D3D11 (shared across slots)
    ID3D11Device* m_d3dDevice = nullptr;
    ID3D11DeviceContext* m_d3dContext = nullptr;

    // OpenGL
    HGLRC m_hglrc = nullptr;

    // WGL/DX interop
    HANDLE m_wglDxDevice = nullptr;

    // WGL extension functions
    PFNWGLDXSETRESOURCESHAREHANDLENVPROC m_wglDXSetResourceShareHandleNV = nullptr;
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

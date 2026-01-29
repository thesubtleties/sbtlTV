use std::ffi::{c_void, CString};
use surfman::{
    Connection, Context, ContextAttributes, ContextAttributeFlags,
    Device, GLVersion, SurfaceAccess, SurfaceType,
};
use euclid::default::Size2D;

/// Headless OpenGL context for offscreen rendering.
/// Uses Surfman for cross-platform support (Linux/Windows/macOS).
pub struct HeadlessGLContext {
    device: Device,
    context: Context,
    // Surface is bound to context - context owns it while bound
}

impl HeadlessGLContext {
    pub fn new() -> Result<Self, String> {
        log::info!("[VIDEO] Creating surfman connection...");

        // Connect to display server
        let connection = Connection::new()
            .map_err(|e| format!("Surfman connection failed: {:?}", e))?;
        log::info!("[VIDEO] Surfman connection created");

        // Select GPU
        log::info!("[VIDEO] Creating adapter...");
        let adapter = connection.create_adapter()
            .map_err(|e| format!("Surfman adapter failed: {:?}", e))?;
        log::info!("[VIDEO] Adapter created");

        // Create device
        log::info!("[VIDEO] Creating device...");
        let device_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            connection.create_device(&adapter)
        }));
        let mut device = match device_result {
            Ok(Ok(d)) => d,
            Ok(Err(e)) => return Err(format!("Surfman device failed: {:?}", e)),
            Err(panic) => return Err(format!("Surfman device panicked: {:?}", panic)),
        };
        log::info!("[VIDEO] Device created");

        // Configure GL 3.3 with alpha
        let context_attributes = ContextAttributes {
            version: GLVersion::new(3, 3),
            flags: ContextAttributeFlags::ALPHA,
        };

        log::info!("[VIDEO] Creating context descriptor...");
        let context_descriptor = device.create_context_descriptor(&context_attributes)
            .map_err(|e| format!("Surfman context descriptor failed: {:?}", e))?;
        log::info!("[VIDEO] Context descriptor created");

        log::info!("[VIDEO] Creating context...");
        let mut context = device.create_context(&context_descriptor, None)
            .map_err(|e| format!("Surfman context creation failed: {:?}", e))?;
        log::info!("[VIDEO] Context created");

        // On Windows and macOS, skip surface creation/binding - it causes issues.
        // FBO rendering works without a bound surface.
        // On Linux/X11, we need a surface for the context to work properly.
        #[cfg(target_os = "linux")]
        {
            log::info!("[VIDEO] Creating surface (Linux requires it)...");
            let surface = device.create_surface(
                &context,
                SurfaceAccess::GPUOnly,
                SurfaceType::Generic { size: Size2D::new(1, 1) },
            ).map_err(|e| format!("Surfman surface creation failed: {:?}", e))?;
            log::info!("[VIDEO] Surface created");

            log::info!("[VIDEO] Binding surface to context...");
            device.bind_surface_to_context(&mut context, surface)
                .map_err(|(e, _)| format!("Surfman bind_surface failed: {:?}", e))?;
            log::info!("[VIDEO] Surface bound");
        }

        #[cfg(target_os = "windows")]
        log::info!("[VIDEO] Skipping surface binding on Windows (WGL doesn't need it for FBO)");

        #[cfg(target_os = "macos")]
        log::info!("[VIDEO] Skipping surface binding on macOS (CGL doesn't need it for FBO)");

        // Make context current
        log::info!("[VIDEO] Making context current...");
        device.make_context_current(&context)
            .map_err(|e| format!("Surfman make_current failed: {:?}", e))?;

        log::info!("[VIDEO] Surfman GL context created and made current");

        Ok(Self { device, context })
    }

    pub fn make_current(&self) -> Result<(), String> {
        self.device.make_context_current(&self.context)
            .map_err(|e| format!("Surfman make_current failed: {:?}", e))
    }

    /// Get OpenGL proc address for mpv's render context.
    pub fn get_proc_address(&self, name: &str) -> *mut c_void {
        // On macOS, use dlsym to get GL functions (like Celluloid does)
        #[cfg(target_os = "macos")]
        {
            extern "C" {
                fn dlsym(handle: *mut c_void, symbol: *const i8) -> *mut c_void;
            }
            const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;
            let c_name = CString::new(name).unwrap();
            unsafe { dlsym(RTLD_DEFAULT, c_name.as_ptr()) }
        }

        #[cfg(not(target_os = "macos"))]
        {
            self.device.get_proc_address(&self.context, name) as *mut c_void
        }
    }
}

impl Drop for HeadlessGLContext {
    fn drop(&mut self) {
        // Unbind and destroy surface before context is dropped (only needed on Linux)
        #[cfg(target_os = "linux")]
        if let Ok(Some(mut surface)) = self.device.unbind_surface_from_context(&mut self.context) {
            let _ = self.device.destroy_surface(&mut self.context, &mut surface);
        }
        // Context and device will be dropped automatically
    }
}

// Safety: Context created and used only on dedicated render thread
unsafe impl Send for HeadlessGLContext {}

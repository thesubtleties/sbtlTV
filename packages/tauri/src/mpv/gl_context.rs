use std::ffi::c_void;
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
        // Connect to display server
        let connection = Connection::new()
            .map_err(|e| format!("Surfman connection failed: {:?}", e))?;

        // Select GPU
        let adapter = connection.create_adapter()
            .map_err(|e| format!("Surfman adapter failed: {:?}", e))?;

        // Create device
        let mut device = connection.create_device(&adapter)
            .map_err(|e| format!("Surfman device failed: {:?}", e))?;

        // Configure GL 3.3 with alpha
        let context_attributes = ContextAttributes {
            version: GLVersion::new(3, 3),
            flags: ContextAttributeFlags::ALPHA,
        };

        let context_descriptor = device.create_context_descriptor(&context_attributes)
            .map_err(|e| format!("Surfman context descriptor failed: {:?}", e))?;

        let mut context = device.create_context(&context_descriptor, None)
            .map_err(|e| format!("Surfman context creation failed: {:?}", e))?;

        // Create a small generic surface (required for GL commands to work)
        // We render to our own FBO, not this surface, so 1x1 is fine
        let surface = device.create_surface(
            &context,
            SurfaceAccess::GPUOnly,
            SurfaceType::Generic { size: Size2D::new(1, 1) },
        ).map_err(|e| format!("Surfman surface creation failed: {:?}", e))?;

        // Bind surface to context - GL commands won't work without this!
        // The context now owns the surface
        device.bind_surface_to_context(&mut context, surface)
            .map_err(|(e, _)| format!("Surfman bind_surface failed: {:?}", e))?;

        // Make context current
        device.make_context_current(&context)
            .map_err(|e| format!("Surfman make_current failed: {:?}", e))?;

        Ok(Self { device, context })
    }

    pub fn make_current(&self) -> Result<(), String> {
        self.device.make_context_current(&self.context)
            .map_err(|e| format!("Surfman make_current failed: {:?}", e))
    }

    /// Get OpenGL proc address for mpv's render context.
    pub fn get_proc_address(&self, name: &str) -> *mut c_void {
        self.device.get_proc_address(&self.context, name) as *mut c_void
    }
}

impl Drop for HeadlessGLContext {
    fn drop(&mut self) {
        // Unbind and destroy surface before context is dropped
        if let Ok(Some(mut surface)) = self.device.unbind_surface_from_context(&mut self.context) {
            let _ = self.device.destroy_surface(&mut self.context, &mut surface);
        }
        // Context and device will be dropped automatically
    }
}

// Safety: Context created and used only on dedicated render thread
unsafe impl Send for HeadlessGLContext {}

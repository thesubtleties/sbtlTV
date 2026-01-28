use std::ffi::c_void;
use surfman::{Connection, Context, ContextAttributes, ContextAttributeFlags, Device, GLVersion};

/// Headless OpenGL context for offscreen rendering.
/// Uses Surfman for cross-platform support (Linux/Windows/macOS).
pub struct HeadlessGLContext {
    device: Device,
    context: Context,
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

        let context = device.create_context(&context_descriptor, None)
            .map_err(|e| format!("Surfman context creation failed: {:?}", e))?;

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
        // Surfman handles cleanup when Device and Context drop
    }
}

// Safety: Context created and used only on dedicated render thread
unsafe impl Send for HeadlessGLContext {}

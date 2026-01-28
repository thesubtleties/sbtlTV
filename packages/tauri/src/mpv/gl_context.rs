use std::ffi::c_void;

/// Headless EGL context for offscreen OpenGL rendering.
/// Creates a pbuffer surface — no window needed.
pub struct HeadlessGLContext {
    egl: khronos_egl::DynamicInstance<khronos_egl::EGL1_4>,
    display: khronos_egl::Display,
    context: khronos_egl::Context,
    surface: khronos_egl::Surface,
}

impl HeadlessGLContext {
    pub fn new() -> Result<Self, String> {
        // Load EGL dynamically — loads EGL 1.4 (which includes all 1.0-1.4 functions)
        let egl = unsafe {
            khronos_egl::DynamicInstance::<khronos_egl::EGL1_4>::load_required()
                .map_err(|e| format!("Failed to load EGL: {}", e))?
        };

        // Get default display
        let display = unsafe {
            egl.get_display(khronos_egl::DEFAULT_DISPLAY)
                .ok_or("Failed to get EGL display")?
        };

        egl.initialize(display)
            .map_err(|e| format!("EGL init failed: {}", e))?;

        // Choose config with OpenGL support
        let config_attribs = [
            khronos_egl::SURFACE_TYPE,
            khronos_egl::PBUFFER_BIT,
            khronos_egl::RENDERABLE_TYPE,
            khronos_egl::OPENGL_BIT,
            khronos_egl::RED_SIZE,
            8,
            khronos_egl::GREEN_SIZE,
            8,
            khronos_egl::BLUE_SIZE,
            8,
            khronos_egl::ALPHA_SIZE,
            8,
            khronos_egl::NONE,
        ];

        let config = egl
            .choose_first_config(display, &config_attribs)
            .map_err(|e| format!("EGL config failed: {}", e))?
            .ok_or("No suitable EGL config found")?;

        // Bind OpenGL API
        egl.bind_api(khronos_egl::OPENGL_API)
            .map_err(|e| format!("Failed to bind OpenGL API: {}", e))?;

        // Create context
        let context_attribs = [khronos_egl::NONE];
        let context = egl
            .create_context(display, config, None, &context_attribs)
            .map_err(|e| format!("EGL context creation failed: {}", e))?;

        // Create 1x1 pbuffer surface (required to make context current)
        let pbuffer_attribs = [
            khronos_egl::WIDTH,
            1,
            khronos_egl::HEIGHT,
            1,
            khronos_egl::NONE,
        ];
        let surface = egl
            .create_pbuffer_surface(display, config, &pbuffer_attribs)
            .map_err(|e| format!("EGL pbuffer failed: {}", e))?;

        // Make current
        egl.make_current(display, Some(surface), Some(surface), Some(context))
            .map_err(|e| format!("EGL make_current failed: {}", e))?;

        Ok(Self {
            egl,
            display,
            context,
            surface,
        })
    }

    pub fn make_current(&self) -> Result<(), String> {
        self.egl
            .make_current(
                self.display,
                Some(self.surface),
                Some(self.surface),
                Some(self.context),
            )
            .map_err(|e| format!("EGL make_current failed: {}", e))
    }

    /// Get the OpenGL proc address for mpv's render context.
    pub fn get_proc_address(&self, name: &str) -> *mut c_void {
        self.egl
            .get_proc_address(name)
            .map(|p| p as *mut c_void)
            .unwrap_or(std::ptr::null_mut())
    }
}

impl Drop for HeadlessGLContext {
    fn drop(&mut self) {
        let _ = self.egl.make_current(self.display, None, None, None);
        let _ = self.egl.destroy_surface(self.display, self.surface);
        let _ = self.egl.destroy_context(self.display, self.context);
        let _ = self.egl.terminate(self.display);
    }
}

// Safety: The GL context is only used from the dedicated render thread
unsafe impl Send for HeadlessGLContext {}

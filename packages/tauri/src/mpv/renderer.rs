use gl::types::*;

/// Manages an OpenGL FBO for offscreen mpv rendering
/// and reads back pixel data for transfer to the frontend.
pub struct OffscreenRenderer {
    fbo: GLuint,
    texture: GLuint,
    width: u32,
    height: u32,
    pixel_buffer: Vec<u8>,
}

impl OffscreenRenderer {
    pub fn new(width: u32, height: u32) -> Self {
        let mut fbo: GLuint = 0;
        let mut texture: GLuint = 0;

        unsafe {
            gl::GenFramebuffers(1, &mut fbo);
            gl::BindFramebuffer(gl::FRAMEBUFFER, fbo);

            gl::GenTextures(1, &mut texture);
            gl::BindTexture(gl::TEXTURE_2D, texture);
            gl::TexImage2D(
                gl::TEXTURE_2D,
                0,
                gl::RGBA8 as GLint,
                width as GLsizei,
                height as GLsizei,
                0,
                gl::RGBA,
                gl::UNSIGNED_BYTE,
                std::ptr::null(),
            );
            gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_MIN_FILTER, gl::LINEAR as GLint);
            gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_MAG_FILTER, gl::LINEAR as GLint);

            gl::FramebufferTexture2D(
                gl::FRAMEBUFFER,
                gl::COLOR_ATTACHMENT0,
                gl::TEXTURE_2D,
                texture,
                0,
            );

            let status = gl::CheckFramebufferStatus(gl::FRAMEBUFFER);
            if status != gl::FRAMEBUFFER_COMPLETE {
                log::error!("FBO incomplete: 0x{:X}", status);
            }

            gl::BindFramebuffer(gl::FRAMEBUFFER, 0);
        }

        let buf_size = (width * height * 4) as usize;
        Self {
            fbo,
            texture,
            width,
            height,
            pixel_buffer: vec![0u8; buf_size],
        }
    }

    pub fn is_complete(&self) -> bool {
        unsafe {
            gl::BindFramebuffer(gl::FRAMEBUFFER, self.fbo);
            let status = gl::CheckFramebufferStatus(gl::FRAMEBUFFER);
            gl::BindFramebuffer(gl::FRAMEBUFFER, 0);
            status == gl::FRAMEBUFFER_COMPLETE
        }
    }

    pub fn fbo(&self) -> GLuint {
        self.fbo
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    /// Resize the FBO and pixel buffer. Call when video dimensions change.
    pub fn resize(&mut self, width: u32, height: u32) {
        if self.width == width && self.height == height {
            return;
        }

        self.width = width;
        self.height = height;
        self.pixel_buffer.resize((width * height * 4) as usize, 0);

        unsafe {
            gl::BindTexture(gl::TEXTURE_2D, self.texture);
            gl::TexImage2D(
                gl::TEXTURE_2D,
                0,
                gl::RGBA8 as GLint,
                width as GLsizei,
                height as GLsizei,
                0,
                gl::RGBA,
                gl::UNSIGNED_BYTE,
                std::ptr::null(),
            );
        }

        log::info!("FBO resized to {}x{}", width, height);
    }

    /// Read back pixels from the FBO into the internal buffer.
    pub fn read_pixels(&mut self) {
        unsafe {
            gl::BindFramebuffer(gl::FRAMEBUFFER, self.fbo);
            gl::ReadPixels(
                0,
                0,
                self.width as GLsizei,
                self.height as GLsizei,
                gl::RGBA,
                gl::UNSIGNED_BYTE,
                self.pixel_buffer.as_mut_ptr() as *mut _,
            );
            gl::BindFramebuffer(gl::FRAMEBUFFER, 0);
        }
    }

    /// Read pixels and convert RGBA to YUV420 planes.
    /// Returns (y_plane, u_plane, v_plane) for efficient transfer.
    pub fn read_as_yuv420(&mut self) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        self.read_pixels();

        let w = self.width as usize;
        let h = self.height as usize;
        let half_w = w / 2;
        let half_h = h / 2;

        let mut y_plane = vec![0u8; w * h];
        let mut u_plane = vec![0u8; half_w * half_h];
        let mut v_plane = vec![0u8; half_w * half_h];

        let rgba = &self.pixel_buffer;

        // Convert RGBA to YUV420 (BT.709)
        // Y for every pixel, U/V subsampled 2x2
        for row in 0..h {
            // Flip vertically: OpenGL reads bottom-up
            let src_row = h - 1 - row;
            for col in 0..w {
                let idx = (src_row * w + col) * 4;
                let r = rgba[idx] as f32;
                let g = rgba[idx + 1] as f32;
                let b = rgba[idx + 2] as f32;

                // BT.709 RGB→YUV
                let y = (0.2126 * r + 0.7152 * g + 0.0722 * b).clamp(0.0, 255.0);
                y_plane[row * w + col] = y as u8;

                // Subsample U/V at 2x2 blocks (top-left pixel of each block)
                if row % 2 == 0 && col % 2 == 0 {
                    let u = (-0.1146 * r - 0.3854 * g + 0.5 * b + 128.0).clamp(0.0, 255.0);
                    let v = (0.5 * r - 0.4542 * g - 0.0458 * b + 128.0).clamp(0.0, 255.0);
                    let uv_idx = (row / 2) * half_w + (col / 2);
                    u_plane[uv_idx] = u as u8;
                    v_plane[uv_idx] = v as u8;
                }
            }
        }

        (y_plane, u_plane, v_plane)
    }
}

impl Drop for OffscreenRenderer {
    fn drop(&mut self) {
        unsafe {
            gl::DeleteFramebuffers(1, &self.fbo);
            gl::DeleteTextures(1, &self.texture);
        }
    }
}

//! mpv integration module.
//!
//! Platform rendering strategies:
//! - Windows: External mpv process with --wid (renders to HWND)
//! - macOS: Native <video> tag (mpv GL broken, frontend handles)
//! - Linux: Native <video> tag by default, optional external mpv window
//!
//! FBO fallback (feature-gated) for debugging or if native doesn't work.

// External process-based mpv (Windows + Linux)
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub mod external;
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub mod ipc;

// FBO-based rendering (fallback, feature-gated)
#[cfg(feature = "fbo-fallback")]
pub mod gl_context;
#[cfg(feature = "fbo-fallback")]
pub mod renderer;

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "windows")]
use external::{ExternalMpv, ExternalMpvState};

#[cfg(target_os = "linux")]
use external::ExternalMpvState;

// ============================================================================
// Shared Types
// ============================================================================

/// mpv status sent to the frontend
#[derive(Clone, Serialize)]
pub struct MpvStatus {
    pub playing: bool,
    pub volume: f64,
    pub muted: bool,
    pub position: f64,
    pub duration: f64,
}

#[derive(Clone, Serialize)]
pub struct MpvResult {
    pub success: Option<bool>,
    pub error: Option<String>,
}

impl MpvResult {
    pub fn ok() -> Self {
        Self {
            success: Some(true),
            error: None,
        }
    }
    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            success: None,
            error: Some(msg.into()),
        }
    }
}

// ============================================================================
// Platform-specific State
// ============================================================================

/// State for external mpv process (Windows/Linux)
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub struct MpvState {
    external: Mutex<ExternalMpvState>,
}

/// State for native video (macOS - mpv not used on backend)
#[cfg(target_os = "macos")]
pub struct MpvState {
    // macOS uses native <video> tag, no backend mpv needed
    _phantom: std::marker::PhantomData<()>,
}

// ============================================================================
// Initialization
// ============================================================================

/// Initialize mpv for the platform.
/// Windows: Spawns external mpv with --wid embedding
/// macOS: No-op (frontend uses native video)
/// Linux: No-op by default (frontend uses native video), external mpv on demand
#[cfg(target_os = "windows")]
pub fn init_mpv(app: &AppHandle) -> Result<(), String> {
    log::info!("[MPV] Windows: Using external mpv with --wid embedding");

    // Get the main window for HWND
    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => {
            log::error!("[MPV] Main window not found - registering empty state");
            app.manage(MpvState {
                external: Mutex::new(ExternalMpvState::new()),
            });
            return Err("Main window not found".to_string());
        }
    };

    // Spawn external mpv embedded in window
    match ExternalMpv::new_embedded(&window, app.clone()) {
        Ok(mpv) => {
            let state = MpvState {
                external: Mutex::new(ExternalMpvState { mpv: Some(mpv) }),
            };
            app.manage(state);
            Ok(())
        }
        Err(e) => {
            log::error!("[MPV] Failed to spawn mpv: {} - registering empty state", e);
            app.manage(MpvState {
                external: Mutex::new(ExternalMpvState::new()),
            });
            Err(e)
        }
    }
}

#[cfg(target_os = "macos")]
pub fn init_mpv(app: &AppHandle) -> Result<(), String> {
    log::info!("[MPV] macOS: Using native video playback (frontend <video> tag)");

    // macOS doesn't need backend mpv - frontend handles video natively
    let state = MpvState {
        _phantom: std::marker::PhantomData,
    };
    app.manage(state);

    // Emit ready immediately - frontend handles playback
    let _ = app.emit("mpv-ready", true);

    Ok(())
}

#[cfg(target_os = "linux")]
pub fn init_mpv(app: &AppHandle) -> Result<(), String> {
    log::info!("[MPV] Linux: Native video by default, external mpv available on demand");

    // Linux starts with native video; external mpv spawned when user enables it
    let state = MpvState {
        external: Mutex::new(ExternalMpvState::new()),
    };
    app.manage(state);

    // Emit ready immediately - frontend handles playback by default
    let _ = app.emit("mpv-ready", true);

    Ok(())
}

// ============================================================================
// Tauri Commands - Windows (External MPV)
// ============================================================================

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn mpv_load(url: String, state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.load(&url),
        None => MpvResult::err("mpv not initialized"),
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn mpv_play(state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.play(),
        None => MpvResult::err("mpv not initialized"),
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn mpv_pause(state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.pause(),
        None => MpvResult::err("mpv not initialized"),
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn mpv_toggle_pause(state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.toggle_pause(),
        None => MpvResult::err("mpv not initialized"),
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn mpv_stop(state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.stop(),
        None => MpvResult::err("mpv not initialized"),
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn mpv_set_volume(volume: f64, state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.set_volume(volume),
        None => MpvResult::err("mpv not initialized"),
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn mpv_toggle_mute(state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.toggle_mute(),
        None => MpvResult::err("mpv not initialized"),
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn mpv_seek(seconds: f64, state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.seek(seconds),
        None => MpvResult::err("mpv not initialized"),
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn mpv_get_status(state: State<MpvState>) -> MpvStatus {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.get_status(),
        None => MpvStatus {
            playing: false,
            volume: 100.0,
            muted: false,
            position: 0.0,
            duration: 0.0,
        },
    }
}

// ============================================================================
// Tauri Commands - macOS (Native Video - No-op backend)
// ============================================================================

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn mpv_load(_url: String, _state: State<MpvState>) -> MpvResult {
    // macOS: Frontend handles video via native <video> tag
    MpvResult::ok()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn mpv_play(_state: State<MpvState>) -> MpvResult {
    MpvResult::ok()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn mpv_pause(_state: State<MpvState>) -> MpvResult {
    MpvResult::ok()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn mpv_toggle_pause(_state: State<MpvState>) -> MpvResult {
    MpvResult::ok()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn mpv_stop(_state: State<MpvState>) -> MpvResult {
    MpvResult::ok()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn mpv_set_volume(_volume: f64, _state: State<MpvState>) -> MpvResult {
    MpvResult::ok()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn mpv_toggle_mute(_state: State<MpvState>) -> MpvResult {
    MpvResult::ok()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn mpv_seek(_seconds: f64, _state: State<MpvState>) -> MpvResult {
    MpvResult::ok()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn mpv_get_status(_state: State<MpvState>) -> MpvStatus {
    // macOS: Frontend tracks status via HTML5 video events
    MpvStatus {
        playing: false,
        volume: 100.0,
        muted: false,
        position: 0.0,
        duration: 0.0,
    }
}

// ============================================================================
// Tauri Commands - Linux (Native Video + Optional External MPV)
// ============================================================================

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn mpv_load(url: String, state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.load(&url),
        None => {
            // No external mpv - frontend uses native video
            MpvResult::ok()
        }
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn mpv_play(state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.play(),
        None => MpvResult::ok(),
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn mpv_pause(state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.pause(),
        None => MpvResult::ok(),
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn mpv_toggle_pause(state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.toggle_pause(),
        None => MpvResult::ok(),
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn mpv_stop(state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.stop(),
        None => MpvResult::ok(),
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn mpv_set_volume(volume: f64, state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.set_volume(volume),
        None => MpvResult::ok(),
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn mpv_toggle_mute(state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.toggle_mute(),
        None => MpvResult::ok(),
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn mpv_seek(seconds: f64, state: State<MpvState>) -> MpvResult {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.seek(seconds),
        None => MpvResult::ok(),
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn mpv_get_status(state: State<MpvState>) -> MpvStatus {
    let guard = state.external.lock().unwrap();
    match &guard.mpv {
        Some(mpv) => mpv.get_status(),
        None => MpvStatus {
            playing: false,
            volume: 100.0,
            muted: false,
            position: 0.0,
            duration: 0.0,
        },
    }
}

/// Enable external mpv window mode on Linux (power-user setting)
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn mpv_enable_external_window(app: AppHandle, state: State<MpvState>) -> MpvResult {
    use external::ExternalMpv;

    let mut guard = state.external.lock().unwrap();
    if guard.mpv.is_some() {
        return MpvResult::err("External mpv already running");
    }

    match ExternalMpv::new_standalone(app) {
        Ok(mpv) => {
            guard.mpv = Some(mpv);
            MpvResult::ok()
        }
        Err(e) => MpvResult::err(e),
    }
}

/// Disable external mpv window mode on Linux
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn mpv_disable_external_window(state: State<MpvState>) -> MpvResult {
    let mut guard = state.external.lock().unwrap();
    guard.mpv = None; // Drop will clean up the process
    MpvResult::ok()
}

// Stub commands for non-Linux platforms
#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn mpv_enable_external_window(_app: AppHandle, _state: State<MpvState>) -> MpvResult {
    MpvResult::err("External window mode only available on Linux")
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn mpv_disable_external_window(_state: State<MpvState>) -> MpvResult {
    MpvResult::err("External window mode only available on Linux")
}

// ============================================================================
// FBO Fallback (feature-gated)
// ============================================================================

#[cfg(feature = "fbo-fallback")]
pub use fbo_fallback::*;

#[cfg(feature = "fbo-fallback")]
mod fbo_fallback {
    //! FBO-based rendering using libmpv.
    //! This is the original approach - kept as fallback for debugging.

    use super::*;
    use crate::mpv::gl_context::HeadlessGLContext;
    use crate::mpv::renderer::OffscreenRenderer;
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
    use libmpv2::Mpv;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tauri::Emitter;

    /// Frame data sent to the frontend via Tauri events
    #[derive(Clone, Serialize)]
    pub struct FrameData {
        pub width: u32,
        pub height: u32,
        pub jpeg: String,
    }

    pub struct FboMpvState {
        mpv: Arc<Mpv>,
        shutdown: Arc<AtomicBool>,
    }

    impl Drop for FboMpvState {
        fn drop(&mut self) {
            self.shutdown.store(true, Ordering::SeqCst);
        }
    }

    fn get_proc_address(ctx: &HeadlessGLContext, name: &str) -> *mut c_void {
        ctx.get_proc_address(name)
    }

    pub fn init_mpv_fbo(app: &AppHandle) -> Result<(), String> {
        let mpv = Mpv::with_initializer(|init| {
            init.set_property("vo", "libmpv")?;
            init.set_property("osc", "no")?;
            init.set_property("osd-level", 0i64)?;
            init.set_property("keep-open", "yes")?;
            init.set_property("idle", "yes")?;
            init.set_property("input-default-bindings", "no")?;
            init.set_property("hwdec", "auto")?;
            init.set_property("tone-mapping", "mobius")?;
            Ok(())
        })
        .map_err(|e| format!("Failed to create mpv: {}", e))?;

        let mpv = Arc::new(mpv);
        let shutdown = Arc::new(AtomicBool::new(false));

        let state = FboMpvState {
            mpv: mpv.clone(),
            shutdown: shutdown.clone(),
        };
        app.manage(state);

        let app_handle = app.clone();
        std::thread::spawn(move || {
            if let Err(e) = render_thread_fbo(mpv, shutdown, app_handle) {
                log::error!("[VIDEO-FBO] Render thread error: {}", e);
            }
        });

        Ok(())
    }

    fn render_thread_fbo(
        mpv: Arc<Mpv>,
        shutdown: Arc<AtomicBool>,
        app: AppHandle,
    ) -> Result<(), String> {
        log::info!("[VIDEO-FBO] Render thread starting...");

        let gl_ctx = HeadlessGLContext::new()?;
        gl_ctx.make_current()?;

        gl::load_with(|s| gl_ctx.get_proc_address(s) as *const _);

        let mpv_ptr = Arc::as_ptr(&mpv) as *mut Mpv;
        let render_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
            RenderContext::new(
                (*mpv_ptr).ctx.as_mut(),
                vec![
                    RenderParam::ApiType(RenderParamApiType::OpenGl),
                    RenderParam::InitParams(OpenGLInitParams {
                        get_proc_address,
                        ctx: gl_ctx,
                    }),
                ],
            )
        }));

        let mut render_ctx = match render_result {
            Ok(Ok(ctx)) => ctx,
            Ok(Err(e)) => return Err(format!("Failed to create render context: {:?}", e)),
            Err(_) => return Err("Render context creation panicked".to_string()),
        };

        let render_pending = Arc::new(AtomicBool::new(false));
        let render_pending_cb = render_pending.clone();
        render_ctx.set_update_callback(move || {
            render_pending_cb.store(true, Ordering::SeqCst);
        });

        let mut offscreen = OffscreenRenderer::new(1920, 1080);
        let fbo_ok = offscreen.is_complete();

        let _ = app.emit("mpv-ready", true);

        let mut last_frame_time = Instant::now();
        let frame_interval = Duration::from_millis(33);

        while !shutdown.load(Ordering::SeqCst) {
            if render_pending.swap(false, Ordering::SeqCst) && fbo_ok {
                let fbo_id = offscreen.fbo() as i32;
                let w = offscreen.width() as i32;
                let h = offscreen.height() as i32;

                if render_ctx
                    .render::<HeadlessGLContext>(fbo_id, w, h, true)
                    .is_ok()
                    && last_frame_time.elapsed() >= frame_interval
                {
                    last_frame_time = Instant::now();
                    let jpeg_bytes = offscreen.read_as_jpeg(80);
                    let frame = FrameData {
                        width: offscreen.width(),
                        height: offscreen.height(),
                        jpeg: BASE64.encode(&jpeg_bytes),
                    };
                    let _ = app.emit("mpv-frame", frame);
                }
            }
            std::thread::sleep(Duration::from_millis(8));
        }

        Ok(())
    }
}

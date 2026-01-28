pub mod gl_context;
pub mod renderer;

use gl_context::HeadlessGLContext;
use renderer::OffscreenRenderer;

use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use libmpv2::Mpv;
use serde::Serialize;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

/// Frame data sent to the frontend via Tauri events
/// JPEG encoded for efficient IPC (~50-100KB vs ~4MB for base64 YUV)
#[derive(Clone, Serialize)]
pub struct FrameData {
    pub width: u32,
    pub height: u32,
    pub jpeg: String,  // base64 encoded JPEG
}

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
    fn ok() -> Self {
        Self {
            success: Some(true),
            error: None,
        }
    }
    fn err(msg: impl Into<String>) -> Self {
        Self {
            success: None,
            error: Some(msg.into()),
        }
    }
}

/// State managed by Tauri — holds the mpv handle for commands
pub struct MpvState {
    mpv: Arc<Mpv>,
    shutdown: Arc<AtomicBool>,
}

impl Drop for MpvState {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }
}

/// get_proc_address callback matching libmpv2's expected signature
fn get_proc_address(ctx: &HeadlessGLContext, name: &str) -> *mut c_void {
    ctx.get_proc_address(name)
}

/// Initialize mpv with offscreen rendering.
/// Spawns a dedicated render thread that emits frames and status to the frontend.
pub fn init_mpv(app: &AppHandle) -> Result<(), String> {
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

    let state = MpvState {
        mpv: mpv.clone(),
        shutdown: shutdown.clone(),
    };
    app.manage(state);

    // Spawn render thread
    let app_handle = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = render_thread(mpv, shutdown, app_handle) {
            log::error!("[VIDEO] Render thread error: {}", e);
        }
    });

    Ok(())
}

fn render_thread(mpv: Arc<Mpv>, shutdown: Arc<AtomicBool>, app: AppHandle) -> Result<(), String> {
    log::info!("[VIDEO] Render thread starting...");

    // Create headless GL context on this thread
    let gl_ctx = HeadlessGLContext::new()?;
    gl_ctx.make_current()?;

    // Load GL function pointers
    gl::load_with(|s| gl_ctx.get_proc_address(s) as *const _);
    log::info!("[VIDEO] GL function pointers loaded");

    // Create mpv render context with OpenGL
    let mpv_ptr = Arc::as_ptr(&mpv) as *mut Mpv;
    let mut render_ctx = unsafe {
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
        .map_err(|e| format!("Failed to create render context: {}", e))?
    };
    log::info!("[VIDEO] mpv render context created");

    // Set up render update callback
    let render_pending = Arc::new(AtomicBool::new(false));
    let render_pending_cb = render_pending.clone();
    render_ctx.set_update_callback(move || {
        render_pending_cb.store(true, Ordering::SeqCst);
    });

    let mut offscreen = OffscreenRenderer::new(1920, 1080);
    let fbo_ok = offscreen.is_complete();

    if !fbo_ok {
        log::error!("FBO incomplete — video rendering disabled (GPU limitation)");
    } else {
        log::info!("[VIDEO] FBO created successfully, {}x{}", offscreen.width(), offscreen.height());
    }

    // Emit ready event
    let _ = app.emit("mpv-ready", true);
    log::info!("[VIDEO] mpv-ready event emitted");

    // Status tracking
    let mut last_status_time = Instant::now();
    let status_throttle = Duration::from_millis(100);

    // Frame rate limiting - match video FPS (capped at 30fps for IPC)
    let mut last_frame_time = Instant::now();
    let mut frame_interval = Duration::from_millis(33); // default ~30fps
    let mut last_fps_check = Instant::now();
    let fps_check_interval = Duration::from_secs(1);

    // Render loop
    while !shutdown.load(Ordering::SeqCst) {
        if render_pending.swap(false, Ordering::SeqCst) {
            let _flags = render_ctx.update();

            if fbo_ok {
                // Check video dimensions and resize if needed
                if let Ok(w) = mpv.get_property::<i64>("width") {
                    if let Ok(h) = mpv.get_property::<i64>("height") {
                        if w > 0 && h > 0 {
                            offscreen.resize(w as u32, h as u32);
                        }
                    }
                }

                let fbo_id = offscreen.fbo() as i32;
                let w = offscreen.width() as i32;
                let h = offscreen.height() as i32;

                if let Err(e) = render_ctx.render::<HeadlessGLContext>(fbo_id, w, h, true) {
                    log::error!("mpv render failed: {}", e);
                    continue;
                }

                // Update frame interval based on video FPS (check every second)
                if last_fps_check.elapsed() >= fps_check_interval {
                    last_fps_check = Instant::now();
                    // Try container-fps first, fall back to estimated-vf-fps
                    let fps = mpv.get_property::<f64>("container-fps")
                        .or_else(|_| mpv.get_property::<f64>("estimated-vf-fps"))
                        .unwrap_or(30.0);

                    // Cap at 60fps max for IPC, min 10fps to avoid issues
                    let capped_fps = fps.clamp(10.0, 60.0);
                    let interval_ms = (1000.0 / capped_fps) as u64;
                    frame_interval = Duration::from_millis(interval_ms);

                    log::info!("[VIDEO] Video FPS: {:.2}, using {:.2}fps ({:.0}ms interval)",
                        fps, capped_fps, interval_ms as f64);
                }

                // Throttle frame emission to match video FPS
                if last_frame_time.elapsed() >= frame_interval {
                    last_frame_time = Instant::now();

                    // Encode as JPEG (quality 80 = good balance of quality/size)
                    let jpeg_bytes = offscreen.read_as_jpeg(80);

                    // Debug: log every ~2 seconds
                    let frame_num = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() % 10000)
                        .unwrap_or(0);

                    if frame_num % 2000 < 20 {
                        log::info!(
                            "[VIDEO] Frame {}x{}, JPEG {}KB, emitting mpv-frame",
                            offscreen.width(), offscreen.height(), jpeg_bytes.len() / 1024
                        );
                    }

                    let frame = FrameData {
                        width: offscreen.width(),
                        height: offscreen.height(),
                        jpeg: BASE64.encode(&jpeg_bytes),
                    };

                    let _ = app.emit("mpv-frame", frame);
                }
            } else {
                // FBO broken — render to dummy target so mpv's clock advances
                let _ = render_ctx.render::<HeadlessGLContext>(0, 1, 1, true);
            }
        }

        // Emit status updates (throttled)
        if last_status_time.elapsed() >= status_throttle {
            last_status_time = Instant::now();

            let status = MpvStatus {
                playing: !mpv.get_property::<bool>("pause").unwrap_or(true),
                volume: mpv.get_property::<f64>("volume").unwrap_or(100.0),
                muted: mpv.get_property::<bool>("mute").unwrap_or(false),
                position: mpv.get_property::<f64>("time-pos").unwrap_or(0.0),
                duration: mpv.get_property::<f64>("duration").unwrap_or(0.0),
            };

            let _ = app.emit("mpv-status", &status);
        }

        // Sleep to avoid busy-waiting (~60fps check rate)
        std::thread::sleep(Duration::from_millis(8));
    }

    Ok(())
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
pub fn mpv_load(url: String, state: tauri::State<MpvState>) -> MpvResult {
    match state.mpv.command("loadfile", &[&url]) {
        Ok(_) => MpvResult::ok(),
        Err(e) => MpvResult::err(e.to_string()),
    }
}

#[tauri::command]
pub fn mpv_play(state: tauri::State<MpvState>) -> MpvResult {
    match state.mpv.set_property("pause", false) {
        Ok(_) => MpvResult::ok(),
        Err(e) => MpvResult::err(e.to_string()),
    }
}

#[tauri::command]
pub fn mpv_pause(state: tauri::State<MpvState>) -> MpvResult {
    match state.mpv.set_property("pause", true) {
        Ok(_) => MpvResult::ok(),
        Err(e) => MpvResult::err(e.to_string()),
    }
}

#[tauri::command]
pub fn mpv_toggle_pause(state: tauri::State<MpvState>) -> MpvResult {
    match state.mpv.command("cycle", &["pause"]) {
        Ok(_) => MpvResult::ok(),
        Err(e) => MpvResult::err(e.to_string()),
    }
}

#[tauri::command]
pub fn mpv_stop(state: tauri::State<MpvState>) -> MpvResult {
    match state.mpv.command("stop", &[]) {
        Ok(_) => MpvResult::ok(),
        Err(e) => MpvResult::err(e.to_string()),
    }
}

#[tauri::command]
pub fn mpv_set_volume(volume: f64, state: tauri::State<MpvState>) -> MpvResult {
    match state.mpv.set_property("volume", volume) {
        Ok(_) => MpvResult::ok(),
        Err(e) => MpvResult::err(e.to_string()),
    }
}

#[tauri::command]
pub fn mpv_toggle_mute(state: tauri::State<MpvState>) -> MpvResult {
    match state.mpv.command("cycle", &["mute"]) {
        Ok(_) => MpvResult::ok(),
        Err(e) => MpvResult::err(e.to_string()),
    }
}

#[tauri::command]
pub fn mpv_seek(seconds: f64, state: tauri::State<MpvState>) -> MpvResult {
    match state
        .mpv
        .command("seek", &[&seconds.to_string(), "absolute"])
    {
        Ok(_) => MpvResult::ok(),
        Err(e) => MpvResult::err(e.to_string()),
    }
}

#[tauri::command]
pub fn mpv_get_status(state: tauri::State<MpvState>) -> MpvStatus {
    MpvStatus {
        playing: !state.mpv.get_property::<bool>("pause").unwrap_or(true),
        volume: state.mpv.get_property::<f64>("volume").unwrap_or(100.0),
        muted: state.mpv.get_property::<bool>("mute").unwrap_or(false),
        position: state
            .mpv
            .get_property::<f64>("time-pos")
            .unwrap_or(0.0),
        duration: state
            .mpv
            .get_property::<f64>("duration")
            .unwrap_or(0.0),
    }
}

//! External mpv process management for platform-native video rendering.
//!
//! Windows: Spawns mpv with --wid to render directly into the app's HWND
//! Linux: Spawns mpv as standalone window (optional power-user setting)

use super::ipc::{MpvIpcClient, MpvEvent, start_reader_thread};
use super::{MpvResult, MpvStatus};
use serde_json::Value;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

/// Socket path for mpv IPC
fn get_socket_path() -> String {
    let pid = std::process::id();
    #[cfg(target_os = "windows")]
    {
        format!(r"\\.\pipe\mpv-socket-{}", pid)
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        format!("/tmp/mpv-socket-{}", pid)
    }
}

/// Find mpv binary - checks bundled location first, then system paths
fn find_mpv_binary(app: &tauri::AppHandle) -> Option<String> {
    // Try bundled mpv first (in resources/mpv/)
    if let Ok(resource_path) = app.path().resource_dir() {
        #[cfg(target_os = "windows")]
        {
            let bundled = resource_path.join("mpv").join("mpv.exe");
            if bundled.exists() {
                log::info!("[MPV-EXT] Found bundled mpv: {:?}", bundled);
                return Some(bundled.to_string_lossy().to_string());
            }
        }

        #[cfg(target_os = "macos")]
        {
            let bundled = resource_path.join("mpv").join("MacOS").join("mpv");
            if bundled.exists() {
                log::info!("[MPV-EXT] Found bundled mpv: {:?}", bundled);
                return Some(bundled.to_string_lossy().to_string());
            }
        }
    }

    // Fall back to system paths
    #[cfg(target_os = "windows")]
    {
        let paths = [
            r"C:\Program Files\mpv\mpv.exe",
            r"C:\Program Files (x86)\mpv\mpv.exe",
            // Chocolatey install location (choco install mpvio)
            r"C:\ProgramData\chocolatey\lib\mpvio.install\tools\mpv.exe",
        ];
        for path in paths {
            if std::path::Path::new(path).exists() {
                log::info!("[MPV-EXT] Found system mpv: {}", path);
                return Some(path.to_string());
            }
        }
        // Check LOCALAPPDATA
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let path = format!(r"{}\Programs\mpv\mpv.exe", local);
            if std::path::Path::new(&path).exists() {
                log::info!("[MPV-EXT] Found user mpv: {}", path);
                return Some(path);
            }
        }
        None
    }

    #[cfg(target_os = "linux")]
    {
        let paths = ["/usr/bin/mpv", "/usr/local/bin/mpv"];
        for path in paths {
            if std::path::Path::new(path).exists() {
                log::info!("[MPV-EXT] Found system mpv: {}", path);
                return Some(path.to_string());
            }
        }
        None
    }

    #[cfg(target_os = "macos")]
    {
        let paths = [
            "/opt/homebrew/bin/mpv",
            "/usr/local/bin/mpv",
            "/usr/bin/mpv",
        ];
        for path in paths {
            if std::path::Path::new(path).exists() {
                log::info!("[MPV-EXT] Found system mpv: {}", path);
                return Some(path.to_string());
            }
        }
        None
    }
}

/// External mpv process with IPC control
pub struct ExternalMpv {
    process: Child,
    ipc: Arc<MpvIpcClient>,
    shutdown: Arc<AtomicBool>,
    #[allow(dead_code)]
    reader_handle: std::thread::JoinHandle<()>,
}

impl ExternalMpv {
    /// Spawn mpv embedded in a window (Windows with --wid)
    #[cfg(target_os = "windows")]
    pub fn new_embedded(window: &tauri::WebviewWindow, app: AppHandle) -> Result<Self, String> {
        let hwnd = get_hwnd(window)?;
        log::info!("[MPV-EXT] Got HWND: {}", hwnd);

        let mpv_path = find_mpv_binary(&app)
            .ok_or_else(|| "mpv not found - install mpv or check bundled resources".to_string())?;
        log::info!("[MPV-EXT] Using mpv: {}", mpv_path);

        let socket_path = get_socket_path();
        log::info!("[MPV-EXT] Socket path: {}", socket_path);

        // Re-enabling --wid now that reader thread is disabled
        let args = vec![
            format!("--input-ipc-server={}", socket_path),
            format!("--wid={}", hwnd),
            "--no-osc".to_string(),
            "--no-osd-bar".to_string(),
            "--osd-level=0".to_string(),
            "--keep-open=yes".to_string(),
            "--idle=yes".to_string(),
            "--input-default-bindings=no".to_string(),
            "--no-input-cursor".to_string(),
            "--cursor-autohide=no".to_string(),
            "--no-terminal".to_string(),
            "--really-quiet".to_string(),
            "--hwdec=auto".to_string(),
            "--vo=gpu".to_string(),
            "--tone-mapping=mobius".to_string(),
        ];

        log::info!("[MPV-EXT] Starting with args: {:?}", args);

        let process = Command::new(&mpv_path)
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn mpv: {}", e))?;

        log::info!("[MPV-EXT] mpv process spawned, PID: {}", process.id());

        // Wait for socket to be available
        std::thread::sleep(Duration::from_millis(500));

        // Connect IPC
        let ipc = Arc::new(MpvIpcClient::connect(&socket_path)?);
        let shutdown = Arc::new(AtomicBool::new(false));

        // WINDOWS: Skip reader thread - cloned pipe handle causes app hang
        // The reader thread blocking on read somehow affects the main thread
        // Commands still work via send_command_async, just no property events
        log::warn!("[MPV-EXT] Windows: Skipping reader thread (causes app hang)");
        let reader_handle = std::thread::spawn(|| {});

        // Skip observe_property since we have no reader to process responses
        log::info!("[MPV-EXT] Windows: Skipping property observers");

        log::info!("[MPV-EXT] Initialized successfully (limited mode)");

        // Emit ready event
        let _ = app.emit("mpv-ready", true);

        Ok(Self {
            process,
            ipc,
            shutdown,
            reader_handle,
        })
    }

    /// Spawn mpv as standalone window (Linux power-user mode)
    #[cfg(target_os = "linux")]
    pub fn new_standalone(app: AppHandle) -> Result<Self, String> {
        let mpv_path = find_mpv_binary(&app)
            .ok_or_else(|| "mpv not found - install via package manager".to_string())?;
        log::info!("[MPV-EXT] Using mpv: {}", mpv_path);

        let socket_path = get_socket_path();
        log::info!("[MPV-EXT] Socket path: {}", socket_path);

        // Clean up old socket if exists
        let _ = std::fs::remove_file(&socket_path);

        let args = vec![
            format!("--input-ipc-server={}", socket_path),
            "--no-osc".to_string(),
            "--osd-level=1".to_string(),
            "--keep-open=yes".to_string(),
            "--idle=yes".to_string(),
            "--hwdec=auto".to_string(),
            "--vo=gpu".to_string(),
            "--tone-mapping=mobius".to_string(),
            "--title=sbtlTV Player".to_string(),
        ];

        log::info!("[MPV-EXT] Starting standalone with args: {:?}", args);

        let process = Command::new(&mpv_path)
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn mpv: {}", e))?;

        log::info!("[MPV-EXT] mpv process spawned, PID: {}", process.id());

        // Wait for socket to be available
        std::thread::sleep(Duration::from_millis(500));

        // Connect IPC
        let ipc = Arc::new(MpvIpcClient::connect(&socket_path)?);
        let shutdown = Arc::new(AtomicBool::new(false));

        // Start reader thread for events
        let ipc_clone = ipc.clone();
        let app_clone = app.clone();
        let shutdown_clone = shutdown.clone();
        let reader_handle = start_reader_thread(&socket_path, ipc_clone.clone(), move |event| {
            if shutdown_clone.load(Ordering::SeqCst) {
                return;
            }
            handle_mpv_event(&app_clone, event);
        })?;

        // Observe properties
        ipc.observe_property(1, "pause")?;
        ipc.observe_property(2, "volume")?;
        ipc.observe_property(3, "mute")?;
        ipc.observe_property(4, "time-pos")?;
        ipc.observe_property(5, "duration")?;

        log::info!("[MPV-EXT] Initialized successfully (standalone mode)");

        // Emit ready event
        let _ = app.emit("mpv-ready", true);

        Ok(Self {
            process,
            ipc,
            shutdown,
            reader_handle,
        })
    }

    /// Load a media file
    pub fn load(&self, url: &str) -> MpvResult {
        match self.ipc.send_command(&["loadfile", url]) {
            Ok(resp) if resp.error == "success" => MpvResult::ok(),
            Ok(resp) => MpvResult::err(resp.error),
            Err(e) => MpvResult::err(e),
        }
    }

    /// Start playback
    pub fn play(&self) -> MpvResult {
        match self.ipc.set_property("pause", "no") {
            Ok(_) => MpvResult::ok(),
            Err(e) => MpvResult::err(e),
        }
    }

    /// Pause playback
    pub fn pause(&self) -> MpvResult {
        match self.ipc.set_property("pause", "yes") {
            Ok(_) => MpvResult::ok(),
            Err(e) => MpvResult::err(e),
        }
    }

    /// Toggle pause state
    pub fn toggle_pause(&self) -> MpvResult {
        match self.ipc.send_command(&["cycle", "pause"]) {
            Ok(resp) if resp.error == "success" => MpvResult::ok(),
            Ok(resp) => MpvResult::err(resp.error),
            Err(e) => MpvResult::err(e),
        }
    }

    /// Stop playback
    pub fn stop(&self) -> MpvResult {
        match self.ipc.send_command(&["stop"]) {
            Ok(resp) if resp.error == "success" => MpvResult::ok(),
            Ok(resp) => MpvResult::err(resp.error),
            Err(e) => MpvResult::err(e),
        }
    }

    /// Set volume (0-100)
    pub fn set_volume(&self, volume: f64) -> MpvResult {
        match self.ipc.set_property("volume", &volume.to_string()) {
            Ok(_) => MpvResult::ok(),
            Err(e) => MpvResult::err(e),
        }
    }

    /// Toggle mute
    pub fn toggle_mute(&self) -> MpvResult {
        match self.ipc.send_command(&["cycle", "mute"]) {
            Ok(resp) if resp.error == "success" => MpvResult::ok(),
            Ok(resp) => MpvResult::err(resp.error),
            Err(e) => MpvResult::err(e),
        }
    }

    /// Seek to position (seconds)
    pub fn seek(&self, seconds: f64) -> MpvResult {
        match self.ipc.send_command(&["seek", &seconds.to_string(), "absolute"]) {
            Ok(resp) if resp.error == "success" => MpvResult::ok(),
            Ok(resp) => MpvResult::err(resp.error),
            Err(e) => MpvResult::err(e),
        }
    }

    /// Get current status
    pub fn get_status(&self) -> MpvStatus {
        let playing = self.ipc.get_property("pause")
            .ok()
            .flatten()
            .and_then(|v| v.as_bool())
            .map(|paused| !paused)
            .unwrap_or(false);

        let volume = self.ipc.get_property("volume")
            .ok()
            .flatten()
            .and_then(|v| v.as_f64())
            .unwrap_or(100.0);

        let muted = self.ipc.get_property("mute")
            .ok()
            .flatten()
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let position = self.ipc.get_property("time-pos")
            .ok()
            .flatten()
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        let duration = self.ipc.get_property("duration")
            .ok()
            .flatten()
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        MpvStatus {
            playing,
            volume,
            muted,
            position,
            duration,
        }
    }
}

impl Drop for ExternalMpv {
    fn drop(&mut self) {
        log::info!("[MPV-EXT] Shutting down...");
        self.shutdown.store(true, Ordering::SeqCst);
        let _ = self.ipc.send_command_async(&["quit"]);
        let _ = self.process.kill();

        // Clean up socket on Unix
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            let socket_path = get_socket_path();
            let _ = std::fs::remove_file(&socket_path);
        }
    }
}

/// Get HWND from Tauri window (Windows only)
#[cfg(target_os = "windows")]
fn get_hwnd(window: &tauri::WebviewWindow) -> Result<isize, String> {
    let handle = window.window_handle()
        .map_err(|e| format!("Failed to get window handle: {}", e))?;

    match handle.as_raw() {
        RawWindowHandle::Win32(win32) => {
            Ok(win32.hwnd.get() as isize)
        }
        _ => Err("Not a Win32 window".to_string()),
    }
}

/// Handle mpv property change events
fn handle_mpv_event(app: &AppHandle, event: MpvEvent) {
    if event.event != "property-change" {
        return;
    }

    // Build status from event data
    // Note: We emit individual events for now, could batch into status updates
    if let Some(name) = &event.name {
        match name.as_str() {
            "pause" | "volume" | "mute" | "time-pos" | "duration" => {
                // Emit generic status update - frontend should request full status
                // This is simpler than tracking state in the backend
                let _ = app.emit("mpv-property-change", ());
            }
            _ => {}
        }
    }
}

/// State holder for external mpv (managed by Tauri)
pub struct ExternalMpvState {
    pub mpv: Option<ExternalMpv>,
}

impl ExternalMpvState {
    pub fn new() -> Self {
        Self { mpv: None }
    }
}

use serde::Serialize;

#[derive(Serialize)]
pub struct PlatformInfo {
    pub is_windows: bool,
    pub is_mac: bool,
    pub is_linux: bool,
}

#[tauri::command]
pub fn get_platform() -> PlatformInfo {
    PlatformInfo {
        is_windows: cfg!(target_os = "windows"),
        is_mac: cfg!(target_os = "macos"),
        is_linux: cfg!(target_os = "linux"),
    }
}

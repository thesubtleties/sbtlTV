use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn window_minimize(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_maximize(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn window_close(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_get_size(app: AppHandle) -> Result<(u32, u32), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    Ok((size.width, size.height))
}

#[tauri::command]
pub fn window_set_size(app: AppHandle, width: u32, height: u32) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    let w = width.max(640);
    let h = height.max(620);
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize { width: w, height: h }))
        .map_err(|e| e.to_string())
}

use tauri::Manager;

mod fetch_proxy;
mod mpv;
mod platform;
mod storage;
mod window_cmds;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            // Initialize shared reqwest client for fetch proxy
            let client = reqwest::Client::builder()
                .user_agent("sbtlTV/0.1.0")
                .build()
                .expect("Failed to create HTTP client");
            app.manage(fetch_proxy::HttpClient(client));

            // Initialize storage
            storage::init(app)?;

            // Initialize mpv with offscreen rendering
            let handle = app.handle().clone();
            eprintln!("[sbtlTV] Initializing mpv...");
            match mpv::init_mpv(&handle) {
                Ok(()) => eprintln!("[sbtlTV] mpv initialized successfully"),
                Err(e) => eprintln!("[sbtlTV] mpv init FAILED: {}", e),
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Window commands
            window_cmds::window_minimize,
            window_cmds::window_maximize,
            window_cmds::window_close,
            window_cmds::window_get_size,
            window_cmds::window_set_size,
            // Platform
            platform::get_platform,
            // Storage
            storage::get_sources,
            storage::get_source,
            storage::save_source,
            storage::delete_source,
            storage::get_settings,
            storage::update_settings,
            storage::is_encryption_available,
            storage::import_m3u_file,
            // Fetch proxy
            fetch_proxy::fetch_proxy,
            fetch_proxy::fetch_binary,
            // mpv
            mpv::mpv_load,
            mpv::mpv_play,
            mpv::mpv_pause,
            mpv::mpv_toggle_pause,
            mpv::mpv_stop,
            mpv::mpv_set_volume,
            mpv::mpv_toggle_mute,
            mpv::mpv_seek,
            mpv::mpv_get_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

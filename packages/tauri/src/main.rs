#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::io::Write;

fn main() {
    // Set up file logging for debugging (writes to user's home directory)
    let log_path = dirs::home_dir()
        .map(|p| p.join("sbtltv-debug.log"))
        .unwrap_or_else(|| std::path::PathBuf::from("sbtltv-debug.log"));

    if let Ok(file) = File::create(&log_path) {
        let _ = writeln!(&file, "=== sbtlTV starting ===");
        env_logger::Builder::from_default_env()
            .target(env_logger::Target::Pipe(Box::new(file)))
            .filter_level(log::LevelFilter::Info)
            .init();
        log::info!("Logging to {:?}", log_path);
    } else {
        // Fallback to default (stderr)
        env_logger::init();
    }

    sbtltv::run()
}

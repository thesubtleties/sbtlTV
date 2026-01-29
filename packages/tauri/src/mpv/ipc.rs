//! IPC client for communicating with external mpv process.
//!
//! Windows: Named pipes (\\.\pipe\mpv-socket-{pid})
//! Linux: Unix sockets (/tmp/mpv-socket-{pid})

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;

#[cfg(target_os = "windows")]
use std::fs::OpenOptions;
#[cfg(target_os = "windows")]
use std::os::windows::fs::OpenOptionsExt;

#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::os::unix::net::UnixStream;

/// JSON-IPC message sent to mpv
#[derive(Serialize)]
struct MpvCommand {
    command: Vec<Value>,
    request_id: u64,
}

/// JSON-IPC response from mpv
#[derive(Deserialize, Debug)]
pub struct MpvResponse {
    pub error: String,
    pub data: Option<Value>,
    pub request_id: Option<u64>,
}

/// Property change event from mpv
#[derive(Deserialize, Debug, Clone)]
pub struct MpvPropertyChange {
    pub name: String,
    pub data: Option<Value>,
}

/// Event from mpv
#[derive(Deserialize, Debug)]
pub struct MpvEvent {
    pub event: String,
    pub name: Option<String>,
    pub data: Option<Value>,
    pub id: Option<u64>,
}

/// Thread-safe IPC client for mpv
pub struct MpvIpcClient {
    request_id: AtomicU64,
    #[cfg(target_os = "windows")]
    writer: Arc<Mutex<std::fs::File>>,
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    writer: Arc<Mutex<UnixStream>>,
    pending: Arc<Mutex<HashMap<u64, std::sync::mpsc::Sender<MpvResponse>>>>,
}

impl MpvIpcClient {
    /// Connect to mpv's IPC socket
    pub fn connect(socket_path: &str) -> Result<Self, String> {
        log::info!("[MPV-IPC] Connecting to {}", socket_path);

        #[cfg(target_os = "windows")]
        let stream = {
            // Windows named pipe - need to open with specific flags
            OpenOptions::new()
                .read(true)
                .write(true)
                .custom_flags(0) // Default flags work for named pipes
                .open(socket_path)
                .map_err(|e| format!("Failed to connect to mpv pipe: {}", e))?
        };

        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let stream = UnixStream::connect(socket_path)
            .map_err(|e| format!("Failed to connect to mpv socket: {}", e))?;

        log::info!("[MPV-IPC] Connected successfully");

        Ok(Self {
            request_id: AtomicU64::new(1),
            writer: Arc::new(Mutex::new(stream)),
            pending: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Send a command to mpv and wait for response
    pub fn send_command(&self, command: &[&str]) -> Result<MpvResponse, String> {
        let request_id = self.request_id.fetch_add(1, Ordering::SeqCst);

        let cmd = MpvCommand {
            command: command.iter().map(|s| Value::String(s.to_string())).collect(),
            request_id,
        };

        let json = serde_json::to_string(&cmd)
            .map_err(|e| format!("Failed to serialize command: {}", e))?;

        // Create response channel
        let (tx, rx) = std::sync::mpsc::channel();
        {
            let mut pending = self.pending.lock().unwrap();
            pending.insert(request_id, tx);
        }

        // Send command
        {
            let mut writer = self.writer.lock().unwrap();
            writeln!(writer, "{}", json)
                .map_err(|e| format!("Failed to send command: {}", e))?;
            writer.flush()
                .map_err(|e| format!("Failed to flush: {}", e))?;
        }

        // Wait for response (with timeout)
        rx.recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "Command timeout".to_string())
    }

    /// Send a command without waiting for response
    pub fn send_command_async(&self, command: &[&str]) -> Result<(), String> {
        let request_id = self.request_id.fetch_add(1, Ordering::SeqCst);

        let cmd = MpvCommand {
            command: command.iter().map(|s| Value::String(s.to_string())).collect(),
            request_id,
        };

        let json = serde_json::to_string(&cmd)
            .map_err(|e| format!("Failed to serialize command: {}", e))?;

        let mut writer = self.writer.lock().unwrap();
        writeln!(writer, "{}", json)
            .map_err(|e| format!("Failed to send command: {}", e))?;
        writer.flush()
            .map_err(|e| format!("Failed to flush: {}", e))?;

        Ok(())
    }

    /// Observe a property for changes
    pub fn observe_property(&self, id: u64, property: &str) -> Result<(), String> {
        self.send_command_async(&["observe_property", &id.to_string(), property])
    }

    /// Get a property value
    pub fn get_property(&self, property: &str) -> Result<Option<Value>, String> {
        let response = self.send_command(&["get_property", property])?;
        if response.error == "success" {
            Ok(response.data)
        } else {
            Err(response.error)
        }
    }

    /// Set a property value
    pub fn set_property(&self, property: &str, value: &str) -> Result<(), String> {
        let response = self.send_command(&["set_property", property, value])?;
        if response.error == "success" {
            Ok(())
        } else {
            Err(response.error)
        }
    }

    /// Handle an incoming response (called from reader thread)
    pub fn handle_response(&self, response: MpvResponse) {
        if let Some(request_id) = response.request_id {
            let mut pending = self.pending.lock().unwrap();
            if let Some(tx) = pending.remove(&request_id) {
                let _ = tx.send(response);
            }
        }
    }
}

/// Start a reader thread that processes mpv messages
pub fn start_reader_thread<F>(
    socket_path: &str,
    ipc: Arc<MpvIpcClient>,
    mut on_event: F,
) -> Result<std::thread::JoinHandle<()>, String>
where
    F: FnMut(MpvEvent) + Send + 'static,
{
    #[cfg(target_os = "windows")]
    let stream = OpenOptions::new()
        .read(true)
        .open(socket_path)
        .map_err(|e| format!("Failed to open mpv pipe for reading: {}", e))?;

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    let stream = UnixStream::connect(socket_path)
        .map_err(|e| format!("Failed to connect to mpv socket for reading: {}", e))?;

    let handle = std::thread::spawn(move || {
        let reader = BufReader::new(stream);

        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(e) => {
                    log::error!("[MPV-IPC] Read error: {}", e);
                    break;
                }
            };

            if line.is_empty() {
                continue;
            }

            // Try parsing as event first
            if let Ok(event) = serde_json::from_str::<MpvEvent>(&line) {
                if event.event == "property-change" {
                    on_event(event);
                }
            }
            // Try parsing as response
            else if let Ok(response) = serde_json::from_str::<MpvResponse>(&line) {
                ipc.handle_response(response);
            }
        }

        log::info!("[MPV-IPC] Reader thread exiting");
    });

    Ok(handle)
}

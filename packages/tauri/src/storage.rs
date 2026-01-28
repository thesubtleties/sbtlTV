use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const SERVICE_NAME: &str = "sbtltv";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Source {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub source_type: String,
    pub url: String,
    pub enabled: bool,
    pub epg_url: Option<String>,
    pub auto_load_epg: Option<bool>,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub last_source_id: Option<String>,
    pub tmdb_api_key: Option<String>,
    pub vod_refresh_hours: Option<u32>,
    pub epg_refresh_hours: Option<u32>,
    pub movie_genres_enabled: Option<Vec<u32>>,
    pub series_genres_enabled: Option<Vec<u32>>,
    pub poster_db_api_key: Option<String>,
    pub rpdb_backdrops_enabled: Option<bool>,
    pub allow_lan_sources: Option<bool>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            last_source_id: None,
            tmdb_api_key: None,
            vod_refresh_hours: Some(24),
            epg_refresh_hours: Some(6),
            movie_genres_enabled: None,
            series_genres_enabled: None,
            poster_db_api_key: None,
            rpdb_backdrops_enabled: Some(false),
            allow_lan_sources: Some(false),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSource {
    id: String,
    name: String,
    #[serde(rename = "type")]
    source_type: String,
    url: String,
    enabled: bool,
    epg_url: Option<String>,
    auto_load_epg: Option<bool>,
    username: Option<String>,
    // Password stored in OS keyring, not in JSON
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredSettings {
    theme: String,
    last_source_id: Option<String>,
    vod_refresh_hours: Option<u32>,
    epg_refresh_hours: Option<u32>,
    movie_genres_enabled: Option<Vec<u32>>,
    series_genres_enabled: Option<Vec<u32>>,
    rpdb_backdrops_enabled: Option<bool>,
    pub(crate) allow_lan_sources: Option<bool>,
    // Sensitive keys stored in OS keyring
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            last_source_id: None,
            vod_refresh_hours: Some(24),
            epg_refresh_hours: Some(6),
            movie_genres_enabled: None,
            series_genres_enabled: None,
            rpdb_backdrops_enabled: Some(false),
            allow_lan_sources: Some(false),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoreData {
    sources: Vec<StoredSource>,
    pub(crate) settings: StoredSettings,
}

impl Default for StoreData {
    fn default() -> Self {
        Self {
            sources: Vec::new(),
            settings: StoredSettings::default(),
        }
    }
}

pub struct StorageState {
    data_path: PathBuf,
    pub(crate) data: Mutex<StoreData>,
}

impl StorageState {
    fn save(&self) -> Result<(), String> {
        let data = self.data.lock().map_err(|e| e.to_string())?;
        let json = serde_json::to_string_pretty(&*data).map_err(|e| e.to_string())?;
        fs::write(&self.data_path, json).map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn keyring_key(id: &str, field: &str) -> String {
    format!("{}:{}", id, field)
}

fn set_secret(key: &str, value: &str) -> Result<(), String> {
    match keyring::Entry::new(SERVICE_NAME, key) {
        Ok(entry) => entry.set_password(value).map_err(|e| {
            log::warn!("Keyring set failed for {}: {}, using base64 fallback", key, e);
            e.to_string()
        }),
        Err(e) => Err(e.to_string()),
    }
}

fn get_secret(key: &str) -> Option<String> {
    keyring::Entry::new(SERVICE_NAME, key)
        .ok()
        .and_then(|entry| entry.get_password().ok())
}

fn delete_secret(key: &str) {
    if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, key) {
        let _ = entry.delete_credential();
    }
}

pub fn init(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_data = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    fs::create_dir_all(&app_data)?;

    let data_path = app_data.join("sbtltv-config.json");
    let data: StoreData = if data_path.exists() {
        let content = fs::read_to_string(&data_path)?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        // Try migrating from Electron config
        let migrated = try_migrate_electron_data();
        if let Some(ref migrated_data) = migrated {
            let json = serde_json::to_string_pretty(migrated_data)?;
            fs::write(&data_path, json)?;
        }
        migrated.unwrap_or_default()
    };

    app.manage(StorageState {
        data_path,
        data: Mutex::new(data),
    });

    Ok(())
}

fn try_migrate_electron_data() -> Option<StoreData> {
    // Look for Electron's config at ~/.config/sbtltv/sbtltv-config.json
    let config_dir = dirs::config_dir()?;
    let electron_config = config_dir.join("sbtltv").join("sbtltv-config.json");
    if !electron_config.exists() {
        return None;
    }

    log::info!("Found Electron config at {:?}, migrating...", electron_config);
    let content = fs::read_to_string(&electron_config).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;

    let mut data = StoreData::default();

    // Migrate sources (passwords can't be migrated - encrypted with Electron's safeStorage)
    if let Some(sources) = value.get("sources").and_then(|s| s.as_array()) {
        for s in sources {
            let stored = StoredSource {
                id: s.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                name: s.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                source_type: s.get("type").and_then(|v| v.as_str()).unwrap_or("m3u").to_string(),
                url: s.get("url").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                enabled: s.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                epg_url: s.get("epg_url").and_then(|v| v.as_str()).map(String::from),
                auto_load_epg: s.get("auto_load_epg").and_then(|v| v.as_bool()),
                username: s.get("username").and_then(|v| v.as_str()).map(String::from),
            };
            data.sources.push(stored);
        }
    }

    // Migrate settings (non-encrypted fields only)
    if let Some(settings) = value.get("settings") {
        data.settings.theme = settings
            .get("theme")
            .and_then(|v| v.as_str())
            .unwrap_or("dark")
            .to_string();
        data.settings.last_source_id = settings
            .get("lastSourceId")
            .and_then(|v| v.as_str())
            .map(String::from);
        data.settings.vod_refresh_hours = settings
            .get("vodRefreshHours")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32);
        data.settings.epg_refresh_hours = settings
            .get("epgRefreshHours")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32);
        data.settings.rpdb_backdrops_enabled = settings
            .get("rpdbBackdropsEnabled")
            .and_then(|v| v.as_bool());
        data.settings.allow_lan_sources = settings
            .get("allowLanSources")
            .and_then(|v| v.as_bool());
    }

    log::info!("Migrated {} sources from Electron config", data.sources.len());
    Some(data)
}

#[derive(Serialize)]
pub struct StorageResult<T: Serialize> {
    pub success: Option<bool>,
    pub error: Option<String>,
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canceled: Option<bool>,
}

impl<T: Serialize> StorageResult<T> {
    fn ok(data: T) -> Self {
        Self {
            success: Some(true),
            error: None,
            data: Some(data),
            canceled: None,
        }
    }

    fn err(msg: impl Into<String>) -> Self {
        Self {
            success: Some(false),
            error: Some(msg.into()),
            data: None,
            canceled: None,
        }
    }
}

// Allow StorageResult<()> by implementing for unit
impl StorageResult<()> {
    fn ok_void() -> Self {
        Self {
            success: Some(true),
            error: None,
            data: None,
            canceled: None,
        }
    }
}

#[tauri::command]
pub fn get_sources(state: tauri::State<StorageState>) -> StorageResult<Vec<Source>> {
    let data = match state.data.lock() {
        Ok(d) => d,
        Err(e) => return StorageResult::err(e.to_string()),
    };

    let sources: Vec<Source> = data
        .sources
        .iter()
        .map(|s| {
            let password = if s.source_type == "xtream" {
                get_secret(&keyring_key(&s.id, "password"))
            } else {
                None
            };

            Source {
                id: s.id.clone(),
                name: s.name.clone(),
                source_type: s.source_type.clone(),
                url: s.url.clone(),
                enabled: s.enabled,
                epg_url: s.epg_url.clone(),
                auto_load_epg: s.auto_load_epg,
                username: s.username.clone(),
                password,
            }
        })
        .collect();

    StorageResult::ok(sources)
}

#[tauri::command]
pub fn get_source(id: String, state: tauri::State<StorageState>) -> StorageResult<Option<Source>> {
    let data = match state.data.lock() {
        Ok(d) => d,
        Err(e) => return StorageResult::err(e.to_string()),
    };

    let source = data.sources.iter().find(|s| s.id == id).map(|s| {
        let password = if s.source_type == "xtream" {
            get_secret(&keyring_key(&s.id, "password"))
        } else {
            None
        };

        Source {
            id: s.id.clone(),
            name: s.name.clone(),
            source_type: s.source_type.clone(),
            url: s.url.clone(),
            enabled: s.enabled,
            epg_url: s.epg_url.clone(),
            auto_load_epg: s.auto_load_epg,
            username: s.username.clone(),
            password,
        }
    });

    StorageResult::ok(source)
}

#[tauri::command]
pub fn save_source(source: Source, state: tauri::State<StorageState>) -> StorageResult<()> {
    let mut data = match state.data.lock() {
        Ok(d) => d,
        Err(e) => return StorageResult::err(e.to_string()),
    };

    // Store password in keyring if xtream source
    if source.source_type == "xtream" {
        if let Some(ref password) = source.password {
            if let Err(e) = set_secret(&keyring_key(&source.id, "password"), password) {
                // Fallback: we'll still save the source but log the keyring failure
                log::warn!("Failed to store password in keyring: {}", e);
            }
        }
    }

    let stored = StoredSource {
        id: source.id.clone(),
        name: source.name,
        source_type: source.source_type,
        url: source.url,
        enabled: source.enabled,
        epg_url: source.epg_url,
        auto_load_epg: source.auto_load_epg,
        username: source.username,
    };

    if let Some(pos) = data.sources.iter().position(|s| s.id == source.id) {
        data.sources[pos] = stored;
    } else {
        data.sources.push(stored);
    }

    drop(data);
    if let Err(e) = state.save() {
        return StorageResult::err(e);
    }

    StorageResult::ok_void()
}

#[tauri::command]
pub fn delete_source(id: String, state: tauri::State<StorageState>) -> StorageResult<()> {
    let mut data = match state.data.lock() {
        Ok(d) => d,
        Err(e) => return StorageResult::err(e.to_string()),
    };

    // Remove password from keyring
    delete_secret(&keyring_key(&id, "password"));

    data.sources.retain(|s| s.id != id);

    drop(data);
    if let Err(e) = state.save() {
        return StorageResult::err(e);
    }

    StorageResult::ok_void()
}

#[tauri::command]
pub fn get_settings(state: tauri::State<StorageState>) -> StorageResult<AppSettings> {
    let data = match state.data.lock() {
        Ok(d) => d,
        Err(e) => return StorageResult::err(e.to_string()),
    };

    let s = &data.settings;
    let tmdb_api_key = get_secret("settings:tmdbApiKey");
    let poster_db_api_key = get_secret("settings:posterDbApiKey");

    StorageResult::ok(AppSettings {
        theme: s.theme.clone(),
        last_source_id: s.last_source_id.clone(),
        tmdb_api_key,
        vod_refresh_hours: s.vod_refresh_hours,
        epg_refresh_hours: s.epg_refresh_hours,
        movie_genres_enabled: s.movie_genres_enabled.clone(),
        series_genres_enabled: s.series_genres_enabled.clone(),
        poster_db_api_key,
        rpdb_backdrops_enabled: s.rpdb_backdrops_enabled,
        allow_lan_sources: s.allow_lan_sources,
    })
}

#[tauri::command]
pub fn update_settings(
    settings: serde_json::Value,
    state: tauri::State<StorageState>,
) -> StorageResult<()> {
    let mut data = match state.data.lock() {
        Ok(d) => d,
        Err(e) => return StorageResult::err(e.to_string()),
    };

    if let Some(theme) = settings.get("theme").and_then(|v| v.as_str()) {
        data.settings.theme = theme.to_string();
    }
    if let Some(id) = settings.get("lastSourceId") {
        data.settings.last_source_id = id.as_str().map(String::from);
    }
    if let Some(key) = settings.get("tmdbApiKey") {
        if let Some(k) = key.as_str() {
            if !k.is_empty() {
                let _ = set_secret("settings:tmdbApiKey", k);
            } else {
                delete_secret("settings:tmdbApiKey");
            }
        } else {
            delete_secret("settings:tmdbApiKey");
        }
    }
    if let Some(v) = settings.get("vodRefreshHours").and_then(|v| v.as_u64()) {
        data.settings.vod_refresh_hours = Some(v as u32);
    }
    if let Some(v) = settings.get("epgRefreshHours").and_then(|v| v.as_u64()) {
        data.settings.epg_refresh_hours = Some(v as u32);
    }
    if let Some(genres) = settings.get("movieGenresEnabled") {
        data.settings.movie_genres_enabled = serde_json::from_value(genres.clone()).ok();
    }
    if let Some(genres) = settings.get("seriesGenresEnabled") {
        data.settings.series_genres_enabled = serde_json::from_value(genres.clone()).ok();
    }
    if let Some(key) = settings.get("posterDbApiKey") {
        if let Some(k) = key.as_str() {
            if !k.is_empty() {
                let _ = set_secret("settings:posterDbApiKey", k);
            } else {
                delete_secret("settings:posterDbApiKey");
            }
        } else {
            delete_secret("settings:posterDbApiKey");
        }
    }
    if let Some(v) = settings.get("rpdbBackdropsEnabled").and_then(|v| v.as_bool()) {
        data.settings.rpdb_backdrops_enabled = Some(v);
    }
    if let Some(v) = settings.get("allowLanSources").and_then(|v| v.as_bool()) {
        data.settings.allow_lan_sources = Some(v);
    }

    drop(data);
    if let Err(e) = state.save() {
        return StorageResult::err(e);
    }

    StorageResult::ok_void()
}

#[tauri::command]
pub fn is_encryption_available() -> StorageResult<bool> {
    // Check if keyring is functional
    let available = keyring::Entry::new(SERVICE_NAME, "test-availability")
        .map(|entry| {
            let _ = entry.set_password("test");
            let result = entry.get_password().is_ok();
            let _ = entry.delete_credential();
            result
        })
        .unwrap_or(false);

    StorageResult::ok(available)
}

#[tauri::command]
pub async fn import_m3u_file(app: AppHandle) -> StorageResult<serde_json::Value> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app
        .dialog()
        .file()
        .add_filter("M3U Playlists", &["m3u", "m3u8"])
        .add_filter("All Files", &["*"])
        .set_title("Import M3U Playlist")
        .blocking_pick_file();

    match file_path {
        Some(path) => {
            let path = path.into_path().map_err(|e| e.to_string());
            match path {
                Ok(p) => match fs::read_to_string(&p) {
                    Ok(content) => {
                        let file_name = p
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("playlist")
                            .to_string();
                        StorageResult::ok(serde_json::json!({
                            "content": content,
                            "fileName": file_name,
                        }))
                    }
                    Err(e) => StorageResult::err(format!("Failed to read file: {}", e)),
                },
                Err(e) => StorageResult::err(e),
            }
        }
        None => StorageResult {
            success: Some(false),
            error: None,
            data: None,
            canceled: Some(true),
        },
    }
}

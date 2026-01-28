use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use url::Url;

pub struct HttpClient(pub Client);

#[derive(Serialize)]
pub struct StorageResult<T: Serialize> {
    pub success: Option<bool>,
    pub error: Option<String>,
    pub data: Option<T>,
}

impl<T: Serialize> StorageResult<T> {
    fn ok(data: T) -> Self {
        Self {
            success: Some(true),
            error: None,
            data: Some(data),
        }
    }

    fn err(msg: impl Into<String>) -> Self {
        Self {
            success: Some(false),
            error: Some(msg.into()),
            data: None,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchProxyResponse {
    pub ok: bool,
    pub status: u16,
    pub status_text: String,
    pub text: String,
}

#[derive(Deserialize)]
pub struct FetchOptions {
    pub method: Option<String>,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub body: Option<String>,
}

const ALLOWED_BINARY_FETCH_DOMAINS: &[&str] = &["files.tmdb.org"];

fn is_allowed_binary_url(url: &str) -> bool {
    Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .map(|host| {
            ALLOWED_BINARY_FETCH_DOMAINS
                .iter()
                .any(|d| host == *d || host.ends_with(&format!(".{}", d)))
        })
        .unwrap_or(false)
}

fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.octets()[0] == 169 && v4.octets()[1] == 254 // link-local / metadata
        }
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

fn is_blocked_url(url: &str) -> bool {
    let parsed = match Url::parse(url) {
        Ok(u) => u,
        Err(_) => return true, // Block unparseable URLs
    };

    // Block file:// protocol
    if parsed.scheme() == "file" {
        return true;
    }

    let host = match parsed.host_str() {
        Some(h) => h,
        None => return true,
    };

    // Block localhost
    if host == "localhost" {
        return true;
    }

    // Check if host is a raw IP
    if let Ok(ip) = host.parse::<IpAddr>() {
        return is_private_ip(&ip);
    }

    // Also check bracket-wrapped IPv6
    let stripped = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = stripped.parse::<IpAddr>() {
        return is_private_ip(&ip);
    }

    false
}

async fn check_dns_rebinding(url: &str) -> Result<bool, String> {
    let parsed = Url::parse(url).map_err(|e| e.to_string())?;
    let host = parsed.host_str().ok_or("No host")?;

    // Skip IP addresses (already checked)
    if host.parse::<IpAddr>().is_ok() {
        return Ok(false);
    }

    // Resolve DNS and check if it points to private IPs
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addr_str = format!("{}:{}", host, port);
    let resolved: Result<Vec<std::net::SocketAddr>, _> =
        tokio::net::lookup_host(&addr_str).await.map(|addrs| addrs.collect());
    match resolved {
        Ok(addrs) => {
            for addr in addrs {
                if is_private_ip(&addr.ip()) {
                    return Ok(true); // DNS rebinding detected
                }
            }
            Ok(false)
        }
        Err(_) => Ok(false), // If DNS resolution fails, let reqwest handle it
    }
}

#[tauri::command]
pub async fn fetch_proxy(
    url: String,
    options: Option<FetchOptions>,
    client: tauri::State<'_, HttpClient>,
    storage: tauri::State<'_, crate::storage::StorageState>,
) -> Result<StorageResult<FetchProxyResponse>, ()> {
    // Check SSRF protection
    let allow_lan = {
        let data = storage.data.lock().unwrap();
        data.settings.allow_lan_sources.unwrap_or(false)
    };

    if !allow_lan {
        if is_blocked_url(&url) {
            return Ok(StorageResult::err(
                "Blocked: Local network access is disabled. Enable \"Allow LAN sources\" in Settings > Security if you trust this source.",
            ));
        }

        // DNS rebinding check
        match check_dns_rebinding(&url).await {
            Ok(true) => {
                return Ok(StorageResult::err(
                    "Blocked: DNS resolves to a private IP address (possible DNS rebinding attack).",
                ));
            }
            Ok(false) => {}
            Err(_) => {} // Let reqwest handle DNS errors
        }
    }

    let method = options
        .as_ref()
        .and_then(|o| o.method.as_deref())
        .unwrap_or("GET");

    let mut request = match method.to_uppercase().as_str() {
        "POST" => client.0.post(&url),
        "PUT" => client.0.put(&url),
        "DELETE" => client.0.delete(&url),
        "PATCH" => client.0.patch(&url),
        _ => client.0.get(&url),
    };

    if let Some(ref opts) = options {
        if let Some(ref headers) = opts.headers {
            for (k, v) in headers {
                request = request.header(k.as_str(), v.as_str());
            }
        }
        if let Some(ref body) = opts.body {
            request = request.body(body.clone());
        }
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            let status_text = status.canonical_reason().unwrap_or("").to_string();
            let ok = status.is_success();
            let status_code = status.as_u16();

            match response.text().await {
                Ok(text) => Ok(StorageResult::ok(FetchProxyResponse {
                    ok,
                    status: status_code,
                    status_text,
                    text,
                })),
                Err(e) => Ok(StorageResult::err(format!("Failed to read response: {}", e))),
            }
        }
        Err(e) => Ok(StorageResult::err(format!("Fetch failed: {}", e))),
    }
}

#[tauri::command]
pub async fn fetch_binary(
    url: String,
    client: tauri::State<'_, HttpClient>,
) -> Result<StorageResult<String>, ()> {
    if !is_allowed_binary_url(&url) {
        let host = Url::parse(&url)
            .ok()
            .and_then(|u| u.host_str().map(String::from))
            .unwrap_or_else(|| "unknown".to_string());
        return Ok(StorageResult::err(format!(
            "Domain not allowed for binary fetch: {}",
            host
        )));
    }

    match client.0.get(&url).send().await {
        Ok(response) => {
            if !response.status().is_success() {
                return Ok(StorageResult::err(format!(
                    "HTTP {}: {}",
                    response.status().as_u16(),
                    response.status().canonical_reason().unwrap_or("")
                )));
            }
            match response.bytes().await {
                Ok(bytes) => {
                    use base64::Engine;
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    Ok(StorageResult::ok(encoded))
                }
                Err(e) => Ok(StorageResult::err(format!("Failed to read response: {}", e))),
            }
        }
        Err(e) => Ok(StorageResult::err(format!("Fetch failed: {}", e))),
    }
}

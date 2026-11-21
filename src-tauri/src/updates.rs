use crate::{AppData, Result};
use reqwest::Url;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_updater::UpdaterExt;

const PUBLIC_KEY: Option<&str> = option_env!("PURETUBE_UPDATER_PUBLIC_KEY");
const ENDPOINT: Option<&str> = option_env!("PURETUBE_UPDATER_ENDPOINT");
static INSTALLING: AtomicBool = AtomicBool::new(false);
struct InstallGuard;
impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::Release);
    }
}
fn safe_endpoint(endpoint: &str) -> Option<Url> {
    let url = Url::parse(endpoint).ok()?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    Some(url)
}
pub fn config() -> Option<(&'static str, Url)> {
    let key = PUBLIC_KEY
        .unwrap_or(include_str!("../updater-public-key.pub"))
        .trim();
    if key.is_empty() {
        return None;
    }
    Some((
        key,
        safe_endpoint(ENDPOINT.unwrap_or(
            "https://github.com/SunshiineDolly/Viddy/releases/latest/download/latest.json",
        ))?,
    ))
}
fn client(app: &AppHandle, state: &AppData) -> Result<tauri_plugin_updater::Updater> {
    let (key, mut url) = config()
        .filter(|_| !state.isolated)
        .ok_or("Signed updates are not configured for this build.")?;
    let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()/30;
    url.query_pairs_mut().append_pair("check", &stamp.to_string());
    app.updater_builder()
        .pubkey(key)
        .endpoints(vec![url])
        .map_err(|_| "The updater endpoint is invalid.")?
        .timeout(std::time::Duration::from_secs(20))
        .restart_after_install(true)
        .build()
        .map_err(|_| "The updater could not be initialized.".into())
}
#[tauri::command]
pub fn update_configured(state: State<AppData>) -> bool {
    !state.isolated && config().is_some()
}

#[tauri::command]
pub async fn update_check(app: AppHandle, state: State<'_, AppData>) -> Result<Option<Value>> {
    let updater = client(&app, &state)?;
    let update = updater
        .check()
        .await
        .map_err(|_| "Could not check the signed update feed. Try again later.")?;
    Ok(update.map(|u| json!({"version":u.version,"notes":u.body})))
}

#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    state: State<'_, AppData>,
    version: String,
    progress: Channel<Value>,
) -> Result<()> {
    if INSTALLING.swap(true, Ordering::AcqRel) {
        return Err("An update installation is already in progress.".into());
    }
    let _guard = InstallGuard;
    let mut update = client(&app, &state)?
        .check()
        .await
        .map_err(|_| "Could not verify the selected update.")?
        .ok_or("The update is no longer available.")?;
    if update.version != version {
        return Err("The update feed changed. Check for updates again before installing.".into());
    }
    if safe_endpoint(update.download_url.as_str()).is_none() {
        return Err("The signed update download must use HTTPS.".into());
    }
    update.timeout = Some(std::time::Duration::from_secs(120));
    let mut downloaded = 0u64;
    let bytes = update.download(|chunk, total| {
        downloaded += chunk as u64;
        let _ = progress.send(json!({"event":"downloading","downloaded":downloaded,"total":total}));
    }, || {
        let _ = progress.send(json!({"event":"verifying"}));
    }).await.map_err(|_| "The update could not be downloaded and verified. Nothing was installed. Try again later.")?;
    let _ = progress.send(json!({"event":"installing"}));
    if let Some(downloads) = app.try_state::<crate::downloads::Downloads>() {
        downloads.shutdown();
    }
    update.install(bytes).map_err(|_| "Viddy could not install the update. Try again or download the release from GitHub.")?;
    // The updater launches the Windows installer; macOS needs an explicit relaunch.
    #[cfg(not(windows))]
    app.restart();
    #[cfg(windows)]
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_https_update_manifest_without_credentials_or_fragment() {
        assert!(safe_endpoint(
            "https://github.com/SunshiineDolly/Viddy/releases/latest/download/latest.json"
        )
        .is_some());
        assert!(safe_endpoint("http://example.com/latest.json").is_none());
        assert!(safe_endpoint("https://account:password@example.com/latest.json").is_none());
        assert!(safe_endpoint("https://example.com/latest.json#fragment").is_none());
    }
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod account;
#[cfg(any(target_os = "macos",test))]
mod mac_session;
mod account_callback;
mod comments;
mod desktop;
#[cfg(windows)]
mod audio_branding;
mod downloads;
mod original_player;
#[cfg(any(target_os = "macos", test))]
mod youtube_embed;
mod popout;
mod updates;
mod youtube_search;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;

const MAX_LIBRARY: usize = 4 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;
struct AppData {
    db: PathBuf,
    recovery: Option<PathBuf>,
    library_guard: Mutex<()>,
    client: reqwest::Client,
    isolated: bool,
}

fn database(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path).map_err(|_| "Could not open the local library.")?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);")
        .map_err(|_| "Could not initialize the local library.")?;
    Ok(conn)
}
fn read(path: &Path) -> Result<Option<Value>> {
    let raw: Option<String> = database(path)?
        .query_row("SELECT data FROM library WHERE id=1", [], |row| row.get(0))
        .optional()
        .map_err(|_| "Could not read the local library.")?;
    raw.map(|item| serde_json::from_str(&item).map_err(|_| "The local library is damaged.".into()))
        .transpose()
}
fn write(path: &Path, data: Value) -> Result<()> {
    let raw = data.to_string();
    if data.get("version").and_then(Value::as_u64) != Some(1) || raw.len() > MAX_LIBRARY {
        return Err("The library format or size is unsupported.".into());
    }
    write_snapshot(&database(path)?, &raw)?;
    Ok(())
}

fn write_snapshot(conn: &Connection, raw: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO library VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        params![raw],
    ).map_err(|_| "Could not save the local library.")?;
    Ok(())
}
#[tauri::command]
fn load(state: State<AppData>) -> Result<Option<Value>> {
    account::ensure_visible_profile(&state)?;
    let _guard = state.library_guard.lock().map_err(|_| "Library is busy.")?;
    recover_library(&state.db, state.recovery.as_deref())
}
fn recover_library(primary: &Path, recovery: Option<&Path>) -> Result<Option<Value>> {
    let current = read(primary);
    if let Ok(Some(data)) = &current {
        if let Some(backup) = recovery {
            if let Some(parent) = backup.parent() { let _ = std::fs::create_dir_all(parent); }
            let _ = write(backup, data.clone());
        }
        return current;
    }
    if let Some(backup) = recovery.filter(|p| p.is_file()) {
        if let Ok(Some(data)) = read(backup) {
            // Preserve a damaged database before replacing it with its independent backup.
            if current.is_err() { std::fs::rename(primary, primary.with_extension("damaged.sqlite3")).map_err(|_| "Could not preserve the damaged library.")?; }
            write(primary, data.clone())?;
            return Ok(Some(data));
        }
    }
    current
}
#[tauri::command]
fn library_profile(state: State<AppData>) -> Result<Option<String>> {
    let _guard = state.library_guard.lock().map_err(|_| "Library is busy.")?;
    account::profile_owner(&database(&state.db)?)
}
#[tauri::command]
fn save(app: tauri::AppHandle, state: State<AppData>, data: Value, cloud: Option<account::Binding>, profile: Option<String>) -> Result<()> {
    let _guard = state.library_guard.lock().map_err(|_| "Library is busy.")?;
    account::check_profile(&database(&state.db)?, profile.as_deref())?;
    let show_tray = data
        .pointer("/settings/tray")
        .and_then(Value::as_bool)
        .unwrap_or(false) || data.pointer("/settings/closeToTray").and_then(Value::as_bool).unwrap_or(false);
    if let Some(cloud) = cloud {
        account::save_synced(&state.db, &data, &cloud)?;
    } else {
        write(&state.db, data.clone())?;
    }
    if let Some(recovery) = &state.recovery {
        if let Some(parent) = recovery.parent() { std::fs::create_dir_all(parent).map_err(|_| "Library saved, but its Documents backup folder is unavailable.")?; }
        write(recovery, data).map_err(|_| "Library saved, but its Documents backup could not be updated.")?;
    }
    if let Some(tray) = app.tray_by_id("viddy") {
        let _ = tray.set_visible(show_tray);
    }
    Ok(())
}
#[tauri::command]
async fn public_feed(state: State<'_, AppData>, id: String) -> Result<String> {
    if id.len() != 24
        || !id.starts_with("UC")
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Enter a valid YouTube channel ID (it starts with UC).".into());
    }
    let mut response = state
        .client
        .get("https://www.youtube.com/feeds/videos.xml")
        .query(&[("channel_id", id)])
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|_| "Could not reach YouTube's public feed.")?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            404 => "YouTube has no public feed for this channel. Check the channel ID.",
            429 => "YouTube is rate limiting feed checks. Try again in a few minutes.",
            _ => "YouTube's public feed is temporarily unavailable.",
        }
        .into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read YouTube's public feed.")?
    {
        if bytes.len() + chunk.len() > 1_048_576 {
            return Err("YouTube returned an unexpectedly large feed.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "YouTube returned an unreadable feed.".into())
}

#[tauri::command]
fn open_info(app: tauri::AppHandle, page: String) -> Result<()> {
    let url = match page.as_str() {
        "youtube" => "https://www.youtube.com/",
        "terms" => "https://www.youtube.com/t/terms",
        "privacy" => "https://policies.google.com/privacy",
        _ => return Err("Unknown page.".into()),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Could not open your browser.".into())
}
#[tauri::command]
async fn export_library(app: tauri::AppHandle, data: Value) -> Result<bool> {
    let raw = serde_json::to_vec_pretty(&data).map_err(|_| "Could not format the backup.")?;
    if let Some(FilePath::Path(path)) = app
        .dialog()
        .file()
        .set_file_name("Viddy-library.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file()
    {
        std::fs::write(path, raw).map_err(|_| "Could not write the selected backup file.")?;
        return Ok(true);
    }
    Ok(false)
}
#[tauri::command]
async fn import_library(app: tauri::AppHandle) -> Result<Option<Value>> {
    use std::io::Read;
    if let Some(FilePath::Path(path)) = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
    {
        let file = std::fs::File::open(path).map_err(|_| "Could not open the selected backup.")?;
        let mut bytes = Vec::new();
        file.take((MAX_LIBRARY + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read the selected backup.")?;
        if bytes.len() > MAX_LIBRARY {
            return Err("This backup is too large.".into());
        }
        return serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "This is not a valid JSON backup.".into());
    }
    Ok(None)
}
#[tauri::command]
fn startup(app: tauri::AppHandle, state: State<AppData>, enabled: Option<bool>) -> Result<bool> {
    if state.isolated {
        return Ok(false);
    }
    let manager = app.autolaunch();
    match enabled {
        Some(true) => manager.enable().map_err(|e| e.to_string())?,
        Some(false) => manager.disable().map_err(|e| e.to_string())?,
        None => (),
    }
    manager.is_enabled().map_err(|e| e.to_string())
}
fn main() {
    // A separate profile makes installer checks safe on a machine with an existing library.
    let profile = std::env::var_os("PURETUBE_ISOLATED_PROFILE").map(PathBuf::from);
    let mut context = tauri::generate_context!();
    if let Some(path) = &profile {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        path.hash(&mut hasher);
        context.config_mut().identifier = format!("app.puretube.test{:x}", hasher.finish());
    }
    let commands: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
        load,
        save,
        public_feed,
        open_info,
        youtube_search::search_youtube,
        youtube_search::search_creators,
        youtube_search::scheduled_channel,
        youtube_search::channel_videos,
        youtube_search::channel_profile,
        youtube_search::live_status,
        youtube_search::watch_creator,
        youtube_search::related_videos,
        youtube_search::channel_live,
        youtube_search::creator_photo,
        youtube_search::youtube_suggestions,
        export_library,
        import_library,
        startup,
        updates::update_configured,
        updates::update_check,
        updates::update_install,
        popout::open_player,
        popout::close_player,
        popout::player_state,
        popout::player_pin,
        popout::player_video,
        popout::player_sample,
        popout::player_autoplay,
        popout::player_queue,
        downloads::download_list,
        downloads::download_video,
        downloads::preview_stream,
        downloads::download_cancel,
        downloads::open_downloads,
        comments::video_comments,
        #[cfg(target_os = "macos")]
        youtube_embed::youtube_embed_port,
        #[cfg(target_os = "macos")]
        youtube_embed::youtube_player_url,
        #[cfg(target_os = "macos")]
        youtube_embed::playback_diagnostics,
        account::account_configured,
        account::account_start,
        library_profile,
        account::account_restore,
        account::account_poll,
        account::account_cancel,
        account::account_read,
        account::account_write,
        account::account_sign_out,
        original_player::original_player,
        original_player::close_original_player,
        downloads::download_preferences,
        downloads::download_set_directory,
        downloads::download_choose_directory,
        downloads::download_set_quality,
        downloads::download_remove,
        downloads::download_clear_finished
    ];
    #[cfg(target_os = "macos")]
    for window in &mut context.config_mut().app.windows {
        // Build explicitly in setup so the chat guard also runs in WKWebView frames.
        window.create = false;
    }
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.unminimize();
            let _ = main.set_focus();
        }
    }));
    let builder = if let Some((key, _)) = updates::config() {
        builder.plugin(tauri_plugin_updater::Builder::new().pubkey(key).build())
    } else {
        builder
    };
    let builder = if profile.is_none() {
        use tauri_plugin_window_state::StateFlags;
        // Older releases saved the native caption with the window position.
        let flags = StateFlags::all() & !StateFlags::DECORATIONS;
        builder.plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(flags)
                .build(),
        )
    } else {
        builder
    };
    builder
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if window.label() == "player" {
                if let tauri::WindowEvent::Moved(position) = event { popout::hold_position(window, position); }
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    popout::closed(window.app_handle());
                }
                return;
            }
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let keep=window.try_state::<AppData>().and_then(|state| read(&state.db).ok().flatten()).and_then(|v| v.pointer("/settings/closeToTray").and_then(Value::as_bool)).unwrap_or(false);
                if keep { api.prevent_close(); let _=window.hide(); return; }
                if let Some(state) = window.try_state::<downloads::Downloads>() {
                    state.shutdown();
                }
                if let Some(tray) = window.app_handle().tray_by_id("viddy") {
                    let _ = tray.set_visible(false);
                }
                window.app_handle().exit(0);
                return;
            }
            if let tauri::WindowEvent::Resized(_) = event {
                if window.is_minimized().unwrap_or(false) {
                    let Some(state) = window.try_state::<AppData>() else {
                        return;
                    };
                    if read(&state.db)
                        .ok()
                        .flatten()
                        .and_then(|v| v.pointer("/settings/tray").and_then(Value::as_bool))
                        .unwrap_or(false)
                    {
                        let _ = window.hide();
                    }
                }
            }
        })
        .setup(move |app| {
            app.manage(account::Account::default());
            #[cfg(target_os = "macos")]
            app.manage(youtube_embed::EmbedOrigin::default());
            #[cfg(target_os = "macos")]
            for config in &app.config().app.windows {
                tauri::WebviewWindowBuilder::from_config(app, config)?
                    .initialization_script_for_all_frames(include_str!("read-only-chat.js"))
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .build()?;
            }
            let isolated = profile.is_some();
            let dir = match profile {
                Some(dir) if dir.is_absolute() => dir,
                Some(_) => return Err("PURETUBE_ISOLATED_PROFILE must be an absolute path".into()),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&dir)?;
            let download_root = if isolated {
                dir.join("downloads")
            } else {
                {
                    let folder = app.path().download_dir()?;
                    folder.join("ViddyVids")
                }
            };
            app.manage(downloads::Downloads::new(
                download_root,
                dir.join("downloads.json"),
            ));
            app.manage(popout::PlayerState::default());
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .build()?;
            app.manage(AppData {
                db: dir.join("library.sqlite3"),
                recovery: if isolated { None } else { Some(app.path().document_dir()?.join("Viddy/library-backup.sqlite3")) },
                library_guard: Mutex::new(()),
                client,
                isolated,
            });
            desktop::configure_tray(app)?;
            #[cfg(windows)]
            if let Some(main) = app.get_webview_window("main") {
                if let Some(icon)=app.default_window_icon() { let _=main.set_icon(icon.clone()); }
                main.set_decorations(false)?;
                let video_app = app.handle().clone();
                main.with_webview(move |webview| {
                    let _ = desktop::configure_youtube_identity(webview, Some(Box::new(move |id| { let _ = video_app.emit_to("main", "embedded-video", id); })));
                })?;
            }
            Ok(())
        })
        .invoke_handler(move |invoke| {
            let mini = invoke.message.webview_ref().label() == "player"
                && matches!(
                    invoke.message.command(),
                    "player_state"
                        | "close_player"
                        | "player_pin"
                        | "player_video"
                        | "player_autoplay"
                        | "player_queue"
                        | "related_videos"
                        | "player_sample"
                        | "load"
                        | "search_youtube"
                        | "channel_videos"
                        | "watch_creator"
                        | "youtube_embed_port"
                        | "youtube_player_url"
                );
            if invoke.message.webview_ref().label() != "main" && !mini {
                invoke
                    .resolver
                    .reject("Native Viddy commands are only available in the local app window.");
                return true;
            }
            commands(invoke)
        })
        .run(context)
        .expect("Could not launch Viddy");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn independent_backup_recovers_removed_or_damaged_app_data() {
        let dir = tempfile::tempdir().unwrap();
        let primary = dir.path().join("app.sqlite3");
        let backup = dir.path().join("documents.sqlite3");
        let value = json!({"version":1,"follows":["creator"],"collections":[{"name":"Study","ids":["video"]}]});
        write(&backup, value.clone()).unwrap();
        assert_eq!(recover_library(&primary, Some(&backup)).unwrap(), Some(value.clone()));
        std::fs::write(&primary, b"damaged database").unwrap();
        assert_eq!(recover_library(&primary, Some(&backup)).unwrap(), Some(value.clone()));
        assert!(primary.with_extension("damaged.sqlite3").is_file());
        write(&primary, json!({"version":1,"follows":[]})).unwrap();
        assert_eq!(recover_library(&primary, Some(&backup)).unwrap().unwrap()["follows"], json!([]));
    }
    #[test]
    fn persists_beyond_connection_and_replaces_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.db");
        assert_eq!(read(&path).unwrap(), None);
        let value = json!({"version": 1, "follows": ["creator"], "history": {"video": 42}});
        write(&path, value.clone()).unwrap();
        assert_eq!(read(&path).unwrap(), Some(value.clone()));
        assert!(write(&path, json!({"version": 9})).is_err());
        assert_eq!(read(&path).unwrap(), Some(value));
        let empty = json!({"version": 1});
        write(&path, empty.clone()).unwrap();
        assert_eq!(read(&path).unwrap(), Some(empty));
    }
}

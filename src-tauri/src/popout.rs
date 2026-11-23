use crate::Result;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

#[derive(Default)]
pub struct PlayerState(pub Mutex<Value>);
fn valid_video(video: &Value) -> bool {
    video["id"].as_str().is_some_and(|id| {
        id.len() == 11
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}
#[tauri::command]
pub async fn open_player(
    app: tauri::AppHandle,
    state: State<'_, PlayerState>,
    payload: Value,
) -> Result<()> {
    if !valid_video(&payload["video"]) || payload.to_string().len() > 300_000 {
        return Err("Invalid player video.".into());
    }
    let mut payload=payload;
    {
        let mut previous=state.0.lock().map_err(|_| "Player is busy.")?;
        if app.get_webview_window("player").is_some() {
            payload["pinned"]=previous["pinned"].clone();
            payload["lockedPosition"]=previous["lockedPosition"].clone();
        } else { payload["pinned"]=json!(false); }
        *previous=payload.clone();
    }
    if let Some(window) = app.get_webview_window("player") {
        let _ = app.emit_to("player", "player-load", &payload);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "player",
        tauri::WebviewUrl::App("index.html?mini=1".into()),
    )
    .title("Viddy mini player")
    .use_https_scheme(true)
    .decorations(false)
    .shadow(false)
    .inner_size(640., 440.)
    .min_inner_size(360., 260.)
    .resizable(true)
    .always_on_top(false)
    .initialization_script_for_all_frames(include_str!("read-only-chat.js"))
    .build()
    .map_err(|_| "Could not open the mini player.")?;
    #[cfg(windows)]
    let video_app = app.clone();
    #[cfg(windows)]
    window
        .with_webview(move |view| {
            let _ = crate::desktop::configure_youtube_identity(view, Some(Box::new(move |id| { let _ = video_app.emit_to("player", "embedded-video", id); })));
        })
        .map_err(|_| "Could not initialize the mini player.")?;
    Ok(())
}
#[tauri::command]
pub fn player_state(state: State<PlayerState>) -> Result<Value> {
    Ok(state.0.lock().map_err(|_| "Player is busy.")?.clone())
}
#[tauri::command]
pub fn close_player(app: tauri::AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("player") {
        window
            .close()
            .map_err(|_| "Could not close the mini player.")?;
    }
    Ok(())
}
#[tauri::command]
pub fn player_pin(window: tauri::WebviewWindow, state: State<PlayerState>, pinned: bool) -> Result<()> {
    if window.label() != "player" {
        return Err("Pinning is only available in the mini player.".into());
    }
    let position=window.outer_position().map_err(|_| "Could not read the player position.")?;
    window
        .set_always_on_top(pinned)
        .map_err(|_| "Could not change the player pin.")?;
    window.set_resizable(!pinned).map_err(|_| "Could not lock the player size.")?;
    let mut payload=state.0.lock().map_err(|_| "Player is busy.")?;
    payload["pinned"]=json!(pinned);
    payload["lockedPosition"]=if pinned { json!({"x":position.x,"y":position.y}) } else {Value::Null};
    Ok(())
}
pub fn hold_position(window: &tauri::Window, position: &tauri::PhysicalPosition<i32>) {
    let target=window.try_state::<PlayerState>().and_then(|state| {
        let payload=state.0.lock().ok()?;
        if payload["pinned"]!=true {return None;}
        Some((i32::try_from(payload["lockedPosition"]["x"].as_i64()?).ok()?,i32::try_from(payload["lockedPosition"]["y"].as_i64()?).ok()?))
    });
    if let Some((x,y))=target {
        if position.x!=x||position.y!=y {let _=window.set_position(tauri::PhysicalPosition::new(x,y));}
    }
}
#[tauri::command]
pub fn player_video(app: tauri::AppHandle, state: State<PlayerState>, video: Value) -> Result<()> {
    if !valid_video(&video) || video.to_string().len() > 50_000 {
        return Err("Invalid player video.".into());
    }
    {
        let mut payload = state.0.lock().map_err(|_| "Player is busy.")?;
        payload["video"] = video.clone();
        payload["start"] = json!(0);
        if let Some(ids) = payload["playlist"]["ids"].as_array() {
            if let Some(index) = ids.iter().position(|id| id == &video["id"]) {
                payload["playlist"]["index"] = json!(index)
            } else {
                let mut queue = payload["playlist"].clone();
                let at = (queue["index"].as_u64().unwrap_or(0) as usize + 1).min(ids.len());
                queue["ids"].as_array_mut().unwrap().insert(at, video["id"].clone());
                queue["index"] = json!(at);
                queue["name"] = json!("Queue");
                payload["playlist"] = queue;
            }
        }
    }
    app.emit_to("main", "player-video", video)
        .map_err(|_| "Could not update the player.".into())
}
#[tauri::command]
pub fn player_sample(
    app: tauri::AppHandle,
    state: State<PlayerState>,
    video_id: String,
    position: f64,
    duration: f64,
    elapsed: f64,
    started: bool,
) -> Result<()> {
    if ![position, duration, elapsed]
        .iter()
        .all(|v| v.is_finite() && *v >= 0.)
        || elapsed > 60.
    {
        return Err("Invalid playback sample.".into());
    }
    let mut payload = state.0.lock().map_err(|_| "Player is busy.")?;
    if !valid_video(&payload["video"]) || payload["video"]["id"].as_str() != Some(video_id.as_str())
    {
        return Ok(());
    }
    if !started {
        payload["start"] = json!(position);
    }
    app.emit_to("main","player-sample",json!({"video":payload["video"],"position":position,"duration":duration,"elapsed":elapsed,"started":started})).map_err(|_|"Could not report playback.".into())
}
pub fn closed(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<PlayerState>() {
        if let Ok(payload) = state.0.lock() {
            let _ = app.emit_to("main", "player-closed", payload.clone());
        }
    }
}

#[tauri::command]
pub fn player_autoplay(
    app: tauri::AppHandle,
    state: State<PlayerState>,
    enabled: bool,
) -> Result<()> {
    state.0.lock().map_err(|_| "Player is busy.")?["autoplay"] = json!(enabled);
    app.emit_to("main", "player-autoplay", enabled)
        .map_err(|_| "Could not change autoplay.".into())
}

#[tauri::command]
pub fn player_queue(
    app: tauri::AppHandle,
    state: State<PlayerState>,
    queue: Option<Value>,
) -> Result<()> {
    let queue = queue.unwrap_or(Value::Null);
    if !queue.is_null()
        && (queue.to_string().len() > 100_000
            || !queue["ids"].as_array().is_some_and(|ids| {
                !ids.is_empty()
                    && ids.len() <= 5000
                    && ids.iter().all(|id| valid_video(&json!({"id":id})))
            })
            || queue["index"]
                .as_u64()
                .is_none_or(|i| i as usize >= queue["ids"].as_array().map_or(0, |a| a.len())))
    {
        return Err("Invalid queue.".into());
    }
    state.0.lock().map_err(|_| "Player is busy.")?["playlist"] = queue.clone();
    app.emit_to("player", "player-queue", queue.clone())
        .map_err(|_| "Could not update queue.".to_string())?;
    app.emit_to("main", "player-queue", queue)
        .map_err(|_| "Could not update queue.".into())
}

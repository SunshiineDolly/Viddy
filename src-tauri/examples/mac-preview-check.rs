#[cfg(target_os = "macos")]
#[path = "../src/youtube_embed.rs"]
mod youtube_embed;

#[cfg(target_os = "macos")]
#[tauri::command]
fn preview_check_result(app: tauri::AppHandle, mut report: serde_json::Value) {
    let path = std::env::var_os("VIDDY_PREVIEW_REPORT").expect("isolated report path");
    report["firstProcessId"] = serde_json::json!(std::process::id());
    std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    println!("{report}");
    if (report["videoTimeAdvanced"] == true || report["externalPlaybackBlockedByYouTube"] == true) && report["previewsCanBeDisabled"] == true && report["mainPlayerReady"] == true { app.restart(); } else { app.exit(1); }
}

#[cfg(target_os = "macos")]
fn main() {
    use tauri::Manager;
    let report_path = std::path::PathBuf::from(std::env::var_os("VIDDY_PREVIEW_REPORT").expect("report path"));
    if let Ok(bytes) = std::fs::read(&report_path) {
        let mut report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        if (report["videoTimeAdvanced"] == true || report["externalPlaybackBlockedByYouTube"] == true) && report["firstProcessId"] != serde_json::json!(std::process::id()) {
            report["restartVerified"] = serde_json::json!(true);
            std::fs::write(report_path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
            println!("{report}");
            return;
        }
    }
    let profile = std::path::PathBuf::from(std::env::var_os("PURETUBE_ISOLATED_PROFILE").expect("isolated profile required"));
    assert!(profile.is_absolute());
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "app.viddy.native-preview-check".into();
    for config in &mut context.config_mut().app.windows { config.create = false; }
    let commands: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![youtube_embed::youtube_embed_port, preview_check_result];
    tauri::Builder::default()
        .setup(move |app| {
            app.manage(youtube_embed::EmbedOrigin::default());
            let config = app.config().app.windows[0].clone();
            tauri::WebviewWindowBuilder::from_config(app, &config)?
                .data_directory(profile.join("webview"))
                .initialization_script_for_all_frames(include_str!("../../tests/mac-preview-native.js"))
                .build()?;
            Ok(())
        })
        .invoke_handler(move |invoke| {
            if matches!(invoke.message.command(), "youtube_embed_port" | "preview_check_result") { return commands(invoke); }
            let answer = match invoke.message.command() {
                "load" => serde_json::json!({"version":1,"settings":{"intro":false,"tray":false,"themedCursor":false}}),
                "public_feed" => serde_json::json!("<?xml version=\"1.0\"?><feed xmlns=\"http://www.w3.org/2005/Atom\"/>"),
                "search_youtube" | "channel_videos" => serde_json::json!({"items":[{"id":"M7lc1UVf-VE","title":"Native Mac preview check","description":"Public video","metadataComplete":true,"channelId":"UC0000000000000000000002","channel":"Example creator","image":"","date":"2026-11-21","duration":120,"shorts":false,"paid":false,"embeddable":true}],"next":null}),
                "scheduled_channel" => serde_json::json!([]),
                "account_configured" | "update_configured" => serde_json::json!(false),
                _ => serde_json::Value::Null,
            };
            invoke.resolver.resolve(answer);true
        })
        .run(context).expect("native preview check");
}

#[cfg(not(target_os = "macos"))]
fn main() { panic!("This check requires macOS WKWebView"); }

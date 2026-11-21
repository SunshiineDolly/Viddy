use std::{
    io::{BufRead, BufReader, Write},
    net::{Ipv4Addr, TcpListener, TcpStream},
    thread,
    time::Duration,
};
use tauri::Url;

#[derive(Default)]
pub struct EmbedOrigin(std::sync::OnceLock<Result<u16, ()>>);

#[tauri::command]
pub fn youtube_embed_port(state: tauri::State<'_, EmbedOrigin>) -> Result<u16, &'static str> {
    state.0.get_or_init(|| start().map_err(|_| ()))
        .as_ref()
        .copied()
        .map_err(|_| "Could not start the YouTube player.")
}

fn start() -> std::io::Result<u16> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let port = listener.local_addr()?.port();
    thread::Builder::new().name("youtube-embed".into()).spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { break };
            let _ = serve(stream, port);
        }
    })?;
    Ok(port)
}

fn serve(mut stream: TcpStream, port: u16) -> std::io::Result<()> {
    let timeout = Some(Duration::from_secs(1));
    stream.set_read_timeout(timeout)?;
    stream.set_write_timeout(timeout)?;
    let mut reader = BufReader::new(&mut stream);
    let mut request = String::new();
    use std::io::Read;
    reader.by_ref().take(4096).read_line(&mut request)?;
    let expected_host = format!("127.0.0.1:{port}");
    let mut valid_host = false;
    let mut headers = reader.take(8192);
    loop {
        let mut line = String::new();
        if headers.read_line(&mut line)? == 0 || line == "\r\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("host") {
                valid_host = value.trim() == expected_host;
            }
        }
    }
    let path = request.strip_prefix("GET ").and_then(|r| r.split_once(' ')).map(|(path, _)| path);
    if let Some(id) = path.and_then(|p| p.strip_prefix("/preview?").or_else(|| p.strip_prefix("/player?"))).filter(|_| valid_host).and_then(preview_id) {
        let page = if path.is_some_and(|p|p.starts_with("/player?")) { include_str!("player-frame.html").replace("{{ID}}", &id).replace("{{PORT}}", &port.to_string()) } else { preview_page(&id, port) };
        return write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nReferrer-Policy: strict-origin-when-cross-origin\r\nContent-Security-Policy: default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com; style-src 'unsafe-inline'\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{page}", page.len());
    }
    let target = request.strip_prefix("GET ")
        .and_then(|request| request.split_once(' '))
        .and_then(|(path, _)| path.strip_prefix("/youtube?"))
        .filter(|_| valid_host)
        .and_then(embed_target);
    let Some(target) = target else {
        return stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    };

    // A document navigation makes WebKit send the loopback origin as the
    // referrer. An HTTP 3xx would retain the original tauri:// referrer.
    let escaped = target.as_str().replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;");
    let page = format!("<!doctype html><meta charset=utf-8><meta http-equiv=refresh content=\"0;url={escaped}\">");
    write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nReferrer-Policy: strict-origin-when-cross-origin\r\nContent-Security-Policy: default-src 'none'\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{page}", page.len())
}

fn preview_id(query: &str) -> Option<String> {
    let url = Url::parse(&format!("http://localhost/?{query}")).ok()?;
    let (_, id) = url.query_pairs().find(|(key, _)| key == "id")?;
    (id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')).then(|| id.into_owned())
}

fn preview_page(id: &str, port: u16) -> String {
    include_str!("preview-player.html").replace("{{ID}}", id).replace("{{PORT}}", &port.to_string())
}

fn embed_target(query: &str) -> Option<Url> {
    let request = Url::parse(&format!("http://localhost/?{query}")).ok()?;
    let (_, target) = request.query_pairs().find(|(key, _)| key == "target")?;
    let target = Url::parse(&target).ok()?;
    let id = target.path().strip_prefix("/embed/")?;
    (target.origin().ascii_serialization() == "https://www.youtube.com"
        && target.username().is_empty()
        && target.password().is_none()
        && id.len() == 11
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
        .then_some(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_page_uses_real_muted_video_and_a_matching_http_origin() {
        let page = preview_page("jNQXAC9IVRw", 4321);
        assert!(page.contains("https://www.youtube.com/embed/jNQXAC9IVRw"));
        assert!(page.contains("origin=http%3A%2F%2F127.0.0.1%3A4321"));
        assert!(page.contains("event.target.mute();event.target.playVideo()"));
        assert!(page.contains("onAutoplayBlocked"));
        assert!(!page.contains("tauri://"));
        assert!(!page.contains("{{ID}}"));
        for invalid in ["id=bad", "id=jNQXAC9IVRw%22%3E", "id=https://example.com", "id=../jNQXAC9IVRw"] {
            assert!(preview_id(invalid).is_none());
        }
    }

    #[test]
    fn preview_route_requires_loopback_host_and_returns_the_player_page() {
        use std::io::Read;
        fn get(host: Option<&str>) -> String {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            let host = host.map(str::to_owned).unwrap_or_else(|| format!("127.0.0.1:{port}"));
            let worker = thread::spawn(move || serve(listener.accept().unwrap().0, port).unwrap());
            let mut client = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
            write!(client, "GET /preview?id=jNQXAC9IVRw HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
            let mut response = String::new();client.read_to_string(&mut response).unwrap();worker.join().unwrap();response
        }
        let page = get(None);
        assert!(page.starts_with("HTTP/1.1 200"));
        assert!(page.contains("new YT.Player"));
        assert!(page.contains("frame-src https://www.youtube.com"));
        assert!(get(Some("example.com")).starts_with("HTTP/1.1 404"));
    }

    #[test]
    fn embed_target_accepts_only_official_video_embeds() {
        fn target(url: &str) -> Option<Url> {
            let mut request = Url::parse("http://127.0.0.1/youtube").unwrap();
            request.query_pairs_mut().append_pair("target", url);
            embed_target(request.query().unwrap())
        }

        let video = "https://www.youtube.com/embed/vWG8Exo0QQ4?autoplay=1&enablejsapi=1";
        assert_eq!(target(video).unwrap().as_str(), video);
        for invalid in [
            "https://www.youtube.com.example/embed/vWG8Exo0QQ4",
            "http://www.youtube.com/embed/vWG8Exo0QQ4",
            "https://www.youtube.com:444/embed/vWG8Exo0QQ4",
            "https://www.youtube.com/watch?v=vWG8Exo0QQ4",
            "https://www.youtube.com/embed/vWG8Exo0QQ4/extra",
        ] {
            assert!(target(invalid).is_none(), "{invalid}");
        }
    }
}

#[tauri::command]
pub fn youtube_player_url(id: String, mode: String) -> Result<String, &'static str> {
 if id.len()!=11 || !id.bytes().all(|b|b.is_ascii_alphanumeric() || b==b'_' || b==b'-') || !matches!(mode.as_str(), "preview"|"watch") {return Err("Invalid player request.")}
 let mut url=Url::parse("https://sunshiinedolly.github.io/Viddy/player.html?v=0.26.9").unwrap();
 let fragment=format!("id={id}&mode={mode}");
 url.set_fragment(Some(&fragment));Ok(url.into())
}

// Read only this running application's public bundle metadata. Never read the
// Keychain, library, environment secrets or user-identifying filesystem paths.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn playback_diagnostics() -> serde_json::Value {
    let executable=std::env::current_exe().ok();
    let bundle=executable.as_ref().and_then(|path|path.parent()).and_then(|path|path.parent()).and_then(|path|path.parent());
    let mut installed_version=None;
    let mut stable_identity=false;
    let mut ad_hoc=false;
    let mut location="unknown";
    if let Some(bundle)=bundle {
        let path=bundle.to_string_lossy();
        location=if path.contains("/AppTranslocation/"){"translocated"}else if path.starts_with("/Volumes/"){"disk image"}else if path.starts_with("/Applications/")||path.contains("/Applications/"){"Applications"}else{"other"};
        if let Ok(output)=std::process::Command::new("/usr/bin/plutil").args(["-extract","CFBundleShortVersionString","raw","-o","-"]).arg(bundle.join("Contents/Info.plist")).output(){
            if output.status.success(){installed_version=String::from_utf8(output.stdout).ok().map(|value|value.trim().to_owned());}
        }
        if let Ok(output)=std::process::Command::new("/usr/bin/codesign").args(["-d","--verbose=4"]).arg(bundle).output(){
            let text=String::from_utf8_lossy(&output.stderr);
            stable_identity=text.lines().any(|line|line=="Authority=Viddy Mac Release Identity");
            ad_hoc=text.lines().any(|line|line=="Signature=adhoc");
        }
    }
    serde_json::json!({"runtimeVersion":env!("CARGO_PKG_VERSION"),"installedVersion":installed_version,"launchLocation":location,"stableSigningIdentity":stable_identity,"adHocSignature":ad_hoc,"sessionStorage":"macOS Keychain v2"})
}

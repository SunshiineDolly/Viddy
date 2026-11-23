use crate::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Serialize, Deserialize)]
pub struct Job {
    id: String,
    video_id: String,
    title: String,
    status: String,
    percent: f64,
    message: String,
    file: Option<String>,
    quality: u32,
    #[serde(default)]
    directory: String,
}
pub struct Downloads {
    jobs: Mutex<Vec<Job>>,
    children: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    cancelled: Mutex<HashSet<String>>,
    tools: Mutex<()>,
    preview_tools: std::sync::OnceLock<HashMap<String,PathBuf>>,
    preview_gate: Mutex<()>,
    preview_cache: Mutex<HashMap<String,(std::time::Instant,String)>>,
    destination: Mutex<PathBuf>,
    quality: Mutex<u32>,
    record: PathBuf,
}
impl Downloads {
    pub fn new(root: PathBuf, record: PathBuf) -> Self {
        let mut jobs: Vec<Job> = fs::read(&record)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        jobs.truncate(200);
        for job in &mut jobs {
            if job.directory.is_empty() {
                job.directory = restored_directory(job, &root);
            }
            if matches!(job.status.as_str(), "preparing" | "downloading" | "merging") {
                job.status = "interrupted".into();
                job.message =
                    "Viddy closed before this download finished. Try again to resume.".into();
            }
        }
        let preferences: Value = fs::read(record.with_file_name("download-preferences.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(Value::Null);
        let destination = preferences["directory"]
            .as_str()
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .filter(|p|{let legacy=root.parent().map(|base|[base.join("PureTube"),base.join("Viddy")]);!legacy.is_some_and(|paths|paths.contains(p))})
            .unwrap_or_else(|| root.clone());
        let quality = preferences["quality"]
            .as_u64()
            .filter(|q| [0, 720, 1080].contains(q))
            .unwrap_or(1080) as u32;
        Self {
            jobs: Mutex::new(jobs),
            children: Mutex::new(HashMap::new()),
            cancelled: Mutex::new(HashSet::new()),
            tools: Mutex::new(()),
            preview_tools: std::sync::OnceLock::new(),
            preview_gate: Mutex::new(()),
            preview_cache: Mutex::new(HashMap::new()),
            destination: Mutex::new(destination),
            quality: Mutex::new(quality),
            record,
        }
    }
    fn stopped(&self, id: &str) -> bool {
        self.cancelled.lock().unwrap().contains(id)
    }
    fn update(
        &self,
        app: &tauri::AppHandle,
        id: &str,
        status: &str,
        percent: f64,
        message: &str,
        file: Option<String>,
    ) {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs.iter_mut().find(|job| job.id == id) {
            job.status = status.into();
            job.percent = percent.clamp(0., 100.);
            job.message = message.into();
            if file.is_some() {
                job.file = file;
            }
        }
        let _ = fs::write(&self.record, serde_json::to_vec(&*jobs).unwrap_or_default());
        let _ = app.emit_to("main", "downloads-changed", &*jobs);
    }
    pub fn shutdown(&self) {
        let children = self.children.lock().unwrap();
        for (id, child) in children.iter() {
            self.cancelled.lock().unwrap().insert(id.clone());
            kill(child);
        }
    }
}
fn kill(child: &Arc<Mutex<Child>>) {
    if let Ok(mut child) = child.lock() {
        if child.try_wait().ok().flatten().is_none() {
            #[cfg(windows)]
            {
                let _ = Command::new("taskkill.exe")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .creation_flags(0x08000000)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
            let _ = child.kill();
        }
    }
}
fn digest(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(|_| "Could not read a download helper.")?;
    let mut hash = Sha256::new();
    let mut chunk = [0; 65536];
    loop {
        let count = file
            .read(&mut chunk)
            .map_err(|_| "Could not verify a download helper.")?;
        if count == 0 {
            break;
        }
        hash.update(&chunk[..count]);
    }
    Ok(hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}
#[derive(Deserialize)]
struct ToolFile {
    name: String,
    sha256: String,
}
#[derive(Deserialize)]
struct Tool {
    name: String,
    url: String,
    sha256: String,
    files: Vec<ToolFile>,
}
fn prepare_verified(
    app: &tauri::AppHandle,
    state: &Downloads,
    id: &str,
    include_ffmpeg: bool,
) -> Result<HashMap<String, PathBuf>> {
    let _guard = state.tools.lock().map_err(|_| "Download setup is busy.")?;
    #[cfg(not(target_os="macos"))]
    let root = PathBuf::from(
        std::env::var_os("LOCALAPPDATA").ok_or("Windows app-data folder is unavailable.")?,
    )
    .join("PureTube/download-tools");
    #[cfg(target_os="macos")]
    let root=app.path().app_cache_dir().map_err(|_|"Could not locate preview storage.")?.join("preview-tools");
    #[cfg(not(target_os="macos"))]
    let mut tools: Vec<Tool> = serde_json::from_str(include_str!("../download-tools.json"))
        .map_err(|_| "Invalid download tool manifest.")?;
    #[cfg(target_os="macos")]
    let mut tools: Vec<Tool> = serde_json::from_str::<HashMap<String,Vec<Tool>>>(include_str!("../macos-preview-tools.json")).map_err(|_|"Invalid preview helper manifest.")?.remove(std::env::consts::ARCH).ok_or("Unsupported Mac architecture.")?;
    if !include_ffmpeg {
        tools.retain(|tool| tool.name != "ffmpeg");
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(300))
        .user_agent("Viddy-downloads")
        .build()
        .map_err(|_| "Could not initialize download setup.")?;
    let mut executables = HashMap::new();
    for (index, tool) in tools.iter().enumerate() {
        if state.stopped(id) {
            return Err("Cancelled".into());
        }
        let dir = root.join(format!("{}-{}", tool.name, &tool.sha256[..12]));
        fs::create_dir_all(&dir).map_err(|_| "Could not create the download tools folder.")?;
        #[cfg(target_os="macos")]
        {
            use std::os::unix::fs::PermissionsExt;
            if fs::symlink_metadata(&dir).is_ok_and(|m|m.file_type().is_symlink()) {return Err("Unsafe helper folder.".into());}
            fs::set_permissions(&dir,fs::Permissions::from_mode(0o700)).map_err(|_|"Could not secure preview storage.")?;
            for name in tool.files.iter().map(|f|f.name.as_str()).chain(std::iter::once("package.download")){
                if fs::symlink_metadata(dir.join(name)).is_ok_and(|m|m.file_type().is_symlink()){return Err("Unsafe helper file.".into());}
            }
        }
        let ready = tool
            .files
            .iter()
            .all(|f| digest(&dir.join(&f.name)).ok().as_deref() == Some(f.sha256.as_str()));
        if !ready {
            if id!="preview" { state.update(
                app,
                id,
                "preparing",
                0.,
                &format!("Preparing downloads ({}/{})…", index + 1, tools.len()),
                None,
            ); }
            let archive = dir.join("package.download");
            if digest(&archive).ok().as_deref() != Some(tool.sha256.as_str()) {
                let mut response = client
                    .get(&tool.url)
                    .send()
                    .and_then(|r| r.error_for_status())
                    .map_err(|_| "Download setup could not reach GitHub. Try again later.")?;
                let mut output =
                    File::create(&archive).map_err(|_| "Could not save a download helper.")?;
                let mut bytes = 0usize;
                let mut buffer = [0; 65536];
                loop {
                    if state.stopped(id) {
                        return Err("Cancelled".into());
                    }
                    let n = response
                        .read(&mut buffer)
                        .map_err(|_| "Download setup was interrupted. Try again.")?;
                    if n == 0 {
                        break;
                    }
                    bytes += n;
                    if bytes > 260 * 1024 * 1024 {
                        return Err("Download helper exceeds its expected size.".into());
                    }
                    output
                        .write_all(&buffer[..n])
                        .map_err(|_| "Not enough space for download setup.")?;
                }
                drop(output);
                if digest(&archive)? != tool.sha256 {
                    return Err(
                        "Download helper checksum did not match. Nothing was executed.".into(),
                    );
                }
            }
            if tool.url.ends_with(".zip") {
                let mut zip = zip::ZipArchive::new(
                    File::open(&archive).map_err(|_| "Could not read the helper archive.")?,
                )
                .map_err(|_| "Could not open the helper archive.")?;
                for file in &tool.files {
                    let mut found = false;
                    for n in 0..zip.len() {
                        let mut entry = zip
                            .by_index(n)
                            .map_err(|_| "Could not extract a download helper.")?;
                        let entry_name = entry
                            .name()
                            .map_err(|_| "Invalid helper archive filename.")?;
                        if Path::new(entry_name.as_ref())
                            .file_name()
                            .and_then(|s| s.to_str())
                            == Some(file.name.as_str())
                        {
                            if found || entry.size() > 400 * 1024 * 1024 {
                                return Err("Unexpected helper archive contents.".into());
                            }
                            found = true;
                            let mut output = File::create(dir.join(&file.name))
                                .map_err(|_| "Could not save the download helper.")?;
                            std::io::copy(&mut entry, &mut output)
                                .map_err(|_| "Not enough space for the download helper.")?;
                        }
                    }
                    if !found {
                        return Err("A required download helper is missing.".into());
                    }
                }
            } else {
                fs::copy(&archive, dir.join(&tool.files[0].name))
                    .map_err(|_| "Could not install the download helper.")?;
            }
            for file in &tool.files {
                if digest(&dir.join(&file.name))? != file.sha256 {
                    return Err(
                        "Download executable verification failed. Nothing was executed.".into(),
                    );
                }
            }
            let _ = fs::remove_file(&archive);
        }
        for file in &tool.files {
            #[cfg(target_os="macos")]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(dir.join(&file.name),fs::Permissions::from_mode(0o700)).map_err(|_|"Could not enable the verified preview helper.")?;
                executables.insert(format!("{}.exe",file.name),dir.join(&file.name));
            }
            #[cfg(not(target_os="macos"))]
            executables.insert(file.name.clone(), dir.join(&file.name));
        }
    }
    Ok(executables)
}
#[cfg(not(target_os="macos"))]
fn prepare(app:&tauri::AppHandle,state:&Downloads,id:&str,include_ffmpeg:bool)->Result<HashMap<String,PathBuf>>{prepare_verified(app,state,id,include_ffmpeg)}

// Finder launches do not inherit a shell's Homebrew PATH. Resolve helpers from
// the standard Apple Silicon and Intel prefixes, without downloading Windows binaries.
#[cfg(target_os = "macos")]
fn prepare(
    app: &tauri::AppHandle,
    state: &Downloads,
    id: &str,
    include_ffmpeg: bool,
) -> Result<HashMap<String, PathBuf>> {
    if state.stopped(id) { return Err("Cancelled".into()); }
    if !include_ffmpeg {return prepare_verified(app,state,id,false);}
    let names: &[&str] = if include_ffmpeg {
        &["yt-dlp", "deno", "ffmpeg", "ffprobe"]
    } else {
        &["yt-dlp", "deno"]
    };
    let mut executables = HashMap::new();
    for name in names {
        let path = ["/opt/homebrew/bin", "/usr/local/bin"].iter()
            .map(|prefix| Path::new(prefix).join(name))
            .find(|path| {
                use std::os::unix::fs::PermissionsExt;
                path.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            })
            .ok_or("Downloads on Mac require Homebrew helpers. In Terminal, run: brew install yt-dlp deno ffmpeg. Then retry.")?;
        // Keep the common download pipeline's lookup keys compatible with Windows.
        executables.insert(format!("{name}.exe"), path);
    }
    Ok(executables)
}
fn preview_tools(app:&tauri::AppHandle,state:&Downloads)->Result<HashMap<String,PathBuf>>{
    if let Some(tools)=state.preview_tools.get(){return Ok(tools.clone());}
    let tools=prepare(app,state,"preview",false)?;
    let _=state.preview_tools.set(tools.clone());Ok(tools)
}
#[tauri::command]
pub async fn preview_prepare(app:tauri::AppHandle)->Result<()>{
    tauri::async_runtime::spawn_blocking(move||preview_tools(&app,&app.state::<Downloads>()).map(|_|())).await.map_err(|_|"Could not prepare previews.")?
}
struct PreviewProcess<'a>{state:&'a Downloads,child:Arc<Mutex<Child>>}
impl Drop for PreviewProcess<'_>{fn drop(&mut self){kill(&self.child);if let Ok(mut children)=self.state.children.lock(){children.remove("preview");}}}
fn preview_url(raw:&str)->Option<String>{
    let url=reqwest::Url::parse(raw.trim()).ok()?;
    (url.scheme()=="https"&&url.username().is_empty()&&url.password().is_none()&&url.fragment().is_none()&&url.host_str().is_some_and(|h|h.ends_with(".googlevideo.com"))).then(||url.to_string())
}
#[tauri::command]
pub async fn preview_stream(app: tauri::AppHandle, id: String, fresh:Option<bool>) -> Result<String> {
    if id.len()!=11 || !id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-') { return Err("Invalid video.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<Downloads>();
        let _guard=state.preview_gate.lock().map_err(|_|"Preview is busy.")?;
        if fresh==Some(true){state.preview_cache.lock().map_err(|_|"Preview cache is busy.")?.remove(&id);}
        if let Some((at,url))=state.preview_cache.lock().map_err(|_|"Preview cache is busy.")?.get(&id){
            if at.elapsed()<Duration::from_secs(300){return Ok(url.clone());}
        }
        let tools=preview_tools(&app,&state)?;
        let mut command=Command::new(&tools["yt-dlp.exe"]);
        command.args([
            "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-warnings", "--no-cache-dir",
            "--socket-timeout", "5", "--retries", "0", "--extractor-retries", "0",
            "--match-filter", "!is_live & !is_upcoming", "--get-url", "--js-runtimes", &format!("deno:{}", tools["deno.exe"].display()),
            "-f", "bv[protocol=https][ext=mp4][vcodec^=avc1][height<=480]/b[protocol=https][ext=mp4][vcodec^=avc1][height<=480]",
            "--", &format!("https://www.youtube.com/watch?v={id}"),
        ]).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let child=Arc::new(Mutex::new(command.spawn().map_err(|_|"Preview could not start.")?));
        state.children.lock().map_err(|_|"Preview is busy.")?.insert("preview".into(),child.clone());
        let process=PreviewProcess{state:&state,child};
        let deadline=std::time::Instant::now()+Duration::from_secs(25);
        loop {
            let status=process.child.lock().map_err(|_|"Preview is busy.")?.try_wait().map_err(|_|"Could not read preview status.")?;
            if status.is_some(){break;}
            if state.stopped("preview"){return Err("Cancelled".into());}
            if std::time::Instant::now()>=deadline {return Err("Preview source timed out. Try another video.".into());}
            std::thread::sleep(Duration::from_millis(50));
        }
        let output={
            let mut child=process.child.lock().map_err(|_|"Preview is busy.")?;
            let status=child.wait().map_err(|_|"Preview could not start.")?;
            let mut stdout=Vec::new();let mut stderr=Vec::new();
            if let Some(out)=child.stdout.take(){out.take(16384).read_to_end(&mut stdout).map_err(|_|"Could not read preview source.")?;}
            if let Some(out)=child.stderr.take(){out.take(16384).read_to_end(&mut stderr).map_err(|_|"Could not read preview status.")?;}
            std::process::Output{status,stdout,stderr}
        };
        if !output.status.success(){
            let reason=String::from_utf8_lossy(&output.stderr).to_lowercase();
            return Err(if reason.contains("confirm")&&reason.contains("bot"){"YouTube is blocking anonymous playback on this network."}else{"A video preview is not available for this video."}.into());
        }
        for line in String::from_utf8_lossy(&output.stdout).lines(){if let Some(url)=preview_url(line){
            let mut cache=state.preview_cache.lock().map_err(|_|"Preview cache is busy.")?;
            if cache.len()>=128 {if let Some(oldest)=cache.iter().min_by_key(|(_,v)|v.0).map(|(id,_)|id.clone()){cache.remove(&oldest);}}
            cache.insert(id.clone(),(std::time::Instant::now(),url.clone()));return Ok(url);
        }}
        Err("A video preview is not available for this video.".into())
    }).await.map_err(|_|"Preview could not be prepared.")?
}

fn worker(app: tauri::AppHandle, id: String) -> Result<()> {
    let state = app.state::<Downloads>();
    let job = state
        .jobs
        .lock()
        .unwrap()
        .iter()
        .find(|j| j.id == id)
        .cloned()
        .ok_or("Download not found.")?;
    let tools = prepare(&app, &state, &id, true)?;
    if state.stopped(&id) {
        return Err("Cancelled".into());
    }
    let destination = PathBuf::from(&job.directory);
    fs::create_dir_all(&destination)
        .map_err(|_| "Could not create the selected downloads folder.")?;
    let height = if job.quality == 0 {
        String::new()
    } else {
        format!("[height<={}]", job.quality)
    };
    // Restricting audio to m4a can select a forbidden URL even when other streams work.
    // Probe candidates first and let FFmpeg merge the best reachable streams into MP4.
    let format = format!("bv*{height}+ba/b{height}");
    let mut cmd = Command::new(&tools["yt-dlp.exe"]);
    cmd.args([
        "--ignore-config",
        "--no-playlist",
        "--no-cache-dir",
        "--no-warnings",
        "--check-formats",
        "--concurrent-fragments",
        "4",
        "--progress-delta",
        "0.5",
        "--newline",
        "--progress",
        "--progress-template",
        "download:PT_PROGRESS:%(progress._percent_str)s",
        "--print",
        "after_move:PT_FILE:%(filepath)s",
        "--no-simulate",
        "--windows-filenames",
        "--no-overwrites",
        "--match-filter",
        "!is_live & !is_upcoming",
        "--merge-output-format",
        "mp4",
        "-f",
        &format,
        "--js-runtimes",
        &format!("deno:{}", tools["deno.exe"].display()),
        "--ffmpeg-location",
        tools["ffmpeg.exe"]
            .parent()
            .unwrap()
            .to_str()
            .ok_or("Invalid helper folder.")?,
        "-P",
        destination.to_str().ok_or("Invalid downloads folder.")?,
        "-o",
        "%(title).120B [%(id)s].%(ext)s",
        "--",
        &format!("https://www.youtube.com/watch?v={}", job.video_id),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let mut child = cmd
        .spawn()
        .map_err(|_| "Could not start the verified download helper.")?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let errors = std::thread::spawn(move || {
        let mut output = String::new();
        let _ = BufReader::new(stderr)
            .take(32000)
            .read_to_string(&mut output);
        output
    });
    let child = Arc::new(Mutex::new(child));
    state
        .children
        .lock()
        .unwrap()
        .insert(id.clone(), child.clone());
    state.update(&app, &id, "downloading", 0., "Downloading…", None);
    let mut output = None;
    for line in BufReader::new(stdout)
        .lines()
        .map_while(std::result::Result::ok)
    {
        if let Some(p) = line
            .strip_prefix("PT_PROGRESS:")
            .and_then(|v| v.trim().trim_end_matches('%').parse::<f64>().ok())
        {
            state.update(&app, &id, "downloading", p, "Downloading…", None);
        } else if let Some(file) = line.strip_prefix("PT_FILE:") {
            let path = PathBuf::from(file.trim());
            if let (Ok(path), Ok(root)) = (path.canonicalize(), destination.canonicalize()) {
                if path.starts_with(root) && path.is_file() {
                    output = Some(path.to_string_lossy().into_owned());
                }
            }
        } else if line.contains("[Merger]") {
            state.update(&app, &id, "merging", 100., "Finishing your video…", None);
        }
    }
    let status = loop {
        if let Some(status) = child
            .lock()
            .unwrap()
            .try_wait()
            .map_err(|_| "Could not finish the download.")?
        {
            break status;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    state.children.lock().unwrap().remove(&id);
    let error = errors.join().unwrap_or_default();
    if state.stopped(&id) {
        state.update(
            &app,
            &id,
            "cancelled",
            0.,
            "Cancelled. Partial files can be resumed by downloading again.",
            None,
        );
        return Ok(());
    }
    if !status.success() || output.is_none() {
        return Err(if error.contains("Sign in")||error.contains("sign in"){ "YouTube requires sign-in for this download. Viddy downloads public, unrestricted videos without account cookies." }else if error.contains("unavailable")||error.contains("not available"){ "This video is not available for download." }else{"The video could not be downloaded. Check your connection and disk space, then try again."}.into());
    }
    state.update(&app, &id, "complete", 100., "Download complete", output);
    Ok(())
}
#[tauri::command]
pub fn download_list(state: State<Downloads>) -> Vec<Job> {
    state.jobs.lock().unwrap().clone()
}
#[tauri::command]
pub fn download_video(
    app: tauri::AppHandle,
    state: State<Downloads>,
    video_id: String,
    title: String,
    quality: Option<u32>,
) -> Result<String> {
    let quality = quality.unwrap_or(*state.quality.lock().unwrap());
    if video_id.len() != 11
        || !video_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || ![0, 720, 1080].contains(&quality)
    {
        return Err("Invalid video or download quality.".into());
    }
    let mut jobs = state.jobs.lock().unwrap();
    if jobs
        .iter()
        .filter(|j| matches!(j.status.as_str(), "preparing" | "downloading" | "merging"))
        .count()
        >= 2
    {
        return Err("Two downloads are already running. Wait for one to finish.".into());
    }
    if let Some(job) = jobs.iter().find(|j| {
        j.video_id == video_id
            && matches!(j.status.as_str(), "preparing" | "downloading" | "merging")
    }) {
        return Ok(job.id.clone());
    }
    let id = format!(
        "{}-{}",
        video_id,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    jobs.insert(
        0,
        Job {
            id: id.clone(),
            video_id,
            title: title.chars().take(400).collect(),
            status: "preparing".into(),
            percent: 0.,
            message: "Preparing download…".into(),
            file: None,
            quality,
            directory: state
                .destination
                .lock()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
        },
    );
    jobs.truncate(200);
    drop(jobs);
    let task = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = worker(app.clone(), task.clone()) {
            let state = app.state::<Downloads>();
            let cancelled = state.stopped(&task);
            state.update(
                &app,
                &task,
                if cancelled { "cancelled" } else { "failed" },
                0.,
                if cancelled {
                    "Download cancelled."
                } else {
                    &error
                },
                None,
            );
        }
    });
    Ok(id)
}
#[tauri::command]
pub fn download_cancel(state: State<Downloads>, id: String) {
    state.cancelled.lock().unwrap().insert(id.clone());
    if let Some(child) = state.children.lock().unwrap().get(&id) {
        kill(child)
    }
}
#[tauri::command]
pub fn open_downloads(app: tauri::AppHandle, state: State<Downloads>) -> Result<()> {
    let root = state.destination.lock().unwrap().clone();
    fs::create_dir_all(&root).map_err(|_| "Could not open the downloads folder.")?;
    app.opener()
        .open_path(display_path(&root), None::<&str>)
        .map_err(|_| "Could not open the downloads folder.".into())
}
fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else {
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
    }
}
fn preferences(state: &Downloads) -> Value {
    json!({"directory":display_path(&state.destination.lock().unwrap()),"quality":*state.quality.lock().unwrap()})
}
fn save_preferences(state: &Downloads) -> Result<Value> {
    let value = preferences(state);
    fs::write(
        state.record.with_file_name("download-preferences.json"),
        value.to_string(),
    )
    .map_err(|_| "Could not save download preferences.")?;
    Ok(value)
}
#[tauri::command]
pub fn download_preferences(state: State<Downloads>) -> Value {
    preferences(&state)
}
#[tauri::command]
pub fn download_set_directory(state: State<Downloads>, directory: String) -> Result<Value> {
    let path = PathBuf::from(directory.trim());
    if !path.is_absolute() {
        return Err("Choose an absolute folder path.".into());
    }
    fs::create_dir_all(&path).map_err(|_| "Could not create or access this folder.")?;
    *state.destination.lock().unwrap() = path
        .canonicalize()
        .map_err(|_| "Could not open this folder.")?;
    save_preferences(&state)
}
#[tauri::command]
pub async fn download_choose_directory(
    app: tauri::AppHandle,
    state: State<'_, Downloads>,
) -> Result<Value> {
    if let Some(FilePath::Path(path)) = app.dialog().file().blocking_pick_folder() {
        *state.destination.lock().unwrap() = path;
        return save_preferences(&state);
    }
    Ok(preferences(&state))
}
#[tauri::command]
pub fn download_set_quality(state: State<Downloads>, quality: u32) -> Result<Value> {
    if ![0, 720, 1080].contains(&quality) {
        return Err("Invalid download quality.".into());
    }
    *state.quality.lock().unwrap() = quality;
    save_preferences(&state)
}
#[tauri::command]
pub fn download_remove(
    app: tauri::AppHandle,
    state: State<Downloads>,
    id: String,
    delete_files: bool,
) -> Result<()> {
    let mut jobs = state.jobs.lock().unwrap();
    let job = jobs
        .iter()
        .find(|j| j.id == id)
        .cloned()
        .ok_or("Download not found.")?;
    if matches!(job.status.as_str(), "preparing" | "downloading" | "merging") {
        return Err("Cancel this download before removing it.".into());
    }
    if delete_files {
        let root = PathBuf::from(&job.directory)
            .canonicalize()
            .map_err(|_| "The download folder is unavailable.")?;
        if let Some(file) = &job.file {
            let path = PathBuf::from(file);
            if path.exists() {
                let canonical = path
                    .canonicalize()
                    .map_err(|_| "Could not find this download.")?;
                let filename = canonical
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default();
                let ext = canonical
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default();
                if !canonical.starts_with(&root)
                    || !filename.contains(&format!("[{}]", job.video_id))
                    || !["mp4", "webm", "mkv", "m4a"].contains(&ext)
                {
                    return Err("This file is outside the recorded download destination.".into());
                }
                fs::remove_file(canonical)
                    .map_err(|_| "Close this video in other programs before deleting it.")?;
            }
        } else {
            for entry in fs::read_dir(root)
                .map_err(|_| "Could not inspect partial downloads.")?
                .flatten()
            {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                if path.is_file()
                    && name.contains(&format!("[{}]", job.video_id))
                    && (name.ends_with(".part") || name.ends_with(".ytdl"))
                {
                    fs::remove_file(path).map_err(|_| "Could not delete a partial download.")?;
                }
            }
        }
    }
    jobs.retain(|j| j.id != id);
    fs::write(
        &state.record,
        serde_json::to_vec(&*jobs).unwrap_or_default(),
    )
    .map_err(|_| "Could not update the downloads list.")?;
    let _ = app.emit_to("main", "downloads-changed", &*jobs);
    Ok(())
}
#[tauri::command]
pub fn download_clear_finished(app: tauri::AppHandle, state: State<Downloads>) -> Result<()> {
    let mut jobs = state.jobs.lock().unwrap();
    jobs.retain(|j| matches!(j.status.as_str(), "preparing" | "downloading" | "merging"));
    fs::write(
        &state.record,
        serde_json::to_vec(&*jobs).unwrap_or_default(),
    )
    .map_err(|_| "Could not clear the downloads list.")?;
    let _ = app.emit_to("main", "downloads-changed", &*jobs);
    Ok(())
}

fn restored_directory(job: &Job, root: &Path) -> String {
    job.file
        .as_ref()
        .and_then(|file| Path::new(file).parent())
        .filter(|path| path.is_absolute())
        .unwrap_or(root)
        .to_string_lossy()
        .into_owned()
}
#[cfg(test)]
mod migration_tests {
    use super::*;
    #[test]
    fn legacy_downloads_keep_their_original_folder_after_renaming() {
        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("PureTube");
        let renamed = directory.path().join("Viddy");
        let mut job:Job=serde_json::from_value(json!({"id":"job","video_id":"jNQXAC9IVRw","title":"Video","status":"complete","percent":100,"message":"Saved","file":original.join("Video [jNQXAC9IVRw].mp4"),"quality":1080})).unwrap();
        assert_eq!(restored_directory(&job, &renamed), original.to_string_lossy());
        job.file = None;
        assert_eq!(restored_directory(&job, &renamed), renamed.to_string_lossy());
    }
}

#[cfg(test)]
mod preview_tests {
    use super::*;
    #[test]
    fn preview_urls_reject_untrusted_hosts_credentials_and_insecure_protocols(){
        assert!(preview_url("https://r1.googlevideo.com/videoplayback?expire=123").is_some());
        for value in ["http://r1.googlevideo.com/a","https://googlevideo.com.attacker.invalid/a","https://user:secret@r1.googlevideo.com/a","file:///tmp/video.mp4","https://r1.googlevideo.com/a#fragment"] {assert!(preview_url(value).is_none());}
    }
    #[test]
    fn both_mac_architectures_have_pinned_official_preview_helpers(){
        let tools:HashMap<String,Vec<Tool>>=serde_json::from_str(include_str!("../macos-preview-tools.json")).unwrap();
        for arch in ["aarch64","x86_64"] {
            let platform=&tools[arch];assert_eq!(platform.len(),2);
            for tool in platform {assert!(tool.url.starts_with("https://github.com/yt-dlp/yt-dlp/releases/download/")||tool.url.starts_with("https://github.com/denoland/deno/releases/download/"));assert_eq!(tool.sha256.len(),64);assert!(tool.sha256.bytes().all(|b|b.is_ascii_hexdigit()));assert_eq!(tool.files.len(),1);assert_eq!(tool.files[0].sha256.len(),64);}
        }
    }
}

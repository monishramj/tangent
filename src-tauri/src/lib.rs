use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
mod bootstrap;
mod checks;
mod llm;
mod menu;
mod pages;
mod store;
mod videos;
use tauri::{Emitter, Manager, RunEvent, State};

struct Process {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: mpsc::Receiver<Result<String, String>>,
    // Dropping the job kills uv and the python grandchild if the graceful close did not.
    #[cfg(windows)]
    job: Option<WindowsJob>,
}

impl Process {
    fn new(mut child: Child) -> Self {
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if tx.send(line.map_err(|e| e.to_string())).is_err() { break; }
            }
        });
        Self { child, stdin: Some(stdin), lines, #[cfg(windows)] job: None }
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        // Closing stdin lets the RPC loop finish. The job/process group covers a stuck grandchild.
        self.stdin.take();
        let deadline = std::time::Instant::now() + Duration::from_millis(300);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
                _ => {
                    #[cfg(unix)]
                    unsafe { libc::killpg(self.child.id() as i32, libc::SIGKILL); }
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    break;
                }
            }
        }
    }
}

#[cfg(windows)]
struct WindowsJob(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl WindowsJob {
    fn attach(child: &Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let job = Self(CreateJobObjectW(std::ptr::null(), std::ptr::null()));
            if job.0.is_null() { return Err(std::io::Error::last_os_error().to_string()); }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(job.0, JobObjectExtendedLimitInformation, (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(), std::mem::size_of_val(&info) as u32) == 0
                || AssignProcessToJobObject(job.0, child.as_raw_handle()) == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            Ok(job)
        }
    }
}
#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        if !self.0.is_null() { unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0); } }
    }
}

#[cfg(windows)]
fn resume(child: &Child) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    #[link(name = "ntdll")]
    unsafe extern "system" { fn NtResumeProcess(process: windows_sys::Win32::Foundation::HANDLE) -> i32; }
    if unsafe { NtResumeProcess(child.as_raw_handle()) } < 0 { Err("Could not resume the sidecar".into()) } else { Ok(()) }
}

#[derive(Default)]
struct Sidecar {
    proc: Option<Process>,
    next_id: u64,
}

#[derive(Default)]
struct State_ {
    work: Arc<Mutex<Sidecar>>,
    ingest: Arc<Mutex<Sidecar>>,
    // shortcut: jobs share a serial budget; yield between chunks if foreground latency needs preemption.
    job: Arc<Mutex<()>>,
    ping: Arc<Mutex<Sidecar>>,
}

impl State_ {
    fn connection(&self, method: &str) -> Arc<Mutex<Sidecar>> {
        // Python handles requests serially, so health checks need a separate connection.
        Arc::clone(match method { "ping" => &self.ping, "ingest_pdf" => &self.ingest, _ => &self.work })
    }
}

pub(crate) fn sidecar_dir(override_dir: Option<PathBuf>, manifest: &Path, dev: bool) -> Result<PathBuf, String> {
    if let Some(dir) = override_dir {
        if dir.as_os_str().is_empty() { return Err("TANGENT_SIDECAR_DIR must not be empty".into()); }
        return Ok(dir);
    }
    if dev { return Ok(manifest.join("../sidecar")); }
    // Same directory the packaged spawn uses: <resources>/runtime/sidecar, recorded at startup.
    bootstrap::recorded_sidecar().ok_or_else(|| "Packaged sidecar is <resources>/runtime/sidecar; startup has not recorded the app resources".into())
}

/// Shared heavy-work thread budget: ~30% of cores, max 6, at least 1.
fn sidecar_threads() -> usize {
    std::env::var("TANGENT_SIDECAR_THREADS").ok().and_then(|v| v.parse().ok()).filter(|&n| n > 0)
        .unwrap_or_else(|| (std::thread::available_parallelism().map_or(4, |n| n.get()) * 3 / 10).max(1)).min(6)
}

fn spawn(background: bool) -> Result<Process, String> {
    let mut cmd = if cfg!(debug_assertions) {
        let dir = sidecar_dir(std::env::var_os("TANGENT_SIDECAR_DIR").map(PathBuf::from), Path::new(env!("CARGO_MANIFEST_DIR")), true)?
            .canonicalize().map_err(|e| format!("sidecar directory: {e}"))?;
        let dirs = llm::search_dirs(&std::env::var("PATH").unwrap_or_default(), &llm::home_dir());
        let uv = llm::resolve("uv", &dirs).ok_or("uv not found in PATH, ~/.local/bin or /opt/homebrew/bin")?;
        let mut cmd = Command::new(uv);
        cmd.arg("run").arg("--project").arg(&dir).args(["python", "-m", "tangent_sidecar"])
            .current_dir(&dir).env("PATH", std::env::join_paths(&dirs).map_err(|e| e.to_string())?);
        cmd
    } else {
        let runtime = bootstrap::runtime()?;
        let mut cmd = Command::new(runtime.python());
        cmd.args(["-m", "tangent_sidecar"]).current_dir(runtime.project())
            .env("HF_HOME", runtime.data.join("models")).env("PYTHONNOUSERSITE", "1")
            .env("PYTHONDONTWRITEBYTECODE", "1");
        cmd
    };
    cmd
        .env("TANGENT_PARENT_PID", std::process::id().to_string()) // the sidecar's watchdog exits when we do
        .env("TANGENT_SIDECAR_THREADS", sidecar_threads().to_string())
        .env("TANGENT_WORK_CLASS", if background { "background" } else { "foreground" })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000 | 0x00000004); // CREATE_NO_WINDOW | CREATE_SUSPENDED, so it joins the job before spawning python
    }
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut proc = Process::new(cmd.spawn().map_err(|e| e.to_string())?);
    #[cfg(windows)]
    {
        proc.job = Some(WindowsJob::attach(&proc.child)?);
        if let Err(error) = resume(&proc.child) {
            drop(proc);
            return Err(error);
        }
    }
    Ok(proc)
}

#[cfg(test)]
fn call(s: &mut Sidecar, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
    call_progress(s, method, params, timeout, |_| {})
}

fn call_progress(s: &mut Sidecar, method: &str, params: Value, timeout: Duration, mut progress: impl FnMut(Value)) -> Result<Value, String> {
    if s.proc.is_none() { s.proc = Some(spawn(method == "ingest_pdf")?); }
    s.next_id += 1;
    let id = s.next_id;
    let process = s.proc.as_mut().unwrap();
    let response = (|| {
        let stdin = process.stdin.as_mut().ok_or("sidecar stdin is closed")?;
        writeln!(stdin, "{}", json!({"id": id, "method": method, "params": params})).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        loop {
            let line = process.lines.recv_timeout(timeout).map_err(|e| match e {
                mpsc::RecvTimeoutError::Timeout => "sidecar timed out".to_string(),
                // No respawn/retry here: the job fails and only the next request starts a fresh sidecar.
                mpsc::RecvTimeoutError::Disconnected => "sidecar exited unexpectedly; retry to restart it".to_string(),
            })??;
            let r: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
            if r["id"] != id { return Err(format!("id mismatch: {}", r["id"])); }
            if let Some(value) = r.get("progress") {
                progress(value.clone());
                continue;
            }
            return Ok(r);
        }
    })();
    let mut r = match response {
        Ok(r) => r,
        Err(error) => {
            s.proc = None; // Kill/reset after transport failure; never consume a stale response.
            return Err(error);
        }
    };
    match r["error"].as_str() {
        Some(e) => Err(e.to_string()),
        None => Ok(r["result"].take()),
    }
}

#[tauri::command]
async fn sidecar_call(app: tauri::AppHandle, state: State<'_, State_>, method: String, params: Value, timeout_ms: Option<u64>) -> Result<Value, String> {
    let connection = state.connection(&method);
    let job = Arc::clone(&state.job);
    tauri::async_runtime::spawn_blocking(move || {
        let _job = if method == "ping" { None } else { Some(job.lock().map_err(|e| e.to_string())?) };
        let path = params.get("path").cloned().unwrap_or(Value::Null);
        let mut sidecar = connection.lock().map_err(|e| e.to_string())?;
        call_progress(&mut sidecar, &method, params, Duration::from_millis(timeout_ms.unwrap_or(300_000)), |value| {
            let _ = app.emit("ingest-progress", json!({"path": path, "progress": value}));
        })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn dev_log(msg: String) { eprintln!("[webview] {msg}"); } // dev diagnostics: webview events land in the terminal log

/// Message shown when Linux cannot composite the window. `None` means rendering looks available.
#[cfg(any(test, target_os = "linux"))]
fn graphics_fix(webkit: bool, gpu: bool) -> Option<&'static str> {
    if !webkit {
        Some("WebKitGTK is not installed, so Tangent cannot draw its window. Install libwebkit2gtk-4.1. If the window is blank, quit and relaunch with WEBKIT_DISABLE_COMPOSITING_MODE=1.")
    } else if !gpu {
        Some("WebKitGTK cannot use the GPU, so the window may stay blank. Quit and relaunch with WEBKIT_DISABLE_COMPOSITING_MODE=1.")
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn library_loads(name: &str) -> bool {
    let Ok(c) = std::ffi::CString::new(name) else { return false };
    unsafe {
        let handle = libc::dlopen(c.as_ptr(), libc::RTLD_LAZY);
        if handle.is_null() { return false; }
        libc::dlclose(handle);
        true
    }
}

#[cfg(target_os = "linux")]
fn webkit_present() -> bool {
    ["libwebkit2gtk-4.1.so.0", "libwebkit2gtk-4.1.so", "libwebkit2gtk-4.0.so.37", "libwebkit2gtk-4.0.so"]
        .into_iter().any(library_loads)
}

#[cfg(target_os = "linux")]
fn gpu_rendering_available() -> bool {
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some() { return true; }
    let Ok(name) = std::ffi::CString::new("libEGL.so.1") else { return false };
    unsafe {
        let handle = libc::dlopen(name.as_ptr(), libc::RTLD_LAZY);
        if handle.is_null() { return false; }
        let get = libc::dlsym(handle, c"eglGetDisplay".as_ptr());
        let init = libc::dlsym(handle, c"eglInitialize".as_ptr());
        let ok = if get.is_null() || init.is_null() { false } else {
            let get: unsafe extern "C" fn(isize) -> *mut std::ffi::c_void = std::mem::transmute(get);
            let init: unsafe extern "C" fn(*mut std::ffi::c_void, *mut i32, *mut i32) -> i32 = std::mem::transmute(init);
            let display = get(0);
            if display.is_null() { false } else {
                let (mut major, mut minor) = (0, 0);
                init(display, &mut major, &mut minor) == 1
            }
        };
        libc::dlclose(handle);
        ok
    }
}

#[cfg(target_os = "linux")]
fn warn_graphics(app: &tauri::AppHandle) {
    let Some(msg) = graphics_fix(webkit_present(), gpu_rendering_available()) else { return };
    eprintln!("Tangent: {msg}");
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    app.dialog().message(msg).title("Tangent").kind(MessageDialogKind::Warning).show(|_| {});
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(State_::default())
        .manage(bootstrap::Setup::default())
        .register_uri_scheme_protocol("setup", |_, request| bootstrap::response(request))
        .on_menu_event(|app, event| menu::on_click(app, event.id().0.as_str()))
        .setup(|app| {
            menu::install(app.handle())?;
            #[cfg(target_os = "linux")]
            warn_graphics(app.handle());
            bootstrap::setup(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "bootstrap" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                // A successful setup shows main before closing the setup window.
                if bootstrap::runtime().is_err() { window.app_handle().exit(0); }
            }
        })
        .invoke_handler(tauri::generate_handler![bootstrap::bootstrap_status, bootstrap::bootstrap_start, bootstrap::bootstrap_cancel, checks::launch_checks, pages::pdf_page, sidecar_call, llm::llm_complete, dev_log, videos::save_video_bundle, videos::list_video_bundles, videos::load_video_bundle, videos::delete_video_bundle, store::store_read, store::store_write, store::store_delete, store::get_secret, store::set_secret, menu::sync_menu])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, e| {
            // Exit covers window close and quit; ExitRequested fires first, so kill there too.
            if matches!(e, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                app.state::<bootstrap::Setup>().cancel();
                let state = app.state::<State_>();
                for connection in [&state.work, &state.ingest, &state.ping] {
                    // try_lock: never hang quit behind a running job; the child's watchdog covers that case.
                    if let Ok(mut s) = connection.try_lock() { *s = Sidecar::default(); }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_sidecar() -> Sidecar {
        let child = Command::new("sh")
            .args(["-c", r#"i=0; while IFS= read -r line; do
                i=$((i+1))
                case "$line" in *slow*) sleep 0.5;; esac
                printf '{"id":%s,"result":"pong"}\n' "$i"
            done"#])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        Sidecar { proc: Some(Process::new(child)), next_id: 0 }
    }

    #[test]
    fn resolver_override_dev_and_bundle() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        assert_eq!(sidecar_dir(Some("/custom/sidecar".into()), manifest, false).unwrap(), PathBuf::from("/custom/sidecar"));
        assert_eq!(sidecar_dir(None, manifest, true).unwrap(), manifest.join("../sidecar"));
        assert!(sidecar_dir(None, manifest, false).is_err());
        assert!(sidecar_dir(Some("".into()), manifest, true).is_err());
        let resources = Path::new("/Applications/Tangent.app/Contents/Resources");
        assert_eq!(bootstrap::bundled_sidecar(resources), resources.join("runtime").join("sidecar"));
        let data = Path::new("/tmp/tangent-runtime");
        assert_eq!(bootstrap::python_at(data, false), data.join("env/bin/python"));
        assert_eq!(bootstrap::python_at(data, true), data.join("env/Scripts/python.exe"));
    }

    #[test]
    fn linux_graphics_message_names_the_fix() {
        assert!(graphics_fix(true, true).is_none());
        let missing = graphics_fix(false, false).unwrap();
        assert!(missing.contains("libwebkit2gtk-4.1") && missing.contains("WEBKIT_DISABLE_COMPOSITING_MODE=1"));
        let gpu = graphics_fix(true, false).unwrap();
        assert!(gpu.contains("WEBKIT_DISABLE_COMPOSITING_MODE=1"));
    }

    #[test]
    fn slow_work_does_not_block_ping() {
        let state = State_::default();
        *state.connection("ingest_pdf").lock().unwrap() = fake_sidecar();
        *state.connection("ping").lock().unwrap() = fake_sidecar();
        let work = state.connection("ingest_pdf");
        assert!(!Arc::ptr_eq(&work, &state.connection("tts_align")));
        let (started, waiting) = mpsc::channel();
        let job = std::thread::spawn(move || {
            let mut sidecar = work.lock().unwrap();
            started.send(()).unwrap();
            call(&mut sidecar, "slow", json!({}), Duration::from_secs(3))
        });
        waiting.recv().unwrap();
        let ping = state.connection("ping");
        let (tx, rx) = mpsc::channel();
        let ping_job = std::thread::spawn(move || {
            tx.send(call(&mut ping.lock().unwrap(), "ping", json!({}), Duration::from_secs(3))).unwrap();
        });
        assert_eq!(rx.recv_timeout(Duration::from_millis(300)).unwrap().unwrap(), "pong");
        assert!(!job.is_finished());
        assert_eq!(job.join().unwrap().unwrap(), "pong");
        ping_job.join().unwrap();
    }

    #[test]
    fn timeout_kills_connection_and_discards_stale_responses() {
        let mut sidecar = fake_sidecar();
        assert!(call(&mut sidecar, "slow", json!({}), Duration::from_millis(20)).unwrap_err().contains("timed out"));
        assert!(sidecar.proc.is_none());
        sidecar = fake_sidecar();
        assert_eq!(call(&mut sidecar, "ping", json!({}), Duration::from_secs(3)).unwrap(), "pong");
    }

    #[cfg(unix)]
    #[test]
    fn drop_kills_grandchild_and_dead_child_fails_without_respawn() {
        use std::os::unix::process::CommandExt;
        // sh -> background sleep (grandchild); after Drop both must be gone.
        let child = Command::new("sh").args(["-c", "sleep 30 & echo $!; wait"])
            .stdin(Stdio::piped()).stdout(Stdio::piped())
            .process_group(0).spawn().unwrap();
        let p = Process::new(child);
        let pid: i32 = p.lines.recv_timeout(Duration::from_secs(3)).unwrap().unwrap().parse().unwrap();
        assert_eq!(unsafe { libc::kill(pid, 0) }, 0);
        drop(p);
        std::thread::sleep(Duration::from_millis(200));
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "grandchild outlived the drop");

        // A sidecar that dies mid-job fails that call; it is not restarted inside the same call.
        let dead = Command::new("sh").args(["-c", "exit 0"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let mut s = Sidecar { proc: Some(Process::new(dead)), next_id: 0 };
        std::thread::sleep(Duration::from_millis(100));
        let err = call(&mut s, "ingest_pdf", json!({}), Duration::from_secs(1)).unwrap_err();
        assert!(s.proc.is_none(), "{err}");
    }

    #[test]
    fn chunk_progress_is_forwarded_before_the_final_response() {
        let child = Command::new("sh").args(["-c", r#"read line; printf '%s\n' '{"id":1,"progress":{"completed":20,"total":41,"paused":false}}' '{"id":1,"result":"done"}'"#])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let mut sidecar = Sidecar { proc: Some(Process::new(child)), next_id: 0 };
        let mut events = vec![];
        let result = call_progress(&mut sidecar, "ingest_pdf", json!({}), Duration::from_secs(3), |p| events.push(p)).unwrap();
        assert_eq!(result, "done");
        assert_eq!(events, vec![json!({"completed":20,"total":41,"paused":false})]);
    }

    #[test]
    fn thread_budget_defaults_and_overrides() {
        assert!((1..=6).contains(&sidecar_threads()));
    }
}

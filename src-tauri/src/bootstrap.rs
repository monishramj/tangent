//! Packaged-only Python setup. uv's cache and incomplete env survive cancellation.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf, process::{Command, Stdio}, sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

#[derive(Clone)]
pub(crate) struct Runtime {
    pub resource: PathBuf,
    pub data: PathBuf,
    fingerprint: String,
}

impl Runtime {
    fn new(resource: PathBuf, data: PathBuf) -> Result<Self, String> {
        let mut hash = Sha256::new();
        for name in ["pyproject.toml", "uv.lock"] {
            hash.update(fs::read(resource.join("sidecar").join(name)).map_err(|e| format!("Bundled {name}: {e}"))?);
        }
        hash.update(b"bootstrap-v2-python-");
        hash.update(PYTHON.as_bytes());
        Ok(Self { resource, data, fingerprint: format!("{:x}", hash.finalize()) })
    }
    pub fn python(&self) -> PathBuf {
        self.data.join(if cfg!(windows) { "env/Scripts/python.exe" } else { "env/bin/python" })
    }
    fn marker(&self) -> PathBuf { self.data.join("complete") }
    pub fn ready(&self) -> bool {
        self.python().is_file() && fs::read_to_string(self.marker()).is_ok_and(|v| v == self.fingerprint)
    }
}

// Exact CPython, so installs are reproducible; bump with the lock. Changing it invalidates the setup marker.
const PYTHON: &str = "3.12.14";

pub(crate) fn runtime() -> Result<&'static Runtime, String> {
    let runtime = RUNTIME.get().ok_or("Python setup has not started")?;
    if !runtime.ready() { return Err("Python setup is incomplete; finish setup before opening a document".into()); }
    Ok(runtime)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    status: String,
    phase: String,
    attempt: u8,
    download_gb: [u8; 2],
    message: String,
}
impl Progress {
    fn new(status: &str, phase: &str, attempt: u8, message: &str) -> Self {
        Self { status: status.into(), phase: phase.into(), attempt, download_gb: [2, 3], message: message.into() }
    }
}

pub struct Setup {
    cancel: Arc<AtomicBool>,
    running: AtomicBool,
    progress: Mutex<Progress>,
}
impl Default for Setup {
    fn default() -> Self {
        Self { cancel: Arc::new(AtomicBool::new(false)), running: AtomicBool::new(false),
            progress: Mutex::new(Progress::new("needed", "python", 0, "First setup downloads about 2–3 GB. Downloads are reused if you cancel or retry.")) }
    }
}
impl Setup {
    pub fn cancel(&self) { self.cancel.store(true, Ordering::SeqCst); }
}

// Only successful uv sync followed by a real interpreter gets a completion marker.
fn install(runtime: &Runtime, cancel: &AtomicBool, mut emit: impl FnMut(Progress),
    mut uv: impl FnMut(&str, u8) -> Result<(), String>) -> Result<(), String> {
    if runtime.ready() { emit(Progress::new("complete", "packages", 0, "Ready")); return Ok(()); }
    fs::create_dir_all(&runtime.data).map_err(|e| e.to_string())?;
    if runtime.marker().exists() { fs::remove_file(runtime.marker()).map_err(|e| e.to_string())?; }
    let mut current_phase = "python";
    let result = (|| {
        for phase in ["python", "packages"] {
            current_phase = phase;
            for attempt in 1..=3 {
                if cancel.load(Ordering::SeqCst) { return Err("Setup cancelled. You can resume anytime.".into()); }
                emit(Progress::new("installing", phase, attempt, if phase == "python" { "Preparing Python" } else { "Downloading and installing document and voice tools (about 2–3 GB)" }));
                match uv(phase, attempt) {
                    Ok(()) => break,
                    Err(error) => {
                        if cancel.load(Ordering::SeqCst) { return Err("Setup cancelled. You can resume anytime.".into()); }
                        if attempt == 3 { return Err(error); }
                        emit(Progress::new("retrying", phase, attempt, "Download interrupted. Retrying with cached downloads…"));
                    }
                }
            }
        }
        if cancel.load(Ordering::SeqCst) { return Err("Setup cancelled. You can resume anytime.".into()); }
        if !runtime.python().is_file() { return Err("Setup finished without a Python interpreter".into()); }
        let temp = runtime.data.join("complete.tmp");
        fs::write(&temp, &runtime.fingerprint).map_err(|e| e.to_string())?;
        fs::rename(temp, runtime.marker()).map_err(|e| e.to_string())?;
        Ok(())
    })();
    match &result {
        Ok(()) => emit(Progress::new("complete", "packages", 0, "Ready")),
        Err(error) => emit(Progress::new(if cancel.load(Ordering::SeqCst) { "cancelled" } else { "failed" }, current_phase, 0, error)),
    }
    result
}

fn run_uv(runtime: &Runtime, phase: &str, cancel: &AtomicBool) -> Result<(), String> {
    let uv = runtime.resource.join(if cfg!(windows) { "uv.exe" } else { "uv" });
    #[cfg(unix)]
    let mut cmd = {
        // The shell watchdog survives an app crash and kills uv's entire group.
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", r#"parent=$1; shift; "$@" & child=$!; (while kill -0 "$parent" 2>/dev/null; do sleep 1; done; kill -KILL -$$) & watcher=$!; wait "$child"; result=$?; kill "$watcher" 2>/dev/null; wait "$watcher" 2>/dev/null; exit "$result""#, "tangent-setup"])
            .arg(std::process::id().to_string()).arg(&uv);
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
        unsafe { cmd.pre_exec(|| { libc::setpriority(libc::PRIO_PROCESS, 0, 10); Ok(()) }); }
        cmd
    };
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new(uv);
        cmd.creation_flags(0x08000000 | 0x00000004); // CREATE_NO_WINDOW | CREATE_SUSPENDED: joins the job before it can spawn
        cmd
    };
    if phase == "python" {
        cmd.args(["python", "install", PYTHON]);
    } else {
        cmd.args(["sync", "--frozen", "--no-dev", "--python", PYTHON, "--managed-python", "--project"])
            .arg(runtime.resource.join("sidecar"));
    }
    cmd.env("UV_PROJECT_ENVIRONMENT", runtime.data.join("env"))
        .env("UV_PYTHON_INSTALL_DIR", runtime.data.join("python"))
        .env("UV_CACHE_DIR", runtime.data.join("cache"))
        .env("UV_HTTP_RETRIES", "3")
        .env("UV_CONCURRENT_DOWNLOADS", "2").env("UV_CONCURRENT_BUILDS", "1").env("UV_CONCURRENT_INSTALLS", "2")
        .stdin(Stdio::null()).stdout(Stdio::null());
    let log = fs::File::create(runtime.data.join("setup.log")).map_err(|e| e.to_string())?;
    cmd.stderr(log);
    let mut child = cmd.spawn().map_err(|e| format!("Could not start bundled uv: {e}"))?;
    #[cfg(windows)]
    let _job = match WindowsJob::attach(&child) {
        Ok(job) => job,
        Err(error) => { let _ = child.kill(); let _ = child.wait(); return Err(error); }
    };
    #[cfg(windows)]
    {
        // Unverified on real Windows (not compilable here). Resumes the suspended uv now that it is in the job.
        use std::os::windows::io::AsRawHandle;
        #[link(name = "ntdll")]
        extern "system" { fn NtResumeProcess(process: windows_sys::Win32::Foundation::HANDLE) -> i32; }
        if unsafe { NtResumeProcess(child.as_raw_handle()) } < 0 {
            let _ = child.kill(); let _ = child.wait();
            return Err("Could not start bundled uv".into());
        }
    }
    loop {
        if cancel.load(Ordering::SeqCst) {
            #[cfg(unix)]
            unsafe { libc::killpg(child.id() as i32, libc::SIGKILL); }
            #[cfg(windows)]
            let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &child.id().to_string()]).status();
            let _ = child.kill();
            let _ = child.wait();
            return Err("Setup cancelled".into());
        }
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(status) => return Err(format!("Download or install failed ({status}). Check your connection and retry. Details: {}", runtime.data.join("setup.log").display())),
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

// Closing this handle (including app crashes) terminates uv and every child on Windows.
#[cfg(windows)]
struct WindowsJob(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl WindowsJob {
    fn attach(child: &std::process::Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let job = Self(CreateJobObjectW(std::ptr::null(), std::ptr::null()));
            if job.0.is_null() { return Err(std::io::Error::last_os_error().to_string()); }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            info.BasicLimitInformation.PriorityClass = windows_sys::Win32::System::Threading::BELOW_NORMAL_PRIORITY_CLASS;
            info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PRIORITY_CLASS;
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
    fn drop(&mut self) { unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0); } }
}

#[tauri::command]
pub fn bootstrap_status(state: State<'_, Setup>) -> Progress { state.progress.lock().unwrap().clone() }

#[tauri::command]
pub fn bootstrap_cancel(state: State<'_, Setup>) { state.cancel(); }

#[tauri::command]
pub fn bootstrap_start(app: AppHandle, state: State<'_, Setup>) -> Result<(), String> {
    let runtime = RUNTIME.get().ok_or("No packaged runtime")?.clone();
    if state.running.swap(true, Ordering::SeqCst) { return Ok(()); }
    state.cancel.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        let state = app.state::<Setup>();
        let _ = install(&runtime, &state.cancel, |progress| {
            *state.progress.lock().unwrap() = progress.clone();
            let _ = app.emit("runtime-setup", &progress);
        }, |phase, _| run_uv(&runtime, phase, &state.cancel));
        state.running.store(false, Ordering::SeqCst);
        if runtime.ready() {
            let _ = open_main(&app);
            if let Some(window) = app.get_webview_window("bootstrap") { let _ = window.close(); }
        }
    });
    Ok(())
}

/// The main window is created (config `create: false`) only once setup is not needed, so the frontend
/// can never call the sidecar before the runtime is ready.
fn needs_setup(dev: bool, ready: bool) -> bool { !dev && !ready }

fn open_main(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if app.get_webview_window("main").is_none() {
        WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?.build()?;
    }
    Ok(())
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let dev = cfg!(debug_assertions);
    let mut ready = true;
    if !dev {
        let runtime = Runtime::new(app.path().resource_dir()?.join("runtime"), app.path().app_data_dir()?.join("runtime"))?;
        ready = runtime.ready();
        RUNTIME.set(runtime).map_err(|_| "Runtime already configured")?;
    }
    if needs_setup(dev, ready) {
        WebviewWindowBuilder::new(app, "bootstrap", WebviewUrl::CustomProtocol("setup://localhost/".parse()?))
            .title("Set up Tangent").inner_size(560.0, 370.0).resizable(false).build()?;
    } else {
        open_main(app)?;
    }
    Ok(())
}

pub fn response(request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let script = request.uri().path().ends_with("setup.js");
    tauri::http::Response::builder()
        .header("Content-Type", if script { "application/javascript" } else { "text/html; charset=utf-8" })
        .header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src ipc: http://ipc.localhost")
        .body(if script { include_bytes!("bootstrap.js").to_vec() } else { include_bytes!("bootstrap.html").to_vec() }).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_window_waits_for_setup() {
        assert!(!needs_setup(true, false)); // dev keeps its existing launch path
        assert!(!needs_setup(false, true));
        assert!(needs_setup(false, false));
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["app"]["windows"][0]["create"], false, "main must be created by setup()");
    }

    #[test]
    fn bootstrap_capability_is_minimal_and_main_has_no_bootstrap_commands() {
        let cap = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        let strings = |v: &serde_json::Value| v.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect::<Vec<_>>();
        let boot = cap(include_str!("../capabilities/bootstrap.json"));
        assert_eq!(strings(&boot["windows"]), ["bootstrap"]);
        assert_eq!(strings(&boot["permissions"]), ["allow-bootstrap-status", "allow-bootstrap-start", "allow-bootstrap-cancel"]);
        // Every command bootstrap.js invokes is granted, and nothing else is.
        let js = include_str!("bootstrap.js");
        for command in ["bootstrap_status", "bootstrap_start", "bootstrap_cancel"] { assert!(js.contains(&format!("'{command}'"))); }
        assert_eq!(js.matches("invoke('").count(), 3);
        let main = cap(include_str!("../capabilities/default.json"));
        assert_eq!(strings(&main["windows"]), ["main"]);
        assert!(!strings(&main["permissions"]).iter().any(|p| p.contains("bootstrap")));
    }
    static ID: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    struct FakeUv(Runtime);
    impl FakeUv {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("tangent setup test-{}-{}", std::process::id(), ID.fetch_add(1, Ordering::SeqCst)));
            fs::create_dir_all(root.join("resource/sidecar")).unwrap();
            for name in ["pyproject.toml", "uv.lock"] { fs::write(root.join("resource/sidecar").join(name), "fixture").unwrap(); }
            Self(Runtime::new(root.join("resource"), root.join("data")).unwrap())
        }
        fn run(&self, phase: &str) -> Result<(), String> {
            if phase == "packages" {
                fs::create_dir_all(self.0.python().parent().unwrap()).unwrap();
                fs::write(self.0.python(), "fake python").unwrap();
            }
            Ok(())
        }
    }
    impl Drop for FakeUv { fn drop(&mut self) { let _ = fs::remove_dir_all(self.0.resource.parent().unwrap()); } }
    #[cfg(unix)]
    #[test]
    fn fake_uv_executable_uses_bundled_paths_and_cancels() {
        use std::os::unix::fs::PermissionsExt;
        let uv = FakeUv::new();
        let path = uv.0.resource.join("uv");
        fs::write(&path, r#"#!/bin/sh
mkdir -p "$UV_PYTHON_INSTALL_DIR"
printf '%s\n' "$@" >> "$UV_PYTHON_INSTALL_DIR/../args"
if [ "$1" = python ]; then exit 0; fi
mkdir -p "$UV_PROJECT_ENVIRONMENT/bin"
: > "$UV_PROJECT_ENVIRONMENT/bin/python"
"#).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        let cancel = AtomicBool::new(false);
        install(&uv.0, &cancel, |_| {}, |phase, _| run_uv(&uv.0, phase, &cancel)).unwrap();
        assert!(uv.0.ready());
        let args = fs::read_to_string(uv.0.data.join("args")).unwrap();
        assert!(args.contains("--frozen\n--no-dev"));
        assert!(args.contains(uv.0.resource.join("sidecar").to_str().unwrap()));
        fs::write(&path, "#!/bin/sh\nsleep 30\n").unwrap();
        let cancel = Arc::new(AtomicBool::new(false)); let flag = cancel.clone();
        let thread = std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(150)); flag.store(true, Ordering::SeqCst); });
        assert!(run_uv(&uv.0, "python", &cancel).is_err());
        thread.join().unwrap();
    }
    #[test]
    fn fresh_partial_complete_and_changed_lock() {
        let uv = FakeUv::new(); let cancel = AtomicBool::new(false); let mut events = vec![];
        // An incomplete prior install is reused but never treated as complete.
        uv.run("packages").unwrap(); assert!(!uv.0.ready());
        install(&uv.0, &cancel, |p| events.push(p), |phase, _| uv.run(phase)).unwrap();
        assert!(uv.0.ready()); assert_eq!(events.first().unwrap().phase, "python");
        assert_eq!(events.last().unwrap().status, "complete");
        assert_eq!(serde_json::to_value(&events[0]).unwrap()["downloadGb"], serde_json::json!([2, 3]));
        install(&uv.0, &cancel, |_| {}, |_, _| panic!("complete setup must not run uv")).unwrap();
        fs::write(uv.0.resource.join("sidecar/uv.lock"), "new lock").unwrap();
        let updated = Runtime::new(uv.0.resource.clone(), uv.0.data.clone()).unwrap();
        assert!(!updated.ready());
    }
    #[test]
    fn missing_interpreter_invalidates_marker_and_success_without_python_is_rejected() {
        let uv = FakeUv::new();
        fs::create_dir_all(&uv.0.data).unwrap();
        fs::write(uv.0.marker(), &uv.0.fingerprint).unwrap();
        assert!(!uv.0.ready());
        assert!(install(&uv.0, &AtomicBool::new(false), |_| {}, |_, _| Ok(())).is_err());
        assert!(!uv.0.marker().exists());
    }
    #[test]
    fn fresh_install_and_network_retry() {
        let uv = FakeUv::new(); let mut calls = 0; let mut retry = false;
        assert!(!uv.0.data.exists());
        install(&uv.0, &AtomicBool::new(false), |p| retry |= p.status == "retrying", |phase, attempt| {
            calls += 1;
            if attempt == 1 { Err("network".into()) } else { uv.run(phase) }
        }).unwrap();
        assert_eq!(calls, 4); assert!(retry); assert!(uv.0.ready());
    }
    #[test]
    fn failed_network_and_cancel_never_mark_complete_and_can_resume() {
        let uv = FakeUv::new(); let cancel = AtomicBool::new(false); let mut calls = 0; let mut last = String::new();
        assert!(install(&uv.0, &cancel, |p| last = p.status, |_, _| { calls += 1; Err("network".into()) }).is_err());
        assert_eq!(calls, 3); assert_eq!(last, "failed"); assert!(!uv.0.marker().exists());
        assert!(install(&uv.0, &cancel, |p| last = p.status, |phase, _| { cancel.store(true, Ordering::SeqCst); uv.run(phase) }).is_err());
        assert_eq!(last, "cancelled"); assert!(!uv.0.ready()); assert!(!uv.0.marker().exists());
        cancel.store(false, Ordering::SeqCst);
        install(&uv.0, &cancel, |_| {}, |phase, _| uv.run(phase)).unwrap(); assert!(uv.0.ready());
    }
}

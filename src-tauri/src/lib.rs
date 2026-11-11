use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
mod llm;
mod pages;
mod store;
mod videos;
use tauri::{Manager, RunEvent, State};

struct Process {
    child: Child,
    stdin: ChildStdin,
    lines: mpsc::Receiver<Result<String, String>>,
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
        Self { child, stdin, lines }
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct Sidecar {
    proc: Option<Process>,
    next_id: u64,
}

#[derive(Default)]
struct State_ {
    work: Arc<Mutex<Sidecar>>,
    ping: Arc<Mutex<Sidecar>>,
}

impl State_ {
    fn connection(&self, method: &str) -> Arc<Mutex<Sidecar>> {
        // Python handles requests serially, so health checks need a separate connection.
        Arc::clone(if method == "ping" { &self.ping } else { &self.work })
    }
}

pub(crate) fn sidecar_dir(override_dir: Option<PathBuf>, manifest: &Path, dev: bool) -> Result<PathBuf, String> {
    if let Some(dir) = override_dir {
        if dir.as_os_str().is_empty() { return Err("TANGENT_SIDECAR_DIR must not be empty".into()); }
        return Ok(dir);
    }
    if dev { return Ok(manifest.join("../sidecar")); }
    // TODO: resolve the bundled sidecar executable/resources when packaging is implemented.
    Err("bundled sidecar is not configured; set TANGENT_SIDECAR_DIR to a uv project".into())
}

fn spawn() -> Result<Process, String> {
    let dir = sidecar_dir(std::env::var_os("TANGENT_SIDECAR_DIR").map(PathBuf::from), Path::new(env!("CARGO_MANIFEST_DIR")), cfg!(debug_assertions))?
        .canonicalize().map_err(|e| format!("sidecar directory: {e}"))?;
    let home = llm::home_dir();
    let dirs = llm::search_dirs(&std::env::var("PATH").unwrap_or_default(), &home);
    let uv = llm::resolve("uv", &dirs).ok_or("uv not found in PATH, ~/.local/bin or /opt/homebrew/bin")?;
    let child = Command::new(uv)
        .arg("run").arg("--project").arg(&dir).args(["python", "-m", "tangent_sidecar"])
        .current_dir(&dir)
        .env("PATH", std::env::join_paths(&dirs).map_err(|e| e.to_string())?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(Process::new(child))
}

fn call(s: &mut Sidecar, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
    if s.proc.is_none() { s.proc = Some(spawn()?); }
    s.next_id += 1;
    let id = s.next_id;
    let process = s.proc.as_mut().unwrap();
    let response = (|| {
        writeln!(process.stdin, "{}", json!({"id": id, "method": method, "params": params})).map_err(|e| e.to_string())?;
        process.stdin.flush().map_err(|e| e.to_string())?;
        let line = process.lines.recv_timeout(timeout).map_err(|e| match e {
            mpsc::RecvTimeoutError::Timeout => "sidecar timed out".to_string(),
            mpsc::RecvTimeoutError::Disconnected => "sidecar exited".to_string(),
        })??;
        let r: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        if r["id"] != id { return Err(format!("id mismatch: {}", r["id"])); }
        Ok(r)
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
async fn sidecar_call(state: State<'_, State_>, method: String, params: Value, timeout_ms: Option<u64>) -> Result<Value, String> {
    let connection = state.connection(&method);
    tauri::async_runtime::spawn_blocking(move || {
        let mut sidecar = connection.lock().map_err(|e| e.to_string())?;
        call(&mut sidecar, &method, params, Duration::from_millis(timeout_ms.unwrap_or(300_000)))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn dev_log(msg: String) { eprintln!("[webview] {msg}"); } // dev diagnostics: webview events land in the terminal log

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(State_::default())
        .invoke_handler(tauri::generate_handler![pages::pdf_page, sidecar_call, llm::llm_complete, dev_log, videos::save_video_bundle, videos::list_video_bundles, videos::load_video_bundle, videos::delete_video_bundle, store::store_read, store::store_write, store::store_delete, store::get_secret, store::set_secret])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, e| {
            if let RunEvent::Exit = e {
                let state = app.state::<State_>();
                for connection in [&state.work, &state.ping] {
                    *connection.lock().unwrap() = Sidecar::default();
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
        assert!(sidecar_dir(None, manifest, false).unwrap_err().contains("bundled"));
        assert!(sidecar_dir(Some("".into()), manifest, true).is_err());
    }

    #[test]
    fn slow_work_does_not_block_ping() {
        let state = State_::default();
        *state.connection("tts_align").lock().unwrap() = fake_sidecar();
        *state.connection("ping").lock().unwrap() = fake_sidecar();
        let work = state.connection("ingest_pdf");
        assert!(Arc::ptr_eq(&work, &state.connection("tts_align")));
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
}

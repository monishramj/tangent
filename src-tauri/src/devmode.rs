//! Developer mode (Settings → Developer): webview events, sidecar/LLM call traces and sidecar stderr
//! go to `<app log dir>/dev.log` so a failed generation can be diagnosed from an installed build.
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::Manager;

static DIR: OnceLock<PathBuf> = OnceLock::new();
static ON: AtomicBool = AtomicBool::new(false);

fn flag() -> Option<PathBuf> { DIR.get().map(|d| d.join("dev-mode")) }
fn log_path() -> Option<PathBuf> { DIR.get().map(|d| d.join("dev.log")) }

pub fn setup(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_log_dir() {
        ON.store(dir.join("dev-mode").exists(), Ordering::Relaxed);
        let _ = DIR.set(dir);
    }
}

pub fn on() -> bool { ON.load(Ordering::Relaxed) }

/// Append-mode handle for the dev log (also used as the sidecar's stderr), only while dev mode is on.
pub fn file() -> Option<File> {
    if !on() { return None; }
    let path = log_path()?;
    std::fs::create_dir_all(path.parent()?).ok()?;
    OpenOptions::new().create(true).append(true).open(path).ok()
}

pub fn log(line: &str) {
    eprintln!("[webview] {line}");
    if let Some(mut f) = file() { let _ = writeln!(f, "{line}"); }
}

#[tauri::command]
pub fn dev_log(msg: String) { log(&msg); }

/// (on, log path)
#[tauri::command]
pub fn dev_mode() -> (bool, String) {
    (on(), log_path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default())
}

#[tauri::command]
pub fn set_dev_mode(on: bool) -> Result<(), String> {
    let flag = flag().ok_or("no app log directory")?;
    if on {
        std::fs::create_dir_all(flag.parent().unwrap()).map_err(|e| e.to_string())?;
        File::create(&flag).map_err(|e| e.to_string())?;
    } else if flag.exists() {
        std::fs::remove_file(&flag).map_err(|e| e.to_string())?;
    }
    ON.store(on, Ordering::Relaxed);
    if on { log(&format!("--- dev mode on, Tangent {} ---", env!("CARGO_PKG_VERSION"))); }
    Ok(())
}

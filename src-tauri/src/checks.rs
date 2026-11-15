//! Read-only Claude Code status for the first-launch screen.
//! Fixed argv only: `--version` and `auth status`. Never `claude -p` (that spends quota).
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const OUT_CAP: usize = 64 * 1024;

const VERSION_ARGS: &[&str] = &["--version"];
const AUTH_ARGS: &[&str] = &["auth", "status", "--json"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeKind { Ok, Missing, Timeout, Failed }

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Probe { pub kind: ProbeKind, pub out: String }

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchChecks {
    pub installed: String,
    pub version: Option<String>,
    pub signed_in: String,
}

pub fn assess(version: &Probe, auth: Option<&Probe>) -> LaunchChecks {
    let ver = (version.kind == ProbeKind::Ok).then(|| version_line(&version.out)).flatten();
    let installed = match version.kind {
        ProbeKind::Missing => "missing",
        ProbeKind::Timeout => "timeout",
        ProbeKind::Failed => "failed",
        ProbeKind::Ok if ver.is_none() => "failed",
        ProbeKind::Ok => "ok",
    };
    let signed_in = if installed != "ok" { "skipped" } else {
        match auth {
            None => "skipped",
            Some(p) if p.kind == ProbeKind::Timeout => "timeout",
            Some(p) => match logged_in(&p.out) {
                Some(true) => "ok",
                Some(false) => "signed_out",
                None => "failed",
            },
        }
    };
    LaunchChecks { installed: installed.into(), version: ver, signed_in: signed_in.into() }
}

/// First non-empty line, capped. Drop anything that looks like an account or a secret.
fn version_line(out: &str) -> Option<String> {
    let line = out.lines().map(str::trim).find(|l| !l.is_empty())?;
    let lower = line.to_ascii_lowercase();
    if line.len() > 80 || line.contains('@') || lower.contains("token") { return None; }
    Some(line.to_string())
}

/// `loggedIn` only. The status JSON also carries email and org fields; those stay here.
fn logged_in(out: &str) -> Option<bool> {
    let start = out.find('{')?;
    let end = out.rfind('}')?;
    if end < start { return None; }
    serde_json::from_str::<Value>(&out[start..=end]).ok()?.get("loggedIn")?.as_bool()
}

struct Drain {
    buf: Arc<Mutex<Vec<u8>>>,
    done: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

/// Read until EOF or the deadline. Keep at most `keep` bytes; further bytes are discarded so the pipe cannot fill.
fn start_drain(mut reader: impl Read + Send + 'static, deadline: Instant, keep: usize) -> Drain {
    let buf = Arc::new(Mutex::new(Vec::new()));
    let done = Arc::new(AtomicBool::new(false));
    let (buf2, done2) = (buf.clone(), done.clone());
    let handle = std::thread::spawn(move || {
        let mut tmp = [0u8; 8192];
        while Instant::now() < deadline {
            let n = match reader.read(&mut tmp) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            if Instant::now() >= deadline { break; } // a read that returns past the deadline is dropped
            if keep > 0 {
                let mut got = buf2.lock().unwrap();
                let room = keep.saturating_sub(got.len());
                if room > 0 { got.extend_from_slice(&tmp[..n.min(room)]); }
            }
        }
        done2.store(true, Ordering::Release);
    });
    Drain { buf, done, handle: Some(handle) }
}

impl Drain {
    fn finish(mut self) -> Vec<u8> {
        if let Some(handle) = self.handle.take() { let _ = handle.join(); }
        self.buf.lock().unwrap().clone()
    }
}

fn kill_tree(child: &mut Child) {
    #[cfg(unix)]
    unsafe { libc::killpg(child.id() as i32, libc::SIGKILL); }
    #[cfg(windows)]
    { let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &child.id().to_string()]).status(); }
    let _ = child.kill();
    let _ = child.wait();
}

pub fn run_probe(exe: &Path, args: &[&str], timeout: Duration) -> Probe {
    if !exe.is_file() { return Probe { kind: ProbeKind::Missing, out: String::new() }; }
    let home = crate::llm::home_dir();
    let dirs = crate::llm::search_dirs(&std::env::var("PATH").unwrap_or_default(), &home);
    let mut cmd = Command::new(exe);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Ok(path) = std::env::join_paths(&dirs) { cmd.env("PATH", path); }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0); // so a timeout can kill grandchildren that inherited the pipes
    }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Probe { kind: ProbeKind::Missing, out: String::new() },
        Err(_) => return Probe { kind: ProbeKind::Failed, out: String::new() },
    };
    let deadline = Instant::now() + timeout;
    let stdout = start_drain(child.stdout.take().unwrap(), deadline, OUT_CAP);
    let stderr = start_drain(child.stderr.take().unwrap(), deadline, 0); // discard; may contain account text
    // try_wait reaps, so a later call returns None. Remember the first status and keep waiting for EOF.
    let mut status = None;
    let status = loop {
        if Instant::now() >= deadline {
            kill_tree(&mut child);
            let _ = (stdout.finish(), stderr.finish());
            return Probe { kind: ProbeKind::Timeout, out: String::new() };
        }
        if status.is_none() {
            match child.try_wait() {
                Ok(found) => status = found,
                Err(_) => {
                    kill_tree(&mut child);
                    let _ = (stdout.finish(), stderr.finish());
                    return Probe { kind: ProbeKind::Failed, out: String::new() };
                }
            }
        }
        if status.is_some() && stdout.done.load(Ordering::Acquire) && stderr.done.load(Ordering::Acquire) { break status.unwrap(); }
        std::thread::sleep(Duration::from_millis(20));
    };
    let out = String::from_utf8_lossy(&stdout.finish()).into_owned();
    let _ = stderr.finish();
    Probe { kind: if status.success() { ProbeKind::Ok } else { ProbeKind::Failed }, out }
}

pub fn claude_checks() -> LaunchChecks {
    let home = crate::llm::home_dir();
    let dirs = crate::llm::search_dirs(&std::env::var("PATH").unwrap_or_default(), &home);
    let Some(exe) = crate::llm::resolve("claude", &dirs) else {
        return assess(&Probe { kind: ProbeKind::Missing, out: String::new() }, None);
    };
    let version = run_probe(&exe, VERSION_ARGS, Duration::from_secs(8));
    if version.kind != ProbeKind::Ok { return assess(&version, None); }
    let auth = run_probe(&exe, AUTH_ARGS, Duration::from_secs(8));
    assess(&version, Some(&auth))
}

#[tauri::command]
pub async fn launch_checks() -> Result<LaunchChecks, String> {
    tauri::async_runtime::spawn_blocking(claude_checks).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(kind: ProbeKind, out: &str) -> Probe { Probe { kind, out: out.into() } }

    #[test]
    fn status_commands_do_not_prompt() {
        let args = VERSION_ARGS.iter().chain(AUTH_ARGS).copied().collect::<Vec<_>>();
        assert!(!args.iter().any(|a| *a == "-p" || *a == "--print" || a.starts_with("--model")));
        assert_eq!(AUTH_ARGS, ["auth", "status", "--json"]);
    }

    #[test]
    fn not_installed_skips_login() {
        let r = assess(&probe(ProbeKind::Missing, ""), None);
        assert_eq!(r, LaunchChecks { installed: "missing".into(), version: None, signed_in: "skipped".into() });
    }

    #[test]
    fn not_logged_in_drops_account_fields() {
        let raw = r#"{"loggedIn":false,"email":"student@school.edu","orgName":"School"}"#;
        let r = assess(&probe(ProbeKind::Ok, "2.1.44 (Claude Code)\n"), Some(&probe(ProbeKind::Failed, raw)));
        assert_eq!(r.installed, "ok");
        assert_eq!(r.version.as_deref(), Some("2.1.44 (Claude Code)"));
        assert_eq!(r.signed_in, "signed_out");
        let json = serde_json::to_string(&r).unwrap();
        assert!(!json.contains("student@school.edu") && !json.contains("email"));
    }

    #[test]
    fn logged_in_ok() {
        let raw = "{\"loggedIn\": true, \"email\": \"a@b.c\"}\n";
        let r = assess(&probe(ProbeKind::Ok, "2.0.1\n"), Some(&probe(ProbeKind::Ok, raw)));
        assert_eq!(r.signed_in, "ok");
        assert!(!serde_json::to_string(&r).unwrap().contains("a@b.c"));
    }

    #[test]
    fn timeout_and_unreadable_version() {
        let r = assess(&probe(ProbeKind::Timeout, ""), None);
        assert_eq!(r.installed, "timeout");
        assert_eq!(r.signed_in, "skipped");
        let auth = assess(&probe(ProbeKind::Ok, "2.0.1\n"), Some(&probe(ProbeKind::Timeout, "")));
        assert_eq!(auth.signed_in, "timeout");
        let junk = assess(&probe(ProbeKind::Ok, "token=secret\n"), None);
        assert_eq!(junk.installed, "failed");
        let broken = assess(&probe(ProbeKind::Ok, "2.0.1\n"), Some(&probe(ProbeKind::Failed, "not json")));
        assert_eq!(broken.signed_in, "failed");
    }

    #[cfg(unix)]
    #[test]
    fn probe_ok_missing_failed_and_timeout() {
        let ok = run_probe(Path::new("/bin/echo"), &["9.9.9"], Duration::from_secs(2));
        assert_eq!(ok.kind, ProbeKind::Ok);
        assert!(ok.out.contains("9.9.9"));
        assert!(ok.out.len() <= OUT_CAP);
        assert_eq!(run_probe(Path::new("/no/such/claude-bin"), &["--version"], Duration::from_millis(200)).kind, ProbeKind::Missing);
        assert_eq!(run_probe(Path::new("/bin/sh"), &["-c", "exit 3"], Duration::from_secs(2)).kind, ProbeKind::Failed);
        let start = Instant::now();
        assert_eq!(run_probe(Path::new("/bin/sleep"), &["5"], Duration::from_millis(200)).kind, ProbeKind::Timeout);
        assert!(start.elapsed() < Duration::from_millis(800), "slept {:?}", start.elapsed());
    }

    #[cfg(unix)]
    #[test]
    fn flood_is_capped_and_does_not_false_timeout() {
        let start = Instant::now();
        let p = run_probe(Path::new("/bin/sh"), &["-c", "dd if=/dev/zero bs=65536 count=32 2>/dev/null"], Duration::from_secs(3));
        assert_eq!(p.kind, ProbeKind::Ok, "{:?}", start.elapsed());
        assert!(p.out.len() <= OUT_CAP);
        assert!(start.elapsed() < Duration::from_secs(2), "{:?}", start.elapsed());
    }

    #[cfg(unix)]
    #[test]
    fn grandchild_holding_the_pipe_cannot_outrun_the_deadline() {
        let marker = std::env::temp_dir().join(format!("tangent-probe-{}", std::process::id()));
        let _ = std::fs::remove_file(&marker);
        // The background subshell inherits our stdout pipe, then the shell exits. Redirecting that subshell would hide the bug.
        let script = format!("(sleep 1; echo x > '{}') & exit 0", marker.display());
        let start = Instant::now();
        let p = run_probe(Path::new("/bin/sh"), &["-c", &script], Duration::from_millis(150));
        assert_eq!(p.kind, ProbeKind::Timeout);
        assert!(start.elapsed() < Duration::from_millis(800), "deadline slipped to {:?}", start.elapsed());
        std::thread::sleep(Duration::from_millis(1200));
        assert!(!marker.exists(), "grandchild outlived the timeout");
        let _ = std::fs::remove_file(&marker);
    }
}

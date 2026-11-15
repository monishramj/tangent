//! Read-only Claude Code status for the first-launch screen.
//! Fixed argv only: `--version` and `auth status`. Never `claude -p` (that spends quota).
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

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

pub fn run_probe(exe: &Path, args: &[&str], timeout: Duration) -> Probe {
    if !exe.is_file() { return Probe { kind: ProbeKind::Missing, out: String::new() }; }
    let home = crate::llm::home_dir();
    let dirs = crate::llm::search_dirs(&std::env::var("PATH").unwrap_or_default(), &home);
    let mut cmd = Command::new(exe);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    if let Ok(path) = std::env::join_paths(&dirs) { cmd.env("PATH", path); }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Probe { kind: ProbeKind::Missing, out: String::new() },
        Err(_) => return Probe { kind: ProbeKind::Failed, out: String::new() },
    };
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Probe { kind: ProbeKind::Timeout, out: String::new() };
            }
            // ponytail: poll; these checks return in well under a second
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => return Probe { kind: ProbeKind::Failed, out: String::new() },
        }
    };
    let mut out = String::new();
    if let Some(mut stdout) = child.stdout.take() { let _ = stdout.read_to_string(&mut out); }
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
        assert_eq!(run_probe(Path::new("/no/such/claude-bin"), &["--version"], Duration::from_millis(200)).kind, ProbeKind::Missing);
        assert_eq!(run_probe(Path::new("/bin/sh"), &["-c", "exit 3"], Duration::from_secs(2)).kind, ProbeKind::Failed);
        assert_eq!(run_probe(Path::new("/bin/sleep"), &["5"], Duration::from_millis(400)).kind, ProbeKind::Timeout);
    }
}

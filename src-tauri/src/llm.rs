//! `llm_complete`: runs a headless coding-agent CLI for the webview (which cannot spawn processes).
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// (binary, args, prompt-on-stdin). `out_file` is where codex writes its final message.
pub fn build_args(provider: &str, system: Option<&str>, out_file: &Path) -> Result<(&'static str, Vec<String>), String> {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    match provider {
        "claude" => {
            let mut a = s(&["-p", "--output-format", "text", "--model", "sonnet"]);
            if let Some(sys) = system {
                a.extend(s(&["--system-prompt", sys]));
            }
            Ok(("claude", a))
        }
        // codex has no system-prompt flag; the caller prepends it to stdin (see `stdin_for`).
        "codex" => {
            let mut a = s(&["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--color", "never", "--output-last-message"]);
            a.push(out_file.to_string_lossy().into_owned());
            a.push("-".into()); // prompt from stdin
            Ok(("codex", a))
        }
        p => Err(format!("unknown provider: {p}")),
    }
}

pub fn stdin_for(provider: &str, prompt: &str, system: Option<&str>) -> String {
    match (provider, system) {
        ("codex", Some(sys)) => format!("{sys}\n\n{prompt}"),
        _ => prompt.to_string(),
    }
}

/// PATH entries plus the dirs GUI apps miss. `path` is the inherited $PATH, `home` is $HOME.
pub fn search_dirs(path: &str, home: &str) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::env::split_paths(path).collect();
    v.push(Path::new(home).join(".local/bin"));
    v.push("/opt/homebrew/bin".into());
    v.push("/usr/local/bin".into());
    v
}

pub fn resolve(bin: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    dirs.iter().map(|d| d.join(bin)).find(|p| p.is_file())
}

pub fn complete(provider: &str, prompt: &str, system: Option<&str>, timeout_ms: Option<u64>) -> Result<String, String> {
    let out_file = std::env::temp_dir().join(format!("tangent-llm-{}-{:?}.txt", std::process::id(), std::thread::current().id()));
    let (bin, args) = build_args(provider, system, &out_file)?;
    let home = std::env::var("HOME").unwrap_or_default();
    let dirs = search_dirs(&std::env::var("PATH").unwrap_or_default(), &home);
    let exe = resolve(bin, &dirs).ok_or_else(|| format!("{bin} not found in PATH, ~/.local/bin or /opt/homebrew/bin"))?;
    let new_path = std::env::join_paths(&dirs).map_err(|e| e.to_string())?; // child (node shims) needs the same dirs
    let mut child = Command::new(exe)
        .args(args)
        .env("PATH", new_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let input = stdin_for(provider, prompt, system);
    let mut stdin = child.stdin.take().unwrap();
    std::thread::spawn(move || { let _ = stdin.write_all(input.as_bytes()); }); // dropped -> EOF
    let (mut so, mut se) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let out = std::thread::spawn(move || { let mut s = String::new(); let _ = so.read_to_string(&mut s); s });
    let err = std::thread::spawn(move || { let mut s = String::new(); let _ = se.read_to_string(&mut s); s });
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.unwrap_or(120_000));
    let status = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? { break st; }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&out_file);
            return Err(format!("{provider} timed out"));
        }
        std::thread::sleep(Duration::from_millis(25)); // ponytail: polling; fine at LLM latencies
    };
    let (stdout, stderr) = (out.join().unwrap_or_default(), err.join().unwrap_or_default());
    let result = if provider == "codex" { std::fs::read_to_string(&out_file).unwrap_or_default() } else { stdout };
    let _ = std::fs::remove_file(&out_file);
    if status.success() { Ok(result) } else { Err(format!("{provider} exited {status}: {}", stderr.trim())) }
}

#[tauri::command]
pub async fn llm_complete(provider: String, prompt: String, system: Option<String>, timeout_ms: Option<u64>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || complete(&provider, &prompt, system.as_deref(), timeout_ms))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_args() {
        let (b, a) = build_args("claude", Some("be brief"), Path::new("/x")).unwrap();
        assert_eq!(b, "claude");
        assert_eq!(a, ["-p", "--output-format", "text", "--model", "sonnet", "--system-prompt", "be brief"]);
        assert!(!build_args("claude", None, Path::new("/x")).unwrap().1.contains(&"--system-prompt".to_string()));
    }

    #[test]
    fn codex_args_read_only_last_message() {
        let (b, a) = build_args("codex", None, Path::new("/tmp/o.txt")).unwrap();
        assert_eq!(b, "codex");
        assert_eq!(a[0], "exec");
        let i = a.iter().position(|x| x == "--sandbox").unwrap();
        assert_eq!(a[i + 1], "read-only");
        let j = a.iter().position(|x| x == "--output-last-message").unwrap();
        assert_eq!(a[j + 1], "/tmp/o.txt");
        assert_eq!(a.last().unwrap(), "-");
        assert!(build_args("nope", None, Path::new("/x")).is_err());
    }

    #[test]
    fn codex_prepends_system() {
        assert_eq!(stdin_for("codex", "q", Some("s")), "s\n\nq");
        assert_eq!(stdin_for("claude", "q", Some("s")), "q");
    }

    #[test]
    fn dirs_and_resolve() {
        let d = search_dirs("/a:/b", "/home/u");
        assert_eq!(&d[..2], [PathBuf::from("/a"), PathBuf::from("/b")]);
        assert!(d.contains(&PathBuf::from("/home/u/.local/bin")));
        assert!(d.contains(&PathBuf::from("/opt/homebrew/bin")));
        let tmp = std::env::temp_dir().join(format!("tangent-resolve-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("fakebin"), "").unwrap();
        assert_eq!(resolve("fakebin", &[PathBuf::from("/nonexistent"), tmp.clone()]), Some(tmp.join("fakebin")));
        assert_eq!(resolve("missing-bin", &[tmp.clone()]), None);
        std::fs::remove_dir_all(tmp).unwrap();
    }
}

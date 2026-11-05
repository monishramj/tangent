//! `llm_complete`: runs a headless coding-agent CLI for the webview (which cannot spawn processes).
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Built-in Claude Code tools denied as defense in depth (`--tools ""` already removes them all).
pub const CLAUDE_DENIED_TOOLS: &str = "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task";

/// Env for the claude child: no CLAUDE.md discovery and no auto-memory, so nothing on disk leaks into prompts.
pub const CLAUDE_ENV: [(&str, &str); 2] = [("CLAUDE_CODE_DISABLE_CLAUDE_MDS", "1"), ("CLAUDE_CODE_DISABLE_AUTO_MEMORY", "1")];

/// (binary, args); the prompt goes on stdin. `out_file` is where codex writes its final message.
/// Prompts carry untrusted textbook/student text, so the agent runs with no tools, no MCP servers, no
/// user/project settings (hooks), no slash commands, no saved session, and (see `complete`) an empty temp cwd.
pub fn build_args(provider: &str, system: Option<&str>, out_file: &Path, with_images: bool, model: Option<&str>) -> Result<(&'static str, Vec<String>), String> {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    match provider {
        "claude" => {
            // Allowlisted: the webview picks the tier per stage (script = sonnet), default haiku.
            let model = match model.unwrap_or("haiku") { m @ ("haiku" | "sonnet") => m, m => return Err(format!("unknown model {m}")) };
            let mut a = s(&["-p", "--model", model,
                "--tools", "", "--disallowedTools", CLAUDE_DENIED_TOOLS,
                "--strict-mcp-config", "--setting-sources", "",
                "--disable-slash-commands", "--no-session-persistence"]);
            if with_images {
                a.extend(s(&["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]));
            } else {
                a.extend(s(&["--output-format", "text"]));
            }
            if let Some(sys) = system {
                a.extend(s(&["--system-prompt", sys]));
            }
            Ok(("claude", a))
        }
        // codex has no system-prompt flag; the caller prepends it to stdin (see `stdin_for`). Images are ignored.
        "codex" => {
            let mut a = s(&["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--color", "never", "--output-last-message"]);
            a.push(out_file.to_string_lossy().into_owned());
            a.push("-".into()); // prompt from stdin
            Ok(("codex", a))
        }
        p => Err(format!("unknown provider: {p}")),
    }
}

pub fn stdin_for(provider: &str, prompt: &str, system: Option<&str>, images: &[String]) -> String {
    match (provider, system) {
        ("codex", Some(sys)) => format!("{sys}\n\n{prompt}"),
        ("claude", _) if !images.is_empty() => claude_stream_input(prompt, images),
        _ => prompt.to_string(),
    }
}

/// One stream-json user message: every image (base64 PNG, no data: prefix) first, then the text prompt.
pub fn claude_stream_input(prompt: &str, images: &[String]) -> String {
    let mut content: Vec<serde_json::Value> = images.iter().map(|data| serde_json::json!({
        "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": data }
    })).collect();
    content.push(serde_json::json!({ "type": "text", "text": prompt }));
    let msg = serde_json::json!({ "type": "user", "message": { "role": "user", "content": content } });
    format!("{msg}\n")
}

/// The text of the final `result` event of a stream-json run.
pub fn parse_stream_result(stdout: &str) -> Result<String, String> {
    let ev = stdout.lines().rev()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l.trim()).ok())
        .find(|v| v["type"] == "result")
        .ok_or("claude: no result event in stream-json output")?;
    let text = ev["result"].as_str().unwrap_or_default().to_string();
    if ev["is_error"].as_bool().unwrap_or(false) || ev["subtype"].as_str().is_some_and(|s| s != "success") {
        return Err(format!("claude: {}", if text.is_empty() { ev["subtype"].as_str().unwrap_or("error").to_string() } else { text }));
    }
    Ok(text)
}

/// A fresh empty directory to run the CLI in, so a relative path or project config can't reach the app's files.
pub fn scratch_dir() -> Result<PathBuf, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("tangent-llm-{}-{}-{}", std::process::id(), nanos, N.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir(&dir).map_err(|e| format!("scratch dir: {e}"))?;
    Ok(dir)
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

pub fn complete(provider: &str, prompt: &str, system: Option<&str>, timeout_ms: Option<u64>, images: &[String], model: Option<&str>) -> Result<String, String> {
    let images: &[String] = if provider == "claude" { images } else { &[] };
    let cwd = scratch_dir()?;
    let r = run(provider, prompt, system, timeout_ms, images, &cwd, model);
    let _ = std::fs::remove_dir_all(&cwd);
    r
}

fn run(provider: &str, prompt: &str, system: Option<&str>, timeout_ms: Option<u64>, images: &[String], cwd: &Path, model: Option<&str>) -> Result<String, String> {
    let out_file = cwd.join("last-message.txt");
    let (bin, args) = build_args(provider, system, &out_file, !images.is_empty(), model)?;
    let home = std::env::var("HOME").unwrap_or_default();
    let dirs = search_dirs(&std::env::var("PATH").unwrap_or_default(), &home);
    let exe = resolve(bin, &dirs).ok_or_else(|| format!("{bin} not found in PATH, ~/.local/bin or /opt/homebrew/bin"))?;
    let new_path = std::env::join_paths(&dirs).map_err(|e| e.to_string())?; // child (node shims) needs the same dirs
    let mut cmd = Command::new(exe);
    cmd.args(args).current_dir(cwd).env("PATH", new_path);
    if provider == "claude" { cmd.envs(CLAUDE_ENV); }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let input = stdin_for(provider, prompt, system, images);
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
            return Err(format!("{provider} timed out"));
        }
        std::thread::sleep(Duration::from_millis(25)); // ponytail: polling; fine at LLM latencies
    };
    let (stdout, stderr) = (out.join().unwrap_or_default(), err.join().unwrap_or_default());
    if !status.success() { return Err(format!("{provider} exited {status}: {}", stderr.trim())); }
    if provider == "codex" { Ok(std::fs::read_to_string(&out_file).unwrap_or_default()) }
    else if !images.is_empty() { parse_stream_result(&stdout) }
    else { Ok(stdout) }
}

#[tauri::command]
pub async fn llm_complete(provider: String, prompt: String, system: Option<String>, timeout_ms: Option<u64>, images: Option<Vec<String>>, model: Option<String>) -> Result<String, String> {
    let images = images.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || complete(&provider, &prompt, system.as_deref(), timeout_ms, &images, model.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_args_locked_down() {
        let (b, a) = build_args("claude", Some("be brief"), Path::new("/x"), false, None).unwrap();
        assert_eq!(b, "claude");
        let after = |flag: &str| a.iter().position(|x| x == flag).map(|i| a[i + 1].as_str());
        assert_eq!(a[0], "-p");
        assert_eq!(after("--model"), Some("haiku"));
        assert_eq!(after("--tools"), Some(""));
        assert_eq!(after("--disallowedTools"), Some(CLAUDE_DENIED_TOOLS));
        for t in ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "NotebookEdit", "Task"] {
            assert!(CLAUDE_DENIED_TOOLS.split(',').any(|x| x == t), "{t} not denied");
        }
        assert_eq!(after("--setting-sources"), Some(""));
        for f in ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"] {
            assert!(a.iter().any(|x| x == f), "missing {f}");
        }
        assert!(!a.iter().any(|x| x == "--mcp-config" || x == "--dangerously-skip-permissions" || x == "--add-dir"));
        assert_eq!(after("--output-format"), Some("text"));
        assert_eq!(after("--system-prompt"), Some("be brief"));
        assert!(!build_args("claude", None, Path::new("/x"), false, None).unwrap().1.contains(&"--system-prompt".to_string()));
        assert!(CLAUDE_ENV.contains(&("CLAUDE_CODE_DISABLE_CLAUDE_MDS", "1")));
    }

    #[test]
    fn claude_model_is_allowlisted() {
        let (_, a) = build_args("claude", None, Path::new("/x"), false, Some("sonnet")).unwrap();
        assert_eq!(a[a.iter().position(|x| x == "--model").unwrap() + 1], "sonnet");
        assert!(build_args("claude", None, Path::new("/x"), false, Some("--evil")).is_err());
    }

    #[test]
    fn claude_images_use_stream_json() {
        let (_, a) = build_args("claude", None, Path::new("/x"), true, None).unwrap();
        let after = |flag: &str| a.iter().position(|x| x == flag).map(|i| a[i + 1].as_str());
        assert_eq!(after("--input-format"), Some("stream-json"));
        assert_eq!(after("--output-format"), Some("stream-json"));
        assert!(a.contains(&"--verbose".to_string()));
        assert_eq!(after("--tools"), Some(""));
        let line = stdin_for("claude", "what is this?", Some("sys"), &["AAAA".into()]);
        assert!(line.ends_with('\n') && line.lines().count() == 1);
        let v: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(v["type"], "user");
        let c = &v["message"]["content"];
        assert_eq!(c[0]["type"], "image");
        assert_eq!(c[0]["source"]["media_type"], "image/png");
        assert_eq!(c[0]["source"]["data"], "AAAA");
        assert_eq!(c[1]["text"], "what is this?");
        assert_eq!(stdin_for("codex", "q", None, &["AAAA".into()]), "q"); // codex ignores images
    }

    #[test]
    fn stream_result_parsing() {
        let out = "{\"type\":\"system\",\"subtype\":\"init\"}\n{\"type\":\"assistant\"}\nnot json\n{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"Red\"}\n";
        assert_eq!(parse_stream_result(out).unwrap(), "Red");
        assert!(parse_stream_result("{\"type\":\"result\",\"subtype\":\"error_max_turns\",\"is_error\":true}").is_err());
        assert!(parse_stream_result("{\"type\":\"system\"}").is_err());
    }

    #[test]
    fn codex_args_read_only_last_message() {
        let (b, a) = build_args("codex", None, Path::new("/tmp/o.txt"), false, None).unwrap();
        assert_eq!(b, "codex");
        assert_eq!(a[0], "exec");
        let i = a.iter().position(|x| x == "--sandbox").unwrap();
        assert_eq!(a[i + 1], "read-only");
        let j = a.iter().position(|x| x == "--output-last-message").unwrap();
        assert_eq!(a[j + 1], "/tmp/o.txt");
        assert_eq!(a.last().unwrap(), "-");
        assert!(build_args("nope", None, Path::new("/x"), false, None).is_err());
    }

    #[test]
    fn codex_prepends_system() {
        assert_eq!(stdin_for("codex", "q", Some("s"), &[]), "s\n\nq");
        assert_eq!(stdin_for("claude", "q", Some("s"), &[]), "q");
    }

    #[test]
    fn scratch_dirs_are_fresh_and_empty() {
        let (a, b) = (scratch_dir().unwrap(), scratch_dir().unwrap());
        assert_ne!(a, b);
        assert_eq!(std::fs::read_dir(&a).unwrap().count(), 0);
        std::fs::remove_dir_all(a).unwrap();
        std::fs::remove_dir_all(b).unwrap();
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

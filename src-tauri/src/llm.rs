//! `llm_complete`: runs a headless coding-agent CLI for the webview (which cannot spawn processes).
use std::io::{Read, Write};
use tauri::Manager;
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

/// Stream-json: PNG base64 or native photo JPEG/WEBP data URLs, then the prompt.
pub fn claude_stream_input(prompt: &str, images: &[String]) -> String {
    let mut content: Vec<serde_json::Value> = images.iter().map(|data| {
        let (mime, data) = ["image/jpeg", "image/webp"].into_iter().find_map(|mime|
            data.strip_prefix(&format!("data:{mime};base64,")).map(|data| (mime, data)))
            .unwrap_or(("image/png", data.as_str()));
        serde_json::json!({ "type": "image", "source": { "type": "base64", "media_type": mime, "data": data } })
    }).collect();
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

fn home_from(home: Option<String>, userprofile: Option<String>) -> String {
    home.or(userprofile).unwrap_or_default()
}

pub fn home_dir() -> String {
    home_from(std::env::var("HOME").ok(),
        if cfg!(windows) { std::env::var("USERPROFILE").ok() } else { None })
}

/// PATH entries plus the dirs GUI apps miss.
pub fn search_dirs(path: &str, home: &str) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::env::split_paths(path).collect();
    v.push(Path::new(home).join(".local/bin"));
    v.push("/opt/homebrew/bin".into());
    v.push("/usr/local/bin".into());
    v
}

pub fn resolve(bin: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';').filter(|ext| !ext.is_empty()).map(String::from).collect()
    } else { vec![] };
    resolve_with(bin, dirs, &exts)
}

/// Extensions first: npm puts an extensionless sh shim next to `claude.cmd` on Windows, and only the .cmd runs.
fn resolve_with(bin: &str, dirs: &[PathBuf], exts: &[String]) -> Option<PathBuf> {
    dirs.iter().flat_map(|dir| {
        exts.iter().map(move |ext| dir.join(format!("{bin}{ext}"))).chain(std::iter::once(dir.join(bin)))
    }).find(|path| path.is_file())
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
    let home = home_dir();
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

/// Bounded photo-only read; never enable Claude's Read tool for untrusted notes.
fn photo_image(base: &Path, path: &Path) -> Result<String, String> {
    if !path.is_absolute() || path.components().any(|part| part == std::path::Component::ParentDir) {
        return Err("Photo path must be absolute without traversal".into());
    }
    let canonical = path.canonicalize().map_err(|e| format!("Photo path: {e}"))?;
    let library = crate::store::read(base, "library")?;
    let allowed = library.as_ref().and_then(|v| v["sources"].as_array()).is_some_and(|sources|
        sources.iter().filter_map(|s| s["pdfPath"].as_str()).any(|p|
            Path::new(p).canonicalize().is_ok_and(|p| p == canonical)));
    if !allowed { return Err("Photo is not an imported source in the library".into()); }
    let path = canonical.as_path();
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["jpg", "jpeg", "png", "webp", "heic"].contains(&extension.as_str()) {
        return Err("Choose a JPG, PNG, HEIC, or WEBP photo".into());
    }
    if !std::fs::metadata(path).map_err(|e| format!("Cannot open photo: {e}"))?.is_file() {
        return Err("Photo must be a file".into());
    }
    let file = std::fs::File::open(path).map_err(|e| format!("Cannot open photo: {e}"))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() { return Err("Photo must be a file".into()); }
    let mut bytes = Vec::new();
    file.take(5 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > 5 * 1024 * 1024 { return Err("Photo is too large; choose one under 5 MiB".into()); }
    // shortcut: HEIC needs JPG/PNG export; add conversion when a supported decoder is available.
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
        else if bytes.starts_with(&[0xff, 0xd8, 0xff]) { "image/jpeg" }
        else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { "image/webp" }
        else { return Err("Cannot decode this photo. Export HEIC as JPG or PNG and try again".into()); };
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = ((c[0] as u32) << 16) | ((c.get(1).copied().unwrap_or(0) as u32) << 8) | c.get(2).copied().unwrap_or(0) as u32;
        encoded.push(ALPHABET[((n >> 18) & 63) as usize] as char);
        encoded.push(ALPHABET[((n >> 12) & 63) as usize] as char);
        encoded.push(if c.len() > 1 { ALPHABET[((n >> 6) & 63) as usize] as char } else { '=' });
        encoded.push(if c.len() > 2 { ALPHABET[(n & 63) as usize] as char } else { '=' });
    }
    Ok(if mime == "image/png" { encoded } else { format!("data:{mime};base64,{encoded}") })
}

#[tauri::command]
pub async fn llm_complete(app: tauri::AppHandle, provider: String, prompt: String, system: Option<String>, timeout_ms: Option<u64>, images: Option<Vec<String>>, model: Option<String>, photo_path: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut images = images.unwrap_or_default();
        if let Some(path) = photo_path {
            if provider != "claude" || !images.is_empty() { return Err("Photo transcription requires Claude and one photo".into()); }
            let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
            images.push(photo_image(&base, Path::new(&path))?);
        }
        complete(&provider, &prompt, system.as_deref(), timeout_ms, &images, model.as_deref())
    })
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn photo_reads_are_bounded_and_reject_other_files() {
        let dir = scratch_dir().unwrap();
        let path = dir.join("note.jpg");
        std::fs::write(&path, [0xff, 0xd8, 0xff]).unwrap();
        assert!(photo_image(&dir, &path).unwrap_err().contains("library"));
        crate::store::write(&dir, "library", &serde_json::json!({"sources": [{"pdfPath": path}]})).unwrap();
        assert!(photo_image(&dir, Path::new("note.jpg")).is_err());
        assert!(photo_image(&dir, &dir.join("../note.jpg")).is_err());
        let unknown = dir.join("unknown.jpg");
        std::fs::write(&unknown, [0xff, 0xd8, 0xff]).unwrap();
        assert!(photo_image(&dir, &unknown).unwrap_err().contains("library"));
        assert_eq!(photo_image(&dir, &path).unwrap(), "data:image/jpeg;base64,/9j/");
        let value: serde_json::Value = serde_json::from_str(&claude_stream_input("transcribe", &[photo_image(&dir, &path).unwrap()])).unwrap();
        assert_eq!(value["message"]["content"][0]["source"]["media_type"], "image/jpeg");
        assert_eq!(value["message"]["content"][0]["source"]["data"], "/9j/");
        std::fs::write(&path, b"not a photo").unwrap();
        assert!(photo_image(&dir, &path).is_err());
        assert!(photo_image(&dir, &dir.join("secret.txt")).is_err());
        std::fs::write(&path, vec![0; 5 * 1024 * 1024 + 1]).unwrap();
        assert!(photo_image(&dir, &path).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

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
        let path = std::env::join_paths(["/a", "/b"]).unwrap();
        let d = search_dirs(path.to_str().unwrap(), "/home/u");
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

    #[test]
    fn resolve_prefers_pathext_over_extensionless_shim() {
        let tmp = scratch_dir().unwrap();
        let dirs = [tmp.clone()];
        let exts = [".exe".into(), ".cmd".into()];
        std::fs::write(tmp.join("claude"), "").unwrap();
        assert_eq!(resolve_with("claude", &dirs, &[]), Some(tmp.join("claude")));
        std::fs::write(tmp.join("claude.cmd"), "").unwrap();
        assert_eq!(resolve_with("claude", &dirs, &exts), Some(tmp.join("claude.cmd")));
        std::fs::remove_dir_all(tmp).unwrap();
    }

    #[test]
    fn home_falls_back_to_userprofile() {
        assert_eq!(home_from(Some("home".into()), Some("profile".into())), "home");
        assert_eq!(home_from(None, Some("profile".into())), "profile");
        assert_eq!(home_from(None, None), "");
        assert_eq!(home_from(Some("".into()), Some("profile".into())), "");
    }
}

//! `llm_complete`: runs a headless coding-agent CLI for the webview (which cannot spawn processes).
use std::io::{BufRead, Read, Write};
use base64::{Engine, engine::general_purpose::STANDARD};
use tauri::Manager;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

/// Built-in Claude Code tools denied as defense in depth (`--tools ""` already removes them all).
pub const CLAUDE_DENIED_TOOLS: &str = "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task";

/// Env for the claude child: no CLAUDE.md discovery and no auto-memory, so nothing on disk leaks into prompts.
pub const CLAUDE_ENV: [(&str, &str); 2] = [("CLAUDE_CODE_DISABLE_CLAUDE_MDS", "1"), ("CLAUDE_CODE_DISABLE_AUTO_MEMORY", "1")];

/// Antigravity (experimental): its print mode always has tools (run_command, write_file, ...) and runs them without asking,
/// and write_file ignores --sandbox. No flag or session setting turns them off (agy 1.5.9). So we watch the stream and
/// kill the process tree the moment any step other than plain text starts; tested 3/3 to beat write_file.
pub const AGY_TOOL_BLOCKED: &str = "Antigravity tried to use a tool, so Tangent stopped it. Try again, or switch to Claude or Codex.";
const AGY_PHOTOS: &str = "Antigravity CLI does not support photo attachments. Switch to Claude for photos.";

pub fn provider_bin(provider: &str) -> Result<&'static str, String> {
    match provider {
        "claude" => Ok("claude"),
        "codex" => Ok("codex"),
        "agy" => Ok("agy"),
        p => Err(format!("unknown provider: {p}")),
    }
}

/// Prompt on stdin. Codex writes its final message separately from diagnostics.
pub fn build_args(provider: &str, system: Option<&str>, out_file: &Path, with_images: bool, model: Option<&str>) -> Result<(&'static str, Vec<String>), String> {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    let bin = provider_bin(provider)?;
    let strong = match model.unwrap_or("haiku") {
        "haiku" => false,
        "sonnet" => true,
        m => return Err(format!("unknown model {m}")),
    };
    match bin {
        "claude" => {
            let model = if strong { "sonnet" } else { "haiku" };
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
        "codex" => {
            let model = if strong { "gpt-6.2-astra" } else { "gpt-6.2-sol" };
            let mut a = s(&["--no-daemon", "--ask-for-approval", "never", "exec",
                "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral",
                "--ignore-user-config", "--ignore-rules", "--color", "never", "--model", model,
                "--config", "mcp_servers={}", "--config", "web_search=\"disabled\"",
                "--config", "project_doc_max_bytes=0",
                "--disable", "shell_tool", "--disable", "view_image", "--disable", "hooks",
                "--disable", "apps", "--disable", "plugins", "--disable", "multi_agent",
                "--disable", "browser_use", "--disable", "computer_use", "--disable", "image_generation",
                "--enable", "skip_host_skill_discovery", "--output-last-message"]);
            a.push(out_file.to_string_lossy().into_owned());
            a.push("-".into());
            Ok((bin, a))
        }
        "agy" => {
            if with_images { return Err(AGY_PHOTOS.into()); }
            let model = if strong { "gemini-3.8-flash-high" } else { "gemini-3.8-flash-medium" };
            // -p= with stream-json reads the prompt from stdin; --sandbox restricts run_command (not write_file).
            Ok((bin, s(&["--model", model, "--sandbox", "--disable-slash-commands",
                "--input-format", "stream-json", "--output-format", "stream-json", "-p="])))
        }
        _ => unreachable!(),
    }
}

pub fn stdin_for(provider: &str, prompt: &str, system: Option<&str>, images: &[String]) -> String {
    match (provider, system) {
        ("codex", Some(sys)) => format!("{sys}\n\n{prompt}"),
        ("agy", _) => {
            let text = system.map_or_else(|| prompt.to_string(), |sys| format!("{sys}\n\n{prompt}"));
            format!("{}\n", serde_json::json!({ "event": "user", "message": { "role": "user", "content": [{ "type": "text", "text": text }] } }))
        }
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

/// True for any agy stream step that is not the prompt or plain model text (tool calls, subagents, unknown kinds).
pub fn agy_disallowed_step(line: &str) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else { return false };
    v["event"] == "step_update" && !matches!(v["step_update"]["step_type"].as_str(), Some("user_input" | "agent_response"))
}

/// The response of agy's final `result` event.
pub fn parse_agy_result(stdout: &str) -> Result<String, String> {
    let ev = stdout.lines().rev()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l.trim()).ok())
        .find(|v| v["event"] == "result")
        .ok_or("agy: no result event in stream-json output")?;
    let r = &ev["result"];
    if r["status"] != "SUCCESS" { return Err(format!("agy: {}", r["error"].as_str().filter(|e| !e.is_empty()).unwrap_or("failed"))); }
    Ok(r["response"].as_str().unwrap_or_default().to_string())
}

/// A fresh empty directory to run the CLI in, so a relative path or project config can't reach the app's files.
pub fn scratch_dir() -> Result<PathBuf, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("tangent-llm-{}-{}-{}", std::process::id(), nanos, N.fetch_add(1, Ordering::Relaxed)));
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(&dir).map_err(|e| format!("scratch dir: {e}"))?;
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

fn complete(provider: &str, prompt: &str, system: Option<&str>, timeout_ms: Option<u64>, images: &[String], model: Option<&str>, request: Option<&AtomicBool>) -> Result<String, String> {
    let cwd = scratch_dir()?;
    let r = run(provider, prompt, system, timeout_ms, images, &cwd, model, request);
    let _ = std::fs::remove_dir_all(&cwd);
    r
}

fn run(provider: &str, prompt: &str, system: Option<&str>, timeout_ms: Option<u64>, images: &[String], cwd: &Path, model: Option<&str>, request: Option<&AtomicBool>) -> Result<String, String> {
    let out_file = cwd.join("last-message.txt");
    let (bin, mut args) = build_args(provider, system, &out_file, !images.is_empty(), model)?;
    if provider == "codex" && !images.is_empty() {
        let stdin = args.pop().unwrap();
        args.extend(codex_images(cwd, images)?);
        args.push(stdin);
    }
    let home = home_dir();
    let dirs = search_dirs(&std::env::var("PATH").unwrap_or_default(), &home);
    let exe = resolve(bin, &dirs).ok_or_else(|| format!("{bin} not found in PATH, ~/.local/bin or /opt/homebrew/bin"))?;
    let new_path = std::env::join_paths(&dirs).map_err(|e| e.to_string())?; // child (node shims) needs the same dirs
    let mut cmd = Command::new(exe);
    cmd.args(args).current_dir(cwd).env("PATH", new_path);
    if provider == "claude" { cmd.envs(CLAUDE_ENV); }
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    let input = stdin_for(provider, prompt, system, images);
    crate::check_request(request)?;
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.unwrap_or(120_000));
    let (status, stdout, stderr) = collect(&mut child, input, deadline, request, provider)?;
    if !status.success() { return Err(format!("{provider} exited {status}: {}", stderr.trim())); }
    if provider == "codex" { std::fs::read_to_string(&out_file).map_err(|e| format!("codex: missing final response: {e}")) }
    else if provider == "agy" { parse_agy_result(&stdout) }
    else if !images.is_empty() { parse_stream_result(&stdout) }
    else { Ok(stdout) }
}

fn collect(child: &mut Child, input: String, deadline: Instant, request: Option<&AtomicBool>, provider: &str) -> Result<(ExitStatus, String, String), String> {
    let mut stdin = child.stdin.take().unwrap();
    std::thread::spawn(move || { let _ = stdin.write_all(input.as_bytes()); }); // dropped -> EOF
    let (mut so, mut se) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let tripped = std::sync::Arc::new(AtomicBool::new(false));
    let (trip, watch) = (tripped.clone(), provider == "agy");
    let out = std::thread::spawn(move || {
        let (mut s, mut line, mut r) = (String::new(), String::new(), std::io::BufReader::new(so));
        while r.read_line(&mut line).unwrap_or(0) > 0 {
            if watch && agy_disallowed_step(&line) { trip.store(true, std::sync::atomic::Ordering::Release); }
            s.push_str(&line);
            line.clear();
        }
        s
    });
    let err = std::thread::spawn(move || { let mut s = String::new(); let _ = se.read_to_string(&mut s); s });
    let result = (|| loop {
        crate::check_request(request)?;
        if tripped.load(std::sync::atomic::Ordering::Acquire) { break Err(AGY_TOOL_BLOCKED.to_string()); }
        if out.is_finished() && err.is_finished() {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? { break Ok(status); }
        }
        if Instant::now() >= deadline {
            break Err(format!("{provider} timed out"));
        }
        std::thread::sleep(Duration::from_millis(25)); // ponytail: polling; fine at LLM latencies
    })();
    if result.is_err() { crate::checks::kill_tree(child); }
    Ok((result?, out.join().unwrap_or_default(), err.join().unwrap_or_default()))
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
    let encoded = STANDARD.encode(bytes);
    Ok(if mime == "image/png" { encoded } else { format!("data:{mime};base64,{encoded}") })
}

fn codex_images(cwd: &Path, images: &[String]) -> Result<Vec<String>, String> {
    images.iter().enumerate().map(|(i, image)| {
        let (suffix, data) = image.strip_prefix("data:image/jpeg;base64,").map(|d| ("jpg", d))
            .or_else(|| image.strip_prefix("data:image/webp;base64,").map(|d| ("webp", d)))
            .unwrap_or(("png", image.as_str()));
        if data.len() > (5_usize * 1024 * 1024).div_ceil(3) * 4 {
            return Err("Image is too large; choose one under 5 MiB".into());
        }
        let bytes = STANDARD.decode(data).map_err(|_| "Invalid base64 image")?;
        if bytes.len() > 5 * 1024 * 1024 {
            return Err("Image is too large; choose one under 5 MiB".into());
        }
        let path = cwd.join(format!("attachment-{i}.{suffix}"));
        std::fs::write(&path, bytes).map_err(|e| format!("Cannot prepare image: {e}"))?;
        Ok(format!("--image={}", path.display()))
    }).collect()
}

#[tauri::command]
pub async fn llm_complete(app: tauri::AppHandle, provider: String, prompt: String, system: Option<String>, timeout_ms: Option<u64>, images: Option<Vec<String>>, model: Option<String>, photo_path: Option<String>, pdf_page: Option<u32>, request_id: Option<u32>) -> Result<String, String> {
    let request = app.state::<crate::State_>().request(request_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::check_request(request.as_deref())?;
        let mut images = images.unwrap_or_default();
        if let Some(path) = photo_path {
            provider_bin(&provider)?;
            if provider == "agy" { return Err(AGY_PHOTOS.into()); }
            if !images.is_empty() { return Err("Photo transcription accepts one photo".into()); }
            let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
            // pdf_page: photo_path is a library PDF (scanned/handwritten notes); send that page rendered by PDFium.
            images.push(match pdf_page {
                Some(page) => STANDARD.encode(crate::pages::page_png(&base, Path::new(&path), page, app.path().resource_dir().ok().as_deref())?),
                None => photo_image(&base, Path::new(&path))?,
            });
        }
        complete(&provider, &prompt, system.as_deref(), timeout_ms, &images, model.as_deref(), request.as_deref())
    })
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn cancel_reaps_a_running_llm_child() {
        use std::os::unix::process::CommandExt;
        use std::sync::atomic::Ordering;

        let mut child = Command::new("/bin/sleep").arg("30")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .process_group(0).spawn().unwrap();
        let request = AtomicBool::new(false);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                std::thread::sleep(Duration::from_millis(40));
                request.store(true, Ordering::Release);
            });
            let result = collect(&mut child, String::new(), Instant::now() + Duration::from_secs(2), Some(&request), "test provider");
            assert_eq!(result.unwrap_err(), "Request aborted");
        });
        assert!(child.try_wait().unwrap().is_some());
    }

    #[cfg(unix)]
    #[test]
    fn deadline_covers_pipes_inherited_after_llm_child_exits() {
        use std::os::unix::process::CommandExt;

        let mut child = Command::new("/bin/sh").args(["-c", "sleep 1 & exit 0"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .process_group(0).spawn().unwrap();
        let result = collect(&mut child, String::new(), Instant::now() + Duration::from_millis(150), None, "test provider");
        assert_eq!(result.unwrap_err(), "test provider timed out");
    }

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
        assert!(a.contains(&"exec".into()));
        for flag in ["--no-daemon", "--ephemeral", "--ignore-user-config", "--ignore-rules"] {
            assert!(a.contains(&flag.into()));
        }
        for setting in ["mcp_servers={}", "web_search=\"disabled\"", "project_doc_max_bytes=0"] {
            assert!(a.windows(2).any(|pair| pair == ["--config", setting]));
        }
        for flag in ["hooks", "shell_tool", "view_image", "apps", "plugins", "browser_use", "computer_use"] {
            assert!(a.windows(2).any(|pair| pair == ["--disable", flag]));
        }
        assert!(a.windows(2).any(|pair| pair == ["--model", "gpt-6.2-sol"]));
        let (_, strong) = build_args("codex", None, Path::new("/tmp/o.txt"), true, Some("sonnet")).unwrap();
        assert!(strong.windows(2).any(|pair| pair == ["--model", "gpt-6.2-astra"]));
        let i = a.iter().position(|x| x == "--sandbox").unwrap();
        assert_eq!(a[i + 1], "read-only");
        let j = a.iter().position(|x| x == "--output-last-message").unwrap();
        assert_eq!(a[j + 1], "/tmp/o.txt");
        assert_eq!(a.last().unwrap(), "-");
        assert!(build_args("nope", None, Path::new("/x"), false, None).is_err());
    }

    #[test]
    fn codex_stages_images_for_attachment() {
        let dir = scratch_dir().unwrap();
        let args = codex_images(&dir, &["QUJD".into(), "data:image/jpeg;base64,/9j/".into()]).unwrap();
        assert_eq!(args, ["attachment-0.png", "attachment-1.jpg"].map(|name| format!("--image={}", dir.join(name).display())));
        assert_eq!(std::fs::read(dir.join("attachment-0.png")).unwrap(), b"ABC");
        assert_eq!(std::fs::read(dir.join("attachment-1.jpg")).unwrap(), [0xff, 0xd8, 0xff]);
        assert!(codex_images(&dir, &["invalid?".into()]).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn agy_args_sandboxed_stream_json_and_photos_refused() {
        let (bin, a) = build_args("agy", None, Path::new("/x"), false, None).unwrap();
        assert_eq!(bin, "agy");
        for f in ["--sandbox", "--disable-slash-commands", "-p="] { assert!(a.contains(&f.to_string()), "{f}"); }
        assert!(a.windows(2).any(|p| p == ["--input-format", "stream-json"]) && a.windows(2).any(|p| p == ["--output-format", "stream-json"]));
        assert!(a.windows(2).any(|p| p == ["--model", "gemini-3.8-flash-medium"]));
        assert!(!a.iter().any(|x| x.contains("dangerously")));
        assert!(build_args("agy", None, Path::new("/x"), false, Some("sonnet")).unwrap().1.windows(2).any(|p| p == ["--model", "gemini-3.8-flash-high"]));
        assert_eq!(build_args("agy", None, Path::new("/x"), true, None).unwrap_err(), AGY_PHOTOS);
        let input: serde_json::Value = serde_json::from_str(&stdin_for("agy", "hi", Some("sys"), &[])).unwrap();
        assert_eq!(input["event"], "user");
        assert_eq!(input["message"]["content"][0]["text"], "sys\n\nhi");
    }

    #[test]
    fn agy_stream_watch_and_result() {
        let step = |t: &str| format!(r#"{{"event":"step_update","step_update":{{"step_type":"{t}","state":"ACTIVE"}}}}"#);
        assert!(!agy_disallowed_step(&step("user_input")) && !agy_disallowed_step(&step("agent_response")));
        assert!(agy_disallowed_step(&step("tool")) && agy_disallowed_step(&step("subagent")));
        assert!(!agy_disallowed_step(r#"{"event":"init","init":{"tools":["run_command"]}}"#) && !agy_disallowed_step("not json"));
        assert_eq!(parse_agy_result(r#"{"event":"result","result":{"status":"SUCCESS","response":"OK\n"}}"#).unwrap(), "OK\n");
        assert_eq!(parse_agy_result(r#"{"event":"result","result":{"status":"ERROR","response":"","error":"auth"}}"#).unwrap_err(), "agy: auth");
        assert!(parse_agy_result("").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn agy_tool_step_kills_the_child() {
        use std::os::unix::process::CommandExt;
        let script = r#"echo '{"event":"step_update","step_update":{"step_type":"tool","state":"ACTIVE"}}'; sleep 5; touch never"#;
        let mut child = Command::new("/bin/sh").args(["-c", script])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .process_group(0).spawn().unwrap();
        let started = Instant::now();
        let result = collect(&mut child, String::new(), Instant::now() + Duration::from_secs(4), None, "agy");
        assert_eq!(result.unwrap_err(), AGY_TOOL_BLOCKED);
        assert!(started.elapsed() < Duration::from_secs(2));
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

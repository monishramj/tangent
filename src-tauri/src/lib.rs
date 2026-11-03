use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, State};

#[derive(Default)]
struct Sidecar {
    proc: Option<(Child, ChildStdin, BufReader<ChildStdout>)>,
    next_id: u64,
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        if let Some((c, ..)) = &mut self.proc {
            let _ = c.kill();
        }
    }
}

// ponytail: one in-flight request (Mutex); add id multiplexing when tutor + generation run concurrently
struct State_(Mutex<Sidecar>);

fn spawn() -> Result<(Child, ChildStdin, BufReader<ChildStdout>), String> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../sidecar"); // dev only
    let mut c = Command::new("uv")
        .args(["run", "--project", dir, "python", "-m", "tangent_sidecar"])
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let (i, o) = (c.stdin.take().unwrap(), BufReader::new(c.stdout.take().unwrap()));
    Ok((c, i, o))
}

fn call(s: &mut Sidecar, method: &str, params: Value) -> Result<Value, String> {
    if s.proc.is_none() {
        s.proc = Some(spawn()?);
    }
    s.next_id += 1;
    let id = s.next_id;
    let (_, stdin, stdout) = s.proc.as_mut().unwrap();
    writeln!(stdin, "{}", json!({"id": id, "method": method, "params": params})).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    let mut line = String::new();
    if stdout.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
        s.proc = None; // dead; respawn on next call
        return Err("sidecar exited".into());
    }
    let mut r: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if r["id"] != id {
        return Err(format!("id mismatch: {}", r["id"]));
    }
    match r["error"].as_str() {
        Some(e) => Err(e.to_string()),
        None => Ok(r["result"].take()),
    }
}

#[tauri::command]
fn sidecar_call(state: State<State_>, method: String, params: Value) -> Result<Value, String> {
    call(&mut state.0.lock().unwrap(), &method, params)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(State_(Mutex::new(Sidecar::default())))
        .invoke_handler(tauri::generate_handler![sidecar_call])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, e| {
            if let RunEvent::Exit = e {
                *app.state::<State_>().0.lock().unwrap() = Sidecar::default(); // drops old -> kills child
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_roundtrip() {
        let mut s = Sidecar::default();
        assert_eq!(call(&mut s, "ping", serde_json::json!({})).unwrap(), "pong");
        assert!(call(&mut s, "nope", serde_json::json!({})).is_err());
    }
}

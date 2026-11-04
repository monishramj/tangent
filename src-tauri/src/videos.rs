use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn safe(s: &str) -> Result<&str, String> {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') { Ok(s) } else { Err(format!("invalid id: {s:?}")) }
}
fn dir_of(base: &Path, id: &str) -> Result<PathBuf, String> { Ok(base.join("videos").join(safe(id)?)) }

/// Replace each scene's stored file name with its absolute path (what the webview needs).
fn resolve(dir: &Path, bundle: &mut Value) {
    for s in bundle["scenes"].as_array_mut().into_iter().flatten() {
        if let Some(f) = s["audioFile"].as_str() { s["audioFile"] = json!(dir.join(f).to_string_lossy()); }
    }
}

/// Copy scene WAVs into <base>/videos/<id>/ and write bundle.json. Idempotent, so it can run after every scene.
pub fn save(base: &Path, mut bundle: Value) -> Result<Value, String> {
    let id = bundle["id"].as_str().ok_or("bundle.id missing")?.to_string();
    let dir = dir_of(base, &id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for s in bundle["scenes"].as_array_mut().ok_or("bundle.scenes missing")? {
        let name = format!("{}.wav", safe(s["sceneId"].as_str().ok_or("sceneId missing")?)?);
        let src = PathBuf::from(s["audioFile"].as_str().ok_or("audioFile missing")?);
        let dest = dir.join(&name);
        if src != dest && src.is_absolute() {
            if src.exists() { fs::copy(&src, &dest).map_err(|e| format!("copy {}: {e}", src.display()))?; }
            else if !dest.exists() { return Err(format!("audio not found: {}", src.display())); }
        }
        s["audioFile"] = json!(name);
    }
    let tmp = dir.join("bundle.json.tmp");
    fs::write(&tmp, serde_json::to_vec(&bundle).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("bundle.json")).map_err(|e| e.to_string())?;
    resolve(&dir, &mut bundle);
    Ok(bundle)
}

pub fn load(base: &Path, id: &str) -> Result<Value, String> {
    let dir = dir_of(base, id)?;
    let mut b: Value = serde_json::from_slice(&fs::read(dir.join("bundle.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    resolve(&dir, &mut b);
    Ok(b)
}

/// Newest first; unreadable bundles are skipped rather than failing the list.
pub fn list(base: &Path) -> Vec<Value> {
    let mut out: Vec<Value> = fs::read_dir(base.join("videos")).into_iter().flatten().flatten()
        .filter_map(|e| load(base, e.file_name().to_str()?).ok()).collect();
    out.sort_by(|a, b| b["createdAt"].as_f64().partial_cmp(&a["createdAt"].as_f64()).unwrap());
    out
}

pub fn delete(base: &Path, id: &str) -> Result<(), String> {
    let dir = dir_of(base, id)?;
    if dir.exists() { fs::remove_dir_all(dir).map_err(|e| e.to_string())?; }
    Ok(())
}

fn base(app: &AppHandle) -> Result<PathBuf, String> { app.path().app_data_dir().map_err(|e| e.to_string()) }

#[tauri::command]
pub fn save_video_bundle(app: AppHandle, bundle: Value) -> Result<Value, String> { save(&base(&app)?, bundle) }
#[tauri::command]
pub fn list_video_bundles(app: AppHandle) -> Result<Vec<Value>, String> { Ok(list(&base(&app)?)) }
#[tauri::command]
pub fn load_video_bundle(app: AppHandle, id: String) -> Result<Value, String> { load(&base(&app)?, &id) }
#[tauri::command]
pub fn delete_video_bundle(app: AppHandle, id: String) -> Result<(), String> { delete(&base(&app)?, &id) }

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("tangent-videos-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn bundle(id: &str, at: u64, wav: &Path) -> Value {
        json!({"id": id, "title": "T", "createdAt": at, "complete": false,
               "scenes": [{"sceneId": "scene-1", "scene": {}, "timeline": {}, "audioFile": wav.to_string_lossy(), "durationSec": 2.0}]})
    }

    #[test]
    fn save_copies_wav_then_load_list_delete() {
        let base = tmp("roundtrip");
        let wav = base.join("tangent-x.wav");
        fs::write(&wav, b"RIFF").unwrap();
        let saved = save(&base, bundle("a", 1, &wav)).unwrap();
        let audio = saved["scenes"][0]["audioFile"].as_str().unwrap();
        assert_eq!(Path::new(audio), base.join("videos/a/scene-1.wav"));
        assert_eq!(fs::read(audio).unwrap(), b"RIFF");
        // temp file may vanish; an incremental re-save with the stored file keeps working
        fs::remove_file(&wav).unwrap();
        let mut again = bundle("a", 1, &wav);
        again["complete"] = json!(true);
        save(&base, again).unwrap();
        assert_eq!(load(&base, "a").unwrap()["complete"], true);
        save(&base, bundle("b", 5, &base.join("videos/a/scene-1.wav"))).unwrap();
        let ids: Vec<_> = list(&base).iter().map(|b| b["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, ["b", "a"]);
        delete(&base, "a").unwrap();
        assert!(load(&base, "a").is_err());
        assert_eq!(list(&base).len(), 1);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn rejects_path_traversal_and_missing_audio() {
        let base = tmp("bad");
        assert!(save(&base, bundle("../evil", 1, &base.join("x.wav"))).is_err());
        assert!(delete(&base, "..").is_err());
        assert!(save(&base, bundle("ok", 1, &base.join("missing.wav"))).unwrap_err().contains("audio not found"));
        let _ = fs::remove_dir_all(&base);
    }
}

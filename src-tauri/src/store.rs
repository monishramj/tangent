use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.tangent.app";

/// Names become file names (store) or keychain accounts (secrets), so keep them boring.
pub fn valid_name(s: &str) -> Result<&str, String> {
    if !s.is_empty() && s.len() <= 128 && !s.contains("..") && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-')) { Ok(s) } else { Err(format!("invalid name: {s:?}")) }
}
fn file_of(base: &Path, name: &str) -> Result<PathBuf, String> { Ok(base.join("store").join(format!("{}.json", valid_name(name)?))) }

pub fn read(base: &Path, name: &str) -> Result<Option<Value>, String> {
    match fs::read(file_of(base, name)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Atomic: write a temp file next to the target, then rename over it.
pub fn write(base: &Path, name: &str, value: &Value) -> Result<(), String> {
    let file = file_of(base, name)?;
    fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec(value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

pub fn delete(base: &Path, name: &str) -> Result<(), String> {
    match fs::remove_file(file_of(base, name)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

fn base(app: &AppHandle) -> Result<PathBuf, String> { app.path().app_data_dir().map_err(|e| e.to_string()) }

#[tauri::command]
pub fn store_read(app: AppHandle, name: String) -> Result<Option<Value>, String> { read(&base(&app)?, &name) }
#[tauri::command]
pub fn store_write(app: AppHandle, name: String, value: Value) -> Result<(), String> { write(&base(&app)?, &name, &value) }
#[tauri::command]
pub fn store_delete(app: AppHandle, name: String) -> Result<(), String> { delete(&base(&app)?, &name) }

fn entry(name: &str) -> Result<keyring::Entry, String> { keyring::Entry::new(SERVICE, valid_name(name)?).map_err(|e| e.to_string()) }

#[tauri::command]
pub fn get_secret(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
/// Empty value deletes the secret. Values are never logged.
#[tauri::command]
pub fn set_secret(name: String, value: String) -> Result<(), String> {
    let e = entry(&name)?;
    if value.is_empty() {
        return match e.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(err) => Err(err.to_string()) };
    }
    e.set_password(&value).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("tangent-store-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn roundtrip_overwrite_delete() {
        let base = tmp("roundtrip");
        assert_eq!(read(&base, "projects").unwrap(), None);
        write(&base, "projects", &json!([{"id": "p1"}])).unwrap();
        assert_eq!(read(&base, "projects").unwrap(), Some(json!([{"id": "p1"}])));
        write(&base, "projects", &json!([])).unwrap();
        assert_eq!(read(&base, "projects").unwrap(), Some(json!([])));
        assert!(!base.join("store/projects.json.tmp").exists());
        delete(&base, "projects").unwrap();
        delete(&base, "projects").unwrap();
        assert_eq!(read(&base, "projects").unwrap(), None);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn rejects_bad_names() {
        let base = tmp("bad");
        for n in ["", "..", "a/b", "a\\b", "a..b", "a b", "../x", &"x".repeat(129)] {
            assert!(read(&base, n).is_err(), "{n:?}");
            assert!(write(&base, n, &json!(1)).is_err());
            assert!(delete(&base, n).is_err());
        }
        assert!(valid_name("ir-src_1.v2").is_ok());
        assert!(valid_name(&"x".repeat(128)).is_ok());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn corrupt_file_is_an_error_not_none() {
        let base = tmp("corrupt");
        fs::create_dir_all(base.join("store")).unwrap();
        fs::write(base.join("store/x.json"), b"{nope").unwrap();
        assert!(read(&base, "x").is_err());
        let _ = fs::remove_dir_all(&base);
    }
}

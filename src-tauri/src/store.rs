use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Names become file names (store) or secret file names, so keep them boring.
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

/// Secrets live in `<appData>/secrets/<name>`, owner-only (0700 dir, 0600 file). The macOS Keychain was dropped:
/// unsigned dev builds changed identity every rebuild and prompted for the login password on each read.
/// ponytail: plaintext at rest, protected by file permissions only; encrypt or move back to the Keychain once builds are signed.
fn secret_file(base: &Path, name: &str) -> Result<PathBuf, String> { Ok(base.join("secrets").join(valid_name(name)?)) }

pub fn secret_get(base: &Path, name: &str) -> Result<Option<String>, String> {
    match fs::read_to_string(secret_file(base, name)?) {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
/// Empty value deletes the secret. Values are never logged.
pub fn secret_set(base: &Path, name: &str, value: &str) -> Result<(), String> {
    let file = secret_file(base, name)?;
    if value.is_empty() {
        return match fs::remove_file(&file) { Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()), _ => Ok(()) };
    }
    let dir = file.parent().unwrap();
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?; }
    #[cfg(windows)]
    owner_only(dir)?;
    let tmp = file.with_extension("tmp");
    let mut open = fs::OpenOptions::new();
    open.write(true).create(true).truncate(true);
    #[cfg(unix)]
    { use std::os::unix::fs::OpenOptionsExt; open.mode(0o600); }
    let mut f = open.open(&tmp).map_err(|e| e.to_string())?;
    // mode() only applies on create: a stale .tmp left by a crash keeps its old bits, so force 0600 before writing.
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; f.set_permissions(fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?; }
    #[cfg(windows)]
    owner_only(&tmp)?;
    std::io::Write::write_all(&mut f, value.as_bytes()).map_err(|e| e.to_string())?;
    drop(f);
    fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    if let Err(error) = owner_only(&file) {
        let _ = fs::remove_file(&file);
        return Err(error);
    }
    Ok(())
}

/// Replace the DACL with one ACE for the current user. Inherited ACEs are blocked.
#[cfg(windows)]
fn owner_only(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree};
    use windows_sys::Win32::Security::Authorization::{
        SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, SE_FILE_OBJECT, SET_ACCESS, TRUSTEE_IS_SID, TRUSTEE_IS_USER,
    };
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenUser, DACL_SECURITY_INFORMATION, GENERIC_ALL, NO_INHERITANCE,
        PROTECTED_DACL_SECURITY_INFORMATION, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut needed = 0u32;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
        let mut buf = vec![0u8; needed as usize];
        if needed == 0 || GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), needed, &mut needed) == 0 {
            CloseHandle(token);
            return Err(std::io::Error::last_os_error().to_string());
        }
        let sid = (*buf.as_ptr().cast::<TOKEN_USER>()).User.Sid;
        let mut entry = EXPLICIT_ACCESS_W::default();
        entry.grfAccessPermissions = GENERIC_ALL;
        entry.grfAccessMode = SET_ACCESS;
        entry.grfInheritance = NO_INHERITANCE;
        entry.Trustee.TrusteeForm = TRUSTEE_IS_SID;
        entry.Trustee.TrusteeType = TRUSTEE_IS_USER;
        entry.Trustee.ptstrName = sid.cast();
        let mut acl = std::ptr::null_mut();
        let built = SetEntriesInAclW(1, &entry, std::ptr::null(), &mut acl);
        if built != 0 {
            CloseHandle(token);
            return Err(format!("secret ACL: {built}"));
        }
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let set = SetNamedSecurityInfoW(
            wide.as_ptr(), SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(), std::ptr::null_mut(), acl, std::ptr::null_mut(),
        );
        if !acl.is_null() { LocalFree(acl.cast()); }
        CloseHandle(token);
        if set != 0 { return Err(format!("secret ACL: {set}")); }
        Ok(())
    }
}

#[cfg(windows)]
fn ace_count(path: &Path) -> Result<u16, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::DACL_SECURITY_INFORMATION;
    unsafe {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut dacl = std::ptr::null_mut();
        let mut sd = std::ptr::null_mut();
        let got = GetNamedSecurityInfoW(wide.as_ptr(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(), std::ptr::null_mut(), &mut dacl, std::ptr::null_mut(), &mut sd);
        if got != 0 || dacl.is_null() {
            if !sd.is_null() { LocalFree(sd); }
            return Err(format!("secret ACL read: {got}"));
        }
        let count = (*dacl).AceCount;
        LocalFree(sd);
        Ok(count)
    }
}

/// Secrets the webview may read back. GIPHY keys are meant for client-side use (GIPHY's docs: call it from the client,
/// never proxy), so JS may fetch with it. Anything else (future paid API keys) is write-only from JS and only read in Rust,
/// so an injected script in the webview can't exfiltrate it.
const WEBVIEW_READABLE: &[&str] = &["giphy"];
fn webview_get(base: &Path, name: &str) -> Result<Option<String>, String> {
    if !WEBVIEW_READABLE.contains(&name) { return Err(format!("secret {name:?} is not readable from the webview")); }
    secret_get(base, name)
}

#[tauri::command]
pub fn get_secret(app: AppHandle, name: String) -> Result<Option<String>, String> { webview_get(&base(&app)?, &name) }
#[tauri::command]
pub fn set_secret(app: AppHandle, name: String, value: String) -> Result<(), String> { secret_set(&base(&app)?, &name, &value) }

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
    fn secrets_roundtrip_owner_only_and_reject_bad_names() {
        let base = tmp("secrets");
        for n in ["", "..", "a/b", "a b", "../giphy", &"x".repeat(129)] {
            assert!(secret_get(&base, n).unwrap_err().starts_with("invalid name"), "{n:?}");
            assert!(secret_set(&base, n, "v").unwrap_err().starts_with("invalid name"), "{n:?}");
        }
        assert_eq!(secret_get(&base, "giphy").unwrap(), None);
        secret_set(&base, "giphy", "abc").unwrap();
        assert_eq!(secret_get(&base, "giphy").unwrap(), Some("abc".into()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(base.join("secrets/giphy")).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(base.join("secrets")).unwrap().permissions().mode() & 0o777, 0o700);
        }
        secret_set(&base, "giphy", "").unwrap();
        secret_set(&base, "giphy", "").unwrap();
        assert_eq!(secret_get(&base, "giphy").unwrap(), None);
        let _ = fs::remove_dir_all(&base);
    }

    #[cfg(windows)]
    #[test]
    fn windows_secret_dacl_is_current_user_only() {
        let base = tmp("winacl");
        secret_set(&base, "giphy", "abc").unwrap();
        assert_eq!(ace_count(&base.join("secrets")).unwrap(), 1);
        assert_eq!(ace_count(&base.join("secrets/giphy")).unwrap(), 1);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn webview_reads_only_allowlisted_secrets() {
        let base = tmp("webview");
        secret_set(&base, "giphy", "g").unwrap();
        secret_set(&base, "anthropic", "a").unwrap();
        assert_eq!(webview_get(&base, "giphy").unwrap(), Some("g".into()));
        assert!(webview_get(&base, "anthropic").is_err());
        assert_eq!(secret_get(&base, "anthropic").unwrap(), Some("a".into())); // Rust side still reads it
        let _ = fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn stale_world_readable_tmp_is_tightened() {
        use std::os::unix::fs::PermissionsExt;
        let base = tmp("staletmp");
        fs::create_dir_all(base.join("secrets")).unwrap();
        let stale = base.join("secrets/giphy.tmp");
        fs::write(&stale, b"old").unwrap();
        fs::set_permissions(&stale, fs::Permissions::from_mode(0o644)).unwrap();
        secret_set(&base, "giphy", "new").unwrap();
        assert_eq!(fs::metadata(base.join("secrets/giphy")).unwrap().permissions().mode() & 0o777, 0o600);
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

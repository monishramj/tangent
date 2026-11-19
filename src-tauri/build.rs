// App commands need permissions so a capability can grant them per window (see capabilities/).
const COMMANDS: &[&str] = &[
    "bootstrap_status", "bootstrap_start", "bootstrap_cancel", "launch_checks", "pdf_page", "sidecar_call", "llm_complete", "begin_request", "cancel_request", "dev_log", "dev_mode", "set_dev_mode",
    "save_video_bundle", "list_video_bundles", "load_video_bundle", "delete_video_bundle",
    "store_read", "store_write", "store_delete", "get_secret", "set_secret", "sync_menu",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}

fn main() {
    println!("cargo:rerun-if-env-changed=TANGENT_SIDECAR_DIR");
    tauri_build::build()
}

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::ffi::{CString, c_char, c_int, c_ulong, c_void};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, atomic::{AtomicUsize, Ordering}};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

type Handle = *mut c_void;

#[cfg(unix)]
#[link(name = "dl")]
unsafe extern "C" {
    fn dlopen(path: *const c_char, flags: c_int) -> Handle;
    fn dlsym(handle: Handle, name: *const c_char) -> Handle;
    fn dlerror() -> *const c_char;
}
#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn LoadLibraryW(path: *const u16) -> Handle;
    fn GetProcAddress(handle: Handle, name: *const c_char) -> Handle;
}

unsafe fn load_library(path: &Path) -> Result<Handle, String> {
    #[cfg(unix)]
    let handle = {
        use std::os::unix::ffi::OsStrExt;
        let path = CString::new(path.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        let flags = if cfg!(target_os = "macos") { 0x2 | 0x4 } else { 0x2 };
        unsafe { dlopen(path.as_ptr(), flags) }
    };
    #[cfg(windows)]
    let handle = {
        use std::os::windows::ffi::OsStrExt;
        let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe { LoadLibraryW(path.as_ptr()) }
    };
    if handle.is_null() { return Err(loader_error()); }
    Ok(handle)
}

fn loader_error() -> String {
    #[cfg(unix)]
    unsafe {
        let error = dlerror();
        if !error.is_null() { return std::ffi::CStr::from_ptr(error).to_string_lossy().into_owned(); }
    }
    "could not load PDFium library or symbol".into()
}

unsafe fn symbol(handle: Handle, name: &[u8]) -> Result<Handle, String> {
    #[cfg(unix)]
    let ptr = unsafe { dlsym(handle, name.as_ptr().cast()) };
    #[cfg(windows)]
    let ptr = unsafe { GetProcAddress(handle, name.as_ptr().cast()) };
    if ptr.is_null() { return Err(format!("{}: {}", String::from_utf8_lossy(name), loader_error())); }
    Ok(ptr)
}

// Never unload PDFium: the process-wide function pointers remain valid until exit.
macro_rules! pdfium {
    ($($name:ident: $ty:ty),+ $(,)?) => {
        #[allow(non_snake_case)]
        struct Pdfium { $($name: $ty),+ }
        #[allow(non_snake_case)]
        impl Pdfium {
            unsafe fn load(path: &Path) -> Result<Self, String> {
                let library = unsafe { load_library(path)? };
                $(let $name: $ty = unsafe { std::mem::transmute(symbol(library, concat!(stringify!($name), "\0").as_bytes())?) };)+
                let api = Self { $($name),+ };
                unsafe { (api.FPDF_InitLibrary)() };
                Ok(api)
            }
        }
    }
}
pdfium! {
    FPDF_InitLibrary: unsafe extern "system" fn(),
    FPDF_LoadDocument: unsafe extern "system" fn(*const c_char, *const c_char) -> Handle,
    FPDF_GetLastError: unsafe extern "system" fn() -> c_ulong,
    FPDF_GetPageCount: unsafe extern "system" fn(Handle) -> c_int,
    FPDF_LoadPage: unsafe extern "system" fn(Handle, c_int) -> Handle,
    FPDF_GetPageWidthF: unsafe extern "system" fn(Handle) -> f32,
    FPDF_GetPageHeightF: unsafe extern "system" fn(Handle) -> f32,
    FPDFBitmap_Create: unsafe extern "system" fn(c_int, c_int, c_int) -> Handle,
    FPDFBitmap_FillRect: unsafe extern "system" fn(Handle, c_int, c_int, c_int, c_int, c_ulong),
    FPDF_RenderPageBitmap: unsafe extern "system" fn(Handle, Handle, c_int, c_int, c_int, c_int, c_int, c_int),
    FPDFBitmap_GetBuffer: unsafe extern "system" fn(Handle) -> *mut c_void,
    FPDFBitmap_GetStride: unsafe extern "system" fn(Handle) -> c_int,
    FPDFBitmap_Destroy: unsafe extern "system" fn(Handle),
    FPDF_ClosePage: unsafe extern "system" fn(Handle),
    FPDF_CloseDocument: unsafe extern "system" fn(Handle),
}

static PDFIUM: OnceLock<Result<Pdfium, String>> = OnceLock::new();
// ponytail: one render at a time across all documents; use isolated processes if parallel rendering becomes necessary.
static PDFIUM_LOCK: Mutex<()> = Mutex::new(());
static CACHE_WRITE_LOCK: Mutex<()> = Mutex::new(());
static WRITES: AtomicUsize = AtomicUsize::new(0);
static TEMP_ID: AtomicUsize = AtomicUsize::new(0);
#[cfg(test)]
static RENDERS: AtomicUsize = AtomicUsize::new(0);

fn library_path(resource: Option<&Path>) -> Result<PathBuf, String> {
    let name = if cfg!(target_os = "macos") { "libpdfium.dylib" }
        else if cfg!(target_os = "windows") { "pdfium.dll" } else { "libpdfium.so" };
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("TANGENT_PDFIUM") { candidates.push(PathBuf::from(path)); }
    if let Ok(sidecar) = crate::sidecar_dir(std::env::var_os("TANGENT_SIDECAR_DIR").map(PathBuf::from),
        Path::new(env!("CARGO_MANIFEST_DIR")), cfg!(debug_assertions) || cfg!(test)) {
        candidates.push(sidecar.join(".venv/Lib/site-packages/pypdfium2_raw").join(name));
        if let Ok(entries) = fs::read_dir(sidecar.join(".venv/lib")) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("python3") {
                    candidates.push(entry.path().join("site-packages/pypdfium2_raw").join(name));
                }
            }
        }
    }
    if let Some(dir) = resource { candidates.push(dir.join("pdfium").join(name)); }
    candidates.into_iter().find(|p| p.is_file()).ok_or_else(||
        format!("PDFium library not found: set TANGENT_PDFIUM to {name}, install the sidecar venv, or bundle pdfium/{name}"))
}

fn validate_pdf(base: &Path, path: &Path) -> Result<PathBuf, String> {
    let canonical = path.canonicalize().map_err(|e| format!("PDF path: {e}"))?;
    if !canonical.is_file() { return Err("PDF path must be a file".into()); }
    let library = crate::store::read(base, "library")?;
    let allowed = library.as_ref().and_then(|v| v["sources"].as_array()).is_some_and(|sources|
        sources.iter().filter_map(|s| s["pdfPath"].as_str()).any(|p|
            Path::new(p).canonicalize().is_ok_and(|p| p == canonical)));
    if !allowed { return Err("PDF is not a source in the library".into()); }
    let mut header = [0; 5];
    File::open(&canonical).and_then(|mut f| f.read_exact(&mut header)).map_err(|e| e.to_string())?;
    if &header != b"%PDF-" { return Err("path must contain a PDF (%PDF- header)".into()); }
    Ok(canonical)
}

fn validate_request(page: u32, width: u32) -> Result<(), String> {
    if !(1..=4000).contains(&width) { return Err("width must be in 1..=4000".into()); }
    if page == 0 { return Err("page must be at least 1".into()); }
    Ok(())
}

fn cache_key(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = meta.modified().map_err(|e| e.to_string())?.duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    hash.update(path.as_os_str().as_encoded_bytes());
    hash.update(meta.len().to_le_bytes());
    hash.update(modified.as_nanos().to_le_bytes());
    Ok(format!("{:x}", hash.finalize()))
}

#[derive(Debug, Serialize)]
pub struct Page { path: String, width: u32, height: u32 }

// All handles are closed before leaving the lock, including on errors.
fn render(path: &Path, page: u32, width: u32, resource: Option<&Path>) -> Result<(Vec<u8>, u32, u32, u32, u32), String> {
    let _lock = PDFIUM_LOCK.lock().map_err(|e| e.to_string())?;
    let api = PDFIUM.get_or_init(|| unsafe { Pdfium::load(&library_path(resource)?) }).as_ref().map_err(Clone::clone)?;
    let path = CString::new(path.to_str().ok_or("PDF path is not UTF-8")?).map_err(|e| e.to_string())?;
    // SAFETY: these symbols have PDFium's documented signatures; handles and buffers stay under the global lock.
    unsafe {
        let doc = (api.FPDF_LoadDocument)(path.as_ptr(), std::ptr::null());
        if doc.is_null() { return Err(format!("PDFium could not open PDF (error {})", (api.FPDF_GetLastError)())); }
        let result = (|| {
            let count = (api.FPDF_GetPageCount)(doc);
            if page > count.max(0) as u32 { return Err(format!("page must be in 1..={count}")); }
            let pdf_page = (api.FPDF_LoadPage)(doc, (page - 1) as c_int);
            if pdf_page.is_null() { return Err("PDFium could not load page".into()); }
            let result = (|| {
                let w = (api.FPDF_GetPageWidthF)(pdf_page) as f64;
                let h = (api.FPDF_GetPageHeightF)(pdf_page) as f64;
                if !w.is_finite() || !h.is_finite() || w < 1.0 || h < 1.0 || w > u32::MAX as f64 || h > u32::MAX as f64 {
                    return Err("invalid PDF page dimensions".into());
                }
                let height = (h * width as f64 / w).ceil().max(1.0);
                if height > c_int::MAX as f64 || height * width as f64 > 64_000_000.0 {
                    return Err("rendered PDF page exceeds 64 million pixels".into());
                }
                let height = height as u32;
                let bitmap = (api.FPDFBitmap_Create)(width as c_int, height as c_int, 0);
                if bitmap.is_null() { return Err("PDFium could not allocate bitmap".into()); }
                let result = (|| {
                    (api.FPDFBitmap_FillRect)(bitmap, 0, 0, width as c_int, height as c_int, 0xffffffff);
                    (api.FPDF_RenderPageBitmap)(bitmap, pdf_page, 0, 0, width as c_int, height as c_int, 0, 0x01);
                    let stride = (api.FPDFBitmap_GetStride)(bitmap);
                    let buffer = (api.FPDFBitmap_GetBuffer)(bitmap);
                    if buffer.is_null() || stride < width as c_int * 4 { return Err("invalid PDFium bitmap".into()); }
                    let bytes = std::slice::from_raw_parts(buffer as *const u8, stride as usize * height as usize);
                    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
                    for row in bytes.chunks_exact(stride as usize) {
                        for pixel in row[..width as usize * 4].chunks_exact(4) { rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]); }
                    }
                    #[cfg(test)]
                    RENDERS.fetch_add(1, Ordering::Relaxed);
                    Ok((rgb, height, w.round() as u32, h.round() as u32, count as u32))
                })();
                (api.FPDFBitmap_Destroy)(bitmap);
                result
            })();
            (api.FPDF_ClosePage)(pdf_page);
            result
        })();
        (api.FPDF_CloseDocument)(doc);
        result
    }
}

fn atomic_write(path: &Path, write: impl FnOnce(&mut File) -> Result<(), String>) -> Result<(), String> {
    let tmp = path.with_extension(format!("{}.{}.tmp", std::process::id(), TEMP_ID.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let mut file = File::options().write(true).create_new(true).open(&tmp).map_err(|e| e.to_string())?;
        write(&mut file)?;
        drop(file);
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(tmp); }
    result
}

fn cached_page(base: &Path, path: &Path, page: u32, width: u32, resource: Option<&Path>) -> Result<Page, String> {
    validate_request(page, width)?;
    let root = base.join("pages");
    let dir = root.join(cache_key(path)?);
    let png = dir.join(format!("{page}-{width}.png"));
    let size = dir.join(format!("{page}.size"));
    if png.is_file() {
        if let Ok(text) = fs::read_to_string(&size) {
            let dims: Vec<u32> = text.split_whitespace().filter_map(|n| n.parse().ok()).collect();
            if let [w, h, count] = dims.as_slice() {
                if page > *count { return Err(format!("page must be in 1..={count}")); }
                let now = SystemTime::now();
                File::open(&png).and_then(|f| f.set_modified(now)).map_err(|e| e.to_string())?;
                File::open(&size).and_then(|f| f.set_modified(now)).map_err(|e| e.to_string())?;
                return Ok(Page { path: png.to_string_lossy().into_owned(), width: *w, height: *h });
            }
        }
    }
    let (rgb, pixels_high, w, h, count) = render(path, page, width, resource)?;
    let _write_lock = CACHE_WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    atomic_write(&png, |file| {
        let mut encoder = png::Encoder::new(file, width, pixels_high);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&rgb).map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())
    })?;
    atomic_write(&size, |file| write!(file, "{w} {h} {count}").map_err(|e| e.to_string()))?;
    if WRITES.fetch_add(1, Ordering::Relaxed) % 16 == 0 {
        // Cache maintenance must not turn a successful render into a failed request.
        if let Err(e) = prune(&root, 512 * 1024 * 1024, 384 * 1024 * 1024) { eprintln!("page cache pruning: {e}"); }
    }
    Ok(Page { path: png.to_string_lossy().into_owned(), width: w, height: h })
}

fn prune(root: &Path, limit: u64, target: u64) -> Result<(), String> {
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    for dir in fs::read_dir(root).map_err(|e| e.to_string())? {
        let dir = dir.map_err(|e| e.to_string())?.path();
        if !dir.is_dir() { continue; }
        for file in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let file = file.map_err(|e| e.to_string())?;
            let meta = file.metadata().map_err(|e| e.to_string())?;
            if meta.is_file() { files.push((meta.modified().map_err(|e| e.to_string())?, meta.len(), file.path())); }
        }
        dirs.push(dir);
    }
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    if total > limit {
        files.sort_by_key(|f| f.0);
        for (_, len, path) in files {
            if total <= target { break; }
            match fs::remove_file(path) {
                Ok(()) => total -= len,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => total -= len,
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    for dir in dirs { let _ = fs::remove_dir(dir); }
    Ok(())
}

#[tauri::command]
pub async fn pdf_page(app: AppHandle, path: String, page: u32, width: u32) -> Result<Page, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_request(page, width)?;
        let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let path = validate_pdf(&base, Path::new(&path))?;
        cached_page(&base, &path, page, width, app.path().resource_dir().ok().as_deref())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn allow_pdf(app: AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let path = validate_pdf(&base, Path::new(&path))?;
        app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{Duration, Instant};

    fn tmp(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("tangent-pages-{name}-{}-{}", std::process::id(), TEMP_ID.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn pdf(base: &Path) -> PathBuf {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents 5 0 R >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 600] /Resources << >> /Contents 5 0 R >>",
            "<< /Length 25 >>\nstream\n1 0 0 rg 0 0 50 50 re f\n\nendstream",
        ];
        let mut bytes = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (i, object) in objects.iter().enumerate() {
            offsets.push(bytes.len());
            write!(bytes, "{} 0 obj\n{object}\nendobj\n", i + 1).unwrap();
        }
        let xref = bytes.len();
        write!(bytes, "xref\n0 6\n0000000000 65535 f \n").unwrap();
        for offset in offsets { writeln!(bytes, "{offset:010} 00000 n ").unwrap(); }
        write!(bytes, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").unwrap();
        let path = base.join("book.pdf");
        fs::write(&path, bytes).unwrap();
        path.canonicalize().unwrap()
    }

    #[test]
    fn validates_requests_and_library_pdf_paths() {
        for (page, width) in [(1, 0), (1, 4001), (0, 800)] { assert!(validate_request(page, width).is_err()); }
        assert!(validate_request(1, 1).is_ok());
        assert!(validate_request(1, 4000).is_ok());
        let base = tmp("validation");
        let path = pdf(&base);
        assert!(validate_pdf(&base, &path).unwrap_err().contains("library"));
        crate::store::write(&base, "library", &json!({"sources": [{"pdfPath": path}]})).unwrap();
        assert_eq!(validate_pdf(&base, &base.join("./book.pdf")).unwrap(), path);
        let unknown = base.join("unknown.pdf");
        fs::copy(&path, &unknown).unwrap();
        assert!(validate_pdf(&base, &unknown).unwrap_err().contains("library"));
        fs::write(&path, b"not a PDF").unwrap();
        assert!(validate_pdf(&base, &path).unwrap_err().contains("%PDF-"));
        assert!(validate_pdf(&base, &base).is_err());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn cache_key_tracks_size_mtime_and_path() {
        let base = tmp("key");
        let path = pdf(&base);
        let first = cache_key(&path).unwrap();
        File::open(&path).unwrap().set_modified(UNIX_EPOCH + Duration::from_secs(10)).unwrap();
        let second = cache_key(&path).unwrap();
        assert_ne!(first, second);
        fs::write(&path, b"%PDF-short").unwrap();
        File::open(&path).unwrap().set_modified(UNIX_EPOCH + Duration::from_secs(10)).unwrap();
        assert_ne!(second, cache_key(&path).unwrap());
        let other = base.join("other.pdf");
        fs::copy(&path, &other).unwrap();
        File::open(&other).unwrap().set_modified(UNIX_EPOCH + Duration::from_secs(10)).unwrap();
        assert_ne!(cache_key(&path).unwrap(), cache_key(&other).unwrap());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn renders_real_pdf_and_hits_cache_without_pdfium_lock() {
        let base = tmp("render");
        let path = pdf(&base);
        assert!(cached_page(&base, &path, 3, 150, None).unwrap_err().contains("1..=2"));
        let first = cached_page(&base, &path, 2, 150, None).unwrap();
        assert_eq!((first.width, first.height), (300, 600));
        let decoder = png::Decoder::new(std::io::BufReader::new(File::open(&first.path).unwrap()));
        let mut reader = decoder.read_info().unwrap();
        assert_eq!((reader.info().width, reader.info().height), (150, 300));
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut pixels).unwrap();
        assert!(pixels.chunks_exact(3).any(|p| p == [255, 0, 0]));
        assert!(pixels.chunks_exact(3).any(|p| p == [255, 255, 255]));
        File::open(&first.path).unwrap().set_modified(UNIX_EPOCH + Duration::from_secs(10)).unwrap();
        let renders = RENDERS.load(Ordering::Relaxed);
        let _lock = PDFIUM_LOCK.lock().unwrap();
        let second = cached_page(&base, &path, 2, 150, None).unwrap();
        assert_eq!(first.path, second.path);
        assert_eq!((second.width, second.height), (300, 600));
        assert_eq!(RENDERS.load(Ordering::Relaxed), renders);
        assert!(fs::metadata(&first.path).unwrap().modified().unwrap() > UNIX_EPOCH + Duration::from_secs(10));
        drop(_lock);
        std::thread::scope(|scope| {
            let a = scope.spawn(|| cached_page(&base, &path, 1, 160, None).unwrap());
            let b = scope.spawn(|| cached_page(&base, &path, 1, 160, None).unwrap());
            let a = a.join().unwrap();
            assert_eq!(a.path, b.join().unwrap().path);
            let reader = png::Decoder::new(std::io::BufReader::new(File::open(a.path).unwrap())).read_info().unwrap();
            assert_eq!((reader.info().width, reader.info().height), (160, 80));
        });
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn prunes_oldest_first_and_removes_empty_directories() {
        let root = tmp("prune");
        fs::create_dir(root.join("old")).unwrap();
        fs::create_dir(root.join("new")).unwrap();
        for (name, time) in [("old/a.png", 1), ("new/b.png", 2), ("new/c.png", 3)] {
            let path = root.join(name);
            fs::write(&path, [0; 10]).unwrap();
            File::open(path).unwrap().set_modified(UNIX_EPOCH + Duration::from_secs(time)).unwrap();
        }
        prune(&root, 30, 10).unwrap();
        assert!(root.join("old/a.png").exists()); // At the limit, leave it alone.
        prune(&root, 29, 10).unwrap();
        assert!(!root.join("old").exists());
        assert!(!root.join("new/b.png").exists());
        assert!(root.join("new/c.png").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore]
    fn bench_render() {
        let path = std::env::var_os("TANGENT_BENCH_PDF").map(PathBuf::from).unwrap_or_else(||
            PathBuf::from(std::env::var_os("HOME").unwrap()).join("Downloads/Bioethics pp38-47 (Tangent test).pdf"));
        let path = path.canonicalize().unwrap();
        for width in [800, 1600] {
            let base = tmp("bench");
            for label in ["cold", "cached"] {
                let start = Instant::now();
                let result = cached_page(&base, &path, 3, width, None).unwrap();
                println!("{width}px {label}: {:.3} ms, {:.1} KiB PNG", start.elapsed().as_secs_f64() * 1000.0,
                    fs::metadata(result.path).unwrap().len() as f64 / 1024.0);
            }
            fs::remove_dir_all(base).unwrap();
        }
    }
}

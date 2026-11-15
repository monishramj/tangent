# Packaging, Tauri shell, release, security

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.


## Contract

### Desktop shell: Tauri (decided)
- System webview (WKWebView on macOS) + Rust core → ~10 MB bundle and a much lower baseline RAM than Electron's bundled Chromium + Node.
- Known risks: rendering differences across webviews (WKWebView / WebView2 / WebKitGTK). Linux WebKitGTK WebGL performance is the weak spot for the later OSS release. PixiJS on WebGL is fine on macOS.
- ML (TTS, alignment, PDF parsing, later Whisper) runs in a **Python sidecar** managed by `uv`, with an env created on first run rather than a frozen PyInstaller blob. The models dominate memory either way (GBs vs. the shell's MBs).
- Target: macOS (M4 Max, 36 GB) first.

## Packaging: one downloadable app
- Goal: a single installer. Nothing the user must install or hunt for (no brew, no separate Python, no ollama).
- Bundle as Tauri `externalBin` sidecars: the Python sidecar (frozen with PyInstaller or an embedded uv Python), `llama-server` (llama.cpp, small), ffmpeg if needed.
- Large model weights (TTS, VLM, alignment) are NOT in the installer. Download once on first run into the app data dir, with a progress UI and checksum. Small models (PocketTTS English ~225 MB including the Alba preset) may be bundled if installer size allows.
- Licence limits what we bundle: Marker weights are restricted (no bundle, opt-in only); Docling is MIT and can ship.
- Personal builds use runtime `TANGENT_SIDECAR_DIR`, then the build-time value, then the checkout sidecar path (dev stays checkout-relative). The release script requires an installed venv; Monish’s stable project is `/Users/monishramj/Documents/Code/hackathons/26_27/accessED_hacks/tangent/sidecar`. PDFium already searches that same venv. Keep the project installed: this is a documented personal-use bridge, not a standalone installer. Next: freeze/embed the Python sidecar and bundle PDFium before broader distribution.
- PDFium (page rendering, BSD-3/Apache-2.0): ship the prebuilt library from bblanchon/pdfium-binaries (pin one release; verify its checksum) as a Tauri `resources` entry at `pdfium/libpdfium.dylib` (macOS universal or arm64 + x64), `pdfium/pdfium.dll` (Windows x64), `pdfium/libpdfium.so` (Linux x64); `pages.rs` already looks there after `TANGENT_PDFIUM` and the dev venv. Dev needs nothing extra: it uses pypdfium2's copy in `sidecar/.venv`.

### Personal updater/signing research (2026-11-12)
- [Official Tauri v2 updater guide](https://v2.tauri.app/plugin/updater/): mandatory updater signatures, external private minisign key, public config key, `createUpdaterArtifacts`, macOS `.app.tar.gz` + `.sig`, static version/platform manifest, and explicit relaunch after installation. Key generated once at `~/.tauri/tangent.key` (0600, outside git); no secrets in config. Back up this key; losing it breaks updates for existing installs.
- [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/): `signingIdentity: "-"` enables free ad-hoc signing, required for Apple Silicon execution but does not establish an identified developer or bypass Gatekeeper. No paid Apple account and no notarization in this personal build; updater signatures do not substitute for Apple signing.
- [Apple Gatekeeper guidance](https://support.apple.com/en-us/102445): downloaded unidentified/unnotarized apps require a user override; current macOS uses Privacy & Security → Open Anyway after a launch attempt. README also gives right-click Open where supported and targeted quarantine removal for this trusted personal build.
- GitHub visibility verified PUBLIC with `gh repo view`. Private repos require authenticated manifest AND artifact downloads using API URLs/per-user secrets in Rust or a proxy/public mirror; the configured public URL does not inherit `gh` login. No embedded token, no private-repo support claimed.

- App icon: macOS-style rounded square (white logo on black) built from `assets/tangent-icon.png` by `scripts/mkicon.py` -> `assets/app-icon.png` -> `bunx tauri icon`. Icons are compiled into the binary: after changing them run `cargo clean -p tangent` before `tauri dev`.

- The binary is `Tangent` (`[[bin]]` in Cargo.toml + `mainBinaryName`) so the dev build shows "Tangent" in the Dock/menu bar; the crate stays `tangent`.

- **CSP on (2026-11-10):** `app.security.csp` in `tauri.conf.json` is a strict directive map: scripts `'self'` only, no `'unsafe-eval'` (Pixi via `pixi.js/unsafe-eval` in `Stage.tsx`, zod `jitless` in `src/zodConfig.ts`), network only to IPC, `asset:` and GIPHY, `frame-src blob:` for the PDF preview, `object-src`/`base-uri`/`form-action 'none'`. Styles keep `'unsafe-inline'` (`dangerousDisableAssetCspModification: ["style-src"]`; React/Pixi/KaTeX inline styles). Tauri applies it only to the built app: `tauri dev` on desktop loads Vite directly, so `vite.config.ts` serves the same policy as a header (plus HMR websocket and inline scripts for the Fast Refresh preamble). Violations show as `[webview] CSP blocked …` (`devlog.ts`). New external hosts (Klipy, API providers) must be added to `connect-src`/`img-src`.

- Merged (2026-11-10, via `review/merge-all`): the audio fix, the Settings side panel + file-based secrets, PocketTTS replacing Kokoro, and the homepage dev design pages (`src/dev/home-design*`).

## Log

- 2026-11-15 (step 6): Dedicated ingest worker uses macOS nice 19 + background QoS, Linux nice 19, Windows IDLE; foreground workers use normal priority.
  Both ML classes keep the existing serial execution order and share a ~30%-of-cores cap, clamped to 1–6 even for overrides; active ingest still delays foreground work.
  Preserved watchdog/no-mid-job-restart rules, added non-signalling Windows process queries, and forward chunk progress to the existing UI caller in `src/library.ts`.
  Evidence: simulated priority/thermal/Windows-watchdog tests, Python fast suite, Rust library tests, affected UI tests and typecheck.
  Not verified: native Windows/Linux scheduling, real-model chunk quality/latency, physical thermal transitions; unknown thermal readings allow work to continue.

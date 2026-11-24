# Packaging, Tauri shell, release, security

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.
- (2026-11-24) Audit cleanups: removed `spikes/` (tag `archive/spikes-2026-11`), `scripts/usage.py`, and the home-design/section-picker dev pages. Fixed the Antigravity line (was "refuses prompts"; gen.md is current). Not verified: Windows/Linux.


## Contract

- **Do not regress (P0 no-audio, 2026-11-16):** the ad-hoc macOS bundle (`signingIdentity: "-"`) must NOT enable hardened runtime or an entitlements file. Entitlements.plist made the ad-hoc signature carry the `runtime` flag in v0.1.3 and the installed app played with no sound; the owner confirmed a copy without the flag has sound. Without hardened runtime library validation is not enforced, so venv/PDFium dylibs still load. `scripts/macos-signing.test.ts` fails if this is reintroduced.

### Desktop shell: Tauri (decided)
- System webview (WKWebView on macOS) + Rust core → ~10 MB bundle and a much lower baseline RAM than Electron's bundled Chromium + Node.
- Known risks: rendering differences across webviews (WKWebView / WebView2 / WebKitGTK). Linux WebKitGTK WebGL performance is the weak spot for the later OSS release. PixiJS on WebGL is fine on macOS.
- ML (TTS, alignment, PDF parsing, later Whisper) runs in a **Python sidecar** managed by `uv`, with an env created on first run rather than a frozen PyInstaller blob. The models dominate memory either way (GBs vs. the shell's MBs).
- Target: macOS (M4 Max, 36 GB) first.

## Packaging: one downloadable app
- Goal: a single installer. Nothing the user must install or hunt for (no brew, no separate Python, no ollama).
- Bundle uv, PDFium, and the sidecar project as Tauri resources in `runtime/`. No Python, checkout, package manager, or system PDFium is required on the user’s machine. Python and ML packages are installed into app data on first launch.
- Large model weights (TTS, VLM, alignment) are NOT in the installer. Download once on first run into the app data dir, with a progress UI and checksum. Small models (PocketTTS English ~225 MB including the Alba preset) may be bundled if installer size allows.
- Licence limits what we bundle: Marker weights are restricted (no bundle, opt-in only); Docling is MIT and can ship.
- Packaged builds never fall back to a developer checkout or PATH uv. Development still resolves `uv` from PATH and runs `uv run --project sidecar python -m tangent_sidecar`; `TANGENT_SIDECAR_DIR` remains a dev override.
- PDFium is resolved from `TANGENT_PDFIUM` (explicit override), then bundled `runtime/libpdfium.dylib`, `runtime/pdfium.dll`, or `runtime/libpdfium.so`. Dev/tests can still use pypdfium2’s copy in a checkout venv. There is no system-library search.

### First-launch bootstrap (step 20)
- `bootstrap.rs` opens a separate accessible setup window before exposing the main window. It says **about 2–3 GB**, provides Set up / Cancel / Resume, and shows indeterminate progress by real phase rather than invented byte percentages. Closing setup quits safely. After that window hands off, the main window's first screen checks Claude Code (`launch_checks` on the main capability only).
- Bundled uv first runs `python install 3.12`, then `sync --frozen --no-dev --python 3.12 --managed-python --project <resources>/runtime/sidecar`. Environment, managed Python, download cache, log, and later Hugging Face weights stay under `<app data>/runtime/{env,python,cache,setup.log,models}`. Model weights still download lazily when their tools first run; no models run during bootstrap.
- A matching `complete` marker **and** interpreter are required before sidecar calls. The marker fingerprints the project, lock, and bootstrap Python version; it is written by atomic rename only after successful sync. Stale markers are removed before retry. Partial envs and uv cache remain reusable after interruption, cancellation, failure, or relaunch. No user content is deleted.
- Each phase retries up to three times; uv also retries HTTP failures three times. Final errors show a Retry/Resume action and point to `setup.log`. Cancel terminates the installer process tree and never writes completion. One setup runs per app instance.
- Installer downloads/installs/builds have concurrency caps (2/2/1). Unix installer runs at nice 10 in a process group with an app-PID watchdog; Windows uses a kill-on-close Job Object with below-normal priority and no console. Runtime Python keeps the latest shared thread/job caps, separate ingest work-class priorities, parent watchdog, process-group cleanup, and no mid-job respawn. Windows runtime lifecycle hardening remains step 21.
- Linux `torch` and `torchaudio` are sourced **only** from the explicit [PyTorch CPU index](https://docs.astral.sh/uv/concepts/indexes/); `uv.lock` includes CPU wheel hashes and no CUDA/NVIDIA dependencies. macOS/Windows retain PyPI pins torch 2.15.0 and torchaudio 2.11.1. Existing platform/package compatibility is still a release-test unknown (including Intel Mac wheels).

### Bundled assets and CI handoff
- `scripts/prepare-runtime.py` runs automatically in Tauri’s `beforeBuildCommand`, before the frontend build. CI needs Python 3.11+ and Rust at build time; end users do not. It copies only the sidecar sources, project, and lock, never `.venv`, models, test PDFs, or caches. The old personal release script no longer requires an installed venv and uses `scripts/heavy.sh`.
- uv is pinned to **0.12.19**, PDFium to **chromium/8152**. `scripts/runtime-assets.json` commits the exact upstream release URLs and SHA256 for each archive, taken from the upstream GitHub release asset digests. A mismatched digest or missing binary aborts packaging. Upstream uv and PDFium licence files are included in the generated resources. Generated binaries are ignored by git.
- Resource matrix: `aarch64-apple-darwin` → uv tar.gz + pdfium-mac-arm64.tgz; `x86_64-apple-darwin` → uv tar.gz + pdfium-mac-x64.tgz; `x86_64-unknown-linux-gnu` → uv tar.gz + pdfium-linux-x64.tgz; `x86_64-pc-windows-msvc` → uv zip + pdfium-win-x64.tgz. Other targets fail closed. The resource matrix does not promise ML wheel availability on every architecture.
- CI uses native runners for the target (Windows/Linux builds only in CI). Tauri passes `TAURI_ENV_TARGET_TRIPLE` to its build hook; a direct script invocation can set that variable explicitly, otherwise it uses `rustc -vV`’s host triple. Example: `TAURI_ENV_TARGET_TRIPLE=x86_64-unknown-linux-gnu python3 scripts/prepare-runtime.py`. Then `scripts/heavy.sh bunx tauri build --target x86_64-unknown-linux-gnu`. Step 22 owns the release workflow matrix/signing; no workflow is added here.
- To update assets, choose upstream tags, replace all matrix URLs and SHA256 values with reviewed release digests, update licence URLs/version text, and build/test each target before publishing. Do not fetch “latest” during builds.

### UI / IPC contract
`runtime-setup` is an app event carrying the following object; `bootstrap_status` returns the identical snapshot so the setup screen can recover missed events by polling. `bootstrap_start` starts/resumes idempotently while already running; `bootstrap_cancel` requests cancellation. Development has no packaged setup and continues its existing launch path.

```ts
type RuntimeSetup = {
  status: 'needed' | 'installing' | 'retrying' | 'cancelled' | 'failed' | 'complete';
  phase: 'python' | 'packages';
  attempt: number;       // 1–3 while running; 0 for initial/final snapshots
  downloadGb: [2, 3];    // estimate, not measured transferred bytes
  message: string;      // user-facing phase, error, or resume guidance
};
```

Proof without ML installation: `scripts/heavy.sh cargo test --manifest-path src-tauri/Cargo.toml` exercises fresh/partial/complete/stale/network/cancel/resume states with fake uv and isolated temporary filesystem fixtures, including a real fake executable at paths with spaces; `node --test scripts/test_bootstrap.cjs` checks screen/IPC wiring; `python3 -m unittest discover -s scripts -p test_prepare_runtime.py` checks hashes, safe extraction, and CPU lock selection. Host Rust tests use the SHA256-verified PDFium library via `TANGENT_PDFIUM` when no dev venv exists. This does not verify a real installer, WebView setup-window rendering, actual ML install/download size, signing, or Windows/Linux execution.

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
- 2026-11-18 First launch and Settings check the selected CLI without model calls. Claude uses `auth status --json`; Codex uses `login status`.
  Claude uses empty tools/settings, strict MCP, disabled slash commands and no session persistence in an empty cwd.
  Codex exec uses read-only and no approvals, ignores user config/rules, disables shell, file-image tools, hooks, MCP, plugins, apps, web and agent features, and uses ephemeral sessions.
  Codex still uses its existing auth and can create internal diagnostics. Antigravity’s [headless permissions](https://antigravity.google/docs/cli/headless/) govern tool approval and headless mode can load user settings/extensions and resume conversations.
  Antigravity is selectable as experimental (sandboxed, tool calls killed); see `gen.md` 2026-11-18.

- 2026-11-17 Generation cancellation reaps LLM children and skips queued Python work before it reaches the sidecar.
  Timeouts cover blocked sidecar writes and LLM pipes held open by child processes.
  Rust passed 64 library tests with one ignored. Active Python RPCs can finish within their existing timeout. Windows cleanup remains unverified.

- 2026-11-17 Developer mode (Settings → Developer, flag file `<app log dir>/dev-mode`): devlog lines, every sidecar/LLM call (duration, error) and sidecar stderr (after relaunch) append to `~/Library/Logs/com.tangent.app/dev.log` in installed builds. `ingest_pdf` no longer takes the shared job lock: a 600-page ingest (with thermal pauses) blocked section text, formulas and TTS for every video. Evidence: cargo test (60), vitest 1105. Not verified: real app run; foreground + background sidecars may now run concurrently (~2x30% cores).
- 2026-11-16 Step 25 recheck at `b9daaed` (#40 + #41): one arm64 release app built; ad-hoc `flags=0x2`, strict codesign verification, fresh setup → nonblank main, saved playback/WebAudio Playing, Textbook PDF pages, and SIGTERM sidecar cleanup PASS. Evidence: `docs/mac-smoke-2026-11.md` and adjacent screenshots/logs.
  Build command exited 1 only at updater signing (private key absent); built `.app` retained in this worker's `src-tauri/target/release/bundle/macos/`, never installed over `/Applications`.
  Owner to verify: audible sound, PPTX import and generation ring (native dialog focus blocked; coordinator deferred). Requested video disappeared; coordinator approved `vmwh7y0mfvjpz4` fallback. No code fix/rebuild; orphan cleanup ran.

- 2026-11-16 Blank main window after first-run setup + SIGTERM orphan: SIGTERM/SIGINT now run the same sidecar cleanup as quit (self-pipe handler, `State_::kill_sidecars`, unit-tested); `open_main` now focuses the new window and a test pins config label to the `default` capability. Blank-window root cause NOT reproduced (dev skips setup, no release build run); set_focus is a hypothesis-level mitigation. Capabilities unchanged.

- 2026-11-16: Mac smoke of the v1 tip (`docs/mac-smoke-2026-11.md`). The PR #37 fix was incomplete: Tauri defaults `hardenedRuntime` to true, so the built app still had `flags=0x10002(adhoc,runtime)` and PDFium page load failed; set `hardenedRuntime: false` (test updated), re-signed copy renders. Blank main window right after first setup, and SIGTERM leaves the sidecar running. Not verified: audio, rebuild with the fix.

### 2026-11-16 P0 no-audio: hardened runtime removed
- Dropped Entitlements.plist from the ad-hoc bundle; owner confirmed a copy without the runtime flag has sound. Added scripts/macos-signing.test.ts (passes).
- Not verified: dylib loading (venv/PDFium) in a rebuilt app; owner to confirm in the next build.

- 2026-11-16 PR #31 review: `run_probe` drains stdout and stderr while it waits, keeps at most 64KiB, and kills the process group (Windows: `taskkill /T`) at the deadline so a grandchild holding the pipe cannot hang the check.
  Evidence: cargo test — sleep past the deadline, a 2MB flood, and a grandchild that inherits the pipe. Not verified: the Windows `taskkill` path.

- 2026-11-16 Step 22: `.github/workflows/release.yml` (tag `v*` -> draft release; macOS arm64+x64, Windows, Linux; tauri-action action-v0.6.2; manual run = dry run with workflow artifacts). Secrets `TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD`; ad-hoc mac signing kept; owner steps in `docs/release.md`.
  Decided: added macOS x64 (`macos-15-intel`), tag must equal `tauri.conf.json` version, `release.sh` left as local fallback; ci.yml untouched.
  Evidence: YAML parses (ruby); actionlint/yamllint not installed. Not verified: any real run (see `docs/release.md` last section).
- 2026-11-16 Step 23: main window shows Claude Code install/login checks before the library (and again under Settings → Setup). `launch_checks` runs only `claude --version` and `claude auth status --json` (no `-p`). Ollama is not offered.
  Evidence: `checks::` unit tests for missing, signed-out, ok, and timeout probes; vitest for the screen and the Settings section.
  Not verified: a real logged-out `auth status` on a machine without Claude, or the setup-window hand-off in a packaged build.

- 2026-11-16 PR #33 review: secret temps are removed before create; the Windows secrets-dir ACE is inheritable so the file is born owner-only, and a failed restriction deletes it. Sidecar drop always `killpg`s after the child exits, including a graceful exit. Evidence: `restriction_failure_removes_the_secret_file` and `drop_kills_grandchild_and_dead_child_fails_without_respawn`. Not verified: a Windows ACL read.
- 2026-11-16 Step 21: Windows sidecar joins a kill-on-close job and gets a short stdin-close before that; secrets get a current-user-only DACL. Packaged python is `<app data>/runtime/env/Scripts/python.exe` and the project is `<resources>/runtime/sidecar`. Linux startup warns, with `WEBKIT_DISABLE_COMPOSITING_MODE=1`, when WebKitGTK or EGL is missing.
  Evidence: host cargo tests for the path helper, graphics message, and secret round-trip. Not verified: a Windows process tree, an ACL read, or a Linux box with no GPU.
- 2026-11-16 PR #22 review fixes: `unsafe extern` for the Windows `NtResumeProcess` block (edition 2024); the setup window now closes only after the main window is created, otherwise it stays open with the error and a retry; `bootstrap.json` drops the ineffective `remote` urls (Tauri treats `setup://` as local) and is scoped by `windows:["bootstrap"]`, `local: true`.
  Evidence: cargo test 43 pass (hand-off failure test, capability shape), cargo check, generated `gen/schemas/capabilities.json` shows `default`->main and `bootstrap`->bootstrap only.
  Not verified: Windows compile, real window-creation failure, caller-URL guard (not added).

- 2026-11-16 PR #21 review follow-ups: bootstrap window now has its own capability (only the 3 `bootstrap_*` commands, remote URLs `setup://`/`setup.localhost`); app commands got per-command permissions (`build.rs` manifest) and `default.json` (main only) lists them explicitly.
  Main window is `create: false` and built by `setup()` only when no setup is needed (or after it finishes), so the frontend cannot hit the sidecar early. Windows uv starts CREATE_SUSPENDED, joins the job, then `NtResumeProcess`. uv licences are SHA256-checked; CPython pinned to 3.12.14 (in the marker fingerprint).
  Evidence: cargo test (42 pass, incl. gating + capability-shape tests), cargo check, prepare-runtime python tests.
  Not verified: Tauri's runtime enforcement of the remote capability on the `setup://` origin, any Windows compile/run, real install with 3.12.14.

- 2026-11-15 (step 6): Dedicated ingest worker uses macOS nice 19 + background QoS, Linux nice 19, Windows IDLE; foreground workers use normal priority.
  Both ML classes keep the existing serial execution order and share a ~30%-of-cores cap, clamped to 1–6 even for overrides; active ingest still delays foreground work.
  Preserved watchdog/no-mid-job-restart rules, added non-signalling Windows process queries, and forward chunk progress to the existing UI caller in `src/library.ts`.
  Evidence: simulated priority/thermal/Windows-watchdog tests, Python fast suite, Rust library tests, affected UI tests and typecheck.
  Not verified: native Windows/Linux scheduling, real-model chunk quality/latency, physical thermal transitions; unknown thermal readings allow work to continue.
- 2026-11-16 Open-source cleanup. MIT `LICENSE` (holder "Monish Ramesh J"; MIT itself still an owner decision), `THIRD_PARTY_NOTICES.md`, short README, `docs/open-source.md` Anthropic checklist. `git rm` of `sidecar/tests/fixtures/stat350_ch5_ir.json`, three course-page previews, and `docs/ui-review/06-original-pdf.png`. Tests use a synthetic IR; the slow PDF test skips when the local file is absent. Evidence: pytest `test_real_fixture.py` and `test_ingest.py`. Not verified: Anthropic terms, MIT confirmation, history rewrite, Windows/Linux installers.
- 2026-11-16 Step 20: bundled pinned uv/PDFium resources and automatic marker-gated Python/ML setup with cancel/resume/retry UI; dev uv path retained, Linux CPU wheels locked.
  Evidence: fake-uv/bootstrap state tests, full host Rust tests with pinned PDFium, script/UI contract tests, limits tests, offline lock check; no local ML installs/model runs.
  Not verified: real bundle or WebView rendering, actual ML installation/size, Intel Mac compatibility, Windows/Linux builds/runtime (CI handoff to steps 21–22).

# Tangent

Desktop app that turns a section of a PDF into a short narrated animation you can pause and ask about. Personal tool first. No textbook, course PDF, or extracted chapter text ships in this repository. Bring your own files.

Design notes live in `CLAUDE.md`. Third-party licences: `THIRD_PARTY_NOTICES.md`. Terms questions for shipping `claude -p`: `docs/open-source.md`.

## Install

The app needs the [Claude Code](https://code.claude.com) CLI on your PATH and a logged-in `claude` account. Installers do not include textbook content.

- **macOS:** open the `.dmg` from [GitHub Releases](https://github.com/monishramj/tangent/releases), drag **Tangent.app** to `/Applications`, and eject the image. This build is ad-hoc signed, not notarized. If Gatekeeper blocks it, try launching once, then System Settings → Privacy & Security → Open Anyway. For your own build: `xattr -dr com.apple.quarantine /Applications/Tangent.app`.
- **Windows and Linux:** installers are produced by CI. They have not been hands-tested on a Windows or Linux machine.

A from-source run still needs `bun`, `uv`, and Rust. Personal release builds can also point at a local sidecar venv via `TANGENT_SIDECAR_DIR` (see `docs/areas/packaging.md`). That path is a developer bridge, not something users install.

## Run

```sh
bun install
bunx tauri dev
```

`tauri dev` starts Vite and the app. The Python sidecar is spawned from `./sidecar` with `uv`.

## Test

```sh
nice -n 10 bunx vitest run --maxWorkers=2
cd src-tauri && CARGO_BUILD_JOBS=3 nice -n 10 cargo test
```

Rust page rendering needs PDFium (`TANGENT_SIDECAR_DIR` or the sidecar venv). Python fast tests: `uv run --project sidecar python -m pytest sidecar/tests`. Slow model tests stay off unless you pass `-m slow` yourself.

## Debug

In dev, webview events (`status …`, `stream scene …`, `scene attempt N rejected: …`, `buffering=…`) are forwarded to the `tauri dev` terminal with a `[webview]` prefix.

## Pipeline

PDF → IR (sidecar) → speech-first script → scene plans → for each scene: TTS and alignment, then a validated scene → PixiJS on one audio clock. Playback starts when scene 1 is ready.

Saved videos go to `~/Library/Application Support/com.tangent.app/videos/<id>/` and replay without another model call.

# Tangent

Desktop app that turns a textbook PDF section into a narrated, animated explainer video you can pause and ask questions about. Design notes and principles live in `CLAUDE.md`.

## Stack

- **Shell:** Tauri 2 (Rust, `src-tauri/`) with a React + PixiJS frontend (`src/`)
- **Sidecar:** Python via `uv` (`sidecar/`): Docling PDF ingest, PocketTTS (`alba`), forced alignment
- **LLM:** Claude Code headless (`claude -p --model haiku`), no API key needed. The model is set in `src-tauri/src/llm.rs` and `src/llm/claudeCli.ts`.

## Run

```sh
bun install
bunx tauri dev          # starts Vite + the app; the sidecar is spawned from ./sidecar via uv
```

Needs `bun`, `uv`, Rust, and a logged-in `claude` CLI on PATH (`~/.local/bin` and `/opt/homebrew/bin` are searched too).

## Test

```sh
nice -n 10 bunx vitest run --maxWorkers=2  # frontend + pipeline
cd src-tauri && CARGO_BUILD_JOBS=3 nice -n 10 cargo test  # Rust; set TANGENT_SIDECAR_DIR for PDFium
```

## Pipeline

PDF → IR sections (sidecar) → speech-first script → scene plans → for each scene: TTS + alignment, then scene DSL (validated, retried with the previous answer + errors) → timeline compile → PixiJS player on the audio clock. Scenes stream: playback starts once scene 1 is ready.

Key files:
- `src/dsl/templates.ts`: scene templates (layout + timing) the LLM fills; `/?showcase=<template>` previews one in dev
- `src/player/`: `PlayerScreen` (16:9 player), `SidePanel` (Ask threads, transcript, checkpoints), `Loading`
- `src/project/ProjectPage.tsx`, `src/home/Home.tsx`: projects (one per class)
- `src/gen/checkpoints.ts`, `src/media/giphy.ts`, `src/library.ts` (cached ingest)
- `src/pipeline/streamVideo.ts`: orchestration, lookahead, retries
- `src/gen/`: script / plan / scene prompts and quality gates
- `src/dsl/`: schema, validator, compiler, computed ops (Array, Tree)
- `src/stage/`: layout, renderer, visuals, motion
- `src/player/`: per-scene audio queue + render loop
- Videos are saved to `~/Library/Application Support/com.tangent.app/videos/<id>/` (bundle.json + per-scene WAVs) and replay with no LLM/TTS calls.

## Debugging

In dev, webview events (`status …`, `stream scene …`, `scene attempt N rejected: …`, `buffering=…`) are forwarded to the terminal running `tauri dev` with a `[webview]` prefix.

## Known issues

- **Mid-scene silence drifts A/V.** When the compiler inserts silence inside a scene, the visuals lag the audio (the WAV isn't padded to match).
- Reaction gifs need a GIPHY key (Settings gear on Home; stored in an owner-only file in app data); without one they render as text cards.
- **Slow first scene.** Script + first scene still take a while with Haiku (the planning call is gone and the first scene is shorter now).
- **A failed scene is skipped,** and the saved video is marked "Partial".
- **Videos saved before 2026-11-04 have no audio** (the old WAV-path bug). Delete and regenerate them.
- **Packaging:** personal release builds still depend on the configured local sidecar venv (see install steps below).

## Install on Monish's Mac (Apple Silicon, personal build)

Open the release `.dmg` and drag **Tangent.app** into `/Applications`, then eject the image and launch the installed app. This free build is ad-hoc signed, not Apple-notarized. For a trusted download, try right-click → Open; on newer macOS, first try launching, then System Settings → Privacy & Security → Open Anyway. For your own verified build, the alternative is:

```sh
xattr -dr com.apple.quarantine /Applications/Tangent.app
open /Applications/Tangent.app
```

This personal package still needs the local `uv` project and its `.venv`, `uv`, and the logged-in Claude CLI. The release script embeds `TANGENT_SIDECAR_DIR` at build time (runtime environment overrides it); PDFium is loaded from that project's `pypdfium2_raw` installation. Keep that directory available after moving the app. Finder apps don't inherit shell exports. On this Mac the stable project is `/Users/monishramj/Documents/Code/hackathons/26_27/accessED_hacks/tangent/sidecar`. Full standalone sidecar/PDFium bundling is the next packaging step.

## Cut a release (no paid account)

The updater key was generated with `bunx tauri signer generate --ci -p '' -w ~/.tauri/tangent.key`. Its private half lives **outside this repo**, mode 0600; back it up securely. Losing it means existing installs cannot trust future updates. The public half is in `src-tauri/tauri.conf.json`. Updater signatures are separate from Apple's code signing.

```sh
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/tangent.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''
export TANGENT_SIDECAR_DIR=/Users/monishramj/Documents/Code/hackathons/26_27/accessED_hacks/tangent/sidecar
./scripts/release.sh 0.1.2 --dry-run  # prints the plan without changing files
./scripts/release.sh 0.1.2            # bumps versions and builds; DOES NOT publish
```

Review/commit the version changes (including Cargo.lock and CLAUDE.md), push, then run the printed `gh release create` command. It uploads `.dmg`, signed `.app.tar.gz`, `.sig`, and `latest.json` from `src-tauri/target/release/bundle/`. The script targets this Mac's native ARM64 architecture; do not use it for Intel/universal releases.

Release builds silently check `https://github.com/monishramj/tangent/releases/latest/download/latest.json` on launch. Settings can call `checkForUpdate()` from `src/update.ts` and display its returned version, then call `installUpdate()` on an explicit click. Installation asks before downloading and restarting; launch checks never pause playback or open a dialog. Until the Settings entry is connected, the launch check only caches availability. No release was published during setup, so a missing endpoint currently produces a harmless check failure.

`monishramj/tangent` was verified **public** on 2026-11-12. If it becomes private, this unauthenticated endpoint will stop working: private GitHub assets need authenticated API requests (including the archive download), or a public update feed/artifact mirror or authenticated proxy. Never ship a shared GitHub token in the frontend/config; a private implementation needs a per-user token stored/read in Rust and API asset URLs, or a proxy that handles authentication. Being logged into `gh` does not authenticate the installed updater.

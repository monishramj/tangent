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
bunx vitest run                      # frontend + pipeline (497 tests)
cd src-tauri && cargo test           # Rust (LLM args, video bundles)
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
- **Packaging:** the sidecar path is dev-only (see `CLAUDE.md` → Packaging).

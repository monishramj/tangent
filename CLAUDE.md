# CLAUDE.md: Tangent

Desktop app (Tauri + PixiJS + Python sidecar) that turns textbook PDFs into animated explainer videos you can interrupt mid-playback with a question. Owner: Monish. Personal tool first, open source later.
Unit: one video per textbook section (5-12 min). Default path needs zero input: drop a PDF, pick a section, watch.
**Active plan: [docs/v1-plan.md](docs/v1-plan.md).** History and the old long-form notes: [docs/history.md](docs/history.md). Index: [docs/README.md](docs/README.md).

## Product principles (do not violate)
1. **Written for the ear, not the page.** Script stage rewrites for speech: short one-idea sentences, signposting, define before use, no parentheticals/nesting/"former-latter", numbers spoken naturally, light repetition. Own pipeline stage, prompt and checks.
2. Energy comes from visuals, never information density. One idea per beat.
3. Visuals match the audio in meaning and timing (animations anchor to narration words; one audio clock).
4. Never feel technical: no prompting needed for a good video or answer.
5. Interruptions are the killer feature: pause, ask, tutor answers on the current scene, rejoin.
6. Feels real-time: stream scene by scene; never wait for a full render.
7. Never teach something wrong: computed visuals, grounded scripts (numeric gate, cite anchors).

## Architecture
```
PDF -> Docling IR (cached) -> Outline -> Script (beats) -> math-to-speech -> TTS -> forced alignment
   -> template/DSL scenes -> compiler + validator -> PixiJS player (audio clock) <- Tutor (interrupts)
```
- Shell: Tauri (Rust core, WKWebView), Python sidecar via uv (Docling, PocketTTS, MMS_FA) -> [packaging](docs/areas/packaging.md)
- Ingest: PDF -> IR with passages/bboxes, lazy formulas -> [ingest](docs/areas/ingest.md)
- Generation: Claude (default), Codex CLI or Antigravity (experimental), grounding, TTS, gifs -> [gen](docs/areas/gen.md)
- Engine: `packages/motion` (DSL, templates, PixiJS stage; no app imports) -> [motion](docs/areas/motion.md)
- Player: audio-clock playback, panels, textbook follow -> [player](docs/areas/player.md)
- Library: sources-first home, folders, bundles, uploads queue -> [library](docs/areas/library.md)
- Tutor: typed interrupts, annotations on the live scene -> [tutor](docs/areas/tutor.md)
- Evidence and tests -> [testing](docs/areas/testing.md)

## Scope
- **v1:** see `docs/v1-plan.md`: dogfood fixes, run-cool ingest, section picker, generation accuracy, PPTX/DOCX + photo/notes adapters, per-topic merging, testing/CI, v0.2.0 beta for macOS/Windows/Linux, open-source release (no content ships).
- **Out of v1:** animated branches, voice input, new course components, extra style packs, zyBooks/web capture.
- **v2:** MP4 export, power-user editor, Pro usage meter, Klipy.

## Current state (2026-11-15)
- v0.1.2 published (GitHub Releases, Tauri updater); v0.1.3 built locally, not published.
- Pipeline works end to end: PDF -> IR (background FIFO preparation) -> script -> templated scenes -> TTS -> streamed playback -> saved bundles.
- Lazy formula decoding (only for selected sections), fp32 formula model, background-QoS ingest.
- Library, Settings, keybinds registry, native macOS menu bar, multi-PDF upload, textbook follow-along done.
- Next: dogfooding on STAT 350; executing `docs/v1-plan.md`.

## Open issues
- No end-to-end run on a real chapter with the newest templates and Tangenter yet; expect prompt tuning.
- Native menu `build()`, hardware pinch, updater install and Windows/Linux builds are unexercised.
- Cached IRs predating passages are not re-ingested (open question: "Re-read PDF" action).
- Windows/Linux builds are still unexercised on a machine here; owner-only secrets, the sidecar job, and the packaged runtime path are in code and waiting on CI.
- First-scene latency unmeasured since planning call removal.
- GlassSurface refraction unsupported in WKWebView (plain blur fallback).
- Full list in `docs/history.md` ("Open issues").

## Decisions (one-liners; full log in docs/history.md)
- Parser Docling (MIT); voice PocketTTS alba; LLM Claude by default (Haiku/Sonnet), optional Codex (Sol/Astra), Antigravity experimental (tools can't be disabled: sandbox + kill on any tool step), strong tier for scripts. Keep Claude allowlists in `llm.rs` and `claudeCli.ts` in sync.
- Templates first over raw DSL; picture templates over flowcharts (max 1 diagram/scene).
- Computed visuals and numeric grounding are deterministic; fail closed per beat, not per video.
- No API keys stored until needed; secrets are owner-only files, only `giphy` webview-readable.
- PDF pages render in Rust (PDFium + disk cache); ingest uses Docling `auto` device.
- One FIFO ingest job at a time; cached sources open immediately; source opens only observe jobs.
- Sidecar capped at ~30% cores, nice 10, orphan-proof; never respawn mid-job.
- Native menu forwards through the same keybind dispatch; only modifier bindings become accelerators.
- Personal macOS build: ad-hoc signing + minisign updater key, silent check, user-confirmed install.
- Home is sources first; lowercase heading only on "library"; videos belong to their PDF.
- Scope cut 2026-11-15: branches, voice, extra components/styles, web capture out of v1; MP4/editor/meter/Klipy to v2.

## Working conventions
- **Notes convention:** read this file + only the area notes your spec names. On finishing, prepend one dated Log entry (<= 6 lines: what, evidence, not verified) to each area touched and one line to `docs/history.md`. Edit `CLAUDE.md` only when a rule, architecture line, scope, open issue or decision changes. Hook (`.githooks/pre-commit`, enable with `git config core.hooksPath .githooks`): code changes must stage `docs/history.md` or a `docs/areas/*.md`; `CLAUDE.md` must stay <= 10 000 bytes. `--no-verify` is the escape.
- Double-check work; be precise; push back on bad ideas. Smallest thing that de-risks the next unknown; no speculative abstractions.
- Speech-first script, word-anchored timing and computed visuals are non-negotiable.
- **Agentic work goes through Orca, not native subagents.** Use the `orchestration` skill (`orca orchestration worker-start --agent codex|claude`), one worktree per parallel branch (`--worktree new-child`). Workers run GPT Sol 6.1 (Codex/Cursor) or Claude Sonnet; Opus only as the coordinator. Cursor takes full self-contained jobs (it can't spawn helpers); Gemini small specified jobs only.
- **CPU:** up to 4-5 workers; wrap heavy commands (builds, full tests) in `scripts/heavy.sh` (max 2 at once) and run `scripts/reap.sh --kill-orphans` before finishing (see `docs/ops.md`). `nice -n 10`, `cargo -j3`, `vitest --maxWorkers=2`; no model runs, dev servers or parallel headless browsers. Visual checks: one Orca browser window.
- See `README.md` for run/test/debug; `[webview]` lines in the `tauri dev` terminal show pipeline status.

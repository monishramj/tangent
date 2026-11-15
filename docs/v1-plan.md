# Tangent v1 execution plan

Written 2026-11-15 for the coordinator. Planning only: nothing here is implemented.
Scope is the owner's final list (prongs 1-11). Out of v1: animated branches, voice, new course
components, extra style packs, zyBooks capture. v2: MP4 export, editor, usage meter, Klipy.

## 0. Rules for the whole run

- Max 2 workers at once. Every worker: own `--worktree new-child` branch, `nice -n 10`, `cargo -j3`,
  `vitest --maxWorkers=2`. No dev servers or headless browsers; visuals via the Orca browser, one window.
- **No model runs** (Docling, TTS, formula model) except T7, which runs alone with nothing else active.
- Hotspot files are single-writer. Never run two tasks that share a lane:

| Lane | Files | Tasks, in order |
|---|---|---|
| L-doc | `CLAUDE.md`, `docs/areas/*`, `.githooks/*` | T1 → T2 (after that, area notes are append-only: no lane) |
| L-home | `src/home/Home.tsx`, `SourceView.tsx`, `views.css` | T9 → T16 → T17 → T18 → T22 |
| L-stream | `src/pipeline/streamVideo.ts`, `src/gen/script.ts` | T10 → T11 → T12 → T13 → T15a → T18 |
| L-rust | `src-tauri/src/lib.rs`, `tauri.conf.json`, `Cargo.toml` | T0 → T4 → T5 → T19 → T20 → T21 |
| L-side | `sidecar/tangent_sidecar/*` | T5 → T7 → T16 → T17 → T19 |

- Dogfood fixes (section 5) take a lane like any task; a P0 fix pre-empts the next queued task in its lane.

## 1. Phases and DAG

```
Phase A rails      T0 → T1 → T2 → T3
Phase B dogfood    T4, T5 → T7, T6 (mocks) → [D1] → T9
Phase C generation T10 → T11 → T12 → T13;  T14 (CI replay);  T15a/T15b
Phase D adapters   T16 → T17 → T18
Phase E release    T19 → T20 → T21 → T22 → T23 → T24 → [D5] → T25
```

| Id | Task | Deps | Lanes | Can pair with |
|---|---|---|---|---|
| T0 | Commit uncommitted main | – | L-rust | – (coordinator, first) |
| T1 | Memory diet | T0 | L-doc | – (solo: every later spec depends on it) |
| T2 | CI + test rails | T1 | L-doc (hooks) | T4 |
| T3 | TEACH: testing-and-ci guide | T2 | – | T5, T6 |
| T4 | Long-PDF page bug | T1 | L-rust | T2, T6 |
| T5 | Run-cool scheme | T4 | L-rust, L-side | T3, T6 |
| T6 | Section picker mocks (2 variants) | T1 | – (dev page only) | T2–T5 |
| T7 | Lazy formula check (one model run) | T5 | L-side | **nothing** |
| T8 | (reserved: dogfood slot, see §5) | – | – | – |
| T9 | Section picker implementation | T6, D1 | L-home | T10 |
| T10 | P7-limited + P6 tutor retrieval | T2 | L-stream | T9 |
| T11 | P2 stream the script | T10 | L-stream, `llm.rs` | T15b |
| T12 | P4 claim entailment (+ passage ids) | T11 | L-stream | T15b, T14 |
| T13 | P3 checkpoints from narration | T12 | L-stream | T14 |
| T14 | Golden set growth + P8 CI replay | T2, D2 | – | T12, T13 |
| T15a | Failed-scene retry/notice | T13 | L-stream | T15b |
| T15b | Raw-DSL accumulation + scene swap | T2 | `packages/motion` | T11–T15a |
| T16 | PPTX/DOCX adapter + text-follow view | T9, T7 | L-home, L-side | T15b |
| T17 | Photos / handwritten notes | T16 | L-home, L-side | T14 |
| T18 | Per-topic source merging | T17, T15a | L-home, L-stream | T19 |
| T19 | Sidecar bootstrap (bundled uv) + PDFium | T5, T16 | L-rust, L-side | T18 |
| T20 | Windows/Linux platform fixes | T19 | L-rust | T22 |
| T21 | Release workflow (3-OS matrix) | T20 | L-rust | T22 |
| T22 | First-run onboarding | T18 | L-home | T20, T21 |
| T23 | OSS hygiene (LICENSE, README, content, ToS) | T14 | – | T20–T22 |
| T24 | Beta smoke on 3 OSes | T21, T22, T23 | – | – |
| T25 | Cut v0.2.0-beta draft | T24, D5 | L-rust | – |

Suggested pairing order: T0 · T1 · (T2+T4) · (T3+T6) · (T5+T6 cont.) · T7 alone · (T9+T10) · (T11+T15b) ·
(T12+T14) · (T13+T14 cont.) · (T15a+T16) · (T17+T23) · (T18+T19) · (T20+T22) · T21 · T24 · T25.

## 2. Tasks

Agent key: **codex** = default implementer; **claude-sonnet** = review/UI/prose with judgment;
**claude-opus/fable** = only where taste or teaching quality is the deliverable; **cursor/gemini** = leaf, fully specified.
"Notes" = area notes the spec must name (exist after T1).

### T0. Commit uncommitted work on main
- Goal: land `Entitlements.plist` (disable-library-validation), `tauri.conf.json`, Loading/library/streamVideo/App changes.
- Agent: coordinator itself (no worker). Run tsc + focused vitest (`Loading`, `library`) first.
- Evidence: clean `git status`; tests green. Risk: entitlement is needed so the ad-hoc-signed app can dlopen venv dylibs; keep.

### T1. Memory diet (prong 1)
- Goal: `CLAUDE.md` 92 KB → ≤ 8 KB; history and per-area detail moved, nothing deleted.
- Files: `CLAUDE.md`, new `docs/history.md`, `docs/areas/{ingest,gen,motion,player,library,tutor,packaging,testing}.md`,
  `docs/README.md` (index), `.githooks/pre-commit`.
- New `CLAUDE.md` contains only: what Tangent is (5 lines), the 7 product principles, architecture diagram + 1 line per
  subsystem with a link to its area note, scope (v1 list, out, v2), current state (≤ 15 lines), open issues (≤ 10),
  decisions summary (≤ 20 one-liners, full log in history), working conventions, the notes convention below.
- Area note format: `## Contract` (invariants, "don't regress" items, key files) then `## Log` (newest first, dated,
  ≤ 6 lines per entry: what, evidence, not verified). Dated narrative from *Current state* goes to `docs/history.md`
  verbatim, newest first. Existing `docs/*.md` design docs stay and are linked from the area notes.
- Convention (goes in `CLAUDE.md`): a worker reads `CLAUDE.md` + only the area notes its spec names; on finishing it
  prepends one Log entry to each area it touched and one line to `docs/history.md`. `CLAUDE.md` changes only when a
  rule, architecture line, scope, open issue or decision changes.
- Hook: reject a commit touching `src/`, `src-tauri/`, `sidecar/`, `packages/` unless it stages `docs/history.md` or a
  `docs/areas/*.md`; reject if `CLAUDE.md` > 10 000 bytes. `--no-verify` stays the escape.
- Agent: **claude-sonnet** (lossless restructuring needs judgment about what is a rule vs. history; Opus not needed).
  Coordinator reviews the diff by spot-checking 10 "don't regress" items exist in a Contract section.
- Evidence: `wc -c CLAUDE.md` ≤ 8 KB; every `Recently fixed … don't regress` bullet greps in `docs/areas/`; hook tested
  with one rejected and one accepted dry commit. Risk: dropped invariants → the grep check above is mandatory.

### T2. CI + test rails (prong 11, build part)
- Goal: one defined way to prove a change, enforced locally and in GitHub.
- Tiers: **t1** tsc + vitest (focused locally, full in CI) · **t2** `cargo test` · **t3** `pytest -m "not slow"` ·
  **t4** golden-set replay (wired in T14) · **t5** visual smoke (Orca browser, manual, screenshot in the PR) ·
  **t6** slow model tests (`pytest -m slow`, manual only, owner's Mac, never CI).
- Files: `.github/workflows/ci.yml` (matrix macos-14, windows-latest, ubuntu-22.04; jobs web / rust / sidecar; uv + cargo
  + bun caches; `concurrency` cancel-in-progress), `.github/pull_request_template.md` (evidence checklist),
  `.githooks/pre-commit` (T1's rule + `tsc --noEmit`), `.githooks/pre-push` (focused vitest on changed dirs, nice 10),
  `package.json` scripts (`check`, `test:focused`), `CHANGELOG.md` (Keep a Changelog; `scripts/release.sh` reads it),
  `docs/areas/testing.md` Contract.
- Policies to write into the testing note: evidence standard (commands + pass counts + what was *not* run, screenshot for
  any UI change); flaky test = quarantine with `test.skip` + an open-issue line the same day, fix or delete within a
  week, never retry-until-green; native-only paths (AppKit menu `build()`, WKWebView audio gesture, hardware pinch,
  updater install, real Docling/TTS) are a manual checklist in `docs/areas/testing.md`, run in T24 and before each release.
- PR flow: branch per task → PR → required checks = the 3 CI jobs on macOS + Linux (Windows required once T20 lands) →
  coordinator squash-merges. Branch protection is set by the owner (`gh api`, command printed by the worker; D3).
- Known reds to expect on first run: 2 PDFium tests without a sidecar venv (CI must `uv sync` first or set
  `TANGENT_PDFIUM`), Windows cfg gaps. Mark Windows `continue-on-error` until T20; do not delete tests.
- Agent: **codex**. Notes: testing, packaging.
- Evidence: a green CI run URL on macOS + Linux, hooks demonstrated. Risk: CI minutes (public repo = free);
  torch download time on runners → cache `~/.cache/uv`.

### T3. TEACH: `docs/testing-and-ci.md` (prong 11, learning part)
- Goal: a learning guide for the owner: why each tier exists, what it catches with a real example from this repo's
  history, day-to-day use (what runs when, how to read a red check, how to re-record the golden set, how to cut a
  release), a 10-minute hands-on walkthrough (break a test on a branch, watch the hook and CI catch it, fix it).
- Agent: **claude-opus** (the writing quality is the deliverable). Then the coordinator walks the owner through it.
- Evidence: owner completes the walkthrough; ≤ 250 lines. Risk: drift → the guide links to the testing note, never
  duplicates config.

### T4. Long-PDF "can't load" (prong 2)
- Goal: root cause, fix, regression test. Start by asking the owner for the PDF name + the `[webview]` line (D0); add the
  missing log first if there is none (`PdfPage` swallows the error: `() => setError(true)`).
- Suspects from reading the code, to confirm or kill in this order:
  1. `PdfPage.tsx`: an error is permanent. The effect only re-runs when `widthPx` changes, so one transient failure
     shows "Couldn't load page N" until zoom changes. No retry, no `<img onError>`.
  2. `pages.rs render`: every page reopens and reparses the whole document under `PDFIUM_LOCK`; `Page` sets `visible`
     permanently, so a fast scroll over a 785-page Original PDF tab queues hundreds of renders that are never cancelled
     and the page on screen waits behind them (looks like a hang).
  3. Poisoning: `PDFIUM_LOCK.lock().map_err(..)` and `CACHE_WRITE_LOCK` turn one panic into a permanent failure for every
     later page; `PDFIUM` `OnceLock` caches a load error forever.
  4. Prune race: a PNG returned to the webview can be pruned before `<img>` loads it (long PDFs at 2000 px fill 512 MiB in
     ~700 pages); the `.size` file can be pruned separately from its PNGs.
  5. `validate_pdf` reads the library JSON and canonicalizes every source on every request.
- Likely fix shape (smallest): keep one open document per path under the lock (LRU of 1-2, close on path change);
  frontend drops a request when the page leaves the viewport and retries failed pages on re-entry + `<img onError>` →
  re-request; recover poisoned locks with `into_inner`; don't cache the library-load error; never prune files touched in
  the last minute.
- Files: `src-tauri/src/pages.rs`, `src/player/PdfPage.tsx`, `src/home/api.ts` (+ tests). Agent: **codex**. Notes: player.
- Evidence: Rust test rendering 300+ pages of a generated PDF with interleaved requests and a forced prune; vitest for
  retry/cancel; owner confirms on the failing PDF. Risk: the real cause is something else (encrypted or non-UTF-8 path) →
  logging first.

### T5. Run cool, engineered (prong 4)
- Today: threads ≈ 30% of cores (min 2) via env + torch + Docling; `os.nice(10)` whole process; `PRIO_DARWIN_BG` around
  Docling conversion only; FAST tables; formula model fp32 with a 512-token cap; lazy formulas. Gaps: `enrich_formulas`
  runs at normal QoS; TTS shares the same nice; nothing reacts to heat; QoS is macOS-only; `sidecar_threads()` is
  duplicated in Rust and Python.
- Scheme (one small module, `limits.py`, Rust only passes env):
  - Two job classes. **background** (ingest, title prep): lowest priority. **interactive** (TTS, `enrich_formulas` while
    the user waits): normal priority, same thread cap.
  - Priority per OS: macOS `PRIO_DARWIN_BG` (exists); Linux `SCHED_IDLE` via
    `os.sched_setscheduler` with a `nice 19` fallback; Windows `SetPriorityClass(PROCESS_MODE_BACKGROUND_BEGIN/END)` via
    `ctypes`. One `background()` context manager, three branches, no-op on failure.
  - Thread budget: `clamp(round(cores × 0.3), 2, 6)`; single source = Python, Rust stops computing it.
  - Thermal governor (background class only): between Docling page batches, read thermal state and sleep. macOS
    `NSProcessInfo.thermalState` via `ctypes` + objc runtime (no pyobjc dependency); Linux
    `/sys/class/thermal/thermal_zone*/temp`; Windows: none (duty cycle only). Policy: nominal/fair → run; serious → sleep
    until fair (poll 5 s); critical → pause. Requires converting in page ranges (Docling `page_range`) of ~20 pages so
    there is a seam to pause at; this also gives real progress for free (replaces the estimate).
  - Env overrides kept: `TANGENT_SIDECAR_THREADS`, `TANGENT_INGEST_FAST=1`.
- Files: `sidecar/tangent_sidecar/{limits,ingest}.py`, `src-tauri/src/lib.rs` (drop duplicate), tests. Agent: **codex**.
  Notes: ingest.
- Evidence: unit tests with a fake thermal reader (pauses, resumes) and per-OS priority branches mocked; pytest not-slow
  green on 3 OSes. Measured numbers come from T7, not here. Risks: chunked conversion may change section stitching
  across range seams → compare IR of the STAT 350 fixture path with mocks; if seams break structure, keep whole-document
  conversion and governor-pause only between pipeline stages (decide inside the task, report which).

### T6. Section picker mocks (prong 5)
- Goal: two static variants on one dev page, owner picks. No production code.
- Both: title size/weight by depth (chapter `title`, section `body` semibold, subsection `caption` regular, dimmer per
  level), page span right-aligned, no bare checkboxes; clicking a title selects the section and all descendants; a parent
  with some children selected shows a partial state; drag range kept; `role="tree"`, arrow keys, Space toggles,
  Shift+arrows extend; selection shown by the one accent; reduced motion = no transitions.
  - **A braces**: a drawn curly brace in the left gutter spans a section's subsections; the brace is the click target for
    "whole section" and thickens on hover/selection.
  - **B leading lines**: hairline tree guides (vertical trunk + elbow per child); the trunk segment is the click target.
- Fixture: the 785-page ethics outline shape (11 roots, 791 rows) + one shallow 2-level book, so density is honest.
- Files: `src/dev/section-picker.{html,tsx,css}` only. Agent: **claude-opus** (taste is the deliverable). Notes: library.
- Evidence: Orca screenshots of A and B × (deep book, shallow book, partial selection, keyboard focus, 600 px width) in
  `docs/ui-review/section-picker/`. Then **D1**.

### T7. Lazy formula check (prong 3). Runs alone.
- Goal: one bounded real run; numbers for the owner.
- Run: a ≤ 15-page STAT 350 slice the owner names (D0), formula-dense. Background QoS on, `TANGENT_SIDECAR_THREADS=2`,
  nothing else running, abort if `thermalState` reaches serious or wall time passes 15 min. Steps: lazy ingest of the
  slice → `enrich_formulas` for 1-2 sections → record.
- Measure: formulas found; bbox match rate (matched / requested at the 0.02 tolerance, plus the distance distribution
  of misses, to tell "tolerance too tight" from "different detection"); fallbacks to `$$orig$$`; added wait before the
  video starts (s, and s per formula); peak thermal state; spot-check 10 decoded formulas against the page by eye.
- Output: `docs/areas/ingest.md` Log entry + a 10-line owner note in the worker_done body. If match rate < 90%: a
  follow-up task to match by reading-order index within the page instead of bbox (do not fix inside T7).
- Agent: **claude-sonnet** (careful measurement and reporting, little code). Notes: ingest.
- Risk: heat → the abort rule; a second run needs the owner's yes.

### T9. Section picker implementation
- Goal: ship the chosen variant in `SourceView`, replacing checkboxes; `topSelected` semantics unchanged.
- Files: `src/home/SourceView.tsx`, `views.css`, tests. Agent: **codex** from the mock (visual spec is fixed), then a
  **claude-sonnet** polish pass only if screenshots differ from the mock. Notes: library.
- Evidence: SourceView vitest (select section + descendants, partial state, keyboard, drag), Orca screenshot vs mock.

### T10. P7-limited + P6
- P7: after targeted repair, ship beats whose only violations are *minor style* (sentence over the word limit, or one
  parenthetical), at most 10% of beats; anything else, or over 10%, fails as today. Accuracy stays fail-closed.
  `ScriptResult` gains `styleWaived: number[]`; the eval prints it.
- P6: tutor context = passages of the beat being narrated (scene `passages`) first, then keyword retrieval to fill.
- Files: `src/gen/script.ts`, `src/tutor/{retrieve,tutor,glue}.ts`, tests. Agent: **codex**. Notes: gen, tutor.
- Evidence: unit tests for the 10% boundary and each waivable/non-waivable class; retrieval test with a paraphrased
  question that keyword overlap misses.

### T11. P2 stream the script (TTFF)
- Goal: scene 1 starts while the rest of the script is written.
- Approach, simplest first: two calls. Call A = hook + first 3 beats (matches `chunkBeats(…, 4, 3)`), call B = the rest
  given A's beats as fixed context. Grounding gate + repair run per part. Only if the seam reads badly in the eval, move
  to incremental parsing of `stream-json` partial messages (needs `llm.rs` streaming; bigger).
- Files: `src/gen/script.ts`, `src/pipeline/streamVideo.ts`, eval script. Agent: **codex**. Notes: gen.
- Evidence: eval before/after on the golden set: TTFF (script-ready time for scene 1), judge-unsupported beats not worse,
  no duplicated/contradicting beat across the seam (new check). Risk: weaker global structure → eval + owner listen (D4).

### T12. P4 parallel claim entailment
- Goal: per scene group, one haiku call checks each beat against its own `[pN]` passages: supported / unsupported +
  source quote; also flags a wrong passage id and returns the right one when it is in the section. Runs alongside TTS;
  unsupported beats get the existing targeted repair before that scene's DSL; still unsupported → cut (same quarter cap).
- Gate before turning on: measure false-positive rate with the harness on the golden set; ship only if ≤ ~5% of
  supported beats are flagged, else ship in log-only mode and report. P5 is planned only if this fails.
- Files: new `src/gen/entail.ts`, `streamVideo.ts`, eval. Agent: **codex**; a **claude-sonnet** review of the prompt.
  Notes: gen.
- Evidence: eval table (unsupported caught, false positives, added time per scene, TTFF unchanged).

### T13. P3 checkpoints from narration
- Goal: checkpoints see each scene's spoken `say` and its passages (no `visualIntent`, no 20k truncation); generated MCQ
  keys verified with T12's check; an unverifiable generated question is dropped. Source exercises still come first.
- Files: `src/gen/checkpoints.ts`, `streamVideo.ts`, tests. Agent: **codex**. Notes: gen.
- Evidence: unit tests + eval count of dropped/kept questions on the golden set.

### T14. Golden set growth + P8 CI replay
- Goal: golden set gains STAT 350 and CS 251 sections from dogfood; replay runs in CI.
- Constraint: recordings and textbook text must not enter the repo. So two sets: **private** (owner's books, recordings in
  `<appData>/eval`, run by `pre-push`/manually, results logged in `docs/areas/gen.md`) and **public** (openly licensed
  sections, e.g. OpenStax statistics + an open data-structures text, with recordings committed under `scripts/eval-public/`
  and replayed offline in CI as tier t4). See D2.
- Files: `scripts/eval-golden.json`, `scripts/eval-public/*`, `ci.yml`. Agent: **cursor** (leaf: mechanical once D2 is
  answered), coordinator records the fixtures (needs `claude -p`). Notes: gen, testing.
- Evidence: CI job green in replay; recorded hash mismatch fails with a "re-record" message.

### T15a. Failed scene: retry, then say so
- Goal: one more full attempt for a failed scene in the background while later scenes keep generating; if it still
  fails, a 2-3 s in-frame notice card ("One part couldn't be made. Skipping ahead.") instead of a silent skip; bundle
  stays Partial; Regenerate-missing action on the saved video is out of scope.
- Files: `streamVideo.ts`, `SceneQueue`/player notice, tests. Agent: **codex**. Notes: gen, player.
### T15b. Raw-DSL accumulation + scene swap
- Goal: (1) compiler auto-fades raw-DSL objects not referenced for N beats unless `keep:true` (same rule template beats
  already follow); (2) between scenes, reuse the existing beat transition (old frame exits, new enters, deterministic in
  t) instead of the hard swap, inside the existing 0.6 s hold.
- Files: `packages/motion/src/{dsl/compiler,stage,player}` only. Agent: **codex**; **claude-sonnet** frame review via
  the dev reel screenshots. Notes: motion.
- Evidence: compiler tests; frames at a scene boundary (`__reel.at`) before/after; audio clock tests untouched and green.

### T16. PPTX / DOCX adapter
- Decision: Docling ingests both natively (no LibreOffice: it cannot be bundled and breaks "nothing to install"). Page
  view for non-PDF sources = a **text-follow view**: the section's passages rendered as markdown/KaTeX with the current
  passage highlighted, same follow reducer. PDFs keep the page view. The picker hint says "export slides to PDF for the
  page view". PPTX passages carry slide numbers as `page`; DOCX has none.
- Files: `sidecar/.../ingest.py` (format switch, passages without bbox), `src/home/Home.tsx` (accept list, copy),
  `src/player/Textbook.tsx` (+ `TextFollow.tsx`), `src/library.ts`/`storage` (`pdfPath` → generic source path, keep the
  field name to avoid a migration), `pages.rs` unchanged. Agent: **codex**. Notes: ingest, library, player.
- Evidence: pytest with tiny generated .pptx/.docx fixtures (python-pptx/docx are Docling deps; mocked converter if
  not-slow needs it); vitest for the text view highlight; Orca screenshot. Risk: `pdf_info` thumbnails for non-PDF →
  a plain type icon.

### T17. Photos / handwritten notes
- Decision: **Claude vision** through the existing `claude -p` image path (`llm.rs` stream-json images, already used by
  the tutor). Docling OCR is weak on handwriting and adds a second heat source. One haiku call per image →
  markdown + LaTeX; images grouped into one source ("note set"), one section per image unless headings are detected; the
  image is the "page" (shown with the text-follow view beside it). Costs Pro quota: show the count before starting.
  Transcription is marked "transcribed, check against your notes" (accuracy principle).
- Files: `src/home/api.ts` + new `src/ingest/photos.ts`, `Home.tsx` (accept png/jpg/heic → convert via `sips`/skip
  heic off macOS), tests. Agent: **codex**. Notes: ingest, library.
- Evidence: unit tests with a mocked provider; one manual run on 2 of the owner's note photos (owner-supplied, not in repo).

### T18. Per-topic source merging
- Goal: one video from sections of 2+ sources (textbook section + matching slides).
- Smallest design: in Make-a-video, "Add from another source" opens that source's picker; selection = list of
  `{sourceId, sectionIds}`; the merged script input concatenates sections with passage ids prefixed `s<k>:pN`; scene
  `passages` keep the prefix; the bundle stores `sources[]` (old single `source` still read); Textbook tab gets a source
  switcher that follows the current beat's source. No automatic topic matching in v1.
- Files: `SourceView.tsx`, `Home.tsx`, `App.tsx`, `streamVideo.ts`, `follow/passages.ts`, `videos.rs` bundle shape,
  tests. Agent: **codex**; **claude-sonnet** review (touches two hot lanes). Notes: library, gen, player.
- Evidence: unit tests for id prefixing and old-bundle replay; one manual two-source video.

### T19. Sidecar bootstrap + PDFium (prong 9)
- Bundle `uv` as `externalBin` (pinned version, per-target triple, checksum in a fetch script), `sidecar/` source +
  `uv.lock` + `pyproject.toml` as `resources`. First run: copy to `<appData>/sidecar/<app version>`,
  `uv sync --frozen` with `UV_PYTHON_INSTALL_DIR` and cache inside appData; progress UI from uv's output (stage +
  bytes), resumable, clear error with Retry. `sidecar_dir` order: `TANGENT_SIDECAR_DIR` → dev checkout → appData copy.
- Linux: torch/torchaudio from the CPU index via `[tool.uv.sources]` + platform markers; regenerate `uv.lock` and confirm
  it resolves for macOS arm64, Windows x64, Linux x64 (`uv lock --check`, `uv sync --frozen --dry-run` per platform).
- PDFium: `scripts/fetch-pdfium.sh` downloads one pinned bblanchon release per OS, verifies sha256, places
  `src-tauri/resources/pdfium/<lib>`; `pages.rs` lookup order already supports it. Model weights still download on first
  use (existing behaviour); show them in the same progress UI.
- Files: `lib.rs`, `tauri.conf.json`, `sidecar/pyproject.toml`, `uv.lock`, new `src/setup/FirstRun.tsx`, scripts.
  Agent: **codex**. Notes: packaging.
- Evidence: Rust tests for dir resolution and version-change resync; a local release build on the Mac launched with
  `sidecar/.venv` renamed away (proves no checkout dependency). Risk: ~2-3 GB first-run download → say so in the UI.

### T20. Windows/Linux platform fixes
- Windows: Job Object with `KILL_ON_JOB_CLOSE` for the sidecar tree (replaces `killpg`); secret files get an owner-only
  ACL (`icacls` call or `windows` crate; pick the one with no new dependency if possible); `PATHEXT` already handled.
- Linux: WebKitGTK WebGL check at startup (create a context; on failure show one screen naming the fix, try
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` once automatically). QoS no-ops are already covered by T5.
- Flip Windows CI to required. Files: `lib.rs`, `store.rs`, `main.tsx`. Agent: **codex**. Notes: packaging.
- Evidence: CI green on all 3 OSes with cfg-gated tests for the Job Object and ACL.

### T21. Release workflow
- `.github/workflows/release.yml`: on tag `v*`, tauri-action matrix (macos-14 arm64, windows-latest x64, ubuntu-22.04
  x64), runs `fetch-pdfium` + uv fetch, signs updater artifacts with the minisign key from secrets, merges one
  `latest.json` across platforms, creates a **draft** release. `scripts/release.sh` shrinks to: bump versions, update
  `CHANGELOG.md`, tag, push. No Intel Mac.
- Agent: **codex**. Notes: packaging, testing. Owner action: add `TAURI_SIGNING_PRIVATE_KEY` (+ password) secrets (D3).
- Evidence: a `v0.2.0-beta.0` dry tag on a fork/branch produces a draft with 3 installers + merged `latest.json`.

### T22. First-run onboarding
- Goal: detect the Claude CLI (`llm::resolve`) and that it is logged in (one tiny `claude -p` call); if missing, show
  install/login steps and re-check; Ollama as fallback **only if a working provider exists** (grep shows provider
  plumbing mentions Ollama; verify it actually completes a script before offering it, else list it as "not yet" and
  record an open issue). Combined with T19's setup screen: one flow, three rows (engine, models, AI provider).
- Files: `src/setup/FirstRun.tsx`, `src/llm/*`, `llm.rs`. Agent: **codex**, **claude-sonnet** copy/UI pass. Notes: packaging.
- Evidence: vitest for each detection state; Orca screenshots of the three states.

### T23. OSS hygiene
- LICENSE (MIT unless the owner says otherwise, D5), third-party notices (Docling MIT, PocketTTS MIT/CC-BY-4.0 weights,
  PDFium BSD-3/Apache-2.0, React Bits, Hugeicons), README rewrite (install per OS, Gatekeeper/SmartScreen notes, bring
  your own books, privacy).
- Content audit: `sidecar/tests/fixtures/stat350_ch5_ir.json` is textbook-derived and is in the repo → replace with an
  openly licensed or synthetic fixture (shares the D2 answer) and note that history still contains it (D5: rewrite
  history or accept). Grep for other book text in tests, eval golden file, screenshots under `docs/ui-review/`.
- ToS: re-read Anthropic's current terms for driving `claude -p` from a third-party app; write the finding + date in
  `docs/areas/packaging.md`; if unclear, the OSS default becomes "bring your own API key or CLI" and that is a D5 item.
- Agent: **claude-sonnet** (reading + judgment), fixture swap by **cursor**. Notes: packaging, testing.

### T24. Beta smoke
- The native-only checklist from the testing note on macOS (owner's machine): fresh-user install, first-run sync, one
  PDF → video → interrupt, updater check. Windows/Linux: installer launches, first-run sync completes, a PDF opens and a
  page renders, WebGL scene plays (needs a real machine or VM: D5). Agent: **claude-sonnet** drives the Mac run via
  `orca-computer-use`; owner does the other OSes. Evidence: checklist with screenshots in `docs/areas/packaging.md`.

### T25. Cut v0.2.0-beta
- Coordinator: changelog, tag, wait for the draft, hand the draft link to the owner. Owner publishes.

## 3. Owner decision points

| Id | When | Question | Default if no answer |
|---|---|---|---|
| D0 | Start | Which PDF fails to load pages (name, page, any `[webview]` line)? Which STAT 350 pages (≤ 15) for the formula run? | T4 proceeds on code suspects; T7 waits |
| D1 | After T6 | Braces or leading lines? | Wait (blocks T9 only) |
| D2 | Before T14 | OK to use openly licensed sections (OpenStax etc.) as the public CI golden set, private books staying local? | Yes |
| D3 | After T2, before T21 | Turn on branch protection; add updater key secrets | Coordinator prints the commands, waits |
| D4 | After T11 | Listen to one two-call script: is the seam audible? | Keep two-call |
| D5 | Before T25 | Licence (MIT?), repo history rewrite for the fixture, Windows/Linux test machine, `claude -p` default for OSS | MIT; no rewrite; CI-only for Win/Linux; keep CLI default, flagged beta |

## 4. Worker-spec template

```
# <Tn> <title>
Goal: <1-2 lines>
Read first: CLAUDE.md, docs/areas/<a>.md[, docs/areas/<b>.md]. Do not read other docs unless a note links them.
Scope: files you may edit: <list>. Do not touch: <lanes owned by the parallel task>.
Do: <3-8 bullets, concrete>
Do not: run models, dev servers or headless browsers; add dependencies; refactor outside scope; edit CLAUDE.md
  (unless the task changes a rule/decision: then one line).
Limits: nice -n 10; cargo -j3; vitest --maxWorkers=2, focused files only (CI runs the full suite).
Evidence required: <tests by name / screenshot paths / measurements>
Finish: prepend a Log entry (≤ 6 lines: what, evidence, not verified) to each area note touched + one line in
  docs/history.md; commit on your branch; open a PR; worker_done with 3 sentences + PR link + anything not verified.
Ask (orca orchestration ask) instead of guessing when: scope must grow, a test you didn't write fails, or a decision
  in section 3 is needed.
```

## 5. Dogfood loop (prong 10)

- Owner drops feedback in one place: `docs/dogfood.md`, one line each (`- [ ] <date> <what happened> <video/PDF, time>`).
  Screenshots/paths welcome; no triage by the owner.
- Coordinator triages at every merge point (never mid-task): tag each line **P0** (wrong teaching, crash, data loss,
  can't make/watch a video), **P1** (hurts every session), **P2** (polish) and its area; then
  - P0 → a task now, in the T8 slot, pre-empting the next queued task of that lane;
  - P1 → appended to the phase that owns the area (gen feedback lands before T12's eval so the golden set gains the
    failing section: every gen bug adds its section to the private golden set);
  - P2 → batched into one polish task per area at the end of that phase; leftover P2 goes to the area note's open issues.
- Each line is ticked with the PR that fixed it or a "won't fix in v1" reason. At most one dogfood task running at a time,
  so the plan keeps moving.

## 6. Merge and verification protocol

1. Worker PR → CI green (t1-t3, later t4) → coordinator reads the diff stat and the evidence block, not the whole diff,
   unless the task touched a hot lane, a security boundary (`llm.rs`, `store.rs`, `pages.rs` validation, CSP) or the
   audio clock: those get a **claude-sonnet** review worker (`/code-review` at medium) before merge.
2. Squash-merge; rebase the other active worker's branch only if it shares files (it should not, by lanes).
3. After each phase: one full local run on efficiency cores (`taskpolicy -b`: tsc, full vitest, cargo test, pytest
   not-slow, production build) and the native checklist items that phase touched.
4. A worker that reports "not verified" items: the coordinator either schedules the check (T24 list) or records it under
   open issues. Never drop it.
5. Failed or stalled worker: one re-dispatch with the failure attached; second failure → switch agent (codex ↔ claude)
   and narrow the scope; never run the same spec a third time unchanged.

## 7. Token-saving rules

- Specs name ≤ 2 area notes; workers do not read `docs/history.md` or other design docs unless a note links them.
- Workers grep before reading; read files in ranges; never paste whole files or full test logs into messages (pass
  counts + first failure only).
- Focused tests locally, full suite in CI. No "explore the codebase" steps: the spec lists the files.
- worker_done is 3 sentences + links. Details live in the area note Log, written once.
- Cheapest capable agent: cursor/gemini for mechanical leaf work (T14 fixtures, T23 fixture swap), codex for
  implementation, claude-sonnet for review/measurement/prose, claude-opus only for T3 and T6.
- The coordinator keeps its own context small: after each merge, it re-reads only `CLAUDE.md` current state + this plan's
  DAG table, not past transcripts.

## 8. Open questions the planner could not resolve

1. The long-PDF failure was not reproduced (no runs allowed); the T4 suspects are from reading code, ranked by likelihood.
2. Whether Docling's `page_range` chunking preserves the section tree across seams (decides T5's governor granularity).
3. Whether an Ollama provider actually works end to end today or is only an interface stub (decides T22's fallback).
4. Whether `uv.lock` resolves torch 2.15.0 / torchaudio 2.11.1 for Windows x64 and Linux x64 CPU without a version change.
5. `stat350_ch5_ir.json` in the repo and in git history vs. "no textbook content in the repo" (D5).
6. Who tests Windows and Linux builds on real hardware (D5); CI can prove build + unit tests only.
7. Current Anthropic terms for third-party apps driving `claude -p` (T23 reads them; not checked here).

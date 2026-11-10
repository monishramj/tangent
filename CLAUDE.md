# CLAUDE.md: Tangent

> **Tangent**: a desktop app that turns textbook material into animated explainer videos you can interrupt mid-playback to go off on a tangent.
> Status (2026-11-05): **MVP + first v1 pieces.** PDF → Docling IR (cached per source) → Code Report-style script → **templated scenes** → TTS/alignment → streamed 16:9 PixiJS playback → saved bundles. Projects per class (NotebookLM-style: sources, videos, practice, notes), threaded tutor in a docked glass panel, player with window-attached controls, checkpoint questions, GIPHY reaction gifs. Next: dogfood on real CS 251 chapters and fix what breaks (see *Current state*).
> Owner: Monish. Personal tool first, released open source later.

## What this is

Tangent turns textbook material into **animated explainer videos** (real motion graphics, not slideshows) that a student can **interrupt mid-playback with a question** and get an explanation of exactly that, without re-prompting. Playback then rejoins the main video.

- **Primary user:** a student self-studying (initially me, for my own Purdue courses).
- **Default path needs zero input:** drop in a source, pick a section, watch. Editing, reordering, and style tweaks are optional power-user features and should never be required.
- **Unit:** one video per textbook section, **5–12 min**. A chapter is a playlist.

## Core product principles (do not violate)

1. **Written for the ear, not the page.** AI scripts fail because they read like prose. The script stage *rewrites* (not summarizes) source text for speech:
   - short sentences, one idea each
   - signposting ("first X, then Y", "here's the key move")
   - define a term *before* using it; re-say it instead of relying on "it"/"respectively"
   - no parentheticals, no nested clauses, no "the former/latter"
   - numbers and symbols spoken naturally ("n log n", "x squared")
   - deliberate light repetition of the key idea
   This is its own pipeline stage with its own prompt and checks, not a line in another prompt.
2. **Energy comes from visuals, never from information density.** Fast cuts and kinetic type are good; cramming more ideas per sentence is not. One idea per beat, moderate speech rate.
3. **Visuals match the audio, in meaning and in timing.** See *Audio–visual sync*.
4. **Never feel technical.** No prompting is required to get a good video or a good answer.
5. **Interruptions are the killer feature.** Pause → ask (typed in MVP, voice in v1) → the tutor responds *on the current scene* → optionally an animated branch (v1) → rejoin.
6. **Feels real-time.** Stream scene-by-scene like video buffering; never make the user wait for a full render.
7. **Never teach something wrong.** Computed visuals and grounding (see *Correctness*).

## Architecture

```
Sources ──adapters──▶ IR ──▶ Outline ──▶ Script (beats: sentence + visual intent)
                                              │
                         math-to-speech ──▶ TTS ──▶ forced alignment (word timestamps)
                                                          │
                              Scene DSL ──▶ timeline compiler + validator ──▶ Live PixiJS player (audio clock)
                                                                                     ▲
                                                Tutor (interrupts) ──────────────────┘ emits annotation DSL / branch scenes
```

### Desktop shell: Tauri (decided)
- System webview (WKWebView on macOS) + Rust core → ~10 MB bundle and a much lower baseline RAM than Electron's bundled Chromium + Node.
- Known risks: rendering differences across webviews (WKWebView / WebView2 / WebKitGTK). Linux WebKitGTK WebGL performance is the weak spot for the later OSS release. PixiJS on WebGL is fine on macOS.
- ML (TTS, alignment, PDF parsing, later Whisper) runs in a **Python sidecar** managed by `uv`, with an env created on first run rather than a frozen PyInstaller blob. The models dominate memory either way (GBs vs. the shell's MBs).
- Target: macOS (M4 Max, 36 GB) first.

### Ingestion → Intermediate Representation (IR)
Every source goes through an adapter into one normalized IR; everything downstream sees only the IR.
- IR = section tree of markdown + LaTeX + extracted figures + **source anchors** (page / slide / URL) so videos can cite "Fig 4.12, p. 287". Also captures end-of-section **exercises** (used for checkpoints).
- Adapters, in build order:
  1. Textbook PDF (MVP)
  2. Lecture slides (PPTX → PDF, same adapter path)
  3. Handwritten notes / photos (vision-model OCR)
  4. zyBooks / web: a **"capture this page" from the user's own logged-in session**, never a scraper holding credentials. Personal use only; content is copyrighted.
- **PDF parser: benchmark before choosing.** Docling (MIT) vs Marker (Apache-2.0 code, restricted OpenRAIL-M weights, needs llama-server for full mode; often best on math) on 3 real chapters (CS 251, STAT 350, CS 334). Scoring: LaTeX fidelity, figure extraction + captions, section tree accuracy, exercises captured, speed on the M4 Max. Licensing note: Marker pushes Tangent toward GPL unless it's strictly isolated as a separate process; Docling keeps MIT/Apache open.
- v1: **merge sources per topic** (textbook section + matching lecture slides → one video).

### Rendering: custom engine + scene DSL (decided)
- The LLM emits a **constrained, schema-validated JSON DSL**, not free-form animation code.
  - Why: reliable from weak/local models, cheap targeted retries, trivially streamable, and every object has an ID in a scene graph we own, so the tutor can target it.
- **Live playback in-app (PixiJS on Canvas/WebGL). No MP4 rendering during playback.** Per-scene cost = LLM generation + TTS. MP4 export is an optional v1 feature.
- **Animations anchor to narration words, not seconds** (see *Audio–visual sync*).
- Keep the core tiny:
  - Primitives: text, **KineticText**, KaTeX math, shapes, arrows, lines, plots/axes, media (gif/image)
  - ~8 actions: create, fade, move, transform/morph, highlight, indicate, camera, wait (+ `op` for computed components)
  - Transitions between beats/scenes: hard cut, whip, push, match-cut
  - Domain components that grow with my courses: `Array`, `Tree` (MVP) → `Heap`, `Graph`, `Datapath`, `Pipeline`, `Distribution`, 3D transform helpers
  - A TS escape hatch for rare custom visuals

### Scene DSL v0 (DRAFT, to review)
```json
{
  "scene": "s03-heapify",
  "objects": [
    { "id": "title", "type": "KineticText", "text": "HEAPIFY", "variant": "slam" },
    { "id": "h", "type": "Heap", "kind": "max", "init": [3, 9, 7, 1, 4] }
  ],
  "beats": [
    {
      "say": "Heapify fixes one broken spot in a heap.",
      "actions": [
        { "at": "Heapify", "do": "create", "target": "title" },
        { "at": "broken spot", "do": "highlight", "target": "h.slot[0]", "color": "burgundy" }
      ],
      "cite": "p. 287"
    },
    {
      "say": "The parent swaps with its bigger child. Then we check again, one level down.",
      "actions": [
        { "at": "swaps", "do": "op", "target": "h", "op": "siftDown", "args": [0] }
      ],
      "transition": "cut"
    },
    { "reaction": { "intent": "satisfying click", "maxSec": 2 } }
  ]
}
```
(Worked check: max-heap `[3,9,7,1,4]`, `siftDown(0)`: 3 swaps with its bigger child 9 → `[9,3,7,1,4]`; at slot 1, 3 swaps with its bigger child 4 → `[9,4,7,1,3]`. The component computes this, not the LLM.)
- `say` = display/spoken source text; math-to-speech converts it to the TTS string, and anchors match against `say`.
- Addressing: `obj.slot[i]` = a **position** (array index / heap slot); `obj.val(9)` = an **element identity** that follows the value through ops. Both needed: "highlight the root" vs "follow the 9".
- `op` actions on computed components run the real algorithm; the compiler expands one `op` into its step animations spread across the anchor gap.
- `reaction` beats: optional gif interstitial, no narration.
- Open on the schema: multi-anchor ranges (`"from": … "to": …`), camera DSL, how branch scenes reference the parent scene graph.

### Audio–visual sync (non-negotiable)
Visuals are scheduled *to* the audio, never the reverse.
1. **Beats.** Each scene is a list of beats: one spoken sentence (or two short ones) + its visual actions, written together, so meaning stays aligned.
2. **Audio first.** Generate the TTS audio, then get word timestamps via **forced alignment against the known script** (CTC aligner, e.g. torchaudio MMS/wav2vec2, or whisper word timestamps as a fallback). Most open TTS models don't emit word timestamps, so this makes timing independent of the TTS model.
3. **Compile.** The timeline compiler resolves every `at` phrase to a timestamp and fits each animation into the gap before the next anchor. If it doesn't fit → insert silence at the nearest sentence boundary rather than squashing the motion.
4. **Validate before playback.** Every anchor phrase exists in `say`, every referenced object exists at that time, and no conflicting actions hit the same object. On failure → regenerate just that beat.
5. **One clock.** Player time = audio clock (`AudioContext.currentTime`), never rAF time. Pause, seek, interrupt, and playback speed all derive from it, so there is zero drift.
6. (v1, optional) VLM spot check: render keyframes at anchor times and ask "does this frame show what's being said?"

### Visual style: first style pack = "black × Code Report" (decided; replaces dark academia)
- **App UI and scenes share it:** pure black base, white type at a few opacities, neutral grays, one restrained accent. No hues by default. The app shell UI (React + React Bits + Hugeicons) is already built this way.
- **Type:** clean system sans for headlines and UI (big kinetic headlines stay bold and tight), mono for code and LEGv8.
- **Motion:** Code Report-style energy (fast cuts, whip transitions, big animated text that slams in, keyword scale-punches, word-by-word reveals pinned to narration), full-screen graphics, graphs, and visualizations. **Never** a static frame with bullet points.
- **Reaction gifs** between content beats (see below) as punctuation.
- Style is a swappable layer (palette, type, easing, transition set, texture), so other packs can come later.

### Reaction gifs
- The LLM may emit an optional `reaction` intent ("mind blown", "wait, what?", "satisfying click") at a beat. Use sparingly, **≤ ~1 per 45–60 s**, never mid-explanation.
- **Providers: GIPHY + Klipy** behind a GIF provider interface (Tenor is out; Google discontinued its public API in 2026). Personal API keys; for OSS, users bring their own.
- Local cache of hits + a **banned list** (blocked gifs/terms). Gifs render framed in the style pack (vignette/frame), not raw.

### Voices (open source, local)
- Narration is generated ahead of playback, so it only needs to beat real time on average.
- **Candidates to benchmark on the M4 Max:**
  - **Chatterbox Turbo** (MIT, 350M): expressive, voice cloning, paralinguistic tags, top open-weight model on TTS Arena; ~1.1× real time on an M4 GPU, which is tight for streaming. Outputs are watermarked (irrelevant for personal use).
  - **Kokoro-82M** (Apache 2.0): ~14× real time on an M4, solid English, no cloning. Default for the **tutor fast path** and the fallback when Chatterbox falls behind.
  - Qwen3-TTS (Apache 2.0, steerable delivery): too slow on Apple Silicon right now (~0.2×).
- TTS sits behind a provider interface; models are swappable.
- **Math-to-speech step:** LaTeX/symbols → spoken English before TTS (`O(n \log n)` → "big O of n log n").

### Streaming
- Scene N plays while N+1 generates. Time-to-first-frame ≈ one scene's generation (~10–20 s target).
- Invariant: per-scene generation (script → TTS → align → DSL → compile) < scene playback time. Keep ≥1 scene of buffer; show a buffering state if starved.
- Parallelize: TTS for beat k runs while the DSL for beat k−1 is generated/compiled.

### Tutor / interrupts
- Fast path: on pause + question, respond within ~2 s (voice, Kokoro) and start **drawing annotations on the current scene via the DSL** (circle, highlight, arrow to `object.id`).
- Context passed: IR section, transcript up to the current word, the live scene graph (object IDs + states), prior questions this session.
- The instant response can't depend on Claude Code CLI cold start → a small local model (Ollama) handles acknowledge + annotate, and Claude produces the substantive answer.
- v1 slow path: stream an **animated branch** through the same scene pipeline, then rejoin.
- After a branch, resume at the **start of the current beat**, not the exact word.

### Checkpoint questions (v1)
- Shown at the ends of segments. **Source exercises first** (end-of-section problems, slide practice problems, zyBook participation activities). Generate only when the source has none for that segment, and **label it as generated**.
- Wrong answer → same branch machinery as an interrupt (app-initiated).

### Inference providers
- **Primary: reuse my subscriptions via Claude Code headless (`claude -p`).** Fine for batch stages that buffer ahead (outline, script, scene DSL).
- **Model: `haiku` by default, `sonnet` for the script stage** (`SCRIPT_OPTS` in `src/gen/script.ts`; Haiku scripts broke the speech-first rules). `CompleteOpts.model` picks the tier; `src-tauri/src/llm.rs` allowlists `haiku|sonnet` and `src/llm/claudeCli.ts` mirrors it; keep both in sync.
- Caveats: cold-start latency (unsuitable for the instant tutor), it eats the 5-hr Pro limit, and the ToS for driving it from my own app must be re-checked **before the OSS release** defaults to it.
- **Provider interface from day one:** `ClaudeCodeCLI` (backend #1), `Ollama` (local fallback + tutor fast path), API-key providers (Claude/Gemini/OpenAI) for other users and later.
- Budget constraint: nothing beyond Claude Pro should cost money by default.
- **API keys (deferred):** none are needed yet, so no storage is built. When the first provider needs one (GIPHY/Klipy, Anthropic or other API-key providers), store it in the **macOS Keychain** via the Rust `keyring` crate behind `get_secret`/`set_secret` Tauri commands, and pass keys to the sidecar at spawn. Never put keys in the repo, `.env` files, or plain app settings. `.env*` is gitignored only as a safety net. The Claude Pro path (`claude -p`) needs no key.

### Correctness & grounding
- **Computed visuals:** algorithm traces and numeric results come from real code, not the LLM (`op` actions on components). LLMs botch hand-traced states.
- Every script claim carries a source anchor (`cite`); a verification pass checks the script against the IR section before scene generation.
- **Golden set:** ~5 CS 251 sections as a regression suite (sync failures, invalid DSL, factual drift, pacing).

### Storage
- A "video" is a project bundle: IR slice + script + DSL + audio + alignment + cached gifs. Small, diffable, and it replays with zero regeneration. Branches are cached alongside.

## Dogfood courses (Fall 2026) → visual vocabulary
- **CS 251** (data structures & algorithms): array/pointer traces, tree rotations, heaps, graph traversals. **MVP dogfood course.**
- **CS 250** (computer architecture, LEGv8, zyBook): datapath/pipeline diagrams, signals through muxes/ALU, instruction encoding.
- **STAT 350**: distributions morphing, shaded areas, sampling simulations.
- **CS 334** (graphics): matrices acting on geometry, 3D transforms, rasterization.

## Scope

### MVP (LOCKED)
Goal: prove *generate → stream → interrupt* and de-risk: (1) can an LLM reliably emit good DSL scenes, (2) does generation stay ahead of playback, (3) does annotate-the-scene tutoring feel magical.
- Tauri shell + Python sidecar (uv)
- One textbook PDF → IR (parser chosen by benchmark) → pick a section
- Outline → speech-first script (beats) → math-to-speech → TTS → forced alignment → scene DSL compiled against real timestamps + validator
- PixiJS player on the audio clock: primitives, KineticText, ~8 actions, KaTeX, cut/whip transitions, `Array` + `Tree` as computed components
- Black × Code Report style pack v0 (reaction gifs optional in MVP if time allows)
- Scene-by-scene streaming
- **Typed** interrupt → tutor voice answer + annotations on the current scene
- Providers: Claude Code CLI + Ollama behind one interface; TTS: Chatterbox/Kokoro behind one interface
- **Out of MVP:** voice input, animated branches, checkpoints, non-PDF adapters, export, editor

### v1
- All 4 adapters + per-topic source merging
- Voice questions (local whisper.cpp)
- Animated branches that stream and rejoin
- Checkpoint questions (source-first)
- Component libraries for all four courses
- Reaction gifs fully integrated; 1–2 more style packs; MP4 export; power-user editor (edit outline, regenerate scene)
- Caching: videos + branches replay without regeneration
- Usage meter for the Pro 5-hr limit; API-key / local fallback
- Open-source release (no content ships in the repo; users bring their own books)

### Deliberately deferred
- Plugin API for adapters/components/style packs: **don't design upfront.** Internal modules first; extract a plugin surface once ~10+ real components exist.
- "Remembers my confusion" / weak-spots tracking, exam-prep mode: not in v1.

## First tasks (in order)
1. **Repo scaffold:** Tauri + TS frontend + PixiJS; `uv` Python sidecar with a typed IPC boundary.
2. **TTS + alignment spike:** Chatterbox Turbo vs Kokoro on the M4 Max (real-time factor, quality on technical narration, math-to-speech output), plus a forced-alignment accuracy check. Decides the default narration voice.
3. **PDF benchmark:** Docling vs Marker on 3 chapters → pick the parser, which settles the license direction.
4. **DSL v0 finalize:** JSON Schema + validator + timeline compiler, hand-written scenes first (no LLM) to prove the player/sync.
5. **LLM → DSL:** generate scenes for one golden CS 251 section; measure validity rate + generation time vs playback.
6. **Tutor annotate loop.**

## Current state (keep this section current)
Read `README.md` for how to run, test and debug. In dev, the `[webview]` lines in the `tauri dev` terminal show pipeline status, rejected scene attempts and buffering.

**Architecture now (2026-11-05):**
- **Rendering engine is its own package**: `packages/motion` (`@tangent/motion`, alias `@motion/*`): `dsl/` (schema, validator, templates, compiler, ops), `stage/` (scene state + PixiJS renderer), `player/` (audio-clock `Player`, `SceneQueue`), `annotations.ts`. It must not import app code (`@/…`), React or Tauri, so it can be published separately.
- **Templates over raw DSL.** The scene LLM picks a template per beat (`title, stat, versus, list, character, diagram, math, code, array, tree, chart, figure, gif, callout, table`, each with variants) and fills short slots. `src/dsl/templates.ts` expands them into positioned DSL objects + word-anchored actions, clears the previous frame unless `keep:true`, and adds a transition. Raw `objects`/`actions` stay as the escape hatch. Fractional anchors `"@0.4"` (word at 40% of the beat) make template timing immune to TTS rewording.
- New primitives: `icon` (Hugeicons by loose name), `emoji`, `person` (stick figure, 9 poses, `pose` action), `gif`, `chart`, `counter`, 10 shape kinds (incl. `alu`, `trapezoid` for MUX, `cylinder`), arrows with `label`/`route: elbow|curve`/`dashed`, `pulse` action (signal dot along an arrow).
- Scene grouping is deterministic (`chunkBeats(beats, 4, 3)`: a short first scene for a faster first frame); the LLM planning call is gone.
- `npm run dev` → `/?showcase=<template>&variant=<v>` renders one template with fake timings (dev only) for visual checks.
- Projects/threads/IR cache/checkpoint results are JSON docs via Rust `store_read/store_write/store_delete` (`<appData>/store`). Figures are written to `<appData>/figures/<sourceId>` (asset scope allows it; this was why figures were always "unavailable"). GIPHY key via `get_secret/set_secret` (Keychain, Settings screen).

**2026-11-05 batch:**
- LLM CLI locked down: `claude -p` runs with `--tools ""`, disallowed tools, `--strict-mcp-config`, `--setting-sources ""`, no slash commands/session persistence, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, in a fresh empty temp cwd. All untrusted text goes into neutralized `<tag>` data blocks (`src/gen/sanitize.ts`); model output is sanitized + length-capped.
- Tutor sees the frame (Stage snapshot → `images` via stream-json), an on-screen description (`@motion/stage/describe`), the line being narrated, retrieved section passages and thread history.
- Narration: `mathToSpeech` rewritten (markdown, lists, ranges, symbols, numbers → words). Beats synthesized per segment with 0.45 s gaps; SceneQueue holds 0.6 s between scenes; the compiler never inserts silence (fixes A/V drift).
- Motion polish (`@tangent/motion`): word-by-word text reveals (no per-frame re-centering), rounded/scaled strokes traced from top-centre with fill fading in, filled arrowheads, one 0.35 s highlight punch (no looping wobble), fixed-slot rolling counters, short slides, decaying camera shake, transitions where the old frame exits left while the new one enters (deterministic in t), speech bubbles with tails. Penner eases inline (`stage/motion.ts`, `MOTION` tokens); no animation library. Standalone dev showcase: `/src/dev/showcase.html?showcase=<t>&variant=<v>&prev=<t>&tr=whip`.
- Player: captions strip under the video, checkpoints pause the video and render inside the frame, persistent Checks strip, seek-bar markers. Home is main's barebones page again; projects/settings removed (in git history).

**2026-11-05 later:**
- Player overlays the video (header + controls fade after 2.5 s idle while playing; no border; captions are plain per-beat text over the bottom). Icon-only header; Checks button with badge opens a Checks tab (grouped by scene, score, "Take the quiz" via React Bits Stepper). Playback speed 0.75–2× (`SceneQueue.setRate`, pitch-preserved; gaps scale). Tutor answers render `$…$` via KaTeX (`RichText`, text never as HTML). Ask opens a fresh question when reopened >3 s / a scene away.
- Checkpoints: must be answerable from the card (`needsMissingData` drops ones that reference unseen tables/figures; may attach `table` or a section `figure`); ~1–2 per scene + end set (≤16). Cards show table / figure / scene thumbnail.
- Detail level per video (`overview | standard | detailed | complete`) picked on Home, flows to the script prompt (`targetBeats`), saved on the bundle.
- Keychain is read only if `tangent.giphy.set` is set (no prompt on Home load). Linux keyring is non-persistent (kernel keyring).

- Templates phase 1: 18 more (timeline, definition, analogy, steps, procon, quote, hook, checklist, numberline, venn, matrix, distribution, pipeline, encoding, stack, queue, linkedlist, graph) in `dsl/vocabTemplates.ts` (helpers `dsl/tplkit.ts`). Computed components Stack/Queue/LinkedList/Graph (real BFS/DFS) in `dsl/components.ts`; on-screen numbers (matrix products, distribution areas `dsl/stats.ts`, pipeline stalls, encoding fits) are computed, never from the LLM. 24 shape kinds, 391 curated icons + synonyms, emoji packs. Per-beat `emphasis`/`energy`/`texture`/`accent`. Cross-scene variety via `recent` (soft: enforced on the first attempt only). Template guide ≈6.2k chars (test caps it at 7k).

**2026-11-05 port (from the `tangent-review` worktree):**
- Scene audio plays through one shared `AudioContext` (`@motion/player/bufferClock`), not one `<audio>` per scene: per-element audio-session churn deadlocked WKWebView. `<audio>` only where there's no AudioContext (jsdom). Speed ≠ 1× plays a WSOLA time-stretched copy at 1× (`@motion/player/stretch`, same pitch, ~0.1 s per minute of audio, cached per rate).
- Home: checkboxes + Select all → "Make video (N sections)" joins sections into one video (`topSelected`, `sectionsText`, id = ids joined with `+`).
- Gifs: `gif` template is gif-only (`full|center`), up to 2 per scene, never two in a row; GIPHY top-1 hit; key found even without the localStorage flag (read once at generation time).
- Sidecar: PDF embedded outline (pypdfium2) defines the top section levels; Roman/letter headings nest; font sizes read from the PDF when there's no outline or dotted numbering.
- Invalid-script errors now list the first violations.

- (2026-11-10) Optional beat `tangenter:{pose,poseTo?,says?,thinks?,at?}` adds the recurring stickman presenter at a consistent 22% stage height. Conservative bounds pick a clear bottom corner or omit him/bubbles; dense or unknown component geometry is intentionally skipped. He walks in from the nearest edge, breathes, points at the key visual, blends poses on narration anchors and persists across consecutive eligible beats. Generation requests roughly one appearance per 3–4 beats, never on gifs/figures; no signature cap (owner preferred the plain stickman).

**Open issues:**
- **Not yet run end-to-end on a real chapter with the new templates.** Expect prompt tuning (template choice, variety) after the first dogfood.
- `src/stage/icons.ts` imports the whole Hugeicons namespace for loose name matching (bundle size). Fine for desktop; revisit if it matters.
- PDF ingest progress is an estimate (pages × learned sec/page); Docling has no progress callback.
- Beat/scene gaps (0.45 s / 0.6 s) are untuned; listen on a real chapter.
- **Objects accumulate only in raw-DSL beats.** Template beats clear the previous frame (unless `keep:true`); escape-hatch objects still rely on the model to fade them.
- **Slow first scene.** Was ~3 min with Haiku; the planning call is gone and scene 1 is 3 beats now, but it is not re-measured yet.
- **A failed scene is skipped** (no overlay mid-playback), and the bundle is marked Partial.
- **Transitions are basic.** Within a scene, beat transitions slide or dip only the incoming layer. Between scenes there is a hard swap, but the Pixi app persists.
- **Old `main` work was mostly superseded** (branch replaced main on 2026-11-05; old work kept in `backup/main-uncommitted-2026-11-04`). Ported: Docling on MPS (`TANGENT_DEVICE` overrides) and section cleanup (captions/help text/watermark titles are not sections, page spans rebuilt after reparenting). Not ported: real Docling progress events, so PDF progress is still an estimate.
- GlassSurface's SVG refraction needs backdrop-filter `url()`, which WKWebView lacks, so the side panel and paused play button fall back to a plain blur.

**Recently fixed (2026-11-10), don't regress:**
- Recent videos only lists entries that have a saved bundle and opens it directly (never regenerates); recents without a bundle are pruned from localStorage once the saved list loads. Regenerate = open the PDF and pick the section.
- Heapify demo removed from the app (Home button + App "demo" screen). `@motion/stage/demo` stays as a test fixture.
- Scrollbars hidden app-wide (`src/index.css`); scrolling still works.
- App icon: macOS-style rounded square (white logo on black) built from `assets/tangent-icon.png` by `scripts/mkicon.py` -> `assets/app-icon.png` -> `bunx tauri icon`. Icons are compiled into the binary: after changing them run `cargo clean -p tangent` before `tauri dev`.
- The binary is `Tangent` (`[[bin]]` in Cargo.toml + `mainBinaryName`) so the dev build shows "Tangent" in the Dock/menu bar; the crate stays `tangent`.

**Recently fixed (2026-11-05), don't regress:**
- **Side panel:** always docks beside the video (width `min(400px,45vw)`, never overlays) and grows open (width keyframe, `.panel-open`) so the video eases smaller. `main` is `overflow-clip`, not `hidden`: the Ask box's autofocus scrolled the overflow-hidden player sideways while the panel slid in (the jagged jump on open). Glass tint via `backgroundOpacity` + `color-scheme: dark`. Header and controls are pinned to the video **column's** top/bottom (window edges), not the video.
- **"Scene queue is complete" on saved videos:** React re-ran the stream effect on the same `SceneQueue` (Fast Refresh / StrictMode) after `finish()`. `dispose()` now empties and reopens the queue, and the effect resets scenes/done/error.
- (2026-11-08) The end-of-seek-bar flag was removed.
- (2026-11-08) Captions live in the video column (not the 16:9 frame): always at the window bottom, above the bottom bar.
- (2026-11-08) Scene breaks removed from the player UI: no gap ticks on the seek bar, no prev/next scene buttons or "Scene N of M", hover shows time only. The bar is one continuous video length. Checkpoint diamonds stay; the 0.6 s hold between scenes in `SceneQueue` is unchanged (playback, not UI).

**Recently fixed (2026-11-04), don't regress:**
- **Scrubbing froze the whole app.** Calling play/pause/seek on every range input event deadlocked WebKit's media stack (webview blocked in `audio.play()` on a sync IPC to the GPU process, which was stuck in an AVFoundation lock). The scrubber pauses on pointerdown, only seeks during the drag, and plays once on pointerup (tested).
- **Canvas didn't resize when the side panel opened.** Pixi `resizeTo` only listens to window resize; `Stage` adds a `ResizeObserver` that calls `app.resize()`.
- **Player layout:** header bar (back, title, Transcript, Ask, fullscreen) above and controls below the video, attached to the window, never over it. The video is a plain 16:9 box (click toggles play; only a frosted play button shows while paused). Space/K and ←/→ shortcuts (ignored while typing). (Superseded 2026-11-05: chrome is pinned to the window edges of the video column.) Animate transform/opacity only; no hand-rolled hover physics (the old Dock/Spotlight/overlay controls were janky and are deleted).
- Tutor gets the real narration transcript (was empty) and thread history for follow-ups.
- Figures load (asset scope + app-data figures dir); one bad figure no longer kills an ingest.
- Ingest runs once per source (IR cached); loading screens show real pipeline steps.
- `streamVideo` must import `resolveAnchor` (its absence crashed every scene).
- `sidecarTts` returns a **raw** WAV path. `SceneQueue.createAudio` converts it, and `save_video_bundle` copies it. An `asset://` URL there silently produced bundles with no audio.
- `SceneQueue` treats `audio.ended` as the end of the scene; otherwise a WAV shorter than its timeline loops.
- The scene retry sends the previous JSON along with the validator errors, and TTS audio is reused across DSL retries.
- Layout: shapes and Math pack 3 per row, and big components get their own row, with cell sizes (`cw`/`ch`) that shapes fit into. Arrows are trimmed to box edges and sit under the boxes, and boxes are opaque.
- `Stage` keeps one Pixi app across scenes. `Player` smooths the coarse `currentTime` between updates (capped at 0.25 s) but ends scenes on the raw clock.

## Working conventions for Claude
- **Every commit updates this file.** Refresh *Status*, *Current state* (open issues, recently fixed) and *Decisions* to match the commit, and stage `CLAUDE.md` with the commit. The `.githooks/pre-commit` hook rejects commits that don't stage it (enable once with `git config core.hooksPath .githooks`; use `--no-verify` only for commits that truly change nothing here).
- Double-check work; be precise and rigorous. Push back on bad or suboptimal ideas.
- Prefer the smallest thing that de-risks the next unknown; no speculative abstractions.
- The speech-first script, word-anchored timing, and computed visuals are non-negotiable quality bars.
- **Agentic work goes through Orca, not native subagents** (Monish, 2026-11-10). Use the `orchestration` skill (`orca orchestration worker-start --agent codex|claude ...`) for implementation, polish, review and any parallel work, so every worker has its own visible terminal, task record and worktree (`--worktree new-child` for parallel branches). Don't use the native Agent tool (general-purpose/worker/util subagents) for this. Implementation defaults to Codex; Claude workers for review/polish when asked. Start Codex workers with auto-review approvals so they don't stall on prompts: `orca terminal create --worktree <ws> --command "codex --approve-for-me"`, then `worker-start --task <id> --terminal <handle>`. Never pass `--model opus` unless Monish asks for it in that message.
- Visual checks: never run headless Chrome in parallel (it pegged the CPU). Open one normal browser window per worker and capture it with `screencapture -x -o -l <windowid>`.

## Packaging: one downloadable app
- Goal: a single installer. Nothing the user must install or hunt for (no brew, no separate Python, no ollama).
- Bundle as Tauri `externalBin` sidecars: the Python sidecar (frozen with PyInstaller or an embedded uv Python), `llama-server` (llama.cpp, small), ffmpeg if needed.
- Large model weights (TTS, VLM, alignment) are NOT in the installer. Download once on first run into the app data dir, with a progress UI and checksum. Small models (Kokoro ~330 MB) may be bundled if installer size allows.
- Licence limits what we bundle: Marker weights are restricted (no bundle, opt-in only); Docling is MIT and can ship.
- Remove the dev-only hardcoded sidecar path in `src-tauri/src/lib.rs` before any packaged build.

## Tree component
- `Tree` has a `kind`: `bst` (default), `avl`, `redblack`, `btree`, `heap`, `generic`. Each kind owns its ops, registered by kind. Node data is nested (`keys`, `children`, optional `color`) so B-trees (many keys per node) fit; level-order arrays stay as shorthand for binary kinds.
- Array heaps: max by default, `heap: "min"` option.

## Decisions (Monish)
- PDF parser: **Docling** (MIT, bundles cleanly). Marker dropped.
- Narration voice: **Kokoro `af_heart`** (female). Chatterbox not pursued for now.
- LLM for generation: **Claude Code `haiku`** (2026-11-04), chosen to conserve usage; **script stage on `sonnet`** (2026-11-05) for script quality.
- Retaking a check replaces the earlier answer; Escape closes the speed menu and the side panel together (2026-11-05).
- Scenes are **templates first** (2026-11-04): reliability and layout quality over free-form DSL. Characters = Hugeicons + stick figures + emoji. Projects = NotebookLM-style with notes. Checkpoints = textbook-first, mixed MCQ (local grading) / short answer (LLM-graded). GIPHY key in Keychain via Settings.

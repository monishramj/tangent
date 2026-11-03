# CLAUDE.md: Tangent

> **Tangent**: a desktop app that turns textbook material into animated explainer videos you can interrupt mid-playback to go off on a tangent.
> Status: **ideation complete, MVP locked.** No code yet. Next: benchmarks + DSL v0 review (see *First tasks*).
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
- **PDF parser: benchmark before choosing.** Docling (MIT) vs Marker (GPL code, restricted weights; often best on math) on 3 real chapters (CS 251, STAT 350, CS 334). Scoring: LaTeX fidelity, figure extraction + captions, section tree accuracy, exercises captured, speed on the M4 Max. Licensing note: Marker pushes Tangent toward GPL unless it's strictly isolated as a separate process; Docling keeps MIT/Apache open.
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
- Dark academia × Code Report style pack v0 (reaction gifs optional in MVP if time allows)
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

## Working conventions for Claude
- Double-check work; be precise and rigorous. Push back on bad or suboptimal ideas.
- Prefer the smallest thing that de-risks the next unknown; no speculative abstractions.
- The speech-first script, word-anchored timing, and computed visuals are non-negotiable quality bars.
- Subagents: use `worker` (Sonnet) for implementation and spikes, `util` (Haiku, read-only) for review/verify/search. Never pass `model: opus` unless Monish asks for it in that message.

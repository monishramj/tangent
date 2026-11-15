# Generation (script, grounding, TTS, gifs, providers)

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.
- Design: [generation-accuracy.md](../generation-accuracy.md)

## Contract

### Reaction gifs
- The LLM may emit an optional `reaction` intent ("mind blown", "wait, what?", "satisfying click") at a beat. Use sparingly, **≤ ~1 per 45–60 s**, never mid-explanation.
- **Providers: GIPHY + Klipy** behind a GIF provider interface (Tenor is out; Google discontinued its public API in 2026). Personal API keys; for OSS, users bring their own.
- Local cache of hits + a **banned list** (blocked gifs/terms). Gifs render framed in the style pack (vignette/frame), not raw.

### Voices (open source, local)
- **Current choice: PocketTTS `alba`** (MIT code, CC-BY-4.0 weights), local CPU synthesis. Selected in the narration comparison; MMS_FA still supplies word timestamps.
- Narration is generated ahead of playback, so it only needs to beat real time on average.
- **Candidates to benchmark on the M4 Max:**
  - **Chatterbox Turbo** (MIT, 350M): expressive, voice cloning, paralinguistic tags, top open-weight model on TTS Arena; ~1.1× real time on an M4 GPU, which is tight for streaming. Outputs are watermarked (irrelevant for personal use).
  - Qwen3-TTS (Apache 2.0, steerable delivery): too slow on Apple Silicon right now (~0.2×).
- TTS sits behind a provider interface; models are swappable.
- **Math-to-speech step:** LaTeX/symbols → spoken English before TTS (`O(n \log n)` → "big O of n log n").

### Streaming
- Scene N plays while N+1 generates. Time-to-first-frame ≈ one scene's generation (~10–20 s target).
- Invariant: per-scene generation (script → TTS → align → DSL → compile) < scene playback time. Keep ≥1 scene of buffer; show a buffering state if starved.
- Parallelize: TTS for beat k runs while the DSL for beat k−1 is generated/compiled.

### Checkpoint questions (v1)
- Shown at the ends of segments. **Source exercises first** (end-of-section problems, slide practice problems, zyBook participation activities). Generate only when the source has none for that segment, and **label it as generated**.
- Wrong answer → same branch machinery as an interrupt (app-initiated).

### Inference providers
- **Primary: reuse my subscriptions via Claude Code headless (`claude -p`).** Fine for batch stages that buffer ahead (outline, script, scene DSL).
- **Model: `haiku` by default, `sonnet` for the script stage** (`SCRIPT_OPTS` in `src/gen/script.ts`; Haiku scripts broke the speech-first rules). `CompleteOpts.model` picks the tier; `src-tauri/src/llm.rs` allowlists `haiku|sonnet` and `src/llm/claudeCli.ts` mirrors it; keep both in sync.
- Caveats: cold-start latency (unsuitable for the instant tutor), it eats the 5-hr Pro limit, and the ToS for driving it from my own app must be re-checked **before the OSS release** defaults to it.
- **Provider interface from day one:** `ClaudeCodeCLI` (backend #1), `Ollama` (local fallback + tutor fast path), API-key providers (Claude/Gemini/OpenAI) for other users and later.
- Budget constraint: nothing beyond Claude Pro should cost money by default.
- **API keys (deferred):** none are needed yet, so no storage is built. When the first provider needs one (GIPHY/Klipy, Anthropic or other API-key providers), store it behind `get_secret`/`set_secret` Tauri commands (now an owner-only file `<appData>/secrets/<name>`, 0600; the Keychain was dropped 2026-11-10 because unsigned dev builds prompted for the login password on every read; revisit Keychain/encryption once builds are signed). `get_secret` only returns allowlisted names (`WEBVIEW_READABLE` in `store.rs`, just `giphy`: GIPHY keys are designed for client-side use); any other key is write-only from the webview and read only in Rust. Pass keys to the sidecar at spawn. Never put keys in the repo, `.env` files, or plain app settings. `.env*` is gitignored only as a safety net. The Claude Pro path (`claude -p`) needs no key.

### Correctness & grounding
- **Computed visuals:** algorithm traces and numeric results come from real code, not the LLM (`op` actions on components). LLMs botch hand-traced states.
- Every script claim carries a source anchor (`cite`); a verification pass checks the script against the IR section before scene generation.
- **Golden set:** ~5 CS 251 sections as a regression suite (sync failures, invalid DSL, factual drift, pacing).

- `streamVideo` must import `resolveAnchor` (its absence crashed every scene).

- `sidecarTts` returns a **raw** WAV path. `SceneQueue.createAudio` converts it, and `save_video_bundle` copies it. An `asset://` URL there silently produced bundles with no audio.

- The scene retry sends the previous JSON along with the validator errors, and TTS audio is reused across DSL retries.

## Log

(none yet; prepend dated entries here)

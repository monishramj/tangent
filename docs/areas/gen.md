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
- Script generation is two Sonnet calls: an opening of exactly 3 beats plus a short remaining outline, then the rest with the accepted opening text as context. Scene 1 TTS/DSL overlaps the second call; later groups append without changing the first scene.
- Both parts use the same speech and numeric gates. A lexical join guard repairs/cuts repeated definitions or explanatory sentences; it cannot recognize every paraphrase. Part 2 transport failures retry once, then emit an ordered error so the saved video is Partial and already playing scenes remain usable.
- Dev logs stamp `script-part-1-start/ready`, `script-part-2-start/ready/failed`, and `first-scene-ready` with elapsed milliseconds from script start. These measure generation readiness, not the first audible frame.
- Parallelize: TTS for beat k runs while the DSL for beat k−1 is generated/compiled.

### Checkpoint questions (v1)
- Shown at the ends of segments. **Source exercises first** (end-of-section problems, slide practice problems, zyBook participation activities). Generate only when the source has none for that segment, and **label it as generated**.
- Generated checks use the beats' spoken narration, with source paragraph anchors for evidence (older IR gets local paragraph ids). Answers/explanations pass the shared numeric gate, then one Haiku batch grounding check; missing/false/malformed verdicts drop only the affected question. A failed check call drops generated questions while textbook exercises survive.
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

### 2026-11-16 — Step 13: grounded checkpoints
- Passed spoken beats and their source passages into checkpoints (including streamed continuation and fact-check cuts); removed source truncation and required generated cite anchors.
- Shared numeric gate + one Haiku grounding batch; unsupported, unknown-anchor, missing/malformed verdicts fail closed per question; textbook exercises retain scene and total-budget priority.
- Evidence: all 7 affected/importer test files passed (122 tests, fake LLM); TypeScript check passed; orphan cleanup ran.
- Decisions/limits: opt-in factCheck defers checks until narration is final; legacy IR uses local paragraph ids; shared gate retains its small-count/rounding/arithmetic rules; same-family LLM checks are fallible.
- Not verified: optional cloud OpenStax eval, local models, native playback/UI (unchanged).

- 2026-11-16 — Step 12: `src/gen/factCheck.ts` + `streamVideo({ factCheck })`, **default OFF**. One haiku call per scene (beats vs source paragraphs: supported/unsupported/unclear); wrong cite anchor corrected; unsupported beat gets one repair (re-checked + speech/number gates) else is cut, never all beats; unusable answers fail open. Scene 1 never waits (log only); later scenes wait <=20 s beside TTS and redo audio only if narration changed.
  Evidence: fake-LLM tests per outcome, flag-off/scene-1/ordering stream tests; 177 tests in src/gen + src/pipeline, tsc clean. Harness: `TANGENT_FACTCHECK_EVAL=1 npx vitest run src/gen/factCheck.eval` prints the false-flag rate (21 bundled synthetic fixtures; `TANGENT_FACTCHECK_FIXTURES=` for your own).
  Not verified: false-flag rate (cloud eval run was blocked by the permission classifier here, so it is unmeasured and the flag stays OFF); real latency; the repair prompt on real beats. Flag is not wired to any UI/setting yet.

- 2026-11-15 — Step 11: split the script into 3 opening beats + outline, then a concurrent continuation; added bounded retry/partial failure, lexical join repair/cut, and elapsed timing logs.
  Evidence: after incorporating current v1, 224 tests passed across 12 affected files; Home quarantine + offline eval skipped; TypeScript passed.
  Not verified: real first-scene latency or audio continuity; owner must listen to one video to assess the join.

**2026-11-15 — v1 step 10:** After repair, waive only long sentences or one parenthetical on at most floor(shipped beats / 10); return `styleWaived` indices and print the count in the eval harness. Accuracy gates and unsupported-beat cuts remain in force.
Proof: focused script/pipeline/storage tests cover boundaries, every lint class, mixed accuracy failures, and saved passage IDs; TypeScript passed.
Not verified: live model/eval runs, real audio, native builds.
- 2026-11-16 Script rule 8 (everyday words) and a stiff-word lint: utilize, subsequently, furthermore, thus, aforementioned, commence, endeavor, plus verb inflections. Whole word, so thusly and utilization miss; therefore and demonstrate stay prompt-only. Hits use the targeted repair, then the existing step-10 waiver (stiff-word counts as minor, at most floor(beats/10), recorded on styleWaived). Accuracy still fails or is cut. Evidence: `src/gen/script.test.ts`. Not verified: narration on a real section.

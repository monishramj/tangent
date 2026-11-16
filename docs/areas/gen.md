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
- **Ollama (open):** the first-launch screen does not offer it. `src/llm/registry.ts` is still claude and codex only, so there is no end-to-end check that can pass. Add the row when a real local `complete()` works.
- Budget constraint: nothing beyond Claude Pro should cost money by default.
- **API keys (deferred):** none are needed yet, so no storage is built. When the first provider needs one (GIPHY/Klipy, Anthropic or other API-key providers), store it behind `get_secret`/`set_secret` Tauri commands (now an owner-only file `<appData>/secrets/<name>`, 0600; the Keychain was dropped 2026-11-10 because unsigned dev builds prompted for the login password on every read; revisit Keychain/encryption once builds are signed). `get_secret` only returns allowlisted names (`WEBVIEW_READABLE` in `store.rs`, just `giphy`: GIPHY keys are designed for client-side use); any other key is write-only from the webview and read only in Rust. Pass keys to the sidecar at spawn. Never put keys in the repo, `.env` files, or plain app settings. `.env*` is gitignored only as a safety net. The Claude Pro path (`claude -p`) needs no key.

### Step 12 fact-check measurement (2026-11-16)

The default production session now enables fact-checking. The decision uses **all 41 factually correct beats**: 14 bundled supported fixtures, the correct narration in the wrong-anchor fixture, and 26 final recorded public OpenStax beats. Wrong-anchor narration counts as correct even when its citation needs repair; the previous metric omitted that case. Deliberately wrong fixtures are the six separate catch-rate cases; `unclear` counts as a miss, never a catch.

| Prompt | Bundled false flags (including wrong-anchor) | Public false flags | Overall false flags | Wrong fixtures caught | Wrong anchor corrected |
| --- | --- | --- | --- | --- | --- |
| Original, retained | 2/15 (13.3%) | 0/26 (0%) | **2/41 (4.9%)** | **6/6 (100%)** | 1/1 |
| One clarification, rejected | 1/15 (6.7%) | 1/26 (3.8%) | 2/41 (4.9%) | 5/6 (83.3%) | 0/1 |

The original prompt meets the requested overall <=5% false-flag / >=80% catch thresholds, although its synthetic-only false-flag rate exceeds 5%. Excluding wrong-anchor narration as the old metric did gives 2/40 (5.0%), which also meets the overall threshold. The single tweak said faithful summaries may omit details and qualified rules of thumb are approximations, while retaining checks against changed facts/quantities/qualifiers. It fixed the two initial false positives but introduced two different ones and missed one wrong claim, so it was not kept. Both variants made 21 one-beat fixture calls plus five public section-batch calls: **52 cloud Haiku calls total**, no local models or new script-generation calls. Both classified every public beat; no public verdict was unclear. This is a small one-sample measurement, not a statistical guarantee of the production rate.

Failure examples (fixture indices and public beat indices are zero-based):

- Original `supported-paraphrase`: source says a binary heap is a complete binary tree with parents no larger than children; the correct shorter narration “A heap is a tree where every parent is smaller than or equal to its kids” was flagged unsupported.
- Original `ok-caveat`: source says the central limit theorem needs a large enough sample, “often taken as at least 30”; narration calls this a “common rule of thumb.” Flagged unsupported despite that qualification.
- Tweaked `wrong-anchor`: “Inserting into a heap takes log n time” was flagged unsupported despite source p2 saying O(log n), rather than correcting p1 to p2.
- Tweaked `definitions/3`: the final recorded mean/class-proportion example (86, 75, 92 -> 84.3; 40 students, 22 men, 18 women) plus its descriptive/inferential recap was flagged unsupported.
- Tweaked `claim-not-in-source`: “Quicksort always runs in linear time, so it beats every other sort” received `unclear` rather than `unsupported`. The original caught it. No explanations are requested by this checker, so these are observed verdict mismatches, not inferred model reasoning.

Reproduce the bundled run with `TANGENT_FACTCHECK_EVAL=1`; add `TANGENT_FACTCHECK_PUBLIC=1` for the public run. Both use `TANGENT_HEAVY_SLOTS=1 taskpolicy -b bash scripts/heavy.sh node_modules/.bin/vitest run src/gen/factCheck.eval --maxWorkers=2 --silent=false`. The public mode reads only the committed PR #25 answers and applies its two recorded targeted repairs by their stable recording keys, avoiding today's changed script prompts and private recording stores. It asserts five sections / 26 beats, with an offline test for both repairs. Production sessions enable the existing gate; direct `streamVideo` callers retain the explicit flag. The polish fixes below now apply scene 1 verdicts with an eight-second cap beside TTS; later scenes check before TTS with a 20-second cap. Timed-out or unusable checks retain the numeric-gated narration but log and persist the scene as unchecked.

### Correctness & grounding
- **Computed visuals:** algorithm traces and numeric results come from real code, not the LLM (`op` actions on components). LLMs botch hand-traced states.
- Every script claim carries a source anchor (`cite`); a verification pass checks the script against the IR section before scene generation.
- **Golden set:** ~5 CS 251 sections as a regression suite (sync failures, invalid DSL, factual drift, pacing).

- `streamVideo` must import `resolveAnchor` (its absence crashed every scene).

- `sidecarTts` returns a **raw** WAV path. `SceneQueue.createAudio` converts it, and `save_video_bundle` copies it. An `asset://` URL there silently produced bundles with no audio.

- The scene retry sends the previous JSON along with the validator errors, and TTS audio is reused across DSL retries.

## Log

- 2026-11-16 Polish P1-1/P1-10/P1-7: apply scene 1 fact-check verdicts beside TTS (eight-second total check cap); later scenes check before TTS (20-second cap), synthesizing accepted rewrites/cuts once.
  Timeouts, missing/malformed/unclear verdicts and retained unsupported beats log + mark the scene unchecked; status survives recording/replay and old bundles remain unmarked.
  App now prepares a list of sources for every generation; one source retains original passage ids, saved metadata and textbook follow behavior.
  Evidence: 175 tests passed across 13 full affected/importer files (three existing skips), TypeScript clean; regression coverage for opening/later caps, applied cuts, rewrite-before-TTS, status persistence, and single/multi-source preparation.
  Limits: no real model/TTS/playback or TTFF measurement; scene 1 still needs a second scene WAV if its concurrent check changes narration; a late timed-out check can finish in the background.

- 2026-11-15 `SECONDS_PER_BEAT` is 6.92, pooled from five saved bundles (2721.36 s / 393 beats). `estimateMinutes` rounds that to whole minutes, minimum 1. Not verified: ratio after newer templates.
- 2026-11-16 Step 12 measured with 52 real sequential cloud Haiku calls: original 2/41 false flags (4.9%), 6/6 catches (100%); one prompt tweak also 2/41, but only 5/6 catches, so retained original.
  Production `startSession` now sets `factCheck: true`; low-level `streamVideo` retains its explicit opt-in default. Added public-recording eval mode and counted correct wrong-anchor beats in false flags.
  Evidence: 21 bundled fixtures + all 26 final public OpenStax beats (PR #25), both prompts; detailed results and failure examples below. Offline checks: 17 affected/importer files, 266 tests passed; final eval/helper checks 12 passed (3 live/generation skips); TypeScript passed.
  Limits: one sample per prompt, same-family checker, five section-sized public batches; no real playback/latency, repair-quality or first-scene enforcement measurement.

- 2026-11-16 Review of the several-sources script: topic merge runs before the join check, and a repair that omits passages or cite keeps the previous anchors. Scene numbers and generated checkpoints use that beat's one source; a beat or scene that names none or several fails closed. A cite that already starts with a source id is not prefixed again, and a single-source repair prompt still omits cite. Evidence: sources.test.ts. Not verified: a live Sonnet script.
- 2026-11-16 Several sources: passage ids are `sourceId/passageId`, cite is prefixed with that source id, and the numeric gate uses only the sources a beat cites. The script is told to merge by topic; beats with a topic label are grouped, otherwise source order is kept and noted. Evidence: sources.test.ts and the streamVideo source-id test. Not verified: a live Sonnet script.
- 2026-11-16 Step 18: `gen/transcribe.ts` exposes a fakeable photo reader; prompt requests verbatim text, LaTeX, no summarising/guessing, `[illegible]` for uncertainty. Numeric provenance remains `unverified-source`, never proof of computed grounding.
  SECURITY BOUNDARY: optional `llm_complete.photoPath` reads one imported library photo (canonical match, absolute path/no traversal, regular file, signature/extension allowlisted, ≤5 MiB) and embeds bytes; Claude tools/settings/MCP/model allowlists are unchanged and remain in sync with `claudeCli.ts`. No Read tool or asset scope expansion.
  Evidence: fake transcription/cache/importer tests + 52 Rust tests (one ignored; existing PDFium path supplied); no cloud sanity call. JPEG/WEBP media types are selected natively; Node provider retains its existing PNG-only contract.

### 2026-11-16 — Step 13: grounded checkpoints
- Passed spoken beats and their source passages into checkpoints (including streamed continuation and fact-check cuts); removed source truncation and required generated cite anchors.
- Shared numeric gate + one Haiku grounding batch; unsupported, unknown-anchor, missing/malformed verdicts fail closed per question; textbook exercises retain scene and total-budget priority.
- Evidence: all 7 affected/importer test files passed (122 tests, fake LLM); TypeScript check passed; orphan cleanup ran.
- Decisions/limits: opt-in factCheck defers checks until narration is final; legacy IR uses local paragraph ids; shared gate retains its small-count/rounding/arithmetic rules; same-family LLM checks are fallible.
- Not verified: optional cloud OpenStax eval, local models, native playback/UI (unchanged).
- 2026-11-16 — Step 23: first-launch checks call `claude --version` and `claude auth status` only. The `llm.rs` / `claudeCli.ts` `-p` allowlist is unchanged. Ollama stays hidden (no provider to verify).
  Evidence: status-command unit tests; screen tests for missing, signed out, ok, and timeout. Not verified: live auth status while logged out.

- 2026-11-16 — Step 15: a scene already got one background retry (same inputs; DSL retry goes through the repair path; audio reused). Added: after the retry fails, `error` events carry `scope: "scene"` (script part 2 failure is `"script"`), each is logged `generation: scene-N skipped after retry (k this session): reason`, and `stream.failedScenes()` counts them. Grounding/numeric failures take the same path (fail closed, never shipped).
  Tested with fake provider/TTS (retry-success, double failure, ungrounded number). Not verified: real runs.
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

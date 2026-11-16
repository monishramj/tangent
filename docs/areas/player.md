# Player, sync, textbook panel

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.
- Design: [textbook-follow.md](../textbook-follow.md)

- (2026-11-16) Paused play button is plain frosted glass (`.play-glass` in index.css: blur + -webkit blur, white 10% tint, `--line` border, soft shadow, hover/active, reduced-motion safe) instead of GlassSurface, whose url() refraction is wrong in WKWebView. Side panel glass untouched. Evidence: PlayerScreen.test 43 pass; Orca screenshots of src/dev/player-loading.html before/after. Not verified in the real Tauri WKWebView.

## Contract

### Audio–visual sync (non-negotiable)
Visuals are scheduled *to* the audio, never the reverse.
1. **Beats.** Each scene is a list of beats: one spoken sentence (or two short ones) + its visual actions, written together, so meaning stays aligned.
2. **Audio first.** Generate the TTS audio, then get word timestamps via **forced alignment against the known script** (CTC aligner, e.g. torchaudio MMS/wav2vec2, or whisper word timestamps as a fallback). Most open TTS models don't emit word timestamps, so this makes timing independent of the TTS model.
3. **Compile.** The timeline compiler resolves every `at` phrase to a timestamp and fits each animation into the gap before the next anchor. If it doesn't fit → insert silence at the nearest sentence boundary rather than squashing the motion.
4. **Validate before playback.** Every anchor phrase exists in `say`, every referenced object exists at that time, and no conflicting actions hit the same object. On failure → regenerate just that beat.
5. **One clock.** Player time = audio clock (`AudioContext.currentTime`), never rAF time. Pause, seek, interrupt, and playback speed all derive from it, so there is zero drift.
6. (v1, optional) VLM spot check: render keyframes at anchor times and ask "does this frame show what's being said?"

- **Silent playback / frozen clock:** WebKit only starts an AudioContext inside a user gesture, and scenes arrive minutes after the "Make video" click. `unlockAudioOnGesture()` (`@motion/player/bufferClock`) creates + resumes the shared context on the first pointerdown/keydown; `play()` rejects after 1.5 s if the context isn't running, and the player shows the error with a Resume button. Audio load/decode errors are reported even for a preloading scene (it used to buffer forever).

- Streamed passage boxes cannot overwrite manual textbook zoom or a pinch preview; fit mode still follows the updated column width. Zoom buttons scale page gaps and preserve the content inset when anchoring free scrolling.

- A page cache entry removed by pruning or containing an invalid PNG header falls back to PDFium rendering; timestamp refresh errors never fail a hit. Cache writes sync before publishing the final filename.

- **Side panel:** always docks beside the video (width `min(400px,45vw)`, never overlays) and grows open (width keyframe, `.panel-open`) so the video eases smaller. `main` is `overflow-clip`, not `hidden`: the Ask box's autofocus scrolled the overflow-hidden player sideways while the panel slid in (the jagged jump on open). Glass tint via `backgroundOpacity` + `color-scheme: dark`. Header and controls are pinned to the video **column's** top/bottom (window edges), not the video.

- **"Scene queue is complete" on saved videos:** React re-ran the stream effect on the same `SceneQueue` (Fast Refresh / StrictMode) after `finish()`. `dispose()` now empties and reopens the queue, and the effect resets scenes/done/error.

- (2026-11-08) The end-of-seek-bar flag was removed.

- (2026-11-08) Captions live in the video column (not the 16:9 frame): always at the window bottom, above the bottom bar.

- (2026-11-08) Scene breaks removed from the player UI: no gap ticks on the seek bar, no prev/next scene buttons or "Scene N of M", hover shows time only. The bar is one continuous video length. Checkpoint diamonds stay; the 0.6 s hold between scenes in `SceneQueue` is unchanged (playback, not UI).

- **Scrubbing froze the whole app.** Calling play/pause/seek on every range input event deadlocked WebKit's media stack (webview blocked in `audio.play()` on a sync IPC to the GPU process, which was stuck in an AVFoundation lock). The scrubber pauses on pointerdown, only seeks during the drag, and plays once on pointerup (tested).

- **Canvas didn't resize when the side panel opened.** Pixi `resizeTo` only listens to window resize; `Stage` adds a `ResizeObserver` that calls `app.resize()`.

- **Player layout:** header bar (back, title, Transcript, Ask, fullscreen) above and controls below the video, attached to the window, never over it. The video is a plain 16:9 box (click toggles play; only a frosted play button shows while paused). Space/K and ←/→ shortcuts (ignored while typing). (Superseded 2026-11-05: chrome is pinned to the window edges of the video column.) Animate transform/opacity only; no hand-rolled hover physics (the old Dock/Spotlight/overlay controls were janky and are deleted).

- `SceneQueue` treats `audio.ended` as the end of the scene; otherwise a WAV shorter than its timeline loops.

- `Stage` keeps one Pixi app across scenes. `Player` smooths the coarse `currentTime` between updates (capped at 0.25 s) but ends scenes on the raw clock.

## Log

- 2026-11-16 Polish B (P1-2/6/8): `plainError(e)` (src/plainError.ts) maps raw errors to plain text, raw detail to devlog; player error strings only. Shared `prefersReducedMotion` (packages/motion/src/reducedMotion.ts) used by Counter/BlurText/Stepper (BlurText now snaps instead of tweening opacity/blur). Dev CSP gets `blob:` in connect-src so the player fixture works. Tests added; not exercised in a real webview. TODO for scene-transition worker: use `prefersReducedMotion()` in the stage transition (snap instead of slide/fade).
- 2026-11-16 Centered the drawn loading ring in the video frame: “Generating video · N%” / “Updating video · N%”, smaller stage line, house white opacities and tabular figures.
  Percentage uses real Progress events: script 20%, remaining work per ready scene, narration 60% of a scene before animation; no timed increments. High-water mark survives loader unmounts, retries and expanding totals; 100 waits for stream completion.
  Evidence: 49 focused Loading/PlayerScreen tests, TypeScript, production fixture build, Orca before/after screenshots in `docs/ui-review/player-percent/`.
  First-scene queue/autoplay and reduced-motion ring behavior retained. Not verified: a real model generation or native WKWebView; weighted work is not elapsed time and can hold while totals grow.
- 2026-11-16 Textbook auto-follow no longer wakes idle player chrome: ignore pointer events at unchanged viewport coordinates.
  Idle observes pointer movement/down, wheel, touch movement and captured keys; programmatic scroll events remain excluded (no scroll listener or follow flag needed).
  Evidence: real audio-clock frame + follow scroll regression; 96 tests in PlayerScreen, Textbook, SourceFollow, SidePanel, App, App.generation and SourceView; TypeScript passes. Playback clock and Textbook follow logic unchanged.
  Not verified: native WKWebView playback with a stationary cursor.

- 2026-11-16 **Open issue: installed-build silence remains unexplained.** The owner heard no audio from `/Applications/Tangent.app` at `b9daaed` (ad-hoc, no hardened runtime), but confirmed audible old-bundle playback in instrumented current-v1 (`d86644f`) dev and release builds.
  Native measurements for `vmwh7y0mfvjpz4` scene 1: running 48 kHz context; 1,176,000 decoded mono frames; peak 0.720925; direct two-channel destination routing; live analyser peak 0.428199; no CSP/decode errors.
  Old/new-runtime saved WAVs are 24 kHz mono PCM16, peaks 0.720367/0.670654 and RMS 0.115406/0.109868; both runtime environments have matching TTS/audio package versions and identical `tts.py`. No new synthesis was run.
  Player clock files and CSP/asset scope are unchanged since v0.1.3; release uses BufferClock, not the HTMLAudio fallback, and its signature has `flags=0x2` with no entitlements. Updater signing failed for the absent private key after the app bundle built.
  Suspect a stale build or gesture-unlock edge case; neither is proven. Owner stopped investigation; probes (including the analyser branch) and test drafts were removed, with no playback-code change or new regression test.
  Not verified: uninstrumented current-v1 release by ear, the original installed process's decoded buffers, or a reproducible cause. Do not treat advancing clocks/audio-session logs alone as proof of audible output.

- 2026-11-15 Scene swap regression: clip each moving Pixi/DOM viewport before compositing; hide the outgoing layer at opacity zero.
  Root cause: PR #15 slid unbounded scene graphs, so camera zoom, edge objects and oversized backdrops crossed into the incoming scene.
  Evidence: renderer boundary regression fails before the fix; full motion/player suites + TypeScript; Orca before/after frames in `docs/ui-review/scene-transition/`.
  Audio clock, deterministic slide timing and SceneQueue's 0.6 s hold unchanged. Not verified: native Tauri/WKWebView playback.

- 2026-11-16 The follow panel keys strictly on the beat's source id. A missing IR shows a placeholder and never another source's pages, including when only one of several sources loaded. Evidence: SourceFollow.test.tsx. Not verified: playback in the app.
- 2026-11-16 When a video has several sources, the textbook panel follows the beat: PDF pages for a PDF source, source text for slides, Word, or a photo. One-source videos keep the existing panel. Evidence: SourceFollow.test.tsx. Not verified: playback in the app.
- 2026-11-16 PPTX/DOCX textbook panel is source text with the current passage highlighted (passage ids, no page render). The source tab shows the same text. Verified: TextSource and SourceView tests. Not verified: playback against a real deck.

### 2026-11-16 — Step 15: skip card for failed scenes
- A `scope: "scene"` error becomes a synthetic 2 s scene (`skipCard.tsx`: empty beats, silent WAV data-URL) enqueued in the SceneQueue at the failed scene's place, so order, seek, interrupt/rejoin and the audio clock behave as for any scene. Card UI: plain "Skipping ahead…", fade only under `motion-safe`.
- Checkpoint `afterScene` is remapped past cards in `PlayerScreen` (`applyCps`); checkpoints about a skipped scene are dropped. If nothing ever plays, the alert + Try again show at stream end.
- Touched adjacent to the clock: only `PlayerScreen`'s queue glue (the silent clip goes through the existing `createAudio`/`bufferClock` path). `queue.ts`, `bufferClock`, `Player` untouched.
- Tests in `PlayerScreen.test.tsx`; not verified in the real app.

### 2026-11-15 — Long PDF page loading
- Log native/image errors via devlog; retry failures on viewport re-entry and one image failure per entry; abort stale queued requests.
- Retain two PDFium documents, retry library initialization, recover poisoned locks, and protect PNG/size files touched within 60 seconds.
- Code confirmed all suspects: sticky failures, reopen/uncancelled queues, poison/cached load failures, fresh-file pruning, and per-request library reads (retained for authorization).
- Proof: 6 Rust tests (640 renders across two generated 320-page PDFs, interleaving, forced prune, poisoned locks); focused frontend retry/cancel and caller tests.
- Not verified: owner's failing PDF, real WKWebView image loading, Windows/Linux; one in-flight native render finishes before queued work advances.
- 2026-11-15 Step 16: preceding final frame slides/cross-fades into incoming scene over its first 0.4 s of audio time.
  Stage reconstructs both frames from timelines on seek/rejoin; canvas, Math and GIF overlays share the transform.
  Audio-clock-adjacent: only compiler phrase-end metadata and Stage invocation changed; Player/SceneQueue/bufferClock, gap and rate untouched.
  Evidence: Stage pause/seek/rejoin and first-scene tests, transition time samples, affected suite and TypeScript check.
  Not verified: real GPU/audio playback or screenshot frames; no dev server/browser started.
- 2026-11-16 Player wait (no scene yet) and mid-video buffer show the library's drawn white ring plus one stage line from existing `Progress` (`Loading.tsx`, keyframes in `index.css`). Overlay is absolute (`bottom-4`), `role=status` `aria-live=polite`; reduced motion holds the ring still. Evidence: `Loading.test.tsx`, `PlayerScreen.test.tsx`, `docs/ui-review/19-loading-first-scene.png`, `20-loading-buffering.png`, `21-loading-playing.png`, `22-loading-reduced.png`. Not verified: WKWebView, a real generation run.
- 2026-11-15: Seek bar reserves a scene-count estimate for later scenes, with transform-only stripes and a hover/time-label generation hint; seeking and markers stay inside arrived content.
  Pipeline progress alone enables it; completion (including skipped scenes) clears it, and saved replays never show it. Reduced motion uses static dim stripes.
  Evidence: PlayerScreen + App suites (43 tests), TypeScript, production fixture build; Orca fixture screenshots in `docs/ui-review/player-loading/` and computed reduced-motion animation `none`, opacity `0.4`.
  Not verified: real generation or native WKWebView; no model runs. Remainder is an estimate because future scene durations are unknown.

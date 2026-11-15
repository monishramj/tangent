# Player, sync, textbook panel

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.
- Design: [textbook-follow.md](../textbook-follow.md)

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

(none yet; prepend dated entries here)

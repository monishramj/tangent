# Tutor / interrupts

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.


## Contract

### Tutor / interrupts
- Fast path: on pause + question, respond within ~2 s (voice, PocketTTS) and start **drawing annotations on the current scene via the DSL** (circle, highlight, arrow to `object.id`).
- Context passed: IR section, transcript up to the current word, the live scene graph (object IDs + states), prior questions this session.
- The instant response can't depend on Claude Code CLI cold start → a small local model (Ollama) handles acknowledge + annotate, and Claude produces the substantive answer.
- v1 slow path: stream an **animated branch** through the same scene pipeline, then rejoin.
- After a branch, resume at the **start of the current beat**, not the exact word.

- Tutor gets the real narration transcript (was empty) and thread history for follow-ups.

## Log

**2026-11-15 — v1 step 10:** Prefer the narrated beat’s source paragraphs before keyword retrieval, within the existing passage budget. Carry optional passage IDs through scene events and saved bundles; load cached section text for replay, with keyword fallback for older bundles.
Proof: retrieval paraphrase/budget tests, active-beat/gap selection, live-player and saved-video prompt tests passed; TypeScript passed.
Not verified: live tutor/model answers or native playback; cached IR is required to resolve IDs.

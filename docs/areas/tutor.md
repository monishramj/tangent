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

(none yet; prepend dated entries here)

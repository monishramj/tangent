# Testing and evidence

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.


## Contract

- Evidence standard: commands run + pass counts + what was NOT run; screenshot for any UI change (Orca browser, one window).
- Native-only paths (AppKit menu `build()`, WKWebView audio gesture, hardware pinch, updater install, real Docling/TTS) are manual checks.
- No model runs, dev servers or headless browsers in parallel; `nice -n 10`, `cargo -j3`, `vitest --maxWorkers=2`.
- Eval harness: see `scripts/eval-generation` (`TANGENT_EVAL=...`) in [generation-accuracy.md](../generation-accuracy.md). Tiers/CI: see [v1-plan.md](../v1-plan.md) T2.

## Log

(none yet; prepend dated entries here)

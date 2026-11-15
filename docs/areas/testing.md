# Testing and evidence

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.


## Contract

- Fast tier, every push: TypeScript (`bunx tsc --noEmit`), full Vitest (`bun test` is Bun's runner, so use `bun run test`), Rust (`cargo test --locked -j3` in `src-tauri`), Python (`uv sync --locked`, then `uv run --no-sync pytest -m "not slow"` in `sidecar`). `bun run check` combines TypeScript and full Vitest. Install web dependencies with `bun install --frozen-lockfile` first; Rust PDFium tests also need the sidecar venv (or `TANGENT_PDFIUM` pointing to its library).
- GitHub runs the fast tier on pushes to main and every PR on macos-14, ubuntu-22.04 and windows-latest. Windows is advisory until platform fixes land; macOS and Linux failures block the evidence standard. Configure branch protection to require their CI jobs when enforcing merges.
- Enable local hooks with `git config core.hooksPath .githooks`: pre-commit retains the note/CLAUDE size rules and typechecks only when TypeScript is staged; pre-push runs `bun run test:focused` on changed directories (all Vitest tests for root config changes). New branches compare against origin/main; existing branches compare against their remote tip. Focused checks do not replace full CI.
- Generation replay tier: recorded model answers for fixed sections, offline and free; CI wiring comes later. Existing eval harness: `scripts/eval-generation` (`TANGENT_EVAL=...`) in [generation-accuracy.md](../generation-accuracy.md).
- UI tier: attach a screenshot to the PR for every UI change (Orca browser, one window).
- Slow tier: real model tests are manual only on the Mac, never CI (`uv run pytest -o addopts= -m slow` in `sidecar`, only when explicitly authorized).
- Evidence standard: exact commands + pass counts + what was NOT run; link the CI run and screenshot where applicable. A red check stays reported as red; never delete or skip existing tests just to get green.
- Flaky policy: quarantine with an explicit skip and open an issue the same day; link the issue in the PR. Fix or delete within one week. Never retry until green.
- Native-only manual checklist: AppKit menu `build()` and command dispatch; WKWebView audio after a user gesture; hardware pinch; updater download/install/relaunch; real Docling ingest and TTS playback. Record each result or explicitly mark not run.
- Keep checks cool: `nice -n 10`, `cargo -j3`, `vitest --maxWorkers=2`; wrap heavy commands with `scripts/heavy.sh` when available. No model runs, dev servers or headless browsers in parallel.

## Log

### 2026-11-15 — uv CI cache cleanup
- Disabled setup-uv's implicit cache; the explicit `~/.cache/uv` cache remains, avoiding a post-job save from an unused directory.
- Proof: workflow assertions and `git diff --check` passed; initial CI web Linux/Windows passed, Linux Rust/sidecar failed in cache cleanup; Windows platform failures remain advisory.
- Not verified: corrected CI run and cancelled macOS jobs; all three matrices already use `fail-fast: false`; native/model paths not run.

### 2026-11-15 — CI and local evidence contract
- Added three-platform web/Rust/sidecar CI, cached installs, hooks, PR checklist and release-seeded CHANGELOG.
- Proof: `nice -n 10 bunx tsc --noEmit` passed; `nice -n 10 bun run test:focused packages/motion/src/player/bufferClock.test.ts`: 5 passed; shell hook demo: 11 assertions passed; `sh -n` and `git diff --check` passed (sandbox denied nice priority changes).
- Not verified locally: full suites, native/manual/model paths, Linux/Windows; generation eval stayed skipped (1 existing opt-in test); CI proof pending coordinator push.

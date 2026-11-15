# Testing and CI: a guide for Monish

Plain-language guide to how a change gets proven in this repo. Source of truth for the rules is [areas/testing.md](areas/testing.md); this file explains the why and walks you through it.

## The idea in one paragraph

A change is "done" when you can show **exact commands, pass counts, and what you did not run**. The same fast checks run on your Mac (hooks) and on GitHub (CI). Anything that needs a real model, real audio or the native app is checked by hand and written down as such.

## The checks, and why each exists

| Check | Runs | Command | What it catches |
|---|---|---|---|
| Typecheck + JS tests | every push, CI job `web` on macOS/Linux/Windows | `bun run check` (= `tsc --noEmit` + `vitest run --maxWorkers=2`) | Type errors, broken UI/engine logic in `src/` and `packages/motion` |
| Rust | CI job `rust` | `cargo test --locked -j3` in `src-tauri` | Native side: PDF page rendering/cache, secrets, CLI discovery |
| Python (fast) | CI job `sidecar` | `uv sync --locked` then `uv run --no-sync pytest -m "not slow"` in `sidecar` | Ingest, passages, RPC protocol, process limits |
| Windows | same three jobs | same commands | Platform bugs. **Advisory**: red Windows does not block; macOS and Linux do |
| Generation replay | not wired into CI yet | `TANGENT_EVAL=1 vitest run scripts/eval-generation` (offline) | Script/scene regressions using recorded model answers. Free, no model call |
| Screenshots | by hand, per UI PR | Orca browser, one window | Layout/visual breakage that tests cannot see |
| Slow model tests | by hand, Mac only, never CI | `uv run pytest -o addopts= -m slow` in `sidecar` | Real Docling/TTS behavior. Only when you explicitly authorize it |
| Local hooks | on commit / push | `git config core.hooksPath .githooks` (once) | Catch it before CI does |

### Real bugs these exist for (all from this repo's history)

- **Typecheck + Vitest.** `5287b19` fixed App tests that still expected the old "Library" heading after a UI rename; the Home screen's tests had been missed once and broke the v1 branch. Rule: run the full test file you touch plus anything that imports it. CI runs everything, so a missed file cannot hide.
- **Vitest, regression tests.** `dfca90c` (audio could be blocked by WebKit until a user gesture) now has tests in `packages/motion/src/player/bufferClock.test.ts` ("a context that never starts… fails play() loudly"). The background-preparation bug where untidied titles marked a PDF Failed and re-called the LLM on every launch got `ingestQueue`/`sourceQueue` tests (see history.md, 2026-11-13).
- **Rust.** The streamed-zoom/page-cache race (2026-11-11) was a truncated or missing page-cache PNG; Rust tests in `src-tauri` (`pages::tests`) cover the cache key, pruning and cache hits. Windows currently fails 3 of them with "access denied" (see Open issues in testing.md).
- **Python.** Sidecar tests guard the stdout-must-stay-clean RPC protocol (`test_rpc.py`, `test_ingest.py`) and the ingest CPU limits (`test_limits.py`), which exist because Docling runs hot (2026-11-13 cooler-ingest entry).
- **Windows advisory.** `96780b6` fixed Windows CLI discovery and Docling device selection; the first CI run still found 3 Rust + 7 Python failures plus 5 fixture errors on Windows that macOS never showed (macOS-only paths, no `os.nice`). That is exactly what Windows CI is for, and why it is allowed to be red for now.
- **Secrets.** `31815f6` (webview may read only allowlisted secrets, owner-only files) is the kind of rule that needs a test, not a promise.
- **Hooks.** `.githooks/pre-commit` refuses code changes with no `docs/history.md` or area-note entry, typechecks when `.ts/.tsx` is staged, and keeps `CLAUDE.md` <= 10 000 bytes. `.githooks/pre-push` runs `bun run test:focused` on only the directories you changed (everything if root config changed). Focused is a speed-up, not a replacement for CI.

## Day to day

**CI is red:**
1. `gh pr checks` (or open the PR) and find which job: `web`, `rust` or `sidecar`, and which OS.
2. `gh run view <run-id> --log-failed` shows only the failing output.
3. Reproduce locally with the table's command for that job. Fix the cause.
4. Windows-only red: look at it, note it in the PR, do not add skips. macOS/Linux red: fix before merging.
5. Never delete or skip a test just to get green. A red check stays reported as red until it is fixed.

**Flaky test rule:** disable it with an explicit skip, open an issue the same day, link the issue in the PR. Fix or delete within a week. Never press "re-run" until it passes; a retry-until-green hides real bugs.

**PR proof rules** (the PR template enforces them): commands run with pass counts; what was *not* run; macOS and Linux CI links; screenshot for any UI change; generation replay evidence for generation changes (once wired); native manual checks (menu `build()`, WKWebView audio, pinch, updater, real Docling/TTS) recorded or marked "not run"; area Log and `docs/history.md` updated.

**Keep the laptop cool:** `nice -n 10`, `cargo -j3`, `vitest --maxWorkers=2`; wrap builds/full suites in `scripts/heavy.sh <cmd>`; `scripts/reap.sh --kill-orphans` afterwards.

## 10-minute hands-on: break a test, watch CI catch it, fix it

Target: the audio-clock test `packages/motion/src/player/bufferClock.test.ts`, which checks that scene time counts at the playback rate. (This is principle 3: one audio clock.)

1. **Setup once.** `bun install --frozen-lockfile` and `git config core.hooksPath .githooks`.
2. **Throwaway branch.** `git switch -c scratch/break-a-test`
3. **Baseline passes.** `bun run test:focused packages/motion/src/player/bufferClock.test.ts` shows `5 passed`.
4. **Break it.** In `packages/motion/src/player/bufferClock.ts`, the `get currentTime()` line multiplies elapsed time by `this.rate`. Change it to `this.rate * 2`.
5. **See it fail locally.** Re-run the command from step 3. Expect 2 failures, `AssertionError: expected 4 to be 2`, in "tracks the context clock…" and "rate ≠ 1 plays a stretched copy…".
6. **See CI catch it.** Commit (the pre-commit hook will ask for a `docs/history.md` line for code changes: add one, or use `git commit --no-verify` on this throwaway), then `git push -u origin scratch/break-a-test` and `gh pr create --draft --base v1 --title "scratch: break a test"`. Watch with `gh pr checks --watch`: the `web` jobs go red on macOS and Linux with the same assertion. (The pre-push hook may already fail first; that is the hook doing its job. `git push --no-verify` to let CI show it.)
7. **Fix.** `git revert HEAD` (or undo the edit), re-run step 3 for `5 passed`, push, and watch `gh pr checks` go green.
8. **Clean up.** Close the draft PR (`gh pr close --delete-branch`) and `git switch -`. Never merge the scratch branch.

## Commands cheat sheet

```sh
bun run check                                   # typecheck + all Vitest
bunx tsc --noEmit                               # typecheck only
bun run test:focused <path-or-dir>              # a few tests
(cd src-tauri && cargo test --locked -j3)       # Rust
(cd sidecar && uv sync --locked && uv run --no-sync pytest -m "not slow")   # Python
scripts/heavy.sh <cmd>                          # throttle heavy commands
scripts/reap.sh --kill-orphans                  # cleanup before finishing
gh pr checks --watch                            # CI status for the current PR
```

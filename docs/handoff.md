# Handoff (updated 2026-11-16)

Resume: Orca run `run_eace85197f30`; sub-coordinator dispatch `ctx_7935c08ae434` (waves 3-8 of docs/v1-plan.md). Never touch main; all work is on branch `v1` (PRs `--base v1`, squash-merge when required CI is green; Windows jobs are advisory).
Rules: agent rotation codex/cursor/antigravity (Claude limit low; no new claude workers), heat: `TANGENT_HEAVY_SLOTS=1`, `taskpolicy -b`, one release build at a time (owner OK'd one rebuild after #40). Security-boundary diffs (llm.rs, store.rs, pages.rs, CSP/capabilities, secrets) and audio-clock diffs get a review worker before merge.

## Done (~20 of 26 plan steps)
Merged into v1: CI, slim CLAUDE.md, long-PDF fix, style slips+tutor, testing guide (#13), flaky quarantine (#14), scene changes (#15), run cool (#16), faster first scene (#17), picker (#19, #26 braces in SourceView), OSS cleanup (#20), no-setup uv/PDFium (#21, #22), fact-check flag (#23, ON by default #39: 4.9% false flags, 6/6 caught), formula report (#24), eval set (#25), formula fidelity guard (#27), rule 8 (#28), release workflow (#29), checkpoints (#30), first-launch checks (#31), failed-scene card (#32), PPTX/DOCX (#34), photo notes (#35), loading ring (#36), P0 audio part 1 (#37).

## Open PRs
- NOTE 2026-11-16 late: #38 and #40 are DIRTY (conflicts after #39/handoff merged): rebase each branch onto origin/v1 (worktrees w6-s19 for #38, w6-smoke for #40), push, wait for required CI, merge. Handed over to the Antigravity head; no new jobs started by the sub-coordinator.
- #33 Windows/Linux fixes (step 21): security review fixes pushed; needs a Windows compile fix (pages.rs `cache_miss` uses `libc` under `cfg!(unix)`: use `#[cfg(unix)]` fn). Worker: cursor ctx_ec60ae65da9d (message sent). Then merge.
- #38 multi-source video (step 19): review fixes pushed (c91c78f); merge when green.
- #40 P0 audio part 2: `hardenedRuntime:false` (Tauri defaults it true; the ad-hoc build still had flags=runtime); merge when green, then ONE release build + smoke re-run (sound, PDF pages, first-run, PPTX, loading ring) - owner listens.

## Running
- cursor ctx_ec60ae65da9d (w4-s21, PR #33); claude ctx_0282b354d693 (w6-blank); stale codex ctx_2c3a1cf50526 (usage limit, ignore).
- blank main window after first-run setup + sidecar left running on SIGTERM: claude worker ctx_0282b354d693 in worktree w6-blank (codex ctx_2c3a1cf50526 hit its limit until 7:49 PM).

## Remaining
Finish #33/#38/#40; blank-window + SIGTERM fix (security: capabilities); release build + smoke re-run (docs/mac-smoke-2026-11.md); step 25 = Mac-only beta test (Windows/Linux only need CI build+pass); step 26 draft release via the tag workflow (docs/release.md; owner adds TAURI_SIGNING_PRIVATE_KEY(+_PASSWORD) secrets and publishes); nits: photo auto-enqueue on load can re-call cloud without confirm (Home.tsx ~76), partial-state cue on picker titles, thin SectionPicker test, lazy formula decoding ~15 s/page.

## Owner decisions pending
MIT licence OK; history rewrite to drop STAT 350 content from git history; Anthropic terms for `claude -p` (docs/open-source.md); listen checks (step 11 join, audio after #40); release secrets; who tests Windows/Linux (decided: nobody in v1).

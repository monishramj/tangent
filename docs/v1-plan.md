# Tangent v1 plan

Updated 2026-11-15. Nothing below is started until Monish says go.

**In v1:** everything below.
**Not in v1:** tutor branches, voice questions, new course components, extra styles, zyBooks/web capture.
**v2:** MP4 export, editor, usage meter, Klipy.

## Status 2026-11-24
- Shipped: v0.2.0 (Latest). v0.2.1 is a Draft (scene-skip audio, merged-chapter outline, prep-spin fixes); publish after CI is green.
- Done since 11-15: run-cool ingest, section picker, generation accuracy/fact-check, PPTX/DOCX + photo adapters, multi-source videos, Windows/Linux fixes, Antigravity as experimental.
- Open: updater 0.2.0 -> 0.2.1 never exercised; one real end-to-end chapter run + first-scene latency; owner listen check on an installed build; Windows/Linux VM smoke; Anthropic `claude -p` terms and git-history purge (owner).

## How the work runs

- Up to 4 workers at a time, each on its own branch. I (Opus) only coordinate, review and merge.
- Workers run **GPT Sol 6.1** (Codex or Cursor) or **Claude Sonnet**. No Opus workers unless truly necessary.
- Codex and Cursor both take full coding jobs. Cursor can't start its own helpers, so its jobs must be self-contained.
  Gemini only gets small, fully spelled-out jobs.
- Low CPU always: nice 10, few threads, no dev servers or headless browsers. Screenshots through the Orca browser.
- No model runs (Docling, TTS, formulas), except the one formula test, which runs alone.
- Some files are touched by many jobs (the home/source screens, the generation pipeline, the Rust core, the
  sidecar). Jobs that share these never run at the same time.

## Running it fast without burning limits

**Spread work across your subscriptions** so no single limit runs out:
- **Codex and Cursor (GPT Sol 6.1):** the coding jobs, split between them so neither quota runs dry.
- **Claude Sonnet:** reviews, measurements, writing, UI taste (picker mockups, your testing guide).
- **Opus:** only me, the coordinator. I read reports and proof, not code.
- **Gemini:** small, fully spelled-out jobs, and spare capacity if others get close to their limits.
- If one provider runs low, I move queued jobs to another instead of waiting.

**Save tokens:**
- Slimming CLAUDE.md first (step 2) cuts every later worker's startup cost by ~90%.
- Each job's instructions list the exact files and notes to read. No "explore the codebase".
- Workers run only the tests for what they changed; GitHub runs the full suite.
- Reports are 3 sentences plus a PR link. Details go once into the area note.
- I check a worker's proof (test counts, screenshots), and only read the full code for risky areas
  (security, the audio clock, files many jobs share). A Claude Sonnet reviewer does those.
- A job that fails twice gets narrowed or moved to the other agent, never rerun unchanged.

**Save time:**
- Up to 4 jobs running; the next one starts the moment one finishes. Heavy local work (builds, full test runs)
  stays niced and mostly happens on GitHub, so the Mac stays cool.
- Jobs are paired so they never touch the same files, so merges don't conflict.
- Long, low-attention jobs (CI setup, release builds, the test set) go when you're asleep or busy.
- Questions for you are batched at a few fixed points (see below), so work rarely waits on you.

## Phase 1: Foundations

1. **Commit leftover work on main.** Done (`03d2fab`).

2. **Slim CLAUDE.md** (Sonnet)
   CLAUDE.md is 92 KB and every worker reads all of it. Cut it to about 8 KB: rules, architecture, current state,
   decisions. Move the dated history to `docs/history.md` and per-area notes to `docs/areas/` (ingest, generation,
   motion, player, library, tutor, packaging, testing). Nothing gets deleted, only moved.
   From then on each worker reads CLAUDE.md plus only the notes its job needs, and adds a short entry to those notes
   when done. A git hook keeps CLAUDE.md small.
   Done when: CLAUDE.md is about 8 KB and every "don't regress" item can still be found in a note.

3. **Testing and CI setup** (Codex/Cursor)
   One clear way to prove a change works, checked on your Mac and on GitHub:
   - Every push: typecheck + JS tests, Rust tests, Python tests (fast ones), on Mac, Windows and Linux.
   - Generation check: replay recorded model answers for a fixed set of sections (offline, free).
   - UI changes: a screenshot in the PR.
   - Slow model tests: only by hand, on your Mac.
   Also: a PR template listing what proof is needed, git hooks, a CHANGELOG, and simple rules
   (a flaky test is disabled and logged the same day, never retried until it passes).
   Done when: CI runs green on GitHub.

4. **Guide for you: how testing and CI work** (Sonnet)
   `docs/testing-and-ci.md`: why each check exists, what it catches (with real past bugs from this repo),
   what to do day to day, and a 10-minute hands-on: break a test, watch it get caught, fix it.
   Then I walk you through it.

## Phase 2: Things you hit while dogfooding

5. **Long PDFs say "can't load"** (Codex/Cursor)
   First add logging (the error is currently swallowed). Likely causes, from reading the code:
   - one failed page stays failed forever (no retry);
   - every page reopens the whole PDF under one lock, so scrolling a long book queues hundreds of renders;
   - one crash can lock out every later page;
   - the cache can delete a page image right before it's shown.
   Fix: keep the PDF open between pages, drop renders for pages scrolled past, retry failed pages, recover from
   crashes, never delete fresh cache files.
   Done when: a test renders 300+ pages without failing, and you confirm on your PDF.

6. **Run cool** (Codex/Cursor)
   Goal: the app never hogs your machine. Speed comes second.
   - Two kinds of work: background (reading PDFs) runs at lowest priority; work you're waiting on (narration,
     formulas for a video) runs normally. Both share a small thread cap (about 30% of cores, max 6).
   - Lowest priority works on all 3 systems (Mac, Linux, Windows).
   - When the Mac reports it's getting hot, background reading pauses until it cools down. That needs reading PDFs
     in chunks of about 20 pages, which also gives a real progress bar instead of an estimate.
   Done when: tests show it pausing and resuming.

7. **Check lazy formula decoding** (Claude Sonnet, runs alone)
   One real run on ≤ 15 formula-heavy STAT 350 pages you choose. Stops itself if the Mac gets hot or it passes
   15 minutes. Reports how many formulas were matched, how much waiting it adds before a video, and whether 10
   decoded formulas look right. If fewer than 90% match, the fix becomes its own job.

8. **Section picker mockups** (Sonnet)
   Two versions on a test page so you can pick:
   - **Braces:** a curly brace spans each section's subsections; click it to select the whole section.
   - **Lines:** thin tree lines; click the line to select the whole section.
   Both: bigger and bolder headings for higher levels, page numbers on the right, no bare checkboxes, clicking a
   title selects it and everything under it, full keyboard support. Screenshots of both, deep and shallow books.
   **You pick one.**

9. **Build the section picker you picked** (Codex/Cursor) into the real source screen.

## Phase 3: Better videos

10. **Small style slips don't kill a video, and a smarter tutor** (Codex/Cursor)
    - A video still ships if a few beats have a slightly long sentence or one parenthetical (max 10% of beats).
      Anything worse still fails. Accuracy problems always fail.
    - The tutor first looks at the textbook paragraphs behind the line being narrated.

11. **First scene starts faster** (Codex/Cursor)
    Write the script in two parts: the first 3 beats, then the rest. Scene 1 starts while part two is written.
    **You listen to one** to check the join between the parts isn't noticeable.

12. **Fact-check every beat** (Codex/Cursor, Sonnet reviews the prompt)
    While narration is generated, a quick check compares each beat with its source paragraphs. A beat that isn't
    supported gets fixed, or cut. Also catches the textbook panel highlighting the wrong paragraph.
    Only turned on if it rarely flags correct beats (≤ 5%), measured first.

13. **Better checkpoint questions** (Codex/Cursor)
    Questions are written from what was actually said, and generated answers are checked against the source.
    Textbook exercises still come first.

14. **Grow the test set** (Gemini or Cursor, I record)
    Add STAT 350 and CS 251 sections from your dogfooding. Your books stay on your machine (never in the repo).
    For GitHub's checks, use openly licensed textbook sections (e.g. OpenStax).

15. **When a scene fails, retry, then say so** (Codex/Cursor)
    Retry once in the background. If it still fails, show a 2-second "skipping ahead" card instead of silently
    jumping.

16. **Cleaner scene changes** (Codex/Cursor, Sonnet checks the frames)
    Objects that pile up get faded out automatically, and scenes slide into each other instead of hard cutting.

## Phase 4: More kinds of sources

17. **Slides and Word docs (PPTX/DOCX)** (Codex/Cursor)
    Docling already reads them. Since they have no PDF pages, the textbook panel shows the source text with the
    current paragraph highlighted instead.

18. **Photos and handwritten notes** (Codex/Cursor)
    Claude reads each photo into text and math (Docling is weak at handwriting). Shows how many it will read
    before starting (uses your Pro limit) and labels the result "transcribed, check against your notes".

19. **One video from several sources** (Codex/Cursor, Sonnet reviews)
    E.g. a textbook section plus the matching lecture slides. You pick sections from each; the textbook panel
    switches source as the video goes.

## Phase 5: Release v0.2.0 beta (Mac, Windows, Linux)

20. **No setup for users** (Codex/Cursor)
    The app ships with `uv`. On first launch it sets up Python and the ML packages itself, with a progress screen
    (about 2-3 GB, said up front). The PDF renderer ships inside the app. Linux uses the smaller CPU-only torch.

21. **Windows and Linux fixes** (Codex/Cursor)
    Windows: close the sidecar cleanly with the app, keep saved keys private. Linux: check the graphics work and
    show a fix if not.

22. **Automatic release builds** (Codex/Cursor)
    Tagging a version builds installers for all 3 systems on GitHub and makes a draft release. You publish it.

23. **First-launch screen** (Codex/Cursor, Sonnet polishes)
    Checks Claude Code is installed and logged in and shows steps if not. Offers Ollama only if it really works.

24. **Open-source cleanup** (Claude Sonnet, Cursor)
    LICENSE (MIT), credits for libraries used, new README (install steps per system), remove textbook content from
    the repo (a STAT 350 test file is in it now), check Anthropic's terms for using `claude -p` from an app.

25. **Beta test on all 3 systems.** Mac on your machine; Windows/Linux on a VM or real machine.

26. **Release.** I make the draft; you publish.

## Order

Jobs in the same wave run together (they don't touch the same files). The next wave's jobs start as soon as
the ones they depend on finish.

- Wave 1: 2 (slim CLAUDE.md) alone, since every later job reads it
- Wave 2: 3 CI · 5 long-PDF bug · 8 picker mockups · 10 style slips + tutor
- Wave 3: 4 testing guide · 6 run cool · 11 faster first scene · 16 cleaner scene changes
- 7 formula test, alone (heat)
- Wave 4: 9 build picker · 12 fact-check · 14 grow test set
- Wave 5: 13 checkpoints · 17 slides/docs · 24 open-source cleanup
- Wave 6: 15 failed scenes · 18 photos/notes · 20 no setup for users
- Wave 7: 19 several sources · 21 Windows/Linux fixes
- Wave 8: 22 release builds · 23 first-launch screen
- Then 25 beta test, 26 release

## What I need from you, and when

- **Now:** which PDF fails to load (name, page)? Which STAT 350 pages for the formula test? OK to push main?
- **After the mockups:** braces or lines?
- **After CI is set up:** turn on required checks and add the release signing key to GitHub (I give you commands).
- **After the faster-start job:** listen to one video.
- **Before release:** MIT licence OK? Who tests Windows/Linux? Remove the STAT 350 file from git history too?

## Your dogfood feedback

Write one line per issue in `docs/dogfood.md` (date, what happened, which video/PDF). I sort them between jobs:
- **Urgent** (wrong teaching, crash, can't make or watch a video): fixed next.
- **Annoying every time:** added to the matching phase.
- **Polish:** batched at the end of a phase.

## Unknowns

- The long-PDF bug hasn't been reproduced yet; the causes above come from reading the code.
- Reading PDFs in chunks might break how sections are stitched together. If so, pauses happen between steps instead.
- Not sure Ollama works end to end today.
- Not sure the ML packages install cleanly on Windows/Linux as pinned.

## Later
- Decide how to keep private notes (CLAUDE.md, docs/areas, history, plans, reviews, usage, handoff, dogfood) out of the public repo: private notes repo checked out at `.notes/` and symlinked into worktrees (recommended) vs. ignore-only. Public docs (release.md, testing-and-ci.md, README images) stay tracked. History rewrite is optional.

# Mac release smoke after PRs #40 and #41 (2026-11-16 UTC)

Tested `origin/v1` at `b9daaed` after fetching both merges, in the `monishramj/w7-smoke` worktree on macOS arm64. One local build only:

```sh
TANGENT_HEAVY_SLOTS=1 scripts/heavy.sh taskpolicy -b bunx tauri build --bundles app
```

The release compilation finished in 12m 02s and produced the app below. **The overall command exited 1** after creating the app and updater archive because `TAURI_SIGNING_PRIVATE_KEY` was not supplied. This does not invalidate the ad-hoc app signature; updater signing/distribution was not tested. No rebuild, signing-key access, installation over `/Applications`, or code changes were made.

Built app for the owner:
`/Users/monishramj/Documents/Code/orca/workspaces/tangent/w7-smoke/src-tauri/target/release/bundle/macos/Tangent.app`

## Results

| Check | Result and evidence |
|---|---|
| Ad-hoc signature, no hardened runtime | **PASS.** `codesign -dv --verbose=4` reports arm64, `flags=0x2(adhoc)`, `Signature=adhoc`; `codesign --verify --deep --strict` succeeds. [Signature output](mac-smoke-2026-11/codesign.txt). |
| App launches from target | **PASS.** Launched the built bundle with `open -g -n`; tested PID 26148. The owner's installed Tangent was already running and was left alone. |
| First-run setup completes | **PASS.** Normal `com.tangent.app` data had no runtime before this run. Bundled uv downloaded Python/packages, wrote the completion marker, and handed off directly to the checks screen during this run. The runtime remains installed for the owner. |
| Main window is not blank after setup | **PASS.** Without relaunching, “Before you start” displayed Claude Code installed/signed-in checks; Continue opened the populated library. [Main-window screenshot](mac-smoke-2026-11/02-main-after-setup.png). |
| Saved video playback and audio session | **PASS for playback and WebKit audio evidence; owner must confirm sound by ear.** Played `vmwh7y0mfvjpz4` (“Statistics and Sampling Distributions Introduction”); captions, scenes and the audio-clock seek value advanced. `log show` for the new PID shows `BaseAudioContext::willBeginPlayback ... returning true`, `Starting foreground activity / 'View is playing audio'`, and `WebAudio, Playing`. [Audio-session excerpt](mac-smoke-2026-11/audio-session.txt). |
| Requested video `vmwid8qr99crtt` | **NOT VERIFIED.** It existed at preflight (31 scenes), then disappeared before playback selection. This worker did not delete or edit it. Coordinator approved the older video above as the replacement and instructed this worker not to touch other saved videos. |
| PDF pages render in Textbook | **PASS.** Opened Textbook during saved playback; page 2 visibly rendered text and equations, with pages 1–3 exposed as images in the accessibility tree. No re-sign or PDFium override was needed. Copyrighted page screenshot retained locally only (path below). |
| Add a PPTX source | **OWNER TO VERIFY.** Created a one-slide synthetic `/tmp/tangent-w7-smoke/Smoke.pptx` with the installed runtime and opened Choose PDFs. The native dialog appeared, but Orca could not focus it for path entry (`window_not_focused`, including the approved `--restore-window` attempt). Cancelled the dialog; no source was added. Coordinator instructed finishing without waiting for owner input. |
| Loading ring while generating | **OWNER TO VERIFY.** Generation was not started because the synthetic PPTX import could not be completed; no new LLM/TTS generation was run. Coordinator explicitly deferred this check. |
| SIGTERM leaves no packaged sidecar | **PASS.** Before termination, Python PID 26569 (`runtime/env/bin/python -m tangent_sidecar`) was a child of tested app PID 26148. After `SIGTERM` to that app, both PIDs disappeared within the 10s assertion deadline. [Process evidence](mac-smoke-2026-11/sigterm.txt). The separately running installed app's sidecar was preserved. |
| Worker cleanup | **PASS.** `scripts/reap.sh --kill-orphans` ran; no worker-started app, compiler, or sidecar remains. Built app retained for the owner. |

## Screenshots and local evidence

Captured with `screencapture -x -o -l <windowid>` (setup 6664, main 6685). The initial sandbox capture was denied; the authorized capture succeeded outside that restriction.

- Committed: [setup](mac-smoke-2026-11/01-setup.png), [nonblank main immediately after setup](mac-smoke-2026-11/02-main-after-setup.png).
- Local only, to avoid shipping textbook content: `/tmp/tangent-w7-smoke/03-playback.png`, `/tmp/tangent-w7-smoke/04-textbook.png`.
- Full local logs: `/tmp/tangent-w7-release-build.log`, `/tmp/tangent-w7-smoke/audio.log`, `/tmp/tangent-w7-smoke/reap.log`. Temporary paths may be cleared by macOS.

The first push’s repository hook ran Vitest: 85 test files passed, 1 skipped; 1,071 tests passed, 4 skipped (42.31s). The follow-up evidence-link change is documentation only. Windows/Linux, notarization, updater installation/signatures, audible output, PPTX import, and the generation ring remain unverified by this run.

---

# Mac smoke, v1 tip 736a520 (2026-11-16)

Local release build (ad-hoc), `bunx tauri build --bundles app --config '{"identifier":"com.tangent.smoke"}'` under `taskpolicy -b ... scripts/heavy.sh`, CARGO_BUILD_JOBS=2, separate target dir. The identifier override gave a separate data dir (`com.tangent.smoke`), so the owner's `com.tangent.app` data and `/Applications/Tangent.app` were not touched. Synthetic docs only (1-page PDF, 2-slide PPTX, tiny DOCX, 8x8 white PNG). The app was driven with `orca computer`. Build outputs and the smoke data dir were deleted afterwards.

## Headline finding: the P0 fix (PR #37) is incomplete
`codesign -dv` on the freshly built app: `flags=0x10002(adhoc,runtime)` and no entitlements. **The hardened-runtime flag is still set.** Tauri's `bundle.macOS.hardenedRuntime` defaults to `true`; removing `entitlements` alone does not turn it off. The installed `/Applications/Tangent.app` shows the same flags. Effect, seen in this build: **PDFium fails under library validation**. The Original PDF tab shows "Couldn't load page 1." After re-signing a copy with `codesign --force --deep --sign -` (`flags=0x2(adhoc)`, no runtime), page 1 renders. This is very likely the cause of the silent audio too: WKWebView audio is gated by the same runtime signing. I could not listen or reproduce audio (no video was generated). Fix in this PR: `"hardenedRuntime": false` in `tauri.conf.json`, and `scripts/macos-signing.test.ts` now requires it to be `false`. A rebuild with the fix was not run (one-build limit); the re-sign of the built bundle is the same codesign outcome.

## Checklist
| Check | Result |
|---|---|
| `codesign` shows no `runtime` flag | **FAIL** as built (0x10002 adhoc,runtime); PASS after the config fix (re-sign check, 0x2 adhoc) |
| First-run setup | PASS. New data dir shows "Set up Tangent" (about 2-3 GB, uv env into `runtime/`, finished in about 1 min on a warm uv cache). The main window was **blank** right after setup finished; after a relaunch the "Before you start" checks screen showed. The blank window is a finding (not root-caused; may be the same runtime flag). |
| Sidecar starts | PASS. `python -m tangent_sidecar` from the app data env ran and ingested all three sources. The sidecar kept running after `pkill` (SIGTERM) of the app, which contradicts "orphan-proof" for that signal (not tested with a normal Cmd-Q). |
| PDFium page render | **FAIL with runtime flag**, PASS without it (see above) |
| dylib / library-validation log lines | Not captured: `log stream` and `log show` with a Tangent predicate returned nothing. The failure is inferred from the UI plus the with/without-flag comparison. |
| Checks screen (Claude Code installed, signed in) | PASS |
| PDF ingest (synthetic) | PASS, "1 pages, 1 sections, Ready" |
| PPTX / DOCX ingest | PASS, both Ready on the shared FIFO. The PPTX gives 2 titled sections (Sections and Source tabs). |
| Section picker (braces) | PARTIAL. Only a flat section list appeared for 1-2 section files. A braces layout needs a multi-chapter PDF, not run. |
| Photo transcription confirm dialog | PASS. "Read 1 photo? ... uses your Claude Pro limit" with Read photos / Cancel. Cancelled, no cloud call, no source added. |
| Updater check silent | PASS. No prompt or error in 3 launches (no newer release exists, so the install path is not exercised). |
| Audio plays / AudioContext running / "View is playing audio" log | NOT RUN. Needs a generated video (`claude -p` + TTS), outside the no-model-run budget. **Owner to listen** on a build with the fix. |
| Loading ring during first-scene wait | NOT RUN (same reason). |
| Safari Web Inspector | NOT RUN. |

## Other notes
- `docs/release.md` and `prepare-runtime.py` agree: the build runs `prepare-runtime.py` and bundles uv, PDFium and sidecar sources (`runtime/` in the app), not the stable-venv bridge; the app always goes through first-run setup (`needs_setup(dev=false)`).
- Next for the owner: rebuild with this PR, `codesign -dv` must show `flags=0x2(adhoc)`, then listen to a video and check PDF pages.

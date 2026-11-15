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

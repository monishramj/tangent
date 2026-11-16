# Changelog

All notable changes are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Historical seed: v0.1.2 is tagged; v0.1.1 and v0.1.3 are taken from version-bump commits `96f8d1b` and `5440f32` because their tags do not exist. v0.1.3 was built locally, not published.

## [Unreleased]

## [0.2.0] - 2026-11-16

First public beta for macOS, Windows and Linux.

### Added
- Slides, Word documents and photos of handwritten notes as sources; one video can combine sections from several sources.
- Section picker with a brace hierarchy, always visible in the Sections view.
- Video length estimate per detail level on Make a video.
- Fact-checking of every beat against its source paragraphs; checkpoint questions written from the narration.
- Real progress percent while a video generates, centered loading, and a generating indicator in the seek bar.
- One-time first-launch setup (bundled uv and PDFium), Claude Code check, and automatic release builds.

### Changed
- Faster first scene (two-part script), everyday wording in scripts, plain error messages, frosted play button, cleaner scene transitions.
- PDF ingest runs in chunks at low priority, pauses when the Mac is hot, and shows real progress.

### Fixed
- No sound and unloadable PDF pages in the installed macOS app (hardened runtime).
- Long PDFs failing to load pages; previous scene showing through transitions; player controls waking during textbook auto-follow; failed scenes skipped silently; photo notes re-transcribed on launch; formula decoding errors.

## [0.1.3] - 2026-11-13

### Changed
- Decode formulas only for sections selected for video generation.
- Run PDF ingest at background priority with FAST tables and a formula token cap; show indeterminate progress past the reading estimate.

## [0.1.2] - 2026-11-13

### Added
- Native macOS menu, configurable shortcuts, and Settings update controls.
- Sequential multi-PDF uploads and background preparation; cached PDFs open immediately.
- Numeric grounding checks, targeted script repair, and a generation eval harness.

### Changed
- Cap sidecar threads and priority; stop orphaned sidecar process groups.
- Treat missing previews and untidied titles as warnings.

## [0.1.1] - 2026-11-12

### Added
- Personal macOS releases with signed Tauri updater artifacts and in-app update checks.

[Unreleased]: https://github.com/monishramj/tangent/compare/5440f32...HEAD
[0.1.3]: https://github.com/monishramj/tangent/compare/v0.1.2...5440f32
[0.1.2]: https://github.com/monishramj/tangent/compare/96f8d1b...v0.1.2
[0.1.1]: https://github.com/monishramj/tangent/commit/96f8d1b

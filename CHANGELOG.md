# Changelog

All notable changes are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Historical seed: v0.1.2 is tagged; v0.1.1 and v0.1.3 are taken from version-bump commits `96f8d1b` and `5440f32` because their tags do not exist. v0.1.3 was built locally, not published.

## [Unreleased]

### Added
- Cross-platform fast CI, focused push checks, staged TypeScript checks, and a PR evidence checklist.

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

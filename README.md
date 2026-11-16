<div align="center">

<img src="assets/app-icon.png" width="120" alt="Tangent icon" />

# Tangent

**Turn a textbook section into a narrated, animated explainer you can interrupt with a question.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/monishramj/tangent?include_prereleases&label=release)](https://github.com/monishramj/tangent/releases)
[![CI](https://github.com/monishramj/tangent/actions/workflows/ci.yml/badge.svg)](https://github.com/monishramj/tangent/actions/workflows/ci.yml)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![Status](https://img.shields.io/badge/status-beta-orange)

<img src="docs/readme/ask.png" width="760" alt="Tangent player paused with the Ask panel open" />

</div>

> **Beta.** Tested by hand on macOS only. Windows and Linux installers are built by CI but have not been hand-tested.

## What it does

- Drop in a textbook PDF, slide deck (PPTX), Word file (DOCX), or a photo of notes, then pick a section.
- Tangent writes a script meant to be *heard*, narrates it locally, and animates it on screen. One idea per beat.
- Playback starts as soon as the first scene is ready. The rest streams in while you watch.
- **Pause any time and ask.** The tutor answers about the scene you are on, then you rejoin the video.
- Saved videos replay with no further model calls.

## Features

- **Written for the ear:** short sentences, defined terms, numbers spoken naturally.
- **Animation locked to narration:** visuals anchor to spoken words on one audio clock.
- **Computed visuals and number checks:** arrays, trees and similar are calculated, not drawn from memory, and numbers are checked against the source text.
- **Textbook follow-along:** a side panel shows the source passage for the current beat.
- **Ask threads and checkpoints:** typed questions stay as threads you can return to.
- **Library:** sources first, with folders, saved videos and a background upload queue.
- **Reaction GIFs (optional):** add a GIPHY key in Settings. Without one they show as text cards.
- **In-app updates:** release builds check for updates quietly and ask before installing.

## Download and install

Get the installer for your system from [GitHub Releases](https://github.com/monishramj/tangent/releases).

| OS | File | Note |
| --- | --- | --- |
| macOS (Apple Silicon, Intel) | `.dmg` | Drag **Tangent.app** to `/Applications`. The build is ad-hoc signed, not notarized. If macOS blocks it, launch once, then open **System Settings → Privacy & Security → Open Anyway**. Or run `xattr -dr com.apple.quarantine /Applications/Tangent.app`. |
| Windows (x64) | `-setup.exe` or `.msi` | Unsigned. On the SmartScreen warning choose **More info → Run anyway**. |
| Linux (x64) | `.AppImage`, `.deb`, `.rpm` | `chmod +x` the AppImage, or install the package with your package manager. |

## First launch

1. **One-time setup download, about 2–3 GB.** Tangent installs its Python runtime, document tools and voice model into the app data folder. Retrying or cancelling reuses what already downloaded.
2. **Claude Code must be installed and logged in.** Generation runs through the `claude` CLI on your PATH. Install it from [code.claude.com](https://code.claude.com), run `claude` once to log in, and Tangent's "Before you start" screen will confirm both.
3. **Local models (Ollama) are not supported yet.** The code has a provider interface for them, but no working local provider ships, so the app does not offer it.

Whether an app may run on top of your Claude Code login is a terms question the owner is still checking: see [docs/open-source.md](docs/open-source.md).

## How it works

```
PDF / PPTX / DOCX / photo
  -> parsed into sections (Docling, cached)
  -> script written for speech (Claude Code)
  -> numbers and math made speakable, then checked against the source
  -> local narration (PocketTTS) + word-level alignment
  -> animated scenes from templates, validated
  -> PixiJS player on the audio clock  <->  tutor answers your questions
```

The app is Tauri (Rust) with a React and PixiJS front end, plus a Python sidecar run through `uv`. The animation engine lives in `packages/motion`. Details are in [docs/areas](docs/areas/).

![Player](docs/readme/player.png)

## Privacy

- Narration and document parsing run on your machine.
- Your books stay on your machine. Nothing is uploaded except the text the Claude CLI needs to write scripts and answer questions, under your own Claude Code account.
- No textbook, course PDF or extracted text ships in this repository or in the installers. Bring your own files.
- No API keys are stored. A GIPHY key, if you add one, is kept in an owner-only file in app data.

## Development

Needs [bun](https://bun.sh), [uv](https://docs.astral.sh/uv/), Rust, and a logged-in `claude` CLI.

```sh
bun install
bunx tauri dev          # Vite + app; the sidecar starts from ./sidecar via uv
bun run check           # typecheck + frontend tests
(cd src-tauri && cargo test --locked -j3)
(cd sidecar && uv sync --locked && uv run --no-sync pytest -m "not slow")
```

How changes are proven, and what CI runs: [docs/testing-and-ci.md](docs/testing-and-ci.md). Releases: [docs/release.md](docs/release.md). Design principles and project notes: [CLAUDE.md](CLAUDE.md).

## Roadmap

v1 is in progress: section picker, generation accuracy, more input types, and the first public beta. Planned for v2:

- MP4 export
- Editor for tweaking a video
- Usage meter
- Klipy GIFs

Not planned yet: voice questions, animated tutor branches, web capture.

## Credits

Built on [Docling](https://github.com/docling-project/docling), [PocketTTS](https://github.com/kyutai-labs/pocket-tts), [PDFium](https://pdfium.googlesource.com/pdfium/) (via pdfium-binaries), [Tauri](https://tauri.app), [PixiJS](https://pixijs.com), [React Bits](https://reactbits.dev) components, [Hugeicons](https://hugeicons.com), [KaTeX](https://katex.org) and [Motion](https://motion.dev). Full licences and weight-licence flags: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE) © 2026 Monish Ramesh J

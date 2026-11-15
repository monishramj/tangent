# Library, sources, storage

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.
- Design: [ui-review.md](../ui-review.md)

## Contract

### Storage
- A "video" is a project bundle: IR slice + script + DSL + audio + alignment + cached gifs. Small, diffable, and it replays with zero regeneration. Branches are cached alongside.

- Recent videos lists only saved bundles with scenes and opens them directly (never regenerates); old localStorage recent shortcuts are ignored. Generate again = open the PDF and use Make a video.

- Scrollbars hidden app-wide (`src/index.css`); scrolling still works.

## Log

- 2026-11-15 Section picker mockups (plan step 8): `src/dev/section-picker.html` (A braces, B lines; deep ~535-row and shallow 43-row fixtures; `?v=a|b&fx=shallow&sel=partial`). Shared tree model, click/drag/keyboard, partial state. Proof: `tsc --noEmit` clean; 10 screenshots in `docs/ui-review/section-picker/`. Not verified: real touch, screen reader, Safari/WKWebView rendering. Owner picks A or B, then step 9 builds it into SourceView.

# Library, sources, storage

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.
- Design: [ui-review.md](../ui-review.md)

## Contract

### Storage
- A "video" is a project bundle: IR slice + script + DSL + audio + alignment + cached gifs. Small, diffable, and it replays with zero regeneration. Branches are cached alongside.

- Recent videos lists only saved bundles with scenes and opens them directly (never regenerates); old localStorage recent shortcuts are ignored. Generate again = open the PDF and use Make a video.

- Scrollbars hidden app-wide (`src/index.css`); scrolling still works.

## Log

(none yet; prepend dated entries here)

# Library, sources, storage

Area note. Read with `CLAUDE.md`. Newest Log entries first, ≤ 6 lines each.
- Design: [ui-review.md](../ui-review.md)

## Contract

### Storage
- A "video" is a project bundle: IR slice + script + DSL + audio + alignment + cached gifs. Small, diffable, and it replays with zero regeneration. Branches are cached alongside.

- Recent videos lists only saved bundles with scenes and opens them directly (never regenerates); old localStorage recent shortcuts are ignored. Generate again = open the PDF and use Make a video.

- Scrollbars hidden app-wide (`src/index.css`); scrolling still works.

## Log

- 2026-11-16 Polish C. P1-3: photo sources restored at launch with no cached IR are no longer re-transcribed; the row shows "Transcribe again" (explicit action only). P1-9: un-skipped multi-drop test; root cause was asserting on queue/loadIr state the moment the row rendered, before the enqueue effect ran; now waits on state; 20 runs green. P1-11: no path deletes a bundle except user Delete (`videos.rs delete`); only overwrite path was a restarted stream reusing a bundle id, now refused in `save` (never shrinks or un-completes). Not verified: what removed `vmwid8qr99crtt` (likely the owner's concurrently running app).
- 2026-11-15 Make a video shows "about N min" beside Overview, Standard, Detailed and Complete. Length follows the sections you pick and the detail (`estimateMinutesFor` × 6.92 s/beat). Proof: Home and SourceView tests; Orca screenshot of the picker. Not verified: estimate vs a newly generated video.
- 2026-11-16 Default Sections now reuses the existing SectionPicker in browse mode; Make a video switches the same component into selection, preserving the approved white hairline braces and heading/page layout.
  Browse exposes no selection state and keeps clicks inert; keyboard movement and reduced-motion CSS are retained, alongside multi-source selection.
  Evidence: 48 passing tests and one existing skip across SectionPicker, SourceView, Home, sectionTree and App; TypeScript, static SourceView fixture and refreshed Orca screenshots `source-{browse,select,selected}.png`.
  Not verified: native WKWebView, physical touch or screen reader; no model runs.

- 2026-11-16 One video can take sections from a second source: "Add another source" on the picker, then back; the selected list names each source. Default one-source Make a video is unchanged. Bundles gain optional `source.id` / `source.also` and per-beat `sourceIds`; a bundle without them still replays. Evidence: SourceView and videos tests. Not verified: a real two-file generation.
- 2026-11-16 Step 18: image picker/drop accepts JPG/JPEG/PNG/HEIC/WEBP; modal counts unique new photos and warns of Claude Pro usage before saving/reading. Source screen and its Source text tab label transcription for checking against notes.
  Evidence: Home/dialog/SourceView/importer tests (pre-push full suite: 81 files, 1057 passing, three existing skips), TypeScript. Not verified: native dialog/WKWebView; photo playback reuses TextSource with its transcription label and passage highlighting (40 player tests + 8 App tests passed; App needed a longer timeout under background throttle).

- 2026-11-16 Library upload accepts .pdf/.pptx/.docx (dialog, drop, file input) and still rejects anything else. Slides and Word docs skip the PDF thumbnail. Verified: Home and source-queue tests. Not verified: the native file dialog on macOS.
- 2026-11-16 Section picker on the source screen (plan step 9, round-1 A braces): `SectionPicker` replaces checkboxes while choosing sections. Hairline braces (round-1 B weight, 20% white), white accent, title or brace selects the subtree; `topSelected` still supplies generation ids. Partial, keyboard, reduced motion, 600px. Proof: `src/home` tests + `App.test.tsx` passed; screenshots `source-*` next to `ref-a-*` in `docs/ui-review/section-picker/`. Not verified: touch, screen reader, WKWebView.
- 2026-11-15 Section picker mockups round 2: `section-picker.html` now shows 3 variants of B's thin lines + brace flair (`?v=1` curl tip, `2` midpoint pinch, `3` curl elbows; `fx=shallow`, `sel=partial`). No checkboxes, white accent, trunk/title click selects the section, bolder headings per level. Proof: `tsc --noEmit` clean; 12 screenshots `c1-`..`c3-` (deep, shallow, keyboard, selected) in `docs/ui-review/section-picker/`. Not verified: touch, screen reader, WKWebView rendering.
- 2026-11-16 Section picker round 2 redo: `src/dev/section-picker.*` now two finished variants, A Tree (hairline tree, curled last elbow, brace nub) and B Brace (no row ticks; hooks at group ends + nub), white accent, no checkboxes (state dot, tint, white trunks), bold heading scale, pages right. Fixed in review: ticks overlapping selected-row tint, nub crowding elbows (now groups of 3+), brace ticks leaking via shared class. Proof: `tsc --noEmit` clean; 10 screenshots in `docs/ui-review/section-picker/` (tree-/brace- x deep, shallow, partial, keyboard, width600; old a-/b-/c* removed). Not verified: real 2x display, WKWebView, screen reader.
- 2026-11-15 Section picker mockups (plan step 8): `src/dev/section-picker.html` (A braces, B lines; deep ~535-row and shallow 43-row fixtures; `?v=a|b&fx=shallow&sel=partial`). Shared tree model, click/drag/keyboard, partial state. Proof: `tsc --noEmit` clean; 10 screenshots in `docs/ui-review/section-picker/`. Not verified: real touch, screen reader, Safari/WKWebView rendering. Owner picks A or B, then step 9 builds it into SourceView.

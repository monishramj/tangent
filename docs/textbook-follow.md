# Textbook follow-along

A **Textbook** tab in the player side panel (next to Ask / Transcript / Checks) shows the source PDF pages and
highlights the passage the current beat rewrites, so a viewer of a thorough video can read along.

Decided with Monish: passage-level highlights (paragraph / block); auto-follow with free scroll and a
"Back to current" button; old bundles show the section's pages with no highlight; the beat → passage mapping is
saved in the bundle (replay never regenerates).

## Data flow

```
Docling item ──▶ IR section.passages[{id:"p12", markdown, boxes:[{page, bbox}]}]   (sidecar, at ingest)
                         │
App: sectionsPassages(ir, ids) ──▶ startSession ──▶ streamVideo ──▶ generateScript
                                                       │   prompt source = "[p12] markdown" blocks
                                                       │   beat.passages = known ids only (unknown dropped)
                                                       ▼
                       scene event .passages = per scene beat: boxesFor(beat.passages, passages)
                                                       │
                     recordStream ──▶ StoredScene.passages ──▶ replayStream (same event shape)
                                                       │
PlayerScreen scenes ──▶ <Textbook scenes time source> ──▶ boxesAt(scenes, t) ──▶ overlay + auto-follow
```

The shared contract is `src/follow/types.ts` (types only). `bbox` is `[x0, y0, x1, y1]` as **fractions of the page,
top-left origin**: the sidecar normalises once with the Docling page size, so the overlay is resolution- and
zoom-independent and the UI never needs PDF points.

## Decisions and push-back

- **Pages are rendered by the sidecar, not the blob `<iframe>` viewer.** The source view's blob iframe hands the
  PDF to WebKit's built-in viewer: we cannot read its scroll position, zoom or page geometry, so an overlay cannot be
  positioned on it. New sidecar call `pdf_page {path, page, width}` renders one page to a PNG data URL with
  pypdfium2 (already used for `pdf_info` thumbnails) and returns the page size in points. No pdf.js: that would be a
  new dependency plus a worker, which the strict CSP (`script-src 'self'`) would need loosening for. `img-src`
  already allows `data:`. The Original PDF tab in `SourceView` stays as is.
- **Passage ids are global** (`p1`, `p2`, … in document order across the whole IR, stable across re-ingests of
  the same PDF), so joined multi-section videos (`id = a+b`) need no namespacing.
- **Script source when passages exist:** the passages joined in order, each prefixed `[pN] `. The sidecar keeps
  passages *complete* (their markdown joined by blank lines equals the section's own markdown at ingest), so no text is
  lost. `checkScript` already rejects square brackets in `say`, so a leaked id gets caught and retried.
- **Unknown ids never fail a beat.** They are dropped (also duplicates and non-strings); a malformed `passages`
  field becomes `[]`. Beats without known passages just have no highlight.
- **Old data:** an IR cached before this change has no `passages` → the script prompt is unchanged, scenes carry no
  mapping, the tab shows the section pages unhighlighted. Cached IRs are **not** re-ingested automatically (Docling
  takes minutes per book). *Open question for Monish:* add a "Re-read PDF" action later if he wants highlights on
  already-ingested books.
- **Known gap (ponytail):** `postprocess._merge_content` adds a `**title**` line for demoted headings that has no
  passage; that line is not in the tagged script source. Content passages under it are kept.

## Work package A: data / backend (Sonnet)

Owns these files only:

| File | Change |
|---|---|
| `sidecar/tangent_sidecar/ingest.py` | `document_to_ir`: every chunk appended to `current["markdown"]` also appends `{"id": f"p{n}", "markdown": chunk, "boxes": [...]}` to `current["passages"]` (new key on every section node, `[]` default). Boxes: one per `item.prov` with a known page: `prov.bbox.to_top_left_origin(page.size.height)`, divided by page width/height, clamped to 0..1, rounded to 4 decimals. Items with no prov get `boxes: []`. New `pdf_page(params)`: `path` str, `page` int 1..page count, `width` int 1..4000 px; returns `{url: "data:image/png;base64,…", width, height}` (page size in points). |
| `sidecar/tangent_sidecar/postprocess.py` | Passages follow content: `_clean`, `_fix_ligatures` and `DUP_MATH` apply to each passage's markdown exactly as to the section markdown; `_merge_content` appends the merged node's passages to the host; `_figures` drops passages of dropped figures and, on caption reattach, rewrites the figure passage's markdown and folds the caption passage (and its boxes) into it. IRs without `passages` must still postprocess. |
| `sidecar/tangent_sidecar/__init__.py` | Register `pdf_page` in `HANDLERS`. |
| `src/home/api.ts` | `Passage` re-export from `@/follow/types`; `sectionsPassages(ir, ids): Passage[]` (section + descendants per id, given order, dedupe by id, drop malformed entries: non-string id/markdown or non-array boxes); `sectionPages(ir, videoSectionId): number[]` (split on `+`, union of anchor pages, sorted unique; unknown → `[]`); `pdfPage(path, page, width)` over `sidecar_call` `pdf_page` (matches `RenderPage`). |
| `src/gen/script.ts` | `Beat.passages?: string[]`. `generateScript({…, passages?: {id, markdown}[]})`: when non-empty, the source block is the tagged passages (still through `stripWatermarks`), the prompt asks for `"passages": string[]` per beat (ids of the blocks the beat rewrites, usually 1–2, never in `say`), and after parsing each beat's `passages` is normalised to known ids, deduped, `[]` when missing/malformed. Malformed `passages` must not fail zod parsing. Without passages: prompt unchanged and `passages` stripped from beats. Retry prompt keeps the tagged source. `targetBeats` still uses `sectionMarkdown`. |
| `src/pipeline/streamVideo.ts` | Option `passages?: Passage[]` → `generateScript`. Scene event gains `passages?: BeatBoxes`, set only when `passages` is non-empty: `groupBeats.map(b => boxesFor(b.passages ?? [], passages))` (aligned with `scene.beats`, same as `spoken[i]`). Absent otherwise (no `passages: undefined` key). |
| `src/pipeline/session.ts` | `irSection.passages?: Passage[]` passed through to `streamVideo`. |
| `src/storage/videos.ts` | `StoredScene.passages?: BeatBoxes`; `recordStream` copies it when present; `replayStream` emits it when present (key absent otherwise). Rust `save_video_bundle` stores JSON as-is: no Rust change. |
| `src/follow/passages.ts` (new) | `boxesFor(ids, passages): PassageBox[]` (given order, skip unknown/duplicates); `boxesAt(scenes: FollowScene[], t, gapSec = DEFAULT_GAP_SEC): FollowAt` (same clock as `narrationLines`: scenes end to end with the queue's gap; the last `say` event started by `t`; `beat` counts spoken beats globally; boxes from `scene.passages?.[event.beat] ?? []`); `hasPassages(scenes)` (some scene has a non-empty box list). |

Tests to make pass: `sidecar/tests/test_passages.py`, `src/follow/passages.test.ts`, the
`generateScript passages` block in `src/gen/script.test.ts`, the `sectionsPassages / sectionPages / pdfPage` block in
`src/home/api.test.ts`, the last test in `src/storage/videos.test.ts` and in `src/pipeline/streamVideo.test.ts`.

## Work package B: UI (Codex)

Owns these files only:

| File | Change |
|---|---|
| `src/follow/follow.ts` (new) | Pure follow state: `initialFollow = {following: true, beat: -1, seq: 0}`; `followReducer(state, action)` with actions `{type:"beat", beat, hasBoxes}` (new beat while following with boxes → `seq+1`; same beat → same object), `{type:"userScroll"}` (→ not following; already off → same object), `{type:"backToCurrent"}` (→ following, `seq+1`). `seq` changing means "scroll to the current highlight now". `showBackButton(state, hasBoxes)`. Geometry: `overlayRect(bbox, {width, height}, padPx = 4)` → px rect, padded and clamped to the page; `scrollTarget(pageTop, pageHeightPx, bbox, viewportH)` → scrollTop that puts the box top a third of the way down, never < 0. |
| `src/player/Textbook.tsx` (new) | `export default function Textbook({source, scenes, time, renderPage = pdfPage}: {source: TextbookSource; scenes: FollowScene[]; time: number; renderPage?: RenderPage})`. Pages shown: contiguous range over `source.pages` ∪ every box page in `scenes`; none → page 1. Scroller `aria-label="Textbook pages"`; each page a wrapper with `data-page={n}` holding `<img alt="Page n">` rendered lazily (IntersectionObserver; placeholder sized from the first page's aspect) at `round(clientWidth × devicePixelRatio)` px, max 4000. Highlights: `data-testid="passage-highlight"` boxes absolutely positioned by `overlayRect` from the page wrapper's measured size (ResizeObserver), so they stay right under resize; style from the black × Code Report pack (white ~12% fill, white/50 hairline, small radius, short opacity transition, no hue). `boxesAt(scenes, time)` drives `followReducer`; on `seq` change scroll the scroller to `scrollTarget` of the first box (smooth). User scroll = `wheel`, `touchmove`, `pointerdown` on the scroller, scroll keys; never the `scroll` event (programmatic scrolls fire it). "Back to current" button (`showBackButton`) floats at the bottom of the panel. Old bundles (`!hasPassages(scenes)`): no highlight, no follow, no button; start at the first section page. |
| `src/player/SidePanel.tsx` | `Tab` adds `"textbook"`; new prop `textbook?: ReactNode`; the tab shows only when given (same pattern as `checks`), label "Textbook". |
| `src/player/PlayerScreen.tsx` | Prop `textbook?: TextbookSource`; header icon button "Textbook" (`aria-pressed`, like Transcript) when given; passes `<Textbook source scenes time />` to `SidePanel`. `scenes` already carries `passages` from the stream. |
| `src/App.tsx` | Generate: `startSession({irSection: {…, passages: sectionsPassages(ir, sectionIds)}})`, `textbook={{pdfPath: meta.pdfPath, pages: sectionPages(ir, sectionIds.join("+"))}}`. Watch: read the cached IR only (`irCache(store).get(sourceFor(pdfPath).id)`, **never** `loadIr`, which would start a Docling ingest) → `sectionPages(ir, video.source.sectionId)`, `[]` if missing; pass `textbook`. |

Tests to make pass: `src/follow/follow.test.ts`, `src/player/Textbook.test.tsx`, the last test in
`src/player/SidePanel.test.tsx`. Add App/PlayerScreen assertions only if cheap.

## Integration

- The packages touch disjoint files. B's vitest suites do not import A's code at runtime (tests inject
  `renderPage`), but `tsc` passes only once both are merged (B uses A's `PipelineEvent.passages`, `sectionsPassages`,
  `sectionPages`, `pdfPage`, `boxesAt`). Merge A first, then B.
- `CLAUDE.md`: each package adds its own bullet under *Current state*; resolve the trivial merge in CLAUDE.md.
- Dogfood after merge: re-ingest one CS 251 chapter (new IR with passages), make a Detailed video, open Textbook.
  Check that highlights land on the right paragraph and that follow / Back to current feel right.

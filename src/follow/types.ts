// Textbook follow-along: the contract between the data package (sidecar, script, bundle) and the UI package
// (Textbook tab). Design: docs/textbook-follow.md. Types only; no runtime code lives here.
import type { Timeline } from "@motion/dsl/compile";

/** A rectangle on one PDF page as fractions of that page, origin top-left: [x0, y0, x1, y1], each 0..1.
 *  Fractions (not points) so the overlay is right at any render scale and for any page size. */
export type BBox = [number, number, number, number];
export type PassageBox = { page: number; bbox: BBox };

/** One source block (paragraph, list item, formula, table, figure) of an IR section, as the sidecar stores it in
 *  `section.passages`. `id` is unique across the whole IR ("p1", "p2", … in document order). A block that spans a
 *  page break has one box per page. */
export type Passage = { id: string; markdown: string; boxes: PassageBox[] };

/** Per scene: one entry per `scene.beats` index, the boxes that beat rewrites ([] = none known).
 *  Absent on scenes from old bundles and from IRs without passages. */
export type BeatBoxes = PassageBox[][];

/** What `boxesAt` needs from each scene, in play order. */
export type FollowScene = { scene: { beats: unknown[] }; timeline: Timeline; passages?: BeatBoxes };

/** The beat playing at time t: `beat` is a global index over all spoken beats (-1 before the first one). */
export type FollowAt = { beat: number; boxes: PassageBox[] };

/** Passed from App to PlayerScreen. `pages` are the video's section pages from the cached IR (sorted, unique,
 *  1-based; [] when the IR is not cached). The tab shows these pages (plus any page a box is on). */
export type TextbookSource = { pdfPath: string; pages: number[] };

/** One rendered page from the Rust `pdf_page` command. `width`/`height` are the page size in PDF points. */
export type PageImage = { url: string; width: number; height: number };
export type RenderPage = (pdfPath: string, page: number, widthPx: number) => Promise<PageImage>;

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { traced } from "../devlog";

export type Anchor = { page: number };
export type SectionIR = { id: string; title: string; level: number; anchors: Anchor[]; children: SectionIR[]; [k: string]: unknown };
/** Undecoded formula: its markdown spot holds the token ⟨formula n⟩ until enrichFormulas decodes it for a video. */
export type PendingFormula = { page: number; bbox: number[]; orig: string };
/** transcribed: a scanned/handwritten PDF read page by page with Claude vision (one section per page). */
export type IR = { sections: SectionIR[]; outline_version?: number; formulas?: Record<string, PendingFormula>; transcribed?: boolean };
export type SectionRef = { id: string; title: string; level: number; anchors: Anchor[] };

const call = <T>(method: string, params: Record<string, unknown>, signal?: AbortSignal) => traced<T>("sidecar_call", method, { method, params }, signal);

/** Pass assetsDir (see figuresDir) so figure PNGs land where the webview's asset protocol can load them. */
export const ingestPdf = (path: string, assetsDir?: string) => call<IR>("ingest_pdf", assetsDir ? { path, assets_dir: assetsDir } : { path });
export const pdfInfo = (path: string) => call<{ pages: number }>("pdf_info", { path });
/** scanned: no text layer on the first pages (scan or handwriting). */
export const pdfScan = (path: string) => call<{ pages: number; scanned: boolean }>("pdf_info", { path, scan: true });
export const figuresDir = async (sourceId: string) => join(await appDataDir(), "figures", sourceId);
export const enrichFormulas = (ir: IR, path: string, ids: string[], pages?: [number, number], signal?: AbortSignal) => call<IR>("enrich_formulas", { ir, path, ids, ...(pages ? { pages } : {}) }, signal);
export const repairSections =(ir: IR, path: string) => call<IR>("repair_sections", { ir, path });
export const listSections = (ir: IR) => call<SectionRef[]>("list_sections", { ir });

export const sectionText = (ir: IR, id: string, signal?: AbortSignal) => call<string>("section_text", { ir, id }, signal);

export type SectionFigure = { id: string; caption: string; image_path: string };
/** Figures extracted for a section and its descendants (same scope as sectionText). */
export function sectionFigures(ir: IR, id: string): SectionFigure[] {
  const find = (nodes: SectionIR[]): SectionIR | undefined => {
    for (const n of nodes) { if (n.id === id) return n; const hit = find(n.children); if (hit) return hit; }
  };
  const own = (n: SectionIR): SectionFigure[] => [
    ...(Array.isArray(n.figures) ? (n.figures as SectionFigure[]).filter(f => f?.id && f.image_path) : []),
    ...n.children.flatMap(own),
  ];
  const node = find(ir.sections);
  return node ? own(node) : [];
}

export type SectionExercise = { id: string; markdown: string; anchors: Anchor[] };
/** End-of-section exercises for a section and its descendants (same scope as sectionFigures). */
export function sectionExercises(ir: IR, id: string): SectionExercise[] {
  const find = (nodes: SectionIR[]): SectionIR | undefined => {
    for (const n of nodes) { if (n.id === id) return n; const hit = find(n.children); if (hit) return hit; }
  };
  const own = (n: SectionIR): SectionExercise[] => [
    ...(Array.isArray(n.exercises) ? (n.exercises as SectionExercise[]).filter(e => e?.id && e.markdown).map(e => ({ id: e.id, markdown: e.markdown, anchors: Array.isArray(e.anchors) ? e.anchors : [] })) : []),
    ...n.children.flatMap(own),
  ];
  const node = find(ir.sections);
  return node ? own(node) : [];
}

/** Picked ids in document order, minus any whose ancestor is also picked (sectionText covers descendants). */
export function topSelected(flat: SectionRef[], picked: Set<string>): string[] {
  const out: string[] = [];
  let covered = Infinity;
  for (const x of flat) {
    if (x.level > covered) continue;
    covered = Infinity;
    if (picked.has(x.id)) { out.push(x.id); covered = x.level; }
  }
  return out;
}
export const multiTitle = (titles: string[]) => titles.length <= 2 ? titles.join(" + ") : `${titles[0]} +${titles.length - 1} more`;

const findNode = (nodes: SectionIR[], id: string): SectionIR | undefined => {
  for (const n of nodes) { if (n.id === id) return n; const hit = findNode(n.children, id); if (hit) return hit; }
};
/** Section markdown plus descendants, already stored on the IR. Same scope as section_text, no sidecar call. */
export function cachedSectionText(ir: IR, id: string): string {
  const texts = (n: SectionIR): string[] => [
    typeof n.markdown === "string" ? n.markdown : "",
    ...(Array.isArray(n.children) ? n.children.flatMap(texts) : []),
  ];
  const node = findNode(ir.sections, id);
  return node ? texts(node).filter(t => t.trim()).join("\n\n") : "";
}
/** One id: plain sectionText. Several: each preceded by its "## title", in the given order. */
export async function sectionsText(ir: IR, ids: string[], signal?: AbortSignal): Promise<string> {
  if (ids.length === 1) return sectionText(ir, ids[0], signal);
  const parts = await Promise.all(ids.map(async id => `## ${findNode(ir.sections, id)?.title ?? id}\n\n${await sectionText(ir, id, signal)}`));
  return parts.join("\n\n");
}
const uniq = <T extends { id: string }>(xs: T[]) => xs.filter((x, i) => xs.findIndex(y => y.id === x.id) === i);
export const sectionsFigures = (ir: IR, ids: string[]) => uniq(ids.flatMap(id => sectionFigures(ir, id)));
export const sectionsExercises = (ir: IR, ids: string[]) => uniq(ids.flatMap(id => sectionExercises(ir, id)));

export const pdfPreview = (path: string) => call<{ pages: number; thumbnailUrl?: string }>("pdf_info", { path, preview: true });

// Textbook follow-along (docs/textbook-follow.md).
export type { Passage } from "@/follow/types";
import type { Passage, PageImage } from "@/follow/types";

const findSection = (nodes: SectionIR[], id: string): SectionIR | undefined => {
  for (const n of nodes) { if (n.id === id) return n; const hit = findSection(n.children, id); if (hit) return hit; }
};
const validPassage = (p: unknown): p is Passage => {
  const q = p as Passage | null;
  return !!q && typeof q.id === "string" && typeof q.markdown === "string" && Array.isArray(q.boxes);
};

/** Passages of each section and its descendants, in the given order, deduped by id. Old IRs have none. */
export function sectionsPassages(ir: IR, ids: string[]): Passage[] {
  const own = (n: SectionIR): unknown[] => [...(Array.isArray(n.passages) ? n.passages : []), ...n.children.flatMap(own)];
  const seen = new Set<string>();
  return ids.flatMap(id => { const n = findSection(ir.sections, id); return n ? own(n) : []; })
    .filter(validPassage).filter(p => !seen.has(p.id) && seen.add(p.id));
}

/** Sorted unique 1-based pages of a video section id (ids joined with "+"). */
export function sectionPages(ir: IR, videoSectionId: string): number[] {
  const pages = new Set<number>();
  const add = (n: SectionIR) => { n.anchors.forEach(a => pages.add(a.page)); n.children.forEach(add); };
  for (const id of videoSectionId.split("+")) { const n = findSection(ir.sections, id); if (n) add(n); }
  return [...pages].sort((a, b) => a - b);
}

let pageQueue: Promise<unknown> = Promise.resolve();
export const pdfPage = (path: string, page: number, width: number, signal?: AbortSignal): Promise<PageImage> => {
  const request = pageQueue.catch(() => {}).then(async () => {
    signal?.throwIfAborted();
    // shortcut: the one in-flight native render finishes; add native cancellation if single-page latency becomes a problem.
    const result = await invoke<{ path: string; width: number; height: number }>("pdf_page", { path, page, width });
    signal?.throwIfAborted();
    return { url: convertFileSrc(result.path), width: result.width, height: result.height };
  });
  pageQueue = request;
  return request;
};

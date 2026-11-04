import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";

export type Anchor = { page: number };
export type SectionIR = { id: string; title: string; level: number; anchors: Anchor[]; children: SectionIR[]; [k: string]: unknown };
export type IR = { sections: SectionIR[] };
export type SectionRef = { id: string; title: string; level: number; anchors: Anchor[] };

const call = <T>(method: string, params: Record<string, unknown>) => invoke<T>("sidecar_call", { method, params });

/** Pass assetsDir (see figuresDir) so figure PNGs land where the webview's asset protocol can load them. */
export const ingestPdf = (path: string, assetsDir?: string) => call<IR>("ingest_pdf", assetsDir ? { path, assets_dir: assetsDir } : { path });
export const pdfInfo = (path: string) => call<{ pages: number }>("pdf_info", { path });
export const figuresDir = async (sourceId: string) => join(await appDataDir(), "figures", sourceId);
export const listSections = (ir: IR) => call<SectionRef[]>("list_sections", { ir });

export const sectionText = (ir: IR, id: string) => call<string>("section_text", { ir, id });

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

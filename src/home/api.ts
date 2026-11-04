import { invoke } from "@tauri-apps/api/core";

export type Anchor = { page: number };
export type SectionIR = { id: string; title: string; level: number; anchors: Anchor[]; children: SectionIR[]; [k: string]: unknown };
export type IR = { sections: SectionIR[] };
export type SectionRef = { id: string; title: string; level: number; anchors: Anchor[] };

const call = <T>(method: string, params: Record<string, unknown>) => invoke<T>("sidecar_call", { method, params });

export const ingestPdf = (path: string) => call<IR>("ingest_pdf", { path });
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

import { invoke } from "@tauri-apps/api/core";

export type Anchor = { page: number };
export type SectionIR = { id: string; title: string; level: number; anchors: Anchor[]; children: SectionIR[]; [k: string]: unknown };
export type IR = { sections: SectionIR[] };
export type SectionRef = { id: string; title: string; level: number; anchors: Anchor[] };

const call = <T>(method: string, params: Record<string, unknown>) => invoke<T>("sidecar_call", { method, params });

export const ingestPdf = (path: string) => call<IR>("ingest_pdf", { path });
export const listSections = (ir: IR) => call<SectionRef[]>("list_sections", { ir });

export const sectionText = (ir: IR, id: string) => call<string>("section_text", { ir, id });

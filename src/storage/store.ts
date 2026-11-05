// Small JSON documents in the app data dir: cached IRs, Q&A threads, checkpoint results.
// Rust side: store_read / store_write / store_delete over <appData>/store/<name>.json.
import { invoke } from "@tauri-apps/api/core";
import type { IR } from "../home/api";

/** A PDF the user opened. `id` is derived from the path, so the same file reuses its cached IR and figures. */
export type Source = { id: string; name: string; pdfPath: string };

export type Message = { role: "user" | "tutor"; text: string; at: number };
/** One question thread, pinned to a moment in a video. */
export type Thread = { id: string; videoId: string; t: number; sceneId?: string; title: string; messages: Message[] };

export type JsonStore = {
  read<T>(name: string): Promise<T | null>;
  write(name: string, value: unknown): Promise<void>;
  remove(name: string): Promise<void>;
};

export const tauriJsonStore: JsonStore = {
  read: <T>(name: string) => invoke<T | null>("store_read", { name }),
  write: (name, value) => invoke("store_write", { name, value }),
  remove: name => invoke("store_delete", { name }),
};

export function memoryJsonStore(seed: Record<string, unknown> = {}): JsonStore & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    async read<T>(name: string) { return data.has(name) ? structuredClone(data.get(name)) as T : null; },
    async write(name, value) { data.set(name, structuredClone(value)); },
    async remove(name) { data.delete(name); },
  };
}

export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Stable, filename-safe id for a PDF path (FNV-1a), so a re-opened file hits its IR cache. */
export function sourceFor(pdfPath: string): Source {
  let h = 2166136261;
  for (let i = 0; i < pdfPath.length; i++) h = Math.imul(h ^ pdfPath.charCodeAt(i), 16777619) >>> 0;
  return { id: `src${h.toString(36)}`, name: pdfPath.split(/[\\/]/).pop() ?? pdfPath, pdfPath };
}

/** Ingest is slow (Docling); an IR is parsed once per source and reused. */
export const irCache = (s: JsonStore) => ({
  get: (sourceId: string) => s.read<IR>(`ir-${sourceId}`),
  set: (sourceId: string, ir: IR) => s.write(`ir-${sourceId}`, ir),
  remove: (sourceId: string) => s.remove(`ir-${sourceId}`),
});

export const threads = (s: JsonStore) => ({
  list: async (videoId: string) => (await s.read<Thread[]>(`threads-${videoId}`)) ?? [],
  save: (videoId: string, all: Thread[]) => s.write(`threads-${videoId}`, all),
});

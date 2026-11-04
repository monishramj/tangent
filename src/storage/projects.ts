// Projects (one per class), cached IRs and Q&A threads, all as small JSON documents in the app data dir.
// Rust side: store_read / store_write / store_delete over <appData>/store/<name>.json.
import { invoke } from "@tauri-apps/api/core";
import type { IR } from "../home/api";

export type Source = { id: string; name: string; pdfPath: string; addedAt: number };
export type Note = { id: string; text: string; createdAt: number; from?: { videoId: string; videoTitle: string; t: number } };
export type Project = { id: string; name: string; emoji: string; createdAt: number; sources: Source[]; notes: Note[] };

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

/** All app persistence goes through these helpers; components take a JsonStore so tests use memoryJsonStore. */
export const projects = (s: JsonStore) => ({
  list: async () => (await s.read<Project[]>("projects")) ?? [],
  async save(p: Project) {
    const all = await this.list();
    const i = all.findIndex(x => x.id === p.id);
    if (i >= 0) all[i] = p; else all.unshift(p);
    await s.write("projects", all);
  },
  async remove(id: string) { await s.write("projects", (await this.list()).filter(p => p.id !== id)); },
});

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

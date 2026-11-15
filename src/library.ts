// Parse a PDF once (cached IR, figures in app data), with honest progress.
import { enrichFormulas, figuresDir, ingestPdf, repairSections, type IR } from "./home/api";
import { listen } from "@tauri-apps/api/event";
import { irCache, sourceFor, tauriJsonStore, type JsonStore } from "./storage/store";

/** fraction is undefined until the sidecar reports its actual page count. */
export type LoadProgress = { fraction?: number; label: string };

export const cachedIr = (pdfPath: string, store: JsonStore = tauriJsonStore) => irCache(store).get(sourceFor(pdfPath).id).catch(() => null);

export async function hasCachedIr(pdfPath: string, store: JsonStore = tauriJsonStore): Promise<boolean> {
  return Boolean(await irCache(store).get(sourceFor(pdfPath).id).catch(() => null));
}

/** Cached IR, else Docling ingest with completed-page progress. */
export async function loadIr(pdfPath: string, onProgress?: (p: LoadProgress) => void, store: JsonStore = tauriJsonStore): Promise<IR> {
  const source = sourceFor(pdfPath);
  const cached = await irCache(store).get(source.id).catch(() => null);
  if (cached) {
    if (cached.outline_version === 1) return cached;
    // A running dev sidecar may still use the old handlers; retry the upgrade on next open.
    const repaired = await repairSections(cached, pdfPath).catch(() => cached);
    if (repaired !== cached) await irCache(store).set(source.id, repaired);
    return repaired;
  }
  onProgress?.({ label: "Reading PDF" });
  const unlisten = await listen<{ path: string; progress: { completed: number; total: number; paused: boolean } }>("ingest-progress", ({ payload }) => {
    if (payload.path !== pdfPath) return;
    const { completed, total, paused } = payload.progress;
    onProgress?.({ fraction: total ? completed / total : undefined,
      label: paused ? `Paused to cool down · ${completed} of ${total} pages` : completed === total ? "Organizing sections" : `Read ${completed} of ${total} pages` });
  });
  try {
    const dir = await figuresDir(source.id).catch(() => undefined);
    const ir = await ingestPdf(pdfPath, dir);
    onProgress?.({ fraction: 1, label: "Done" });
    await irCache(store).set(source.id, ir);
    return ir;
  } finally { unlisten(); }
}

const FORMULA_TOKEN = /⟨formula (\d+)⟩/g;

/** Undecoded formulas inside the given sections (and their subsections): what enrichFormulas will decode. */
export function pendingIn(ir: IR, ids: string[]): number {
  const want = new Set(ids), found = new Set<string>();
  const walk = (nodes: IR["sections"], inside: boolean) => nodes.forEach(n => {
    const here = inside || want.has(n.id);
    if (here) for (const m of JSON.stringify({ ...n, children: [] }).matchAll(FORMULA_TOKEN)) if (ir.formulas?.[m[1]]) found.add(m[1]);
    walk(n.children, here);
  });
  walk(ir.sections, false);
  return found.size;
}

/** Formulas are decoded only for the sections a video is made from (the formula model is ingest's heat source).
 * Starts from the cached IR (it holds earlier videos' decodes), saves the result back, and on failure falls back
 * to the PDF text layer so a token never reaches the script. */
export async function withFormulas(pdfPath: string, ir: IR, ids: string[], store: JsonStore = tauriJsonStore, onDecode?: (count: number) => void): Promise<IR> {
  const id = sourceFor(pdfPath).id;
  const latest = (await irCache(store).get(id).catch(() => null)) ?? ir;
  const pending = latest.formulas ?? {};
  if (!Object.keys(pending).length) return latest;
  onDecode?.(pendingIn(latest, ids));
  try {
    const done = await enrichFormulas(latest, pdfPath, ids);
    await irCache(store).set(id, done).catch(() => {});
    return done;
  } catch {
    const fill = (_: string, n: string) => pending[n]?.orig ? JSON.stringify(`$$${pending[n].orig}$$`).slice(1, -1) : "";
    return { ...latest, sections: JSON.parse(JSON.stringify(latest.sections).replace(FORMULA_TOKEN, fill)) };
  }
}

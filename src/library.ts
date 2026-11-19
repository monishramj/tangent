// Parse a source once (cached IR, figures in app data), with honest progress.
import { enrichFormulas, figuresDir, ingestPdf, pdfInfo, repairSections, type IR } from "./home/api";
import { transcribePhoto, transcribePdf, isPhotoSource } from "./gen/transcribe";
import { listen } from "@tauri-apps/api/event";
import { isOfficeSource } from "./storage/library";
import { irCache, sourceFor, tauriJsonStore, type JsonStore } from "./storage/store";

/** fraction is undefined until the sidecar reports its actual page count. */
export type LoadProgress = { fraction?: number; label: string };

export const cachedIr = (pdfPath: string, store: JsonStore = tauriJsonStore) => irCache(store).get(sourceFor(pdfPath).id).catch(() => null);

export async function hasCachedIr(pdfPath: string, store: JsonStore = tauriJsonStore): Promise<boolean> {
  return Boolean(await irCache(store).get(sourceFor(pdfPath).id).catch(() => null));
}

/** The user chose "Read with Claude" for this scanned PDF: loadIr transcribes pages instead of running Docling. */
const transcribeKey = (pdfPath: string) => `transcribe-${sourceFor(pdfPath).id}`;
const wantsTranscription = async (pdfPath: string, store: JsonStore) => !!(await store.read<boolean>(transcribeKey(pdfPath)).catch(() => null));
export async function chooseTranscription(pdfPath: string, store: JsonStore = tauriJsonStore) {
  await store.write(transcribeKey(pdfPath), true);
  await irCache(store).remove(sourceFor(pdfPath).id);
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
  if (isPhotoSource(pdfPath)) {
    onProgress?.({ label: "Transcribing photo" });
    const ir = await transcribePhoto(pdfPath);
    await irCache(store).set(source.id, ir);
    return ir;
  }
  if (await wantsTranscription(pdfPath, store)) {
    const { pages } = await pdfInfo(pdfPath);
    const ir = await transcribePdf(pdfPath, pages, (done, total) => onProgress?.({ fraction: done / total, label: `Reading handwriting · page ${Math.min(done + 1, total)} of ${total}` }));
    await irCache(store).set(source.id, ir);
    return ir;
  }
  onProgress?.({ label: isOfficeSource(pdfPath) ? "Reading document" : "Reading PDF" });
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
  return pendingIds(ir, ids).size;
}

function pendingIds(ir: IR, ids: string[]): Set<string> {
  const want = new Set(ids), found = new Set<string>();
  const walk = (nodes: IR["sections"], inside: boolean) => nodes.forEach(n => {
    const here = inside || want.has(n.id);
    if (here) for (const m of JSON.stringify({ ...n, children: [] }).matchAll(FORMULA_TOKEN)) if (ir.formulas?.[m[1]]) found.add(m[1]);
    walk(n.children, here);
  });
  walk(ir.sections, false);
  return found;
}

/** Page windows of at most `span` pages covering the given formulas' pages. */
export function formulaBatches(ir: IR, numbers: Iterable<string>, span = BATCH_PAGES): [number, number][] {
  const pages = [...new Set([...numbers].map(n => ir.formulas?.[n]?.page).filter((p): p is number => typeof p === "number"))].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const p of pages) { const last = out[out.length - 1]; if (last && p - last[0] < span) last[1] = p; else out.push([p, p]); }
  return out;
}
// Each batch is one Docling pass with the formula model: ~25 pages stays well inside the sidecar's 5 min call limit.
const BATCH_PAGES = 25;
const MAX_BATCHES = 3;

type FormulaJob = {
  controller: AbortController;
  promise: Promise<IR>;
  subscribers: Set<{ onDecode?: (count: number) => void }>;
};
const formulaQueues = new WeakMap<JsonStore, Map<string, { tail: Promise<unknown>; jobs: Map<string, FormulaJob> }>>();

/** Formulas are decoded only for the sections a video is made from (the formula model is ingest's heat source).
 * Starts from the cached IR (it holds earlier videos' decodes), saves the result back, and on failure falls back
 * to the PDF text layer so a token never reaches the script. */
export function withFormulas(pdfPath: string, ir: IR, ids: string[], store: JsonStore = tauriJsonStore, onDecode?: (count: number) => void, signal?: AbortSignal): Promise<IR> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  let queues = formulaQueues.get(store);
  if (!queues) formulaQueues.set(store, queues = new Map());
  const id = sourceFor(pdfPath).id;
  let queue = queues.get(id);
  if (!queue) queues.set(id, queue = { tail: Promise.resolve(), jobs: new Map() });
  const { jobs } = queue;
  const key = JSON.stringify([...new Set(ids)].sort());
  let job = jobs.get(key);
  if (!job || job.controller.signal.aborted) {
    const controller = new AbortController();
    const subscribers: FormulaJob["subscribers"] = new Set();
    const report = (count: number) => subscribers.forEach(subscriber => subscriber.onDecode?.(count));
    const run = () => decodeFormulas(pdfPath, ir, ids, store, id, report, controller.signal);
    const promise = queue.tail.then(run, run).finally(() => {
      if (jobs.get(key)?.controller === controller) jobs.delete(key);
      if (!jobs.size) queues.delete(id);
    });
    queue.tail = promise;
    jobs.set(key, job = { controller, subscribers, promise });
  }
  const { controller, promise, subscribers } = job;
  const subscriber = { onDecode };
  subscribers.add(subscriber);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => {
      subscribers.delete(subscriber);
      if (!subscribers.size) controller.abort();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    const unsubscribe = () => signal.removeEventListener("abort", abort);
    void promise.then(
      result => { unsubscribe(); resolve(result); },
      error => { unsubscribe(); reject(error); },
    );
  });
}

async function decodeFormulas(pdfPath: string, ir: IR, ids: string[], store: JsonStore, id: string, onDecode: (count: number) => void, signal: AbortSignal): Promise<IR> {
  signal.throwIfAborted();
  const cache = irCache(store);
  const latest = (await cache.get(id).catch(() => null)) ?? ir;
  signal.throwIfAborted();
  const pending = latest.formulas ?? {};
  if (!Object.keys(pending).length) return latest;
  let current = latest;
  onDecode(pendingIn(current, ids));
  try {
    // Batches save as they finish: a failure or retry keeps what was decoded, and other sidecar work runs in between.
    const batches = formulaBatches(current, pendingIds(current, ids));
    // ponytail: big selections (a whole book) skip the model and use the text layer; decoding them takes ~30+ min.
    if (batches.length > MAX_BATCHES) throw new Error("too many formulas to decode before playback");
    for (const pages of batches) {
      signal.throwIfAborted();
      current = await enrichFormulas(current, pdfPath, ids, pages, signal);
      await cache.set(id, current).catch(() => {});
      signal.throwIfAborted();
      onDecode(pendingIn(current, ids));
    }
    return current;
  } catch {
    signal.throwIfAborted();
    const left = current.formulas ?? {};
    const fill = (_: string, n: string) => left[n]?.orig ? JSON.stringify(`$$${left[n].orig}$$`).slice(1, -1) : "";
    return { ...current, sections: JSON.parse(JSON.stringify(current.sections).replace(FORMULA_TOKEN, fill)) };
  }
}

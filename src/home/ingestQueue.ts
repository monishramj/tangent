import { cachedIr, loadIr, type LoadProgress } from '../library';
import { listSections, pdfPreview, type IR, type SectionRef } from './api';
import { sectionTitles } from './sectionTitles';
import { sourceFor, type JsonStore } from '../storage/store';
import type { LLMProvider } from '../llm/provider';
import type { LibrarySource } from '../storage/library';

export type IngestItem<T> = {
  path: string; status: 'queued' | 'reading' | 'tidying' | 'preview' | 'done' | 'failed';
  value?: T; progress?: LoadProgress; error?: string; warning?: string; result: Promise<T>;
};

/** One worker, including reads requested by opening an existing source.
 * `warn` records a soft, non-blocking issue (e.g. missing preview, untidied titles): the
 * item still finishes `done` and shows a muted note. Only a thrown error marks it `failed`. */
export function ingestQueue<T>(read: (path: string, report: (progress: LoadProgress) => void, stage: (status: 'tidying' | 'preview', value: T) => void, warn: (message: string) => void) => Promise<T>) {
  let items: IngestItem<T>[] = [];
  let running = false;
  const listeners = new Set<() => void>();
  const pending: { item: IngestItem<T>; resolve: (value: T) => void; reject: (error: unknown) => void }[] = [];
  const publish = () => { items = [...items]; listeners.forEach(fn => fn()); };
  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (pending.length) {
        const { item, resolve, reject } = pending.shift()!;
        item.status = 'reading'; publish();
        try {
          const value = await read(item.path, progress => { item.progress = progress; publish(); }, (status, value) => { item.status = status; item.value = value; publish(); }, message => { item.warning = message; publish(); });
          item.value = value; item.status = 'done'; resolve(value);
        } catch (error) {
          item.status = 'failed'; item.error = String(error); reject(error);
        }
        publish();
      }
    } finally { running = false; }
  };
  const enqueue = (path: string, retry = false) => {
    const existing = items.find(item => item.path === path);
    if (existing && !(retry && (existing.status === 'failed' || existing.warning))) return existing;
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    // Background imports may have no source view awaiting their result.
    void result.catch(() => {});
    const item: IngestItem<T> = { path, status: 'queued', value: existing?.value, result };
    items = [...items.filter(item => item.path !== path), item];
    pending.push({ item, resolve, reject }); publish();
    void Promise.resolve().then(drain);
    return item;
  };
  const restore = (path: string, value: T, warning?: string) => {
    if (!items.some(item => item.path === path)) { items = [...items, { path, status: 'done', value, warning, result: Promise.resolve(value) }]; publish(); }
  };
  return { enqueue, restore, snapshot: () => items, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
}

export type PreparedSource = { ir: IR; sections: SectionRef[] };

/** Every expensive stage stays inside the same FIFO, including explicit retries. */
export function sourceQueue(store: JsonStore, provider: LLMProvider, savePreview: (path: string, preview: Awaited<ReturnType<typeof pdfPreview>>) => Promise<void>) {
  const queue = ingestQueue<PreparedSource>(async (path, report, stage, warn) => {
    // Only a failed ingest (loadIr) marks the source Failed; a missing preview or
    // untidied titles are usable (sections/IR exist), so they warn instead of throwing.
    const ir = await loadIr(path, report, store);
    const sections = await listSections(ir);
    stage('tidying', { ir, sections });
    const cleaned = await sectionTitles(sourceFor(path).id, sections, ir, store, provider, true);
    const value = { ir, sections: cleaned.sections };
    stage('preview', value);
    const source = sources.get(path);
    if (!source?.thumbnailUrl || !source.pageCount) {
      const preview = await pdfPreview(path).catch(() => undefined);
      if (!preview?.thumbnailUrl || !preview.pages) warn('No preview');
      else { await savePreview(path, preview); sources.set(path, { ...sourceFor(path), ...source, thumbnailUrl: preview.thumbnailUrl, pageCount: preview.pages }); }
    }
    if (cleaned.incomplete) warn('Some titles not tidied');
    return value;
  });
  const sources = new Map<string, LibrarySource>();
  return { ...queue,
    // Startup only reads caches here (no LLM, no preview fetch), so a source is Ready as
    // soon as its IR is cached; a missing preview or untidied titles are a quiet warning,
    // not a re-enqueue. Re-ingest only happens when the IR itself isn't cached.
    async restore(source: LibrarySource) {
      sources.set(source.pdfPath, source);
      const ir = await cachedIr(source.pdfPath, store);
      if (!ir || ir.outline_version !== 1) return;
      const sections = await listSections(ir);
      const cleaned = await sectionTitles(source.id, sections, ir, store);
      const warning = cleaned.incomplete ? 'Some titles not tidied' : !source.thumbnailUrl || !source.pageCount ? 'No preview' : undefined;
      queue.restore(source.pdfPath, { ir, sections: cleaned.sections }, warning);
    },
  };
}

export function preparationLabel(item: IngestItem<unknown>) {
  return item.status === 'queued' ? 'Queued' : item.status === 'reading' ? `Reading ${Math.round((item.progress?.fraction ?? 0) * 100)}%`
    : item.status === 'tidying' ? 'Tidying titles' : item.status === 'preview' ? 'Making preview' : item.status === 'done' ? 'Ready' : 'Failed';
}
export const isPreparing = (item?: IngestItem<unknown>) => !!item && item.status !== 'done' && item.status !== 'failed';

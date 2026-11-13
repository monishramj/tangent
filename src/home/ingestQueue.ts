import type { LoadProgress } from '../library';

export type IngestItem<T> = {
  path: string; status: 'queued' | 'reading' | 'done' | 'failed';
  progress?: LoadProgress; error?: string; result: Promise<T>;
};

/** One worker, including reads requested by opening an existing source. */
export function ingestQueue<T>(read: (path: string, report: (progress: LoadProgress) => void) => Promise<T>) {
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
          const value = await read(item.path, progress => { item.progress = progress; publish(); });
          item.status = 'done'; resolve(value);
        } catch (error) {
          item.status = 'failed'; item.error = String(error); reject(error);
        }
        publish();
      }
    } finally { running = false; }
  };
  const enqueue = (path: string, retry = false) => {
    const existing = items.find(item => item.path === path);
    if (existing && !(retry && existing.status === 'failed')) return existing;
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    // Background imports may have no source view awaiting their result.
    void result.catch(() => {});
    const item: IngestItem<T> = { path, status: 'queued', result };
    items = [...items.filter(item => item.path !== path), item];
    pending.push({ item, resolve, reject }); publish();
    void Promise.resolve().then(drain);
    return item;
  };
  return { enqueue, snapshot: () => items, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
}

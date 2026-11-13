import { beforeEach, expect, it, vi } from 'vitest';
import { sourceQueue } from './ingestQueue';
import { loadIr } from '../library';
import { listSections, pdfPreview } from './api';
import { memoryJsonStore, sourceFor } from '../storage/store';

vi.mock('../library', async orig => ({ ...await orig<typeof import('../library')>(), loadIr: vi.fn() }));
vi.mock('./api', async orig => ({ ...await orig<typeof import('./api')>(), listSections: vi.fn(), pdfPreview: vi.fn() }));
const sections = [{ id: 's', title: 'Heaps', level: 1, anchors: [] }];
const ir = { outline_version: 1, sections: [{ ...sections[0], children: [] }] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadIr).mockResolvedValue(ir);
  vi.mocked(listSections).mockResolvedValue(sections);
  vi.mocked(pdfPreview).mockResolvedValue({ pages: 1, thumbnailUrl: 'page.png' });
});
it('holds the FIFO through titles and thumbnail saving and shares a job while open', async () => {
  let finish!: (value: string) => void;
  const order: string[] = [];
  vi.mocked(loadIr).mockImplementation(async path => { order.push(`ingest:${path}`); return ir; });
  const provider = { complete: vi.fn().mockImplementationOnce(() => { order.push('titles:a'); return new Promise<string>(resolve => { finish = resolve; }); }).mockResolvedValue('{"s":"Heaps"}') };
  const queue = sourceQueue(memoryJsonStore(), provider, async path => { order.push(`preview:${path}`); });
  const a = queue.enqueue('a.pdf'), b = queue.enqueue('b.pdf');
  await vi.waitFor(() => expect(a.status).toBe('tidying'));
  expect(a.value?.sections).toEqual(sections);
  expect(queue.enqueue('a.pdf')).toBe(a);
  expect(order).toEqual(['ingest:a.pdf', 'titles:a']);
  expect(b.status).toBe('queued');
  finish('{"s":"Binary heaps"}');
  await b.result;
  expect(order).toEqual(['ingest:a.pdf', 'titles:a', 'preview:a.pdf', 'ingest:b.pdf', 'preview:b.pdf']);
  expect(queue.enqueue('a.pdf')).toBe(a);
});
it('keeps a source usable with a quiet warning when title cleanup fails, and explicit retry clears it', async () => {
  const source = sourceFor('a.pdf');
  const store = memoryJsonStore({ [`ir-${source.id}`]: ir, [`titles-${source.id}`]: { signature: JSON.stringify([['s', 'Heaps']]), titles: [null] } });
  const provider = { complete: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('{"s":"Heaps"}') };
  const save = vi.fn().mockResolvedValue(undefined);
  const queue = sourceQueue(store, provider, save);
  const a = queue.enqueue('a.pdf');
  await a.result; // no longer rejects: sections/IR are usable, so it finishes done with a warning
  expect(a.status).toBe('done');
  expect(a.warning).toBe('Some titles not tidied');
  expect(a.value?.sections).toEqual(sections);
  const retry = queue.enqueue('a.pdf', true);
  expect(queue.enqueue('a.pdf', true)).toBe(retry);
  await retry.result;
  expect(retry.status).toBe('done');
  expect(retry.warning).toBeUndefined();
  expect(provider.complete).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenCalledTimes(1);
});
it('restore marks an untidied, preview-less source done from cache alone, and never re-ingests it', async () => {
  const source = sourceFor('a.pdf');
  const store = memoryJsonStore({ [`ir-${source.id}`]: ir, [`titles-${source.id}`]: { signature: JSON.stringify([['s', 'Heaps']]), titles: [null] } });
  const provider = { complete: vi.fn().mockResolvedValue('{}') }, save = vi.fn();
  const queue = sourceQueue(store, provider, save);
  await queue.restore(source); // no thumbnailUrl/pageCount, incomplete title cache
  const a = queue.enqueue(source.pdfPath);
  expect(a.status).toBe('done');
  expect(a.warning).toBe('Some titles not tidied');
  expect(loadIr).not.toHaveBeenCalled();
  expect(provider.complete).not.toHaveBeenCalled();
  expect(pdfPreview).not.toHaveBeenCalled();
  // The warning only clears through the explicit retry, which does run the real pipeline.
  const retry = queue.enqueue(source.pdfPath, true);
  expect(retry).not.toBe(a);
  await retry.result;
  expect(loadIr).toHaveBeenCalledTimes(1);
});
it('hydrates prepared sources without ingest, LLM or preview and never repeats them', async () => {
  const source = sourceFor('ready.pdf');
  const store = memoryJsonStore({ [`ir-${source.id}`]: ir, [`titles-${source.id}`]: { signature: JSON.stringify([['s', 'Heaps']]), titles: ['Binary heaps'] } });
  const provider = { complete: vi.fn() }, save = vi.fn();
  const queue = sourceQueue(store, provider, save);
  await queue.restore({ ...source, thumbnailUrl: 'page.png', pageCount: 1 });
  expect((await queue.enqueue(source.pdfPath).result).sections[0].title).toBe('Binary heaps');
  expect(loadIr).not.toHaveBeenCalled();
  expect(provider.complete).not.toHaveBeenCalled();
  expect(pdfPreview).not.toHaveBeenCalled();
});
it('keeps a source usable with a quiet warning when the preview fails, and explicit retry clears it', async () => {
  vi.mocked(pdfPreview).mockRejectedValueOnce(new Error('preview broke'));
  const provider = { complete: vi.fn().mockResolvedValue('{"s":"Heaps"}') };
  const save = vi.fn().mockResolvedValue(undefined);
  const queue = sourceQueue(memoryJsonStore(), provider, save);
  const a = queue.enqueue('a.pdf');
  await a.result; // no longer rejects
  expect(a.status).toBe('done');
  expect(a.warning).toBe('No preview');
  expect(save).not.toHaveBeenCalled();
  const retry = queue.enqueue('a.pdf', true);
  await retry.result;
  expect(retry.status).toBe('done');
  expect(retry.warning).toBeUndefined();
  expect(save).toHaveBeenCalledTimes(1);
  // Titles were already cached complete by the first attempt, so retry doesn't re-call the LLM.
  expect(provider.complete).toHaveBeenCalledTimes(1);
});
